// Офис: состояние, конвейер Леон → Генри → Марк → Диана, сделки, сохранение, Claude
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import * as B from './brain.js';
import {ask, askJSON, aiEnabled} from './claude.js';
const {sideRu, fmtUSD, fmtPct, fmtPrice, fmtQty, clamp} = B;

const AGENTS = {
  nika:  {name: 'Леон',  role: 'аналитик трендов и новостей', persona: 'энергичный и любопытный, всегда называет источник новости и его надёжность'},
  boris: {name: 'Генри', role: 'риск-менеджер сделок',        persona: 'осторожный педант с сухим юмором, мыслит стопами и размером риска'},
  timur: {name: 'Марк', role: 'стратег сигналов',            persona: 'уверенный, говорит процентами уверенности и порогами'},
  aliya: {name: 'Диана',  role: 'трейдер-исполнитель',         persona: 'собранная и лаконичная, отчитывается ордерами и результатом в долларах'},
};

function freshState(CFG){
  return {
    v: 2, ids: 1, createdAt: Date.now(), mode: CFG.mode, exchange: CFG.exchange, exchangeEnv: CFG.exchangeEnv,
    profile: 'balanced', params: {...B.PROFILES.balanced}, auto: true, tradingOn: true,
    pf: {cash: CFG.paperCash, startEquity: CFG.paperCash, positions: [], closed: [], fees: 0, dayKey: '', dayStart: CFG.paperCash, killed: false, curve: [], peak: CFG.paperCash, maxDD: 0, initialised: CFG.mode === 'paper'},
    news: [], seenNews: [], brief: null, evals: [], evalLog: [], signals: [], sigLog: [], pending: [], orders: [], feed: [],
    stats: {nika: {news: 0, briefs: 0, reliable: 0}, boris: {evals: 0, ok: 0, caution: 0, reject: 0}, timur: {signals: 0, confSum: 0, closes: 0, below: 0}, aliya: {orders: 0, skips: 0, errors: 0}},
  };
}

