// Офис: состояние, конвейер Рустам → Джама → Нод → Артур, сделки по нескольким счетам, сохранение, Claude
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import * as B from './brain.js';
import {ask, askJSON, aiEnabled} from './claude.js';
import {describeError} from './exchange.js';
const {sideRu, fmtUSD, fmtPct, fmtPrice, fmtQty, clamp} = B;

const AGENTS = {
  nika:  {name: 'Рустам',  role: 'аналитик трендов и новостей', persona: 'энергичный и любопытный, всегда называет источник новости и его надёжность'},
  boris: {name: 'Джама', role: 'риск-менеджер сделок',        persona: 'осторожный педант с сухим юмором, мыслит стопами и размером риска'},
  timur: {name: 'Нод', role: 'стратег сигналов',            persona: 'уверенный, говорит процентами уверенности и порогами'},
  aliya: {name: 'Артур',  role: 'трейдер-исполнитель',         persona: 'собранный и лаконичный, отчитывается ордерами и результатом в долларах'},
};
const freshStats = () => ({nika: {news: 0, briefs: 0, reliable: 0}, boris: {evals: 0, ok: 0, caution: 0, reject: 0}, timur: {signals: 0, confSum: 0, closes: 0, below: 0}, aliya: {orders: 0, skips: 0, errors: 0}});

// «книга» счёта: деньги, позиции, история и переключатели — у каждого счёта своя
function newBook(acc, CFG){
  const paper = acc.kind === 'paper', cash = paper ? CFG.paperCash : 0;
  return {sig: acc.sig, cash, startEquity: cash, positions: [], closed: [], fees: 0, dayKey: '', dayStart: cash, killed: false, curve: [], peak: cash, maxDD: 0,
    initialised: paper, auto: !acc.real, tradingOn: true, everActive: false};
}
// state.pf / state.auto / state.tradingOn смотрят в книгу активного счёта (в файл не пишутся)
function attachViews(state){
  const book = () => state.books[state.active];
  Object.defineProperty(state, 'pf', {get: book, enumerable: false, configurable: true});
  Object.defineProperty(state, 'auto', {get: () => book().auto, set: v => { book().auto = v; }, enumerable: false, configurable: true});
  Object.defineProperty(state, 'tradingOn', {get: () => book().tradingOn, set: v => { book().tradingOn = v; }, enumerable: false, configurable: true});
  return state;
}

export class Office extends EventEmitter {
  constructor({CFG, market, accounts}){
    super();
    this.CFG = CFG; this.market = market; this.accounts = accounts;
    this.file = path.join(CFG.dataDir, 'state.json');
    this.state = this.load();
    this.running = false; this.again = null; this.lastFocusAt = 0; this.saveT = null;
    const self = this;
    this.ctx = {coins: market.coins, state: this.state, id: () => this.state.ids++, equity: () => this.equity(), marketType: CFG.marketType, get maxOrderUsd(){ return self.acc.maxOrderUsd; }};
  }
  get acc(){ return this.accounts[this.state.active]; }
  get broker(){ return this.acc.broker; }

