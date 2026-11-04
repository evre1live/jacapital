// Движок стратегий: дневной тренд с ML-фильтром, фандинг-арбитраж (виртуальный счёт) и возврат к среднему на часовых.
// Решения принимаются на закрытии свечей тем же кодом, что проверяется в бэктесте (strategies.js); агенты офиса их озвучивают.
import * as S from './strategies.js';
import {symbolFor, describeError} from './exchange.js';
import {fmtUSD, fmtPct, sideRu} from './brain.js';

const DAY = S.DAY, H = S.HOUR, FUND = 8 * H;
export const STRATS = {
  trend: {name: 'Тренд-ансамбль', short: 'тренд'},
  carry: {name: 'Фандинг-арбитраж', short: 'фандинг', paperOnly: true},
  mr: {name: 'Возврат к среднему', short: 'возврат'},
};
export const RISK_P = {ddBrake: 0.08, ddStop: 0.15, maxGross: 1.0, minTrade: 10};
export const RISK_LIMITS = {ddBrake: [0.03, 0.2], ddStop: [0.06, 0.3], maxGross: [0.3, 1.5]};
export const DEFAULT_ALLOC = {trend: 0.5, carry: 0.5, mr: 0, legacy: 0};   // до первого бэктеста; дальше доли задаёт его результат
export const PARAM_SPACE = {trend: S.TREND_LIMITS, carry: S.CARRY_LIMITS, mr: S.MR_LIMITS, risk: RISK_LIMITS};
export function defaultParams(){ return {trend: {...S.TREND_P}, carry: {...S.CARRY_P}, mr: {...S.MR_P}, risk: {...RISK_P}}; }
const pct = x => fmtPct(x, 1);
const r3 = x => Math.round(x * 1000) / 1000;
const num = (x, d = 2) => x.toFixed(d).replace('.', ',');

export class Engine {
  constructor({office, market, CFG}){
    this.office = office; this.market = market; this.ex = market.ex; this.CFG = CFG;
    this.d = {}; this.h = {}; this.f = {}; this.ok = false; this.busy = false; this.err = '';
    const st = office.state;
    st.strat ||= {};
    st.strat.params = {...defaultParams(), ...(st.strat.params || {})};
    for (const k of Object.keys(defaultParams())) st.strat.params[k] = {...defaultParams()[k], ...(st.strat.params[k] || {})};
    st.strat.alloc ||= {...DEFAULT_ALLOC};
    st.strat.status ||= {trend: 'тест', carry: 'тест', mr: 'тест'};
    st.strat.mr ||= {};              // открытые сделки возврата к среднему: монета → {t0, entry, stop}
    st.strat.carryOn ||= {};         // монеты, по которым включён фандинг-арбитраж
    st.strat.last ||= {};            // время последних обработанных свечей и событий фандинга
    st.strat.since ||= Date.now();   // начало проверки на виртуальном счёте
    this.view = null;                // последние цели и показатели — для интерфейса
  }
  get st(){ return this.office.state.strat; }
  get P(){ return this.st.params; }
  get coins(){ return Object.keys(this.market.coins); }
  // монеты, по которым стратегии открывают сделки; остальные (выбывшие из набора) только закрываются
  get active(){ const a = this.CFG.coinsActive; return a && a.length ? this.coins.filter(s => a.includes(s)) : this.coins; }