export class Office extends EventEmitter {
  constructor({CFG, market, broker}){
    super();
    this.CFG = CFG; this.market = market; this.broker = broker;
    this.file = path.join(CFG.dataDir, 'state.json');
    this.state = this.load();
    this.running = false; this.again = null; this.lastFocusAt = 0; this.saveT = null;
    this.ctx = {coins: market.coins, state: this.state, id: () => this.state.ids++, equity: () => this.equity(), marketType: CFG.marketType, maxOrderUsd: CFG.maxOrderUsd};
  }
  // ---------- хранение ----------
  load(){
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (s.v === 2 && s.mode === this.CFG.mode && s.exchange === this.CFG.exchange && s.exchangeEnv === this.CFG.exchangeEnv) { console.log('[office] состояние загружено'); return s; }
      console.log('[office] режим изменился — начинаю с чистого листа');
    } catch {}
    return freshState(this.CFG);
  }
  save(){
    try { fs.mkdirSync(this.CFG.dataDir, {recursive: true}); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.state)); fs.renameSync(tmp, this.file); }
    catch (e) { console.warn('[office] не удалось сохранить:', e.message); }
  }
  touch(){ this.emit('state'); clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save(), 4000); }

  // ---------- деньги ----------
  price(sym){ const c = this.market.coins[sym]; return c ? c.price : 0; }
  upnl(p){ return (this.price(p.sym) - p.entry) * p.qty * p.dir; }
  equity(){ let e = this.state.pf.cash; for (const p of this.state.pf.positions) e += p.entry * p.qty + this.upnl(p); return e; }
  dayKey(ts = Date.now()){ return new Intl.DateTimeFormat('en-CA', {timeZone: this.CFG.tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ts)); }

  async initAccount(){
    const pf = this.state.pf;
    if (this.CFG.mode !== 'exchange') { if (!pf.dayKey){ pf.dayKey = this.dayKey(); pf.dayStart = this.equity(); } return; }
    const bal = await this.broker.balance();
    if (!pf.initialised && bal){
      pf.cash = bal.total || bal.free || 0; pf.startEquity = pf.cash; pf.dayStart = pf.cash; pf.peak = pf.cash; pf.initialised = true;
      this.post('system', null, `Подключен счёт ${this.venue()}: ${fmtUSD(pf.cash)} USDT. Агенты начинают работу.`, 'system');
    }
    if (!pf.dayKey){ pf.dayKey = this.dayKey(); pf.dayStart = this.equity(); }
    await this.reconcile(true);
    this.touch();
  }
  // сверка с биржей: позиции, закрытые вне офиса, и позиции, открытые без нас (только фьючерсы)
  async reconcile(adopt = false){
    if (this.CFG.mode !== 'exchange' || this.CFG.marketType !== 'swap') return;
    const pf = this.state.pf;
    const live = await this.broker.openPositions(Object.values(this.market.coins).map(c => c.symbol));
    if (live === null) return;
    for (const pos of [...pf.positions]){
      if (pos.closing || Date.now() - pos.ts < 60000) continue;
      if (live.some(lp => lp.symbol === pos.symbol && lp.dir === pos.dir)) continue;
      const px = this.price(pos.sym) || pos.entry;
      const gross = (px - pos.entry) * pos.qty * pos.dir;
      pf.cash += pos.entry * pos.qty + gross; pf.positions = pf.positions.filter(x => x !== pos);
      const c = {id: pos.id, sym: pos.sym, dir: pos.dir, qty: pos.qty, entry: pos.entry, exit: px, ts: pos.ts, tsClose: Date.now(), pnl: gross - pos.fees, pct: (gross - pos.fees) / (pos.entry * pos.qty), reason: 'закрыта вне офиса', conf: pos.conf};
      pf.closed.unshift(c);
      this.post('aliya', null, `Позиции ${sideRu(pos.dir)} ${pos.sym} больше нет на бирже — похоже, её закрыли вручную или биржа ликвидировала. Убрала из учёта (оценка ${fmtUSD(c.pnl, true)}).`, 'system');
    }
    if (!adopt) { this.touch(); return; }
    for (const lp of live){
      const c = Object.values(this.market.coins).find(x => x.symbol === lp.symbol); if (!c) continue;
      if (pf.positions.some(p => p.symbol === lp.symbol)) continue;
      const atr = B.indicators(c).atr; const stop = 1.6 * atr;
      pf.positions.push({id: this.ctx.id(), sym: c.sym, symbol: c.symbol, dir: lp.dir, qty: lp.qty, entry: lp.entry, sl: lp.entry - lp.dir * stop, tp: lp.entry + lp.dir * stop * this.state.params.rr, stop, ts: Date.now(), riskUSD: lp.qty * stop, conf: 0, fees: 0, be: false, adopted: true});
      pf.cash -= lp.entry * lp.qty;
      this.post('aliya', null, `Нашла на бирже открытую позицию ${sideRu(lp.dir)} ${c.sym} ${fmtQty(lp.qty, lp.entry)} @ ${fmtPrice(lp.entry)} — взяла под контроль со стопом и тейком.`, 'trade');
    }
    this.touch();
  }
  venue(){
    if (this.CFG.mode === 'paper') return `виртуальный, цены ${this.CFG.exchange === 'mock' ? 'имитации' : this.CFG.exchange}`;
    const ex = this.CFG.exchange === 'mock' ? 'имитация биржи' : this.CFG.exchange[0].toUpperCase() + this.CFG.exchange.slice(1);
    return `${ex} ${this.CFG.exchangeEnv === 'demo' ? 'демо-счёт' : 'тестовая сеть'} · ${this.CFG.marketType === 'swap' ? 'фьючерсы' : 'спот'}`;
  }

  // ---------- лента ----------
  post(from, to, text, tag, extra = {}){
    const m = {id: this.ctx ? this.ctx.id() : this.state.ids++, ts: Date.now(), from, to, text, tag, ...extra};
    this.state.feed.unshift(m); if (this.state.feed.length > 200) this.state.feed.length = 200;
    this.emit('feed', m);
    return m;
  }

  // ---------- конвейер ----------
  async runPipeline(focus = null){
    if (!this.market.status.ok && !Object.values(this.market.coins).some(c => c.price > 0)) return;
    if (this.running){ this.again = focus || this.again || 'scan'; return; }
    this.running = true;
    try {
      const st = this.state, stages = [];
      const brief = B.nikaScan(this.ctx, focus);
      this.post('nika', 'boris', B.nikaText(brief, focus), focus ? 'news' : 'brief', focus ? {coins: focus.coins, tone: focus.s, rel: focus.rel, link: focus.link} : {});
      const top = brief.hot[0] ? brief.items.find(i => i.sym === brief.hot[0]) : null;
      stages.push({agent: 'nika', kind: focus ? 'news' : 'scan', pre: focus ? (focus.coins && focus.coins.length ? `Новость по ${focus.coins[0]}!` : 'Новость по рынку!') : null,
        say: top ? `Сводка: ${top.sym} ${top.score > 0 ? '▲' : '▼'}${Math.abs(top.score).toFixed(2)}` : 'Сводка: тихо'});
      const evals = B.borisEvaluate(this.ctx, brief);
      if (!evals.length && !st.pf.positions.length){ stages.push({agent: 'boris', say: 'Идей нет, ждём', end: true}); return this.finishRun(stages, focus); }
      if (evals.length) this.post('boris', 'timur', B.borisText(evals), 'risk');
      const okc = evals.filter(e => e.verdict !== 'reject');
      const btxt = evals.length ? evals.slice(0, 2).map(e => `${e.sym} риск ${e.risk}${e.verdict === 'reject' ? ' ✗' : ' ✓'}`).join(' · ') : 'Позиции в норме';
      if (!okc.length && !st.pf.positions.length){ stages.push({agent: 'boris', say: btxt, end: true}); return this.finishRun(stages, focus); }
      stages.push({agent: 'boris', say: btxt});
      const res = B.timurSignals(this.ctx, brief, evals);
      if (evals.length || res.sigs.length) this.post('timur', 'aliya', B.timurText(res, evals, st.params), 'signal');
      if (!res.sigs.length){ stages.push({agent: 'timur', say: evals.length ? (res.best ? `Слабо: ${res.best}% < ${st.params.threshold}%` : 'Сигналов нет') : 'Держим позиции', end: true}); return this.finishRun(stages, focus); }
      const s0 = res.sigs[0];
      stages.push({agent: 'timur', say: s0.type === 'open' ? `${sideRu(s0.dir)} ${s0.sym} ${s0.conf}%` : `Закрыть ${s0.sym}`});
      const out = await this.execute(res.sigs);
      const main = out.find(r => r.kind === 'open') || out.find(r => r.kind === 'close') || out.find(r => !r.silent) || out[0];
      let say = 'Готово', react = null;
      if (main){
        if (main.kind === 'open') say = `Открыла ${sideRu(main.pos.dir)} ${main.pos.sym}`;
        else if (main.kind === 'close'){ say = `Закрыла ${main.c.sym}: ${fmtUSD(main.c.pnl, true)}`; react = main.c.pnl; }
        else if (main.kind === 'queued') say = 'Жду вашего решения';
        else say = main.text.replace(/^Пропускаю /, 'Пропуск: ').slice(0, 46);
      }
      stages.push({agent: 'aliya', say, react});
      return this.finishRun(stages, focus);
    } catch (e) {
      console.error('[office] конвейер:', e);
    } finally {
      this.running = false;
      if (this.again){ const f = this.again; this.again = null; setTimeout(() => this.runPipeline(f === 'scan' ? null : f), 300); }
    }
  }
  finishRun(stages, focus){
    this.emit('run', {id: this.ctx.id(), ts: Date.now(), news: !!focus, stages});
    this.touch();
  }

  // ---------- исполнение ----------
  async execute(sigs, approved = false){
    const out = [], st = this.state;
    for (const s of sigs.filter(x => x.type === 'close')){
      const pos = st.pf.positions.find(x => x.id === s.posId); if (!pos) continue;
      const c = await this.closePosition(pos, 'сигнал развернулся');
      if (c) out.push({kind: 'close', c, text: `Закрыла ${sideRu(c.dir)} ${c.sym}: ${fmtUSD(c.pnl, true)} (${fmtPct(c.pct)}).`});
    }
    for (const s of sigs.filter(x => x.type === 'open')){
      if (!st.auto && !approved){
        const ex = st.pending.find(x => x.sym === s.sym && x.dir === s.dir);
        const expiresAt = Date.now() + 10 * this.market.tf;
        if (ex){ Object.assign(ex, {...s, id: ex.id, expiresAt}); out.push({kind: 'queued', silent: true, text: ''}); continue; }
        st.pending = st.pending.filter(x => x.sym !== s.sym);
        st.pending.push({...s, expiresAt});
        out.push({kind: 'queued', text: `Жду вашего решения: ${sideRu(s.dir)} ${s.sym}, уверенность ${s.conf}%.`});
        continue;
      }
      const r = await this.openPosition(s);
      if (r.kind === 'skip') st.stats.aliya.skips++;
      out.push(r);
    }
    this.skipSeen ||= new Map();
    for (const r of out){
      if (r.silent || !r.text) continue;
      if (r.kind === 'skip'){ const k = r.text.replace(/\d+([.,]\d+)?/g, '#'); const t = this.skipSeen.get(k); if (t && Date.now() - t < 15 * 60000) { r.silent = true; continue; } this.skipSeen.set(k, Date.now()); }
      this.post('aliya', null, r.text, r.kind === 'queued' ? 'signal' : 'trade', r.pos ? {sym: r.pos.sym} : r.c ? {sym: r.c.sym} : {});
    }
    if (out.some(r => r.kind === 'queued')) this.emit('pending');
    this.touch();
    return out;
  }
  async openPosition(sig){
    const st = this.state, p = st.params, pf = st.pf;
    const res = (kind, text) => ({kind, text, sig});
    if (!st.tradingOn) return res('skip', `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: торговля на паузе.`);
    if (pf.killed) return res('skip', `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: сработал дневной лимит убытка.`);
    const ex = pf.positions.find(x => x.sym === sig.sym);
    if (ex && ex.dir === sig.dir) return res('skip', `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: уже в позиции.`);
    let pre = '';
    if (ex){ const c = await this.closePosition(ex, 'разворот сигнала'); if (!c) return res('skip', `Не удалось закрыть ${ex.sym} перед разворотом.`); pre = `Закрыла ${sideRu(ex.dir)} ${ex.sym} (${fmtUSD(c.pnl, true)}). `; }
    if (pf.positions.length >= p.maxPos) return res('skip', pre + `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: лимит ${p.maxPos} поз.`);
    if (sig.dir < 0 && (!p.shorts || this.CFG.marketType === 'spot')) return res('skip', pre + `Пропускаю SHORT ${sig.sym}: шорты выключены.`);
    const coin = this.market.coins[sig.sym]; const px = coin.price;
    let qty = Math.min(sig.qty, this.CFG.maxOrderUsd / px);
    if (qty * px * 1.002 > pf.cash * 0.98) qty = pf.cash * 0.98 / (px * 1.002);
    if (qty * px < 10) return res('skip', pre + `Пропускаю ${sig.sym}: мало свободных средств.`);
    let f;
    try { f = await this.broker.open({sym: sig.sym, symbol: coin.symbol, dir: sig.dir, qty, price: px}); }
    catch (e) { st.stats.aliya.errors++; return res('skip', pre + `Биржа не приняла ордер ${sideRu(sig.dir)} ${sig.sym}: ${e.message}`); }
    const stop = sig.stop || Math.abs(sig.entry - sig.sl);
    pf.cash -= f.fill * f.qty + f.fee; pf.fees += f.fee;
    const pos = {id: this.ctx.id(), sym: sig.sym, symbol: coin.symbol, dir: sig.dir, qty: f.qty, entry: f.fill, sl: f.fill - sig.dir * stop, tp: f.fill + sig.dir * stop * p.rr, stop, ts: Date.now(), riskUSD: f.qty * stop, conf: sig.conf, fees: f.fee, be: false, orderId: f.orderId};
    pf.positions.push(pos);
    st.stats.aliya.orders++;
    st.orders = [{ts: Date.now(), text: `${sideRu(pos.dir)} ${pos.sym} ${fmtQty(pos.qty, pos.entry)} @ ${fmtPrice(pos.entry)}`}, ...st.orders].slice(0, 30);
    this.emit('open', pos);
    return {kind: 'open', pos, text: pre + `Открыла ${sideRu(pos.dir)} ${pos.sym}: ${fmtQty(pos.qty, pos.entry)} @ ${fmtPrice(pos.entry)}. Стоп ${fmtPrice(pos.sl)}, тейк ${fmtPrice(pos.tp)}.`};
  }
  async closePosition(pos, reason){
    if (pos.closing) return null; pos.closing = true;
    const pf = this.state.pf; const px = this.price(pos.sym);
    let f;
    try { f = await this.broker.close(pos, px); }
    catch (e) {
      pos.closing = false; pos.closeErr = (pos.closeErr || 0) + 1; this.state.stats.aliya.errors++;
      if (pos.closeErr === 3) this.reconcile().catch(() => {});
      if (pos.closeErr === 1 || pos.closeErr % 10 === 0) this.post('aliya', null, `Не получилось закрыть ${sideRu(pos.dir)} ${pos.sym} (${reason}): ${e.message}. Повторю.`, 'system');
      return null;
    }
    const gross = (f.fill - pos.entry) * pos.qty * pos.dir;
    pf.cash += pos.entry * pos.qty + gross - f.fee; pf.fees += f.fee;
    pf.positions = pf.positions.filter(x => x !== pos);
    const net = gross - f.fee - pos.fees;
    const c = {id: pos.id, sym: pos.sym, dir: pos.dir, qty: pos.qty, entry: pos.entry, exit: f.fill, ts: pos.ts, tsClose: Date.now(), pnl: net, pct: net / (pos.entry * pos.qty), reason, conf: pos.conf, note: f.note};
    pf.closed.unshift(c); if (pf.closed.length > 300) pf.closed.length = 300;
    this.state.orders = [{ts: Date.now(), text: `Закрыт ${sideRu(pos.dir)} ${pos.sym} @ ${fmtPrice(f.fill)} · ${fmtUSD(net, true)}`}, ...this.state.orders].slice(0, 30);
    this.emit('close', c); this.touch();
    return c;
  }

  // ---------- каждую котировку: стопы и тейки ----------
  async onTick(){
    for (const pos of [...this.state.pf.positions]){
      if (pos.closing) continue;
      const px = this.price(pos.sym); if (!px) continue;
      const hitSL = pos.dir > 0 ? px <= pos.sl : px >= pos.sl;
      const hitTP = pos.dir > 0 ? px >= pos.tp : px <= pos.tp;
      if (!hitSL && !hitTP) continue;
      const reason = hitTP ? 'тейк-профит' : pos.be ? 'стоп в безубытке' : 'стоп-лосс';
      const c = await this.closePosition(pos, reason);
      if (c){
        this.post('aliya', null, `Сработал ${reason}: ${sideRu(c.dir)} ${c.sym} ${fmtUSD(c.pnl, true)} (${fmtPct(c.pct)}).`, 'trade', {sym: c.sym});
        this.emit('react', {agent: 'aliya', say: `${hitTP ? 'Тейк' : 'Стоп'} ${c.sym}: ${fmtUSD(c.pnl, true)}`, pnl: c.pnl});
      }
    }
    const pf = this.state.pf, eq = this.equity();
    if (pf.positions.length){ pf.peak = Math.max(pf.peak, eq); pf.maxDD = Math.max(pf.maxDD, 1 - eq / pf.peak); }
  }
  // ---------- на закрытии свечи ----------
  async onCandle(){
    const st = this.state, pf = st.pf, p = st.params, tf = this.market.tf;
    for (const pos of [...pf.positions]){
      if (pos.closing) continue;
      const px = this.price(pos.sym); const gain = (px - pos.entry) * pos.dir;
      if (!pos.be && gain >= pos.stop){ pos.sl = pos.entry + pos.dir * pos.stop * 0.15; pos.be = true; this.post('aliya', null, `Перенесла стоп ${pos.sym} в безубыток.`, 'trade', {sym: pos.sym}); }
      if (gain >= pos.stop * 1.6){ const atr = B.indicators(this.market.coins[pos.sym]).atr; const ns = px - pos.dir * 1.1 * atr; if ((ns - pos.sl) * pos.dir > 0) pos.sl = ns; }
      if (Date.now() - pos.ts >= p.timeStop * tf){ const c = await this.closePosition(pos, 'по времени'); if (c){ this.post('aliya', null, `Закрыла по времени: ${sideRu(c.dir)} ${c.sym} ${fmtUSD(c.pnl, true)}.`, 'trade'); this.emit('react', {agent: 'aliya', say: `Выход по времени ${c.sym}`, pnl: c.pnl}); } }
    }
    const before = st.pending.length; st.pending = st.pending.filter(x => x.expiresAt > Date.now());
    if (before !== st.pending.length) this.emit('pending');
    const eq = this.equity(), dk = this.dayKey();
    if (dk !== pf.dayKey){ pf.dayKey = dk; pf.dayStart = eq; if (pf.killed){ pf.killed = false; this.post('aliya', null, 'Новый торговый день: лимит убытка сброшен.', 'system'); } }
    if (!pf.killed && eq < pf.dayStart * (1 - p.dailyLimit / 100)){ pf.killed = true; this.post('aliya', null, `Дневной лимит убытка ${p.dailyLimit}% достигнут — новые сделки на паузе до следующего дня.`, 'system'); this.emit('react', {agent: 'aliya', say: 'Стоп-кран: лимит дня', pnl: -1}); }
    pf.peak = Math.max(pf.peak, eq); pf.maxDD = Math.max(pf.maxDD, 1 - eq / pf.peak);
    pf.curve.push({ts: Date.now(), e: eq}); if (pf.curve.length > 1000) pf.curve.splice(0, pf.curve.length - 1000);
    this.touch();
  }

  // ---------- команды из интерфейса ----------
  setProfile(key){ if (!B.PROFILES[key]) return; this.state.profile = key; this.state.params = {...B.PROFILES[key]}; this.post('system', null, `Профиль риска: ${B.PROFILES[key].label}. Риск на сделку ${this.state.params.riskPct}%, порог сигнала ${this.state.params.threshold}%, до ${this.state.params.maxPos} позиций.`, 'system'); this.touch(); }
  setParam(k, v){
    const st = this.state;
    if (k === 'shorts'){ st.params.shorts = !!v; }
    else if (B.PARAM_LIMITS[k]){ const [a, b] = B.PARAM_LIMITS[k]; const n = +v; if (!isFinite(n)) return; st.params[k] = clamp(n, a, b); }
    else return;
    st.profile = 'custom'; this.touch();
  }
  setAuto(v){ this.state.auto = !!v; this.post('system', null, v ? 'Автосделки включены: Диана исполняет сигналы сама.' : 'Ручной режим: Диана будет ждать вашего подтверждения по каждой сделке.', 'system'); this.touch(); }
  setTrading(v){ this.state.tradingOn = !!v; this.post('system', null, v ? 'Торговля включена.' : 'Торговля на паузе: новые сделки не открываются, стопы и тейки по открытым позициям работают.', 'system'); this.touch(); }
  async approve(id, ok){
    const st = this.state; const p = st.pending.find(x => x.id === id); if (!p) return;
    st.pending = st.pending.filter(x => x !== p);
    if (ok){ this.post('aliya', null, `Принято: исполняю ${sideRu(p.dir)} ${p.sym}.`, 'trade'); await this.execute([p], true); this.emit('run', {id: this.ctx.id(), ts: Date.now(), stages: [{agent: 'aliya', say: `Исполняю ${p.sym}`}]}); }
    else this.post('aliya', null, `Отклонено вами: ${sideRu(p.dir)} ${p.sym}.`, 'signal');
    this.emit('pending'); this.touch();
  }
  async manualClose(id){
    const pos = this.state.pf.positions.find(p => p.id === id); if (!pos) return;
    const c = await this.closePosition(pos, 'вручную');
    if (c){ this.post('aliya', null, `Закрыла вручную по вашей команде: ${sideRu(c.dir)} ${c.sym} ${fmtUSD(c.pnl, true)} (${fmtPct(c.pct)}).`, 'trade'); this.emit('react', {agent: 'aliya', say: `Закрыла ${c.sym} по команде`, pnl: c.pnl}); }
  }
  resetPaper(){
    if (this.CFG.mode !== 'paper') return false;
    const keepNews = this.state.news, seen = this.state.seenNews;
    this.state = freshState(this.CFG); this.state.news = keepNews; this.state.seenNews = seen; this.ctx.state = this.state;
    this.state.pf.dayKey = this.dayKey(); this.state.pf.dayStart = this.equity();
    this.post('system', null, `Виртуальный счёт сброшен: ${fmtUSD(this.CFG.paperCash)}.`, 'system');
    this.save(); this.emit('reset');
    return true;
  }

  // ---------- Claude ----------
  snapshot(){
    const st = this.state, pf = st.pf, eq = this.equity(), cl = pf.closed; const r2 = x => Math.round(x * 100) / 100;
    return {
      time: new Date().toLocaleString('ru-RU', {timeZone: this.CFG.tz}), venue: this.venue(), risk_profile: st.profile, params: st.params, auto_trading: st.auto, trading_on: st.tradingOn,
      account: {equity: r2(eq), pnl_total: r2(eq - pf.startEquity), pnl_today: r2(eq - pf.dayStart), trades: cl.length, win_rate: cl.length ? Math.round(cl.filter(c => c.pnl > 0).length / cl.length * 100) : null, max_drawdown_pct: r2(pf.maxDD * 100), daily_stop_active: pf.killed},
      market: Object.values(this.market.coins).map(c => { const it = B.indicators(c); const b = st.brief && st.brief.items.find(i => i.sym === c.sym); return {coin: c.sym, price: +c.price.toPrecision(6), chg_24h_pct: r2(c.chg24 * 100), rsi: Math.round(it.rsi), atr_pct: r2(it.atrPct * 100), trend: b ? b.label : null, news_tone: b ? r2(b.sent) : null, nika_score: b ? r2(b.score) : null}; }),
      news: st.news.slice(0, 6).map(n => ({coins: n.coins.length ? n.coins : 'весь рынок', title: n.titleRu || n.title, source: n.source, reliability: n.rel, tone: r2(n.s), minutes_ago: Math.round((Date.now() - n.ts) / 60000)})),
      boris_evals: st.evalLog.slice(0, 4).map(e => ({coin: e.sym, side: sideRu(e.dir), risk: e.risk, verdict: B.VERDICT_RU[e.verdict], reasons: e.reasons})),
      timur_signals: st.sigLog.slice(0, 4).map(s => ({coin: s.sym, type: s.type === 'open' ? sideRu(s.dir) : 'закрыть', confidence: s.conf})),
      positions: pf.positions.map(p => ({coin: p.sym, side: sideRu(p.dir), qty: +p.qty.toPrecision(5), entry: +p.entry.toPrecision(6), price: +this.price(p.sym).toPrecision(6), pnl: r2(this.upnl(p)), stop: +p.sl.toPrecision(6), take: +p.tp.toPrecision(6)})),
      pending_approvals: st.pending.map(p => ({coin: p.sym, side: sideRu(p.dir), confidence: p.conf})),
      recent_trades: cl.slice(0, 6).map(c => ({coin: c.sym, side: sideRu(c.dir), pnl: r2(c.pnl), reason: c.reason})),
    };
  }
  async chat(agent, turns){
    const a = AGENTS[agent]; if (!a) throw new Error('Нет такого агента');
    const clean = (Array.isArray(turns) ? turns : []).filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim()).slice(-8).map(t => ({role: t.role, content: t.content.slice(0, 1500)}));
    while (clean.length && clean[0].role !== 'user') clean.shift();
    if (!clean.length || clean[clean.length - 1].role !== 'user') throw new Error('Пустой вопрос');
    const system = `Ты — ${a.name}, ${a.role} в офисе крипто-трейдинга JA Capital. Офис работает на реальных котировках; счёт: ${this.venue()}. Цепочка: Леон (тренды и новости) → Генри (риски) → Марк (сигналы) → Диана (исполнение).
Твой характер: ${a.persona}.
Отвечай по-русски, от первого лица, 1–4 коротких предложения. Опирайся только на данные ниже и называй конкретные цифры. Если данных нет — так и скажи. Не обещай доходность и не давай советов по реальным инвестициям.
Состояние офиса (JSON): ${JSON.stringify(this.snapshot())}`;
    const text = await ask({system, messages: clean, fast: true, maxTokens: 500, kind: 'chat'});
    this.post(agent, 'you', text, 'chat');
    return text;
  }
  async meeting(){
    const lines = Object.entries(AGENTS).map(([k, a]) => `- ${a.name} — ${a.role} (${a.persona});`).join('\n');
    const prompt = `Проведи короткую планёрку в офисе крипто-трейдинга JA Capital (реальные котировки; счёт: ${this.venue()}). Агенты:
${lines}
Каждый агент говорит одну реплику от первого лица, по-русски, до 30 слов, строго по данным ниже: что видит и что предлагает. Затем общий итог до 40 слов и рекомендация профиля риска: cautious, balanced или aggressive, с причиной до 20 слов. Не обещай доходность.
Ответь только JSON такого вида:
{"nika":"…","boris":"…","timur":"…","aliya":"…","summary":"…","profile":"balanced","profileWhy":"…"}
Состояние офиса (JSON):
${JSON.stringify(this.snapshot())}`;
    const d = await askJSON({prompt, fast: false, maxTokens: 900, kind: 'meeting'});
    for (const k of Object.keys(AGENTS)) if (typeof d[k] === 'string' && d[k].trim()) this.post(k, 'office', d[k].trim(), 'meet');
    const prof = B.PROFILES[d.profile] ? d.profile : null;
    if (d.summary) this.post('system', null, `Итог планёрки: ${String(d.summary).trim()}${prof ? ` Рекомендация: профиль «${B.PROFILES[prof].label}» — ${String(d.profileWhy || '').trim()}` : ''}`, 'meet');
    this.touch();
    return {...d, profile: prof};
  }

  // ---------- для клиентов ----------
  publicState(){
    const st = this.state, pf = st.pf;
    return {
      profile: st.profile, params: st.params, auto: st.auto, tradingOn: st.tradingOn,
      pf: {cash: pf.cash, startEquity: pf.startEquity, positions: pf.positions.map(({closing, ...p}) => p), closed: pf.closed.slice(0, 60), fees: pf.fees, dayStart: pf.dayStart, killed: pf.killed, curve: pf.curve.slice(-400), peak: pf.peak, maxDD: pf.maxDD,
        balance: this.broker.lastBalance || null, closedCount: pf.closed.length, wins: pf.closed.filter(c => c.pnl > 0).length, grossWin: pf.closed.filter(c => c.pnl > 0).reduce((a, c) => a + c.pnl, 0), grossLoss: -pf.closed.filter(c => c.pnl <= 0).reduce((a, c) => a + c.pnl, 0), realized: pf.closed.reduce((a, c) => a + c.pnl, 0)},
      news: st.news.slice(0, 30), brief: st.brief, evals: st.evals, evalLog: st.evalLog, sigLog: st.sigLog, pending: st.pending, orders: st.orders, stats: st.stats,
      status: {market: this.market.status, ai: aiEnabled()},
    };
  }
}