  // ---------- хранение ----------
  load(){
    let s = null;
    try { s = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    if (s && s.v === 2){
      // переход со старого формата: один счёт → книга этого счёта
      const id = s.mode === 'paper' ? 'paper' : s.exchange;
      const book = {...s.pf, auto: s.auto, tradingOn: s.tradingOn, sig: id === 'paper' ? 'paper' : `${s.exchange}:${s.exchangeEnv}:${this.CFG.marketType}`, everActive: true};
      for (const k of ['pf', 'auto', 'tradingOn', 'mode', 'exchange', 'exchangeEnv']) delete s[k];
      Object.assign(s, {v: 3, books: {[id]: book}, active: id});
      console.log('[office] состояние перенесено в новый формат');
    }
    if (!s || s.v !== 3){
      const firstEx = Object.values(this.accounts).find(a => a.kind === 'exchange' && a.configured) || null;
      s = {v: 3, ids: 1, createdAt: Date.now(), active: this.CFG.mode === 'exchange' && firstEx ? firstEx.id : 'paper', books: {},
        profile: 'balanced', params: {...B.PROFILES.balanced},
        news: [], seenNews: [], brief: null, evals: [], evalLog: [], signals: [], sigLog: [], pending: [], orders: [], feed: [], stats: freshStats()};
    } else console.log('[office] состояние загружено');
    for (const acc of Object.values(this.accounts)){
      const b = s.books[acc.id];
      if (!b) s.books[acc.id] = newBook(acc, this.CFG);
      else if (b.sig !== acc.sig){
        s.books[acc.id] = newBook(acc, this.CFG);
        (s.feed ||= []).unshift({id: s.ids++, ts: Date.now(), from: 'system', to: null, text: `Настройки счёта «${acc.label}» изменились — учёт по нему начат заново.`, tag: 'system'});
      }
    }
    if (!this.accounts[s.active] || !this.accounts[s.active].configured) s.active = 'paper';
    s.gate ||= {}; s.migrations ||= {};
    if (!s.migrations.paperNov2026){
      s.migrations.paperNov2026 = Date.now();
      if (this.accounts[s.active] && this.accounts[s.active].real){
        s.active = 'paper';
        (s.feed ||= []).unshift({id: s.ids++, ts: Date.now(), from: 'system', to: null, text: 'Офис переведён на виртуальный счёт: прежняя логика агентов убыточна на истории. Реальные деньги получат только стратегии, прошедшие проверку. Открытые позиции на Binance ведутся до своих стопов и тейков.', tag: 'system'});
        console.log('[office] активный счёт переключён на виртуальный (защита реальных денег)');
      }
    }
    return attachViews(s);
  }
  save(){
    try { fs.mkdirSync(this.CFG.dataDir, {recursive: true}); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.state)); fs.renameSync(tmp, this.file); }
    catch (e) { console.warn('[office] не удалось сохранить:', e.message); }
  }
  touch(){ this.emit('state'); clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save(), 4000); }

  // ---------- деньги ----------
  price(sym){ const c = this.market.coins[sym]; return c ? c.price : 0; }
  upnl(p){ return (this.price(p.sym) - p.entry) * p.qty * p.dir; }
  equity(book = this.state.pf){ let e = book.cash; for (const p of book.positions) e += p.entry * p.qty + this.upnl(p); return e; }
  dayKey(ts = Date.now()){ return new Intl.DateTimeFormat('en-CA', {timeZone: this.CFG.tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ts)); }
  // счета, по которым сейчас можно вести позиции
  liveBooks(){ return Object.entries(this.state.books).filter(([id]) => this.accounts[id] && this.accounts[id].ready).map(([id, book]) => ({id, book, acc: this.accounts[id]})); }

  async initAccount(){
    const pf = this.state.books.paper; if (!pf.dayKey){ pf.dayKey = this.dayKey(); pf.dayStart = this.equity(pf); }
    this.touch();
  }
  // подключение биржевого счёта: ключи, баланс, сверка позиций
  async connectAccount(id, opts = {}){
    const acc = this.accounts[id];
    if (!acc || acc.kind !== 'exchange' || !acc.configured || !acc.broker) return false;
    try { await acc.broker.init(Object.values(this.market.coins).map(c => c.symbol)); }
    catch (e) {
      const err = describeError(e), first = acc.error !== err;
      acc.ready = false; acc.error = err; acc.rawError = String(e && e.message || e).slice(0, 400); acc.failedAt = Date.now();
      // в лог: новая ошибка, ручная проверка из интерфейса или та же ошибка раз в 5 минут
      if (first || opts.manual || Date.now() - (acc.loggedAt || 0) > 5 * 60000){ acc.loggedAt = Date.now(); console.warn(`[account] ${acc.label}${opts.manual ? ' (проверка из интерфейса)' : first ? '' : ' (всё ещё)'}: ${err} | ответ биржи: ${acc.rawError.slice(0, 200)}`); }
      this.emit('accounts'); return false;
    }
    const wasReady = acc.ready; acc.ready = true; acc.error = '';
    if (!wasReady) console.log(`[account] ${acc.label}: подключён${acc.broker.lastBalance ? `, баланс ${Math.round((acc.broker.lastBalance.total || acc.broker.lastBalance.free || 0) * 100) / 100} USDT` : ''}`);
    const book = this.state.books[id], bal = acc.broker.lastBalance;
    if (!book.initialised && bal){
      book.cash = bal.total || bal.free || 0; book.startEquity = book.cash; book.dayStart = book.cash; book.peak = book.cash; book.initialised = true;
      this.post('system', null, `Подключен счёт «${acc.label}»: ${fmtUSD(book.cash)} USDT.`, 'system');
    } else if (!wasReady && acc.failedAt) this.post('system', null, `Связь со счётом «${acc.label}» восстановлена.`, 'system');
    if (!book.dayKey){ book.dayKey = this.dayKey(); book.dayStart = this.equity(book); }
    for (const n of acc.broker.notes || []) if (!wasReady) this.post('system', null, `«${acc.label}»: ${n}`, 'system');
    await this.reconcile(id, true);
    this.emit('accounts'); this.touch();
    return true;
  }
  // сверка с биржей: позиции, закрытые вне офиса, и позиции, открытые без нас (только фьючерсы)
  async reconcile(id = this.state.active, adopt = false){
    const acc = this.accounts[id];
    if (!acc || acc.kind !== 'exchange' || !acc.ready || this.CFG.marketType !== 'swap') return;
    const pf = this.state.books[id], tag = id === this.state.active ? '' : `«${acc.label}»: `;
    const live = await acc.broker.openPositions(Object.values(this.market.coins).map(c => c.symbol));
    if (live === null) return;
    for (const pos of [...pf.positions]){
      if (pos.closing || Date.now() - pos.ts < 60000) continue;
      if (live.some(lp => lp.symbol === pos.symbol && lp.dir === pos.dir)) continue;
      const px = this.price(pos.sym) || pos.entry;
      const gross = (px - pos.entry) * pos.qty * pos.dir;
      pf.cash += pos.entry * pos.qty + gross; pf.positions = pf.positions.filter(x => x !== pos);
      await acc.broker.unprotectPos(pos);
      const c = {id: pos.id, sym: pos.sym, dir: pos.dir, qty: pos.qty, entry: pos.entry, exit: px, ts: pos.ts, tsClose: Date.now(), pnl: gross - pos.fees, pct: (gross - pos.fees) / (pos.entry * pos.qty), reason: 'закрыта вне офиса', conf: pos.conf};
      pf.closed.unshift(c);
      this.post('aliya', null, `${tag}Позиции ${sideRu(pos.dir)} ${pos.sym} больше нет на бирже — её закрыли вручную, сработал страховочный стоп или биржа ликвидировала. Убрал из учёта (оценка ${fmtUSD(c.pnl, true)}).`, 'system');
    }
    if (!adopt) { this.touch(); return; }
    for (const lp of live){
      const c = Object.values(this.market.coins).find(x => x.symbol === lp.symbol); if (!c) continue;
      if (pf.positions.some(p => p.symbol === lp.symbol)) continue;
      const atr = B.indicators(c).atr; const stop = 1.6 * atr;
      const pos = {id: this.ctx.id(), sym: c.sym, symbol: c.symbol, dir: lp.dir, qty: lp.qty, entry: lp.entry, sl: lp.entry - lp.dir * stop, tp: lp.entry + lp.dir * stop * this.state.params.rr, stop, ts: Date.now(), riskUSD: lp.qty * stop, conf: 0, fees: 0, be: false, adopted: true};
      pf.positions.push(pos);
      pf.cash -= lp.entry * lp.qty;
      this.post('aliya', null, `${tag}Нашёл на бирже открытую позицию ${sideRu(lp.dir)} ${c.sym} ${fmtQty(lp.qty, lp.entry)} @ ${fmtPrice(lp.entry)} — взял под контроль со стопом и тейком.`, 'trade');
    }
    this.touch();
  }
  venue(id = this.state.active){
    const acc = this.accounts[id]; if (!acc) return '';
    return acc.kind === 'paper' ? `виртуальный счёт, котировки ${this.CFG.quotes === 'mock' ? 'имитации' : this.CFG.quotes[0].toUpperCase() + this.CFG.quotes.slice(1)}` : `${acc.label}, ${this.CFG.marketType === 'swap' ? 'фьючерсы' : 'спот'}`;
  }
  accountsPublic(){
    return Object.values(this.accounts).map(a => ({id: a.id, kind: a.kind, label: a.label, note: a.note, real: a.real, ready: a.ready, configured: a.configured, error: a.error || '',
      positions: (this.state.books[a.id] || {positions: []}).positions.length}));
  }
  // переключение счёта из интерфейса
  async switchAccount(id, confirmed){
    const acc = this.accounts[id];
    if (!acc) throw new Error('Нет такого счёта');
    if (id === this.state.active) return false;
    if (!acc.configured) throw new Error(acc.error || 'Счёт не настроен на сервере');
    if (acc.real && !confirmed) throw new Error('Для реального счёта нужно подтверждение');
    if (!acc.ready && !(await this.connectAccount(id))) throw new Error(`Счёт «${acc.label}» недоступен: ${acc.error}`);
    const prev = this.acc, prevOpen = this.state.pf.positions.length;
    this.state.pending = []; this.emit('pending');
    this.state.active = id;
    const book = this.state.pf;
    if (!book.everActive){ book.everActive = true; if (acc.real) book.auto = false; }
    this.post('system', null, `Счёт переключён: «${acc.label}».` +
      (acc.real ? ` Сделки идут на настоящие деньги — но только по стратегиям, прошедшим проверку; остальные сигналы Артур пропустит. ${book.auto ? 'Автосделки включены.' : 'Каждую сделку Артур будет ждать вашего подтверждения.'}` : '') +
      (prevOpen ? ` На счёте «${prev.label}» осталось позиций: ${prevOpen} — стопы и тейки по ним продолжают работать.` : ''), 'system');
    this.save(); this.emit('reset');
    return true;
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
      if (!this.legacyOn()){ stages.push({agent: 'nika', say: top ? `${top.sym} ${top.score > 0 ? '▲' : '▼'}${Math.abs(top.score).toFixed(2)} — для сводки` : 'Рынок спокоен', end: true}); return this.finishRun(stages, focus); }
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
        if (main.kind === 'open') say = `Открыл ${sideRu(main.pos.dir)} ${main.pos.sym}`;
        else if (main.kind === 'close'){ say = `Закрыл ${main.c.sym}: ${fmtUSD(main.c.pnl, true)}`; react = main.c.pnl; }
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
      if (c) out.push({kind: 'close', c, text: `Закрыл ${sideRu(c.dir)} ${c.sym}: ${fmtUSD(c.pnl, true)} (${fmtPct(c.pct)}).`});
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
    if (!this.acc.ready) return res('skip', `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: нет связи со счётом «${this.acc.label}».`);
    // реальные деньги — только стратегиям, прошедшим проверку на истории и на виртуальном счёте
    if (this.acc.real && !this.realAllowed(sig.strategy)) return res('skip', `Пропускаю ${sideRu(sig.dir)} ${sig.sym} на реальном счёте: стратегия «${sig.strategy || 'прежние агенты'}» ещё не прошла проверку. Проверка идёт на виртуальном счёте.`);
    if (!st.tradingOn) return res('skip', `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: торговля на паузе.`);
    if (pf.killed) return res('skip', `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: сработал дневной лимит убытка.`);
    const ex = pf.positions.find(x => x.sym === sig.sym);
    if (ex && ex.dir === sig.dir) return res('skip', `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: уже в позиции.`);
    let pre = '';
    if (ex){ const c = await this.closePosition(ex, 'разворот сигнала'); if (!c) return res('skip', `Не удалось закрыть ${ex.sym} перед разворотом.`); pre = `Закрыл ${sideRu(ex.dir)} ${ex.sym} (${fmtUSD(c.pnl, true)}). `; }
    if (pf.positions.length >= p.maxPos) return res('skip', pre + `Пропускаю ${sideRu(sig.dir)} ${sig.sym}: лимит ${p.maxPos} поз.`);
    if (sig.dir < 0 && (!p.shorts || this.CFG.marketType === 'spot')) return res('skip', pre + `Пропускаю SHORT ${sig.sym}: шорты выключены.`);
    const coin = this.market.coins[sig.sym]; const px = coin.price;
    let qty = Math.min(sig.qty, this.acc.maxOrderUsd / px);
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
    if (this.broker.protect){
      try { const pr = await this.broker.protectPos(pos); if (pr){ pos.protId = pr.id; pos.protPx = pr.price; } }
      catch (e) { this.post('aliya', null, `Не удалось поставить страховочный стоп на бирже для ${pos.sym}: ${describeError(e)}. Позицию веду сам.`, 'system'); }
    }
    st.orders = [{ts: Date.now(), text: `${sideRu(pos.dir)} ${pos.sym} ${fmtQty(pos.qty, pos.entry)} @ ${fmtPrice(pos.entry)}`}, ...st.orders].slice(0, 30);
    this.emit('open', pos);
    return {kind: 'open', pos, text: pre + `Открыл ${sideRu(pos.dir)} ${pos.sym}: ${fmtQty(pos.qty, pos.entry)} @ ${fmtPrice(pos.entry)}. Стоп ${fmtPrice(pos.sl)}, тейк ${fmtPrice(pos.tp)}.`};
  }
  async closePosition(pos, reason, id = this.state.active){
    if (pos.closing) return null; pos.closing = true;
    const acc = this.accounts[id], pf = this.state.books[id]; const px = this.price(pos.sym);
    let f;
    try { f = await acc.broker.close(pos, px); }
    catch (e) {
      pos.closing = false; pos.closeErr = (pos.closeErr || 0) + 1; this.state.stats.aliya.errors++;
      if (pos.closeErr === 3) this.reconcile(id).catch(() => {});
      if (pos.closeErr === 1 || pos.closeErr % 10 === 0) this.post('aliya', null, `${id === this.state.active ? '' : `«${acc.label}»: `}Не получилось закрыть ${sideRu(pos.dir)} ${pos.sym} (${reason}): ${e.message}. Повторю.`, 'system');
      return null;
    }
    await acc.broker.unprotectPos(pos);
    const gross = (f.fill - pos.entry) * pos.qty * pos.dir;
    pf.cash += pos.entry * pos.qty + gross - f.fee; pf.fees += f.fee;
    pf.positions = pf.positions.filter(x => x !== pos);
    const net = gross - f.fee - pos.fees;
    const c = {id: pos.id, sym: pos.sym, dir: pos.dir, qty: pos.qty, entry: pos.entry, exit: f.fill, ts: pos.ts, tsClose: Date.now(), pnl: net, pct: net / (pos.entry * pos.qty), reason, conf: pos.conf, note: f.note, strategy: pos.strategy || 'legacy', ctx: pos.ctx || null, fees: pos.fees + f.fee};
    pf.closed.unshift(c); if (pf.closed.length > 300) pf.closed.length = 300;
    if (id === this.state.active) this.state.orders = [{ts: Date.now(), text: `Закрыт ${sideRu(pos.dir)} ${pos.sym} @ ${fmtPrice(f.fill)} · ${fmtUSD(net, true)}`}, ...this.state.orders].slice(0, 30);
    this.emit('close', c); this.touch();
    return c;
  }

  // ---------- каждую котировку: стопы и тейки ----------
  async onTick(){
    for (const {id, book, acc} of this.liveBooks()){
      const tag = id === this.state.active ? '' : `«${acc.label}»: `;
      for (const pos of [...book.positions]){
        if (pos.closing || pos.kind === 'carry' || !pos.dir) continue;
        const px = this.price(pos.sym); if (!px) continue;
        const hitSL = pos.sl != null && (pos.dir > 0 ? px <= pos.sl : px >= pos.sl);
        const hitTP = pos.tp != null && (pos.dir > 0 ? px >= pos.tp : px <= pos.tp);
        if (!hitSL && !hitTP) continue;
        const reason = hitTP ? 'тейк-профит' : pos.strategy ? 'аварийный стоп' : pos.be ? 'стоп в безубытке' : 'стоп-лосс';
        const c = await this.closePosition(pos, reason, id);
        if (c){
          this.post('aliya', null, `${tag}Сработал ${reason}: ${sideRu(c.dir)} ${c.sym} ${fmtUSD(c.pnl, true)} (${fmtPct(c.pct)}).`, 'trade', {sym: c.sym});
          if (!tag) this.emit('react', {agent: 'aliya', say: `${hitTP ? 'Тейк' : 'Стоп'} ${c.sym}: ${fmtUSD(c.pnl, true)}`, pnl: c.pnl});
        }
      }
      if (book.positions.length){ const eq = this.equity(book); book.peak = Math.max(book.peak, eq); book.maxDD = Math.max(book.maxDD, 1 - eq / book.peak); }
    }
  }
  // ---------- на закрытии свечи ----------
  async onCandle(){
    const st = this.state, p = st.params, tf = this.market.tf;
    for (const {id, book: pf, acc} of this.liveBooks()){
      const tag = id === st.active ? '' : `«${acc.label}»: `;
      for (const pos of [...pf.positions]){
        if (pos.closing || pos.strategy) continue;
        const px = this.price(pos.sym); const gain = (px - pos.entry) * pos.dir;
        if (!pos.be && gain >= pos.stop){ pos.sl = pos.entry + pos.dir * pos.stop * 0.15; pos.be = true; this.post('aliya', null, `${tag}Перенёс стоп ${pos.sym} в безубыток.`, 'trade', {sym: pos.sym}); }
        if (gain >= pos.stop * 1.6){ const atr = B.indicators(this.market.coins[pos.sym]).atr; const ns = px - pos.dir * 1.1 * atr; if ((ns - pos.sl) * pos.dir > 0) pos.sl = ns; }
        if (Date.now() - pos.ts >= p.timeStop * tf){ const c = await this.closePosition(pos, 'по времени', id); if (c){ this.post('aliya', null, `${tag}Закрыл по времени: ${sideRu(c.dir)} ${c.sym} ${fmtUSD(c.pnl, true)}.`, 'trade'); if (!tag) this.emit('react', {agent: 'aliya', say: `Выход по времени ${c.sym}`, pnl: c.pnl}); } }
      }
      if (!pf.initialised) continue;
      const eq = this.equity(pf), dk = this.dayKey();
      if (dk !== pf.dayKey){ pf.dayKey = dk; pf.dayStart = eq; if (pf.killed){ pf.killed = false; this.post('aliya', null, `${tag}Новый торговый день: лимит убытка сброшен.`, 'system'); } }
      if (!pf.killed && eq < pf.dayStart * (1 - p.dailyLimit / 100)){ pf.killed = true; this.post('aliya', null, `${tag}Дневной лимит убытка ${p.dailyLimit}% достигнут — новые сделки на паузе до следующего дня.`, 'system'); if (!tag) this.emit('react', {agent: 'aliya', say: 'Стоп-кран: лимит дня', pnl: -1}); }
      pf.peak = Math.max(pf.peak, eq); pf.maxDD = Math.max(pf.maxDD, 1 - eq / pf.peak);
      pf.curve.push({ts: Date.now(), e: eq}); if (pf.curve.length > 1000) pf.curve.splice(0, pf.curve.length - 1000);
    }
    const before = st.pending.length; st.pending = st.pending.filter(x => x.expiresAt > Date.now());
    if (before !== st.pending.length) this.emit('pending');
    this.touch();
  }

  // прежние агенты торгуют, только если им явно дана доля капитала (по умолчанию — нет: на истории они убыточны)
  legacyOn(){ const a = this.state.strat && this.state.strat.alloc; return !!(a && a.legacy > 0); }

  // ---------- позиции стратегий: одна чистая позиция на монету и стратегию ----------
  stratPos(strategy, sym, book = this.state.pf){ return book.positions.find(p => p.strategy === strategy && p.sym === sym && !p.closing); }
  // изменить позицию стратегии до целевого количества (со знаком); возвращает описание сделки или null
  async adjust(strategy, sym, targetQty, ctx = {}, reason = 'ребалансировка'){
    const st = this.state, pf = st.pf, coin = this.market.coins[sym]; if (!coin || !coin.price) return null;
    const acc = this.acc, px = coin.price, cur = this.stratPos(strategy, sym), q = cur ? cur.qty * cur.dir : 0;
    if (!acc.ready) return {skip: `нет связи со счётом «${acc.label}»`};
    if (acc.real && !this.realAllowed(strategy)) return {skip: `стратегия ещё не допущена к реальному счёту`};
    if (acc.real && !st.auto) return {skip: 'на реальном счёте выключены автосделки — стратегия ведёт его только с ними'};
    if (!st.tradingOn) return {skip: 'торговля на паузе'};
    const out = [];
    // разворот или полное закрытие
    if (cur && (targetQty === 0 || Math.sign(targetQty) !== cur.dir)){
      const c = await this.closePosition(cur, reason); if (!c) return {skip: `не удалось закрыть ${sym}`};
      out.push({act: 'close', sym, dir: c.dir, usd: c.qty * c.exit, pnl: c.pnl});
      if (targetQty === 0) return {done: out};
    }
    const now = this.stratPos(strategy, sym), q0 = now ? now.qty * now.dir : 0, dq = targetQty - q0;
    if (!dq) return {done: out};
    if (Math.abs(dq) * px < (acc.minTradeUsd || 10)) return out.length ? {done: out} : {skip: 'изменение меньше минимального ордера'};
    if (now && Math.sign(dq) !== now.dir){
      // частичное сокращение: закрываем часть и фиксируем результат этой части
      const part = {...now, qty: Math.min(Math.abs(dq), now.qty)};
      let f; try { f = await acc.broker.close(part, px); } catch (e) { this.state.stats.aliya.errors++; return {skip: `биржа не приняла сокращение ${sym}: ${e.message}`}; }
      const gross = (f.fill - now.entry) * part.qty * now.dir, feeShare = now.fees * part.qty / now.qty;
      pf.cash += now.entry * part.qty + gross - f.fee; pf.fees += f.fee;
      const net = gross - f.fee - feeShare;
      pf.closed.unshift({id: this.ctx.id(), sym, dir: now.dir, qty: part.qty, entry: now.entry, exit: f.fill, ts: now.ts, tsClose: Date.now(), pnl: net, pct: net / (now.entry * part.qty), reason: 'сокращение: ' + reason, strategy, ctx: {...now.ctx, exit: ctx}, fees: feeShare + f.fee});
      if (pf.closed.length > 300) pf.closed.length = 300;
      now.qty -= part.qty; now.fees -= feeShare; now.riskUSD = now.qty * now.stop;
      if (now.qty * px < 1) pf.positions = pf.positions.filter(x => x !== now);
      else if (now.protId){ await acc.broker.unprotectPos(now); try { const pr = await acc.broker.protectPos(now); if (pr){ now.protId = pr.id; now.protPx = pr.price; } } catch {} }
      out.push({act: 'reduce', sym, dir: now.dir, usd: part.qty * f.fill, pnl: net});
      this.touch(); return {done: out};
    }
    // открытие или наращивание
    const dir = Math.sign(dq); let qty = Math.abs(dq);
    if (dir < 0 && this.CFG.marketType === 'spot') return {skip: 'на споте шорт невозможен'};
    qty = Math.min(qty, acc.maxOrderUsd / px);
    if (qty * px * 1.002 > pf.cash * 0.98) qty = pf.cash * 0.98 / (px * 1.002);
    if (qty * px < (acc.minTradeUsd || 10)) return out.length ? {done: out} : {skip: 'мало свободных средств'};
    let f; try { f = await acc.broker.open({sym, symbol: coin.symbol, dir, qty, price: px}); }
    catch (e) { st.stats.aliya.errors++; return {skip: `биржа не приняла ордер ${sym}: ${e.message}`}; }
    pf.cash -= f.fill * f.qty + f.fee; pf.fees += f.fee; st.stats.aliya.orders++;
    const hard = ctx.hardStop || 0.25;   // аварийный стоп: дальше обычных дневных колебаний, на случай обвала
    if (now){
      const nq = now.qty + f.qty; now.entry = (now.entry * now.qty + f.fill * f.qty) / nq; now.qty = nq; now.fees += f.fee;
      now.stop = now.entry * hard; now.sl = now.entry - now.dir * now.stop; now.riskUSD = now.qty * now.stop; now.ctx = {...now.ctx, last: ctx};
      if (acc.broker.protect){ await acc.broker.unprotectPos(now); try { const pr = await acc.broker.protectPos(now); if (pr){ now.protId = pr.id; now.protPx = pr.price; } } catch {} }
    } else {
      const stop = f.fill * hard;
      const pos = {id: this.ctx.id(), sym, symbol: coin.symbol, dir, qty: f.qty, entry: f.fill, sl: f.fill - dir * stop, tp: null, stop, ts: Date.now(), riskUSD: f.qty * stop, conf: Math.round((ctx.conf || 0.5) * 100), fees: f.fee, be: false, orderId: f.orderId, strategy, ctx};
      pf.positions.push(pos);
      if (acc.broker.protect){ try { const pr = await acc.broker.protectPos(pos); if (pr){ pos.protId = pr.id; pos.protPx = pr.price; } } catch (e) { this.post('aliya', null, `Не удалось поставить страховочный стоп на бирже для ${sym}: ${describeError(e)}. Позицию веду сам.`, 'system'); } }
      this.emit('open', pos);
    }
    st.orders = [{ts: Date.now(), text: `${dir > 0 ? 'Купил' : 'Продал'} ${sym} ${fmtQty(f.qty, f.fill)} @ ${fmtPrice(f.fill)} · ${strategy}`}, ...st.orders].slice(0, 30);
    out.push({act: now ? 'add' : 'open', sym, dir, usd: f.qty * f.fill});
    this.touch(); return {done: out};
  }
  // фандинг-арбитраж (только виртуальный счёт): спот + шорт фьючерса, деньги заморожены, доход — фандинг
  openCarry(sym, notional, P, ctx = {}){
    const pf = this.state.books.paper, locked = notional * (1 + 1 / P.lev), cost = notional * P.cost / 2;
    if (locked + cost > pf.cash * 0.98) return null;
    pf.cash -= locked + cost; pf.fees += cost;
    const pos = {id: this.ctx.id(), kind: 'carry', strategy: 'carry', sym, symbol: (this.market.coins[sym] || {}).symbol, dir: 0, qty: 1, entry: locked, notional, lev: P.lev, funding: 0, fees: cost, sl: null, tp: null, stop: 0, riskUSD: 0, conf: 0, ts: Date.now(), ctx};
    pf.positions.push(pos); this.touch(); return pos;
  }
  creditCarry(pos, rate){ const pf = this.state.books.paper, g = pos.notional * rate; pf.cash += g; pos.funding += g; pos.lastRate = rate; return g; }
  closeCarry(pos, reason = 'фандинг упал'){
    const pf = this.state.books.paper; if (!pf.positions.includes(pos)) return null;
    const cost = pos.notional * (pos.ctx && pos.ctx.costRate || 0.0038) / 2;
    pf.cash += pos.entry - cost; pf.fees += cost; pf.positions = pf.positions.filter(x => x !== pos);
    const net = pos.funding - pos.fees - cost;
    const c = {id: pos.id, kind: 'carry', sym: pos.sym, dir: 0, qty: pos.notional, entry: 0, exit: 0, ts: pos.ts, tsClose: Date.now(), pnl: net, pct: net / pos.entry, reason, strategy: 'carry', ctx: pos.ctx, fees: pos.fees + cost, funding: pos.funding};
    pf.closed.unshift(c); if (pf.closed.length > 300) pf.closed.length = 300; this.touch(); return c;
  }

  // стратегия допущена к реальным деньгам, только если прошла проверку (state.gate[id].real === true)
  realAllowed(strategy){ const g = (this.state.gate || {})[strategy || 'legacy']; return !!(g && g.real); }

  // ---------- команды из интерфейса ----------
  setProfile(key){ if (!B.PROFILES[key]) return; this.state.profile = key; this.state.params = {...B.PROFILES[key]}; this.post('system', null, `Профиль риска: ${B.PROFILES[key].label}. Риск на сделку ${this.state.params.riskPct}%, порог сигнала ${this.state.params.threshold}%, до ${this.state.params.maxPos} позиций.`, 'system'); this.touch(); }
  setParam(k, v){
    const st = this.state;
    if (k === 'shorts'){ st.params.shorts = !!v; }
    else if (B.PARAM_LIMITS[k]){ const [a, b] = B.PARAM_LIMITS[k]; const n = +v; if (!isFinite(n)) return; st.params[k] = clamp(n, a, b); }
    else return;
    st.profile = 'custom'; this.touch();
  }
  setAuto(v){ this.state.auto = !!v; this.post('system', null, v ? 'Автосделки включены: Артур исполняет сигналы сам.' : 'Ручной режим: Артур будет ждать вашего подтверждения по каждой сделке.', 'system'); this.touch(); }
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
    if (c){ this.post('aliya', null, `Закрыл вручную по вашей команде: ${sideRu(c.dir)} ${c.sym} ${fmtUSD(c.pnl, true)} (${fmtPct(c.pct)}).`, 'trade'); this.emit('react', {agent: 'aliya', say: `Закрыл ${c.sym} по команде`, pnl: c.pnl}); }
  }
  resetPaper(){
    if (this.state.active !== 'paper') return false;
    const st = this.state;
    st.books.paper = newBook(this.accounts.paper, this.CFG); st.books.paper.everActive = true;
    Object.assign(st, {brief: null, evals: [], evalLog: [], signals: [], sigLog: [], pending: [], orders: [], feed: [], stats: freshStats()});
    st.pf.dayKey = this.dayKey(); st.pf.dayStart = this.equity();
    this.post('system', null, `Виртуальный счёт сброшен: ${fmtUSD(this.CFG.paperCash)}.`, 'system');
    this.save(); this.emit('reset');
    return true;
  }

  // ---------- Claude ----------
  snapshot(){
    const st = this.state, pf = st.pf, eq = this.equity(), cl = pf.closed; const r2 = x => Math.round(x * 100) / 100;
    return {
      time: new Date().toLocaleString('ru-RU', {timeZone: this.CFG.tz}), venue: this.venue(), real_money: !!this.acc.real, risk_profile: st.profile, params: st.params, auto_trading: st.auto, trading_on: st.tradingOn,
      account: {equity: r2(eq), pnl_total: r2(eq - pf.startEquity), pnl_today: r2(eq - pf.dayStart), trades: cl.length, win_rate: cl.length ? Math.round(cl.filter(c => c.pnl > 0).length / cl.length * 100) : null, max_drawdown_pct: r2(pf.maxDD * 100), daily_stop_active: pf.killed},
      market: Object.values(this.market.coins).map(c => { const it = B.indicators(c); const b = st.brief && st.brief.items.find(i => i.sym === c.sym); return {coin: c.sym, price: +c.price.toPrecision(6), chg_24h_pct: r2(c.chg24 * 100), rsi: Math.round(it.rsi), atr_pct: r2(it.atrPct * 100), trend: b ? b.label : null, news_tone: b ? r2(b.sent) : null, nika_score: b ? r2(b.score) : null}; }),
      news: st.news.slice(0, 6).map(n => ({coins: n.coins.length ? n.coins : 'весь рынок', title: n.titleRu || n.title, source: n.source, reliability: n.rel, tone: r2(n.s), minutes_ago: Math.round((Date.now() - n.ts) / 60000)})),
      boris_evals: st.evalLog.slice(0, 4).map(e => ({coin: e.sym, side: sideRu(e.dir), risk: e.risk, verdict: B.VERDICT_RU[e.verdict], reasons: e.reasons})),
      timur_signals: st.sigLog.slice(0, 4).map(s => ({coin: s.sym, type: s.type === 'open' ? sideRu(s.dir) : 'закрыть', confidence: s.conf})),
      positions: pf.positions.map(p => ({coin: p.sym, side: sideRu(p.dir), qty: +p.qty.toPrecision(5), entry: +p.entry.toPrecision(6), price: +this.price(p.sym).toPrecision(6), pnl: r2(this.upnl(p)), stop: p.sl != null ? +p.sl.toPrecision(6) : null, take: p.tp != null ? +p.tp.toPrecision(6) : null, strategy: p.strategy || 'legacy'})),
      pending_approvals: st.pending.map(p => ({coin: p.sym, side: sideRu(p.dir), confidence: p.conf})),
      recent_trades: cl.slice(0, 6).map(c => ({coin: c.sym, side: sideRu(c.dir), pnl: r2(c.pnl), reason: c.reason})),
    };
  }
  async chat(agent, turns){
    const a = AGENTS[agent]; if (!a) throw new Error('Нет такого агента');
    const clean = (Array.isArray(turns) ? turns : []).filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim()).slice(-8).map(t => ({role: t.role, content: t.content.slice(0, 1500)}));
    while (clean.length && clean[0].role !== 'user') clean.shift();
    if (!clean.length || clean[clean.length - 1].role !== 'user') throw new Error('Пустой вопрос');
    const system = `Ты — ${a.name}, ${a.role} в офисе крипто-трейдинга JA Capital. Офис работает на реальных котировках; счёт: ${this.venue()}. Цепочка: Рустам (тренды и новости) → Джама (риски) → Нод (сигналы) → Артур (исполнение).
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
      account: {id: st.active, kind: this.acc.kind, label: this.acc.label, real: !!this.acc.real, ready: !!this.acc.ready, error: this.acc.error || ''}, accounts: this.accountsPublic(),
      pf: {cash: pf.cash, startEquity: pf.startEquity, positions: pf.positions.map(({closing, ...p}) => p), closed: pf.closed.slice(0, 60), fees: pf.fees, dayStart: pf.dayStart, killed: pf.killed, curve: pf.curve.slice(-400), peak: pf.peak, maxDD: pf.maxDD,
        balance: this.broker.lastBalance || null, maxOrderUsd: this.acc.maxOrderUsd, closedCount: pf.closed.length, wins: pf.closed.filter(c => c.pnl > 0).length, grossWin: pf.closed.filter(c => c.pnl > 0).reduce((a, c) => a + c.pnl, 0), grossLoss: -pf.closed.filter(c => c.pnl <= 0).reduce((a, c) => a + c.pnl, 0), realized: pf.closed.reduce((a, c) => a + c.pnl, 0)},
      news: st.news.slice(0, 30), brief: st.brief, evals: st.evals, evalLog: st.evalLog, sigLog: st.sigLog, pending: st.pending, orders: st.orders, stats: st.stats,
      status: {market: this.market.status, ai: aiEnabled()},
      ...(this.extra ? this.extra() : {}),
    };
  }
}