  // ---------- данные ----------
  async fetchCols(sym, tf, limit){
    const rows = await this.ex.fetchOHLCV(symbolFor(sym, this.CFG.marketType), tf, undefined, limit);
    const ms = tf === '1d' ? DAY : H, now = Date.now();
    const ks = rows.filter(r => r && r[4] != null && r[0] + ms <= now).map(r => ({t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4]}));
    return S.toCols(ks);
  }
  async loadDaily(){ for (const s of this.coins) this.d[s] = await this.fetchCols(s, '1d', 520); }
  async loadHourly(){ for (const s of this.coins) this.h[s] = await this.fetchCols(s, '1h', Math.max(300, this.P.mr.trendMa + 60)); }
  async loadFunding(){
    if (!this.ex.fetchFundingRateHistory) return;
    for (const s of this.coins){
      try { const rows = await this.ex.fetchFundingRateHistory(symbolFor(s, 'swap'), Date.now() - 25 * DAY, 100); this.f[s] = rows.map(r => ({t: r.timestamp, r: +r.fundingRate || 0})).sort((a, b) => a.t - b.t); }
      catch (e) { if (!this.f[s]) this.f[s] = []; }
    }
  }
  async init(){
    try { await this.loadDaily(); if ((this.st.alloc.mr || 0) > 0) await this.loadHourly(); await this.loadFunding(); this.ok = true; this.err = ''; }
    catch (e) { this.err = describeError(e); console.warn('[engine] загрузка истории:', this.err); }
  }

  // владелец включает или выключает стратегию на реальном счёте (без 21-дневной проверки — его решение)
  async setReal(on, why = 'по решению владельца'){
    const off = this.office, gate = off.state.gate;
    if (on){ gate.trend = {real: true, manual: true, ts: Date.now(), why}; this.st.status.trend = 'на реальном счёте (решение владельца)'; }
    else {
      for (const k of Object.keys(gate)) if (gate[k]) gate[k] = {...gate[k], real: false, off: Date.now()};
      this.st.status.trend = 'проверка на виртуальном счёте';
      // закрыть позиции стратегий на реальных счетах
      for (const a of Object.values(off.accounts).filter(a => a.real && a.ready)){
        for (const p of off.state.books[a.id].positions.filter(p => p.strategy && !p.closing)){ const c = await off.closePosition(p, 'стратегия остановлена на реальном счёте', a.id); if (c) off.post('aliya', null, `«${a.label}»: закрыл ${sideRu(c.dir)} ${c.sym} ${fmtUSD(c.pnl, true)} — стратегия остановлена.`, 'trade'); }
      }
    }
    off.touch(); this.kick();
  }
  setRealMult(id, v){ const k = Math.max(0.5, Math.min(3, +v || 1)); (this.st.realMult ||= {})[id] = k; this.office.touch(); this.kick(); return k; }
  kick(){ this.st.kick = true; setTimeout(() => this.tick(), 500); }

  // ---------- расписание: вызывается раз в минуту ----------
  async tick(){
    if (this.busy) return; this.busy = true;
    try {
      if (!this.ok) await this.init();
      if (!this.ok) return;
      // набор монет изменился (еженедельный пересчёт самых ликвидных) — сразу привести позиции к целям
      const key = this.active.join(','); if (this.st.coinsKey !== key){ const first = !this.st.coinsKey; this.st.coinsKey = key; this.st.kick = first ? 'набор монет расширен' : 'обновился набор монет'; }
      const now = Date.now(), last = this.st.last;
      const dayBar = Math.floor(now / DAY) * DAY - DAY, hourBar = Math.floor(now / H) * H - H, fundEv = Math.floor(now / FUND) * FUND;
      // дневная свеча закрылась (через минуту после полуночи UTC — чтобы биржа успела её отдать)
      if (last.day !== dayBar && now - (dayBar + DAY) > 60e3){ await this.loadDaily(); await this.loadFunding(); last.day = dayBar; await this.daily(); }
      if (last.hour !== hourBar && now - (hourBar + H) > 30e3){ if ((this.st.alloc.mr || 0) > 0) await this.loadHourly(); last.hour = hourBar; await this.hourly(); }
      if (last.fund !== fundEv && now - fundEv > 3 * 60e3){ await this.loadFunding(); await this.funding(fundEv); last.fund = fundEv; }
      if (this.st.kick){ const why = typeof this.st.kick === 'string' ? this.st.kick : 'изменились настройки счёта'; this.st.kick = false; await this.rebalance(why); this.office.touch(); }
    } catch (e) { console.error('[engine]', e); this.err = String(e.message || e); }
    finally { this.busy = false; }
  }

  // ---------- риск (Аки): тормоз при просадке и предел общей позиции ----------
  riskScale(id = 'paper'){
    const pf = this.office.state.books[id], eq = this.office.equity(pf), R = this.P.risk, now = Date.now();
    // после аварийной остановки — 14 дней без позиций, затем отсчёт просадки начинается заново
    const halt = (this.st.halt ||= {})[id];
    if (halt && now - halt > 14 * DAY){ pf.peak = eq; delete this.st.halt[id]; }
    const dd = pf.peak > 0 ? 1 - eq / pf.peak : 0;
    if (dd >= R.ddStop || this.st.halt[id]){ if (!this.st.halt[id]) this.st.halt[id] = now; return {k: 0, dd, why: `просадка ${pct(-dd)} от пика — сработал аварийный порог ${pct(-R.ddStop)}: позиции закрыты на 14 дней`}; }
    if (dd >= R.ddBrake) return {k: 0.5, dd, why: `просадка ${pct(-dd)} от пика — размеры вдвое меньше`};
    return {k: 1, dd, why: ''};
  }
  mlMult(series){
    const m = this.st.model; const out = {}; for (const s of this.coins) out[s] = {mult: 1, p: null};
    if (!m || !m.w) return out;
    const feats = S.mlFeatures(this.d, series, this.f);
    for (const s of this.coins){ const F = feats[s]; if (!F) continue; const i = this.d[s].n - 1; if (!F[i]) continue; const p = S.predictLogit(m, F[i]); out[s] = {mult: S.multFromProb(p, m), p}; }
    return out;
  }
  // целевые доли капитала по монетам от тренда (без учёта распределения между стратегиями)
  trendTargets(){
    const P = this.P.trend, syms = this.active.filter(s => this.d[s] && this.d[s].n > 120), N = this.active.length, series = {};
    for (const s of syms) series[s] = S.trendSeries(this.d[s], P);
    const ml = this.mlMult(series), out = {};
    for (const s of syms){ const i = this.d[s].n - 1, sg = series[s].sig[i], sc = series[s].scale[i], C = this.d[s].c;
      out[s] = {w: sg * sc * ml[s].mult / N, sig: sg, scale: sc, p: ml[s].p, mult: ml[s].mult, on: Math.round(sg * P.lbs.length), of: P.lbs.length, r30: i >= 30 ? C[i] / C[i - 30] - 1 : 0}; }
    return out;
  }
  mrTargets(){
    const out = {}, N = this.active.length;
    for (const s of this.active){ const o = this.st.mr[s]; out[s] = {w: o ? 1 / N : 0}; }
    return out;
  }
  books(){
    const off = this.office, gate = off.state.gate || {}, anyReal = Object.values(gate).some(g => g && g.real);
    return Object.values(off.accounts).filter(a => a.ready && off.state.books[a.id] && (a.kind === 'paper' || (anyReal && a.real))).map(a => a.id);
  }
  // собрать цели всех направленных стратегий и привести позиции к ним — на каждом счёте, который ведёт движок
  async rebalance(why, stages){
    const ids = this.books(); let main = null;
    for (const id of ids){ const r = await this.rebalanceBook(why, id === 'paper' ? stages : null, id); if (id === 'paper') main = r; }
    return main;
  }
  // доли стратегий на конкретном счёте: на реальном — только допущенные и доступные (фандинг-арбитражу нужен спот), их доли растягиваются до 100%
  allocFor(id){
    const off = this.office, acc = off.accounts[id], A = this.st.alloc, out = {};
    if (!acc.real) return {...A};
    let z = 0; for (const k of Object.keys(STRATS)){ out[k] = off.realAllowed(k) && !STRATS[k].paperOnly ? (A[k] || 0) : 0; z += out[k]; }
    if (z > 0) for (const k of Object.keys(out)) out[k] /= z;
    return out;
  }
  multFor(id){ const acc = this.office.accounts[id]; return acc.real ? Math.max(0.5, Math.min(3, (this.st.realMult || {})[id] || 1)) : 1; }
  async rebalanceBook(why, stages, id){
    const off = this.office, book = off.state.books[id], acc = off.accounts[id], eq = off.equity(book), A = this.allocFor(id), R = this.P.risk, risk = this.riskScale(id), mult = this.multFor(id);
    const tag = acc.real ? `«${acc.label}»: ` : '';
    const tt = this.trendTargets(), mt = this.mrTargets(), res = [], skips = [];
    // небольшой реальный счёт: капитал делится не на все монеты, а на K с самым сильным трендом (иначе доли меньше минимального ордера)
    const K = acc.real ? Math.min(this.CFG.realTopK || 5, this.active.length) : 0;
    // монеты, где даже полная доля меньше минимального ордера биржи (у BTC — $50–100), в отбор не берём: место займёт следующая
    const fits = s => { const x = tt[s], c = this.market.coins[s], min = acc.broker && acc.broker.minCost && c ? acc.broker.minCost(c.symbol) : 0;
      return !min || eq * (A.trend || 0) * mult * risk.k * x.sig * x.scale * x.mult / K >= min; };
    const sel = K ? S.topK(Object.entries(tt).filter(([s]) => fits(s)).map(([s, x]) => ({s, sig: x.sig, r30: x.r30})), K) : null;
    const tw = {}, mw = {};
    for (const s of this.coins){
      const x = tt[s], base = !x ? 0 : sel ? (sel.has(s) ? x.sig * x.scale * x.mult / K : 0) : x.w;
      tw[s] = (A.trend || 0) * base * risk.k * mult; mw[s] = (A.mr || 0) * (mt[s] ? mt[s].w : 0) * risk.k * mult; }
    // предел общей позиции по направленным стратегиям
    const gross = this.coins.reduce((a, s) => a + Math.abs(tw[s]) + Math.abs(mw[s]), 0), cap = gross > R.maxGross ? R.maxGross / gross : 1;
    for (const [strategy, W] of [['trend', tw], ['mr', mw]]){
      for (const s of this.coins){
        const px = this.market.coins[s] && this.market.coins[s].price; if (!px) continue;
        const target = W[s] * cap * eq / px, cur = off.stratPos(strategy, s, book), q = cur ? cur.qty * cur.dir : 0;
        // на бирже позиции по монете складываются: пока висит позиция прежних агентов, стратегия эту монету не трогает
        if (acc.kind === 'exchange' && book.positions.some(p => p.sym === s && !p.strategy && !p.closing)){ if (target) skips.push(`${s}: ждём закрытия позиции прежних агентов`); continue; }
        // допуск: не дёргать позицию из-за мелких изменений цели (как в бэктесте)
        const band = this.P.trend.band;
        if (target === 0 && q === 0) continue;
        if (target !== 0 && q !== 0 && Math.sign(target) === Math.sign(q) && Math.abs(target - q) <= band * Math.abs(q)) continue;
        const ctx = strategy === 'trend' ? {conf: tt[s] && tt[s].p != null ? tt[s].p : 0.5, sig: r3(tt[s] ? tt[s].sig : 0), scale: r3(tt[s] ? tt[s].scale : 0), mlP: tt[s] && tt[s].p != null ? r3(tt[s].p) : null, mult: r3(tt[s] ? tt[s].mult : 1), risk: risk.k, dd: r3(risk.dd), why}
          : {conf: 0.5, rsi: this.st.mr[s] ? this.st.mr[s].rsi : null, risk: risk.k, why};
        const r = await off.adjust(strategy, s, target, ctx, why, id);
        if (r && r.done) res.push(...r.done.map(x => ({...x, strategy})));
        else if (r && r.skip) skips.push(`${s}: ${r.skip}`);
      }
    }
    if (id === 'paper') this.view = {ts: Date.now(), trend: tt, risk, alloc: {...A}, eq};
    if (acc.real){
      const moves = res.map(x => `${x.act === 'close' ? 'закрыл' : x.act === 'reduce' ? 'сократил' : x.act === 'add' ? 'докупил' : 'открыл'} ${x.dir < 0 && (x.act === 'open' || x.act === 'add') ? 'шорт ' : ''}${x.sym} на ${fmtUSD(x.usd)}`);
      if (res.length) off.post('aliya', null, `${tag}${moves.join('; ')}.`, 'trade');
      console.log(`[engine] ${acc.label} (${why}, размер ×${mult}, капитал ${eq.toFixed(2)}): ${moves.length ? moves.join('; ') : 'без сделок'}${skips.length ? ' | пропущено: ' + skips.join('; ') : ''}`);
    }
    if (stages){
      const moves = res.map(x => `${x.act === 'close' ? 'закрыл' : x.act === 'reduce' ? 'сократил' : x.act === 'add' ? 'докупил' : 'открыл'} ${x.dir < 0 && x.act !== 'close' && x.act !== 'reduce' ? 'шорт ' : ''}${x.sym} на ${fmtUSD(x.usd)}${x.pnl != null ? ` (${fmtUSD(x.pnl, true)})` : ''}`);
      stages.push({agent: 'aliya', say: res.length ? `Сделок: ${res.length}` : 'Позиции в норме'});
      off.post('aliya', null, res.length ? `Ребалансировка: ${moves.join('; ')}.` + (skips.length ? ` Пропущено — ${skips.slice(0, 3).join('; ')}.` : '') : `Изменений нет: позиции в пределах допуска${skips.length ? `; пропущено — ${skips.slice(0, 3).join('; ')}` : ''}.`, 'trade');
    }
    return {res, skips, risk, tt};
  }

  // ---------- дневное закрытие: тренд, ML, риск ----------
  async daily(){
    const off = this.office, stages = [], tt = this.trendTargets(), risk = this.riskScale('paper');
    const on = Object.entries(tt).filter(([, x]) => x.sig > 0).sort((a, b) => b[1].sig - a[1].sig);
    const fund = this.coins.map(s => [s, this.fundApr(s, 21)]).filter(([, a]) => a != null).sort((a, b) => b[1] - a[1]);
    const more = (n, k) => n > k ? ` и ещё ${n - k}` : '';
    off.post('nika', 'boris', `Дневная свеча закрыта. В восходящем тренде ${on.length} из ${Object.keys(tt).length} монет${on.length ? ': ' + on.slice(0, 8).map(([s, x]) => `${s} ${x.on}/${x.of}`).join(', ') + more(on.length, 8) : ''}.` + (fund.length ? ` Фандинг за неделю: ${fund.slice(0, 3).map(([s, a]) => `${s} ${pct(a)} годовых`).join(', ')}.` : ''), 'brief');
    stages.push({agent: 'nika', kind: 'scan', say: on.length ? `Тренд: ${on.slice(0, 3).map(([s]) => s).join(', ')}` : 'Трендов нет'});
    const vols = on.slice(0, 3).map(([s, x]) => `${s} ×${num(x.scale)}`);
    off.post('boris', 'timur', `Размер по волатильности: ${vols.length ? vols.join(', ') : 'позиций нет'}. ${risk.why ? risk.why[0].toUpperCase() + risk.why.slice(1) + '.' : `Просадка от пика ${pct(-risk.dd)} — в норме.`}`, 'risk');
    stages.push({agent: 'boris', say: risk.k < 1 ? `Тормоз: ×${risk.k}` : 'Риск в норме'});
    const A = this.st.alloc, eq = off.equity(off.state.books.paper);
    const tgt = on.filter(([, x]) => x.w * (A.trend || 0) * risk.k > 0).map(([s, x]) => `${s} ${pct(x.w * (A.trend || 0) * risk.k)} капитала${x.p != null ? ` (ML ${Math.round(x.p * 100)}%, ×${num(x.mult)})` : ''}`);
    off.post('timur', 'aliya', `Цели тренда: ${tgt.length ? tgt.slice(0, 8).join(', ') + (tgt.length > 8 ? ` и ещё ${tgt.length - 8}` : '') : risk.k === 0 ? 'вне рынка до конца аварийной паузы' : 'вне рынка'}. Доля стратегии в капитале — ${Math.round((A.trend || 0) * 100)}% от ${fmtUSD(eq)} (виртуальный счёт).`, 'signal');
    stages.push({agent: 'timur', say: tgt.length ? `Целей: ${tgt.length}` : 'Вне рынка'});
    await this.rebalance('дневное закрытие', stages);
    off.emit('run', {id: off.ctx.id(), ts: Date.now(), news: false, stages}); off.touch();
    this.dailyPnl();
  }

  // ---------- часовое закрытие: возврат к среднему ----------
  async hourly(){
    const off = this.office, P = this.P.mr, A = this.st.alloc; if (!(A.mr > 0)) return;
    const acts = [];
    for (const s of this.active){
      const c = this.h[s]; if (!c || c.n < P.trendMa + 5) continue;
      const ind = S.mrIndicators(c, P), i = c.n - 1, o = this.st.mr[s];
      const pos = o ? {i0: Math.max(0, S.idxAtOrBefore(c, o.t0)), entry: o.entry, stop: o.stop} : null;
      const d = S.mrDecide(ind, i, pos, P);
      if (d.act === 'enter'){ this.st.mr[s] = {t0: c.t[i], entry: c.c[i], stop: d.stop, rsi: Math.round(ind.rsi[i])}; acts.push({s, act: 'вход', rsi: ind.rsi[i]}); }
      else if (d.act === 'exit'){ delete this.st.mr[s]; acts.push({s, act: 'выход', why: d.why}); }
    }
    if (!acts.length) return;
    const stages = [{agent: 'timur', say: `Возврат: ${acts.map(a => `${a.act} ${a.s}`).join(', ')}`}];
    off.post('timur', 'aliya', 'Возврат к среднему (часовые): ' + acts.map(a => a.act === 'вход' ? `${a.s} — RSI-2 ${a.rsi.toFixed(0)} при восходящем тренде, вход` : `${a.s} — выход (${a.why})`).join('; ') + '.', 'signal');
    await this.rebalance('возврат к среднему', stages);
    off.emit('run', {id: off.ctx.id(), ts: Date.now(), news: false, stages}); off.touch();
  }

  // ---------- фандинг: начисление и решения по арбитражу (только виртуальный счёт) ----------
  fundApr(s, n){ const f = this.f[s]; if (!f || !f.length) return null; const x = f.slice(-n); return x.reduce((a, v) => a + v.r, 0) / x.length * 1095; }
  async funding(ev){
    const off = this.office, pf = off.state.books.paper, P = this.P.carry, A = this.st.alloc;
    // 1) начислить фандинг за прошедшее событие по открытым позициям
    let got = 0;
    for (const pos of pf.positions.filter(p => p.kind === 'carry')){
      const f = this.f[pos.sym] || [], e = f.find(x => Math.abs(x.t - ev) < 60e3) || null;
      if (e && pos.lastEv !== e.t){ got += off.creditCarry(pos, e.r); pos.lastEv = e.t; }
    }
    // 2) решения: включить или выключить по каждой монете
    if (!(A.carry > 0)) { for (const pos of pf.positions.filter(p => p.kind === 'carry')) off.closeCarry(pos, 'стратегия выключена'); return; }
    const msgs = [], eq = off.equity(pf), slot = eq * A.carry / this.active.length * S.carryYieldShare(P);
    for (const s of this.coins){
      if (!this.active.includes(s)){ const pos = pf.positions.find(p => p.kind === 'carry' && p.sym === s); if (pos){ const c = off.closeCarry(pos, 'монета выбыла из набора'); if (c) msgs.push(`закрыл ${s}: монета выбыла из набора`); } continue; }
      const f = this.f[s]; if (!f || f.length < P.nEnter + 1) continue;
      const states = S.carryStates([...f, {t: ev + FUND, r: 0}], P), want = states[states.length - 1];
      const pos = pf.positions.find(p => p.kind === 'carry' && p.sym === s);
      if (want && !pos){ const p = off.openCarry(s, slot, P, {apr: r3(this.fundApr(s, P.nEnter)), costRate: P.cost}); if (p) msgs.push(`открыл ${s}: спот + шорт на ${fmtUSD(slot)}, фандинг ${pct(this.fundApr(s, P.nEnter))} годовых`); }
      else if (!want && pos){ const c = off.closeCarry(pos, 'фандинг ниже порога'); if (c) msgs.push(`закрыл ${s}: итог ${fmtUSD(c.pnl, true)}`); }
    }
    if (msgs.length){ off.post('aliya', null, `Фандинг-арбитраж (виртуально): ${msgs.join('; ')}.`, 'trade'); off.emit('run', {id: off.ctx.id(), ts: Date.now(), news: false, stages: [{agent: 'timur', say: 'Фандинг-арбитраж'}, {agent: 'aliya', say: msgs[0].slice(0, 46)}]}); }
    off.touch();
  }
  // реализованный результат по стратегиям на виртуальном счёте с начала проверки
  dailyPnl(){
    const pf = this.office.state.books.paper, since = this.st.since, out = {};
    for (const c of pf.closed) if (c.tsClose >= since && c.strategy) out[c.strategy] = (out[c.strategy] || 0) + c.pnl;
    for (const p of pf.positions) if (p.strategy && p.kind !== 'carry') out[p.strategy] = (out[p.strategy] || 0) + this.office.upnl(p) - p.fees;
    for (const p of pf.positions) if (p.kind === 'carry') out.carry = (out.carry || 0) + p.funding - p.fees;
    this.st.paperPnl = out; return out;
  }
  publicView(){
    const st = this.st, tt = this.view && this.view.trend || {};
    const realAcc = Object.values(this.office.accounts).find(a => a.real && a.kind === 'exchange');
    const real = realAcc ? {id: realAcc.id, label: realAcc.label, ready: !!realAcc.ready, on: !!(this.office.state.gate.trend && this.office.state.gate.trend.real), mult: this.multFor(realAcc.id), topK: this.CFG.realTopK || 5, auto: !!(this.office.state.books[realAcc.id] || {}).auto,
      positions: ((this.office.state.books[realAcc.id] || {}).positions || []).filter(p => p.strategy).length} : null;
    return {ok: this.ok, err: this.err, real, alloc: st.alloc, params: st.params, status: st.status, gate: this.office.state.gate, since: st.since, paperPnl: this.dailyPnl(), model: st.model ? {ts: st.model.ts, n: st.model.n, auc: st.model.auc} : null,
      mr: st.mr, carry: Object.fromEntries(this.coins.map(s => [s, this.fundApr(s, 21)])), trend: Object.fromEntries(Object.entries(tt).map(([s, x]) => [s, {sig: r3(x.sig), w: r3(x.w), p: x.p != null ? r3(x.p) : null}])), risk: this.view ? this.view.risk : null, names: STRATS};
  }
}
