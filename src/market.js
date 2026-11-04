// Котировки: опрос тикеров и свечей, «живая» текущая свеча
import {EventEmitter} from 'node:events';
import {symbolFor, describeError} from './exchange.js';
import {tfMs} from './mockexchange.js';
import {atrPctSeries} from './brain.js';

export class Market extends EventEmitter {
  constructor(ex, CFG){
    super();
    this.ex = ex; this.CFG = CFG; this.tf = tfMs(CFG.timeframe);
    this.coins = {}; this.status = {ok: false, error: 'Подключаюсь к бирже…', lastOk: 0, fails: 0};
  }
  async init(){
    await this.ex.loadMarkets();
    for (const base of this.CFG.coins){
      const symbol = symbolFor(base, this.CFG.marketType);
      if (!this.ex.markets[symbol]){ console.warn(`[market] ${symbol} нет на бирже — пропускаю`); continue; }
      this.coins[base] = {sym: base, symbol, price: 0, chg24: 0, candles: [], cur: null, atrRef: 0.004};
    }
    if (!Object.keys(this.coins).length) throw new Error('Ни одной монеты из COINS нет на бирже');
    for (const base of Object.keys(this.coins)) await this.loadCandles(base, 300);
    this.status = {ok: true, error: '', lastOk: Date.now(), fails: 0};
  }
  async loadCandles(base, limit){
    const c = this.coins[base];
    const rows = await this.ex.fetchOHLCV(c.symbol, this.CFG.timeframe, undefined, limit);
    const ks = rows.filter(r => r && r[4] != null).map(r => ({t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] || 0}));
    if (!ks.length) return;
    if (limit >= 50 || !c.candles.length){
      c.cur = ks[ks.length - 1]; c.candles = ks.slice(0, -1);
    } else {
      for (const k of ks){
        if (c.cur && k.t === c.cur.t){ c.cur.v = k.v; c.cur.h = Math.max(c.cur.h, k.h); c.cur.l = Math.min(c.cur.l, k.l); continue; }
        const i = c.candles.findIndex(x => x.t === k.t);
        if (i >= 0) c.candles[i] = k; else if (!c.cur || k.t < c.cur.t) { c.candles.push(k); c.candles.sort((a, b) => a.t - b.t); }
      }
    }
    if (c.candles.length > 600) c.candles.splice(0, c.candles.length - 600);
    c.price = c.price || c.cur.c;
    c.atrRef = atrPctSeries(c.candles) || c.atrRef;
    this.emit('candles', base, limit >= 50 ? c.candles.slice(-240) : c.candles.slice(-4));
  }
  async pollTickers(){
    const list = Object.values(this.coins).map(c => c.symbol);
    try {
      // полный тикер за 24 ч (вес 40 у Binance) — раз в минуту ради изменения за сутки; в остальное время только цены (вес 2)
      const now = Date.now(); const closed = [];
      const cheap = this.ex.has && this.ex.has.fetchLastPrices && this.fullAt && now - this.fullAt < 60000;
      let t;
      if (cheap){ const lp = await this.ex.fetchLastPrices(list); t = {}; for (const k in lp) t[k] = {last: lp[k].price}; }
      else { t = await this.ex.fetchTickers(list); this.fullAt = now; }
      for (const c of Object.values(this.coins)){
        const tk = t[c.symbol]; if (!tk) continue;
        const p = +(tk.last ?? tk.close ?? ((tk.bid && tk.ask) ? (tk.bid + tk.ask) / 2 : 0)); if (!(p > 0)) continue;
        c.price = p; if (tk.percentage != null && isFinite(tk.percentage)) c.chg24 = tk.percentage / 100;
        if (!c.cur) c.cur = {t: Math.floor(now / this.tf) * this.tf, o: p, h: p, l: p, c: p, v: 0};
        while (now >= c.cur.t + this.tf){
          c.candles.push({...c.cur});
          c.cur = {t: c.cur.t + this.tf, o: c.cur.c, h: c.cur.c, l: c.cur.c, c: c.cur.c, v: 0};
          if (!closed.includes(c.sym)) closed.push(c.sym);
        }
        c.cur.c = p; if (p > c.cur.h) c.cur.h = p; if (p < c.cur.l) c.cur.l = p;
      }
      this.status = {ok: true, error: '', lastOk: now, fails: 0};
      this.emit('tick');
      if (closed.length){
        this.emit('candle', closed);
        setTimeout(() => { for (const s of closed) this.loadCandles(s, 4).catch(() => {}); }, 4000);
      }
    } catch (e) {
      this.status.fails++; this.status.ok = false; this.status.error = describeError(e);
      if (this.status.fails === 1 || this.status.fails % 20 === 0) console.warn('[market]', this.status.error);
      this.emit('status');
    }
  }
}
