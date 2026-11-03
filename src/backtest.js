// Бэктест: история Binance (свечи и фандинг) → прогон стратегий с комиссиями, проскальзыванием и фандингом.
// Параметры стратегий заданы заранее, без подгонки под историю, чтобы результат не был переоптимизирован.
import * as B from './brain.js';

export const BT_VERSION = 1;
const DAY = 864e5, TF = {'5m': 3e5, '1h': 36e5, '1d': DAY};
const TZ_SHIFT = 5 * 36e5; // торговый день офиса — по Ташкенту
const LBS = [5, 10, 20, 30, 60, 90, 150, 250, 360];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- загрузка истории ----------
async function retry(fn, tries = 4){
  for (let i = 0; ; i++){ try { return await fn(); } catch (e) { if (i >= tries - 1) throw e; await sleep(2000 * (i + 1)); } }
}
export async function loadCandles(ex, symbol, tf, since, until = Date.now()){
  const ms = TF[tf], out = [];
  let t = since;
  for (let guard = 0; guard < 2000 && t < until; guard++){
    const rows = await retry(() => ex.fetchOHLCV(symbol, tf, t, 1000));
    if (!rows || !rows.length) break;
    for (const r of rows){
      if (r[0] + ms > until) break; // незакрытая свеча
      if (!out.length || r[0] > out[out.length - 1].t) out.push({t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4]});
    }
    const last = rows[rows.length - 1][0];
    if (last < t) break;
    t = last + ms;
  }
  return out;
}
export async function loadFunding(ex, symbol, since, until = Date.now()){
  const out = [];
  let t = since;
  for (let guard = 0; guard < 300 && t < until; guard++){
    const rows = await retry(() => ex.fetchFundingRateHistory(symbol, t, 1000));
    if (!rows || !rows.length) break;
    for (const r of rows) if (!out.length || r.timestamp > out[out.length - 1].t) out.push({t: r.timestamp, r: +r.fundingRate || 0});
    const last = rows[rows.length - 1].timestamp;
    if (last < t || rows.length < 1000) break;
    t = last + 1;
  }
  return out;
}

// ---------- счёт: подписанное количество, комиссии, проскальзывание, фандинг ----------
class Book {
  constructor(cash, cost){ Object.assign(this, {cash, fee: cost.fee, slip: cost.slip, useFunding: cost.funding !== false, q: {}, fees: 0, slipCost: 0, funding: 0, orders: 0, turnover: 0}); }
  trade(sym, dq, px){
    if (!dq) return px;
    const f = px * (1 + Math.sign(dq) * this.slip), n = Math.abs(dq) * f, fee = n * this.fee;
    this.cash -= dq * f + fee; this.fees += fee; this.slipCost += Math.abs(dq) * px * this.slip; this.turnover += n; this.orders++;
    const q = (this.q[sym] || 0) + dq; this.q[sym] = q === 0 ? 0 : q;
    return f;
  }
  fund(sym, px, rate){ const q = this.q[sym]; if (!q || !rate || !this.useFunding) return 0; const c = q * px * rate; this.cash -= c; this.funding += c; return c; }
  equity(px){ let e = this.cash; for (const s in this.q) if (this.q[s]) e += this.q[s] * px[s]; return e; }
  gross(px){ let g = 0; for (const s in this.q) if (this.q[s]) g += Math.abs(this.q[s]) * px[s]; return g; }
}

// фандинг: события между барами, по цене ближайшего закрытия
function fundingCursor(funding, syms, t0){
  const p = {}; for (const s of syms){ const arr = funding[s] || []; let i = 0; while (i < arr.length && arr[i].t <= t0) i++; p[s] = i; }
  return (s, upTo, cb) => { const arr = funding[s] || []; while (p[s] < arr.length && arr[p[s]].t <= upTo){ cb(arr[p[s]].r); p[s]++; } };
}
function timeline(c, syms, from){ const set = new Set(); for (const s of syms) for (const k of c[s]) if (k.t >= from) set.add(k.t); return [...set].sort((a, b) => a - b); }
function pushCurve(curve, tEnd, eq){ const d = Math.floor((tEnd - 1) / DAY) * DAY; if (curve.length && curve[curve.length - 1][0] === d) curve[curve.length - 1][1] = eq; else curve.push([d, eq]); }

// ---------- стратегия офиса: Рустам → Джама → Нод → Артур (как в brain.js / office.js) ----------
export function simAgents(data, {tf, cost, P, from, cash = 10000}){
  const ms = TF[tf], syms = Object.keys(data.c).filter(s => data.c[s].length > 230);
  const T = timeline(data.c, syms, from);
  const idx = {}; for (const s of syms) idx[s] = new Map(data.c[s].map((k, i) => [k.t, i]));
  const bk = new Book(cash, cost), px = {}, pos = new Map(), trades = [], curve = [];
  const fc = fundingCursor(data.f, syms, T[0] || from);
  let dayKey = null, dayStart = cash, killed = false;
  curve.push([Math.floor(from / DAY) * DAY - DAY, cash]);
  for (const s of syms){ const i0 = Math.max(0, data.c[s].findIndex(k => k.t >= from) - 1); px[s] = data.c[s][i0].c; }
  const maxOrder = eq => 0.30 * eq; // как на виртуальном счёте: $3000 при $10 000
  const close = (s, price, reason, t) => {
    const p = pos.get(s), f0 = bk.fees, fill = bk.trade(s, -p.dir * p.qty, price);
    const net = (fill - p.entry) * p.dir * p.qty - p.fees - (bk.fees - f0) - p.fund;
    trades.push({s, dir: p.dir, t0: p.t0, t1: t, pnl: net, r: net / p.risk, reason}); pos.delete(s);
  };
  const open = (s, dir, qty, price, stop, t) => {
    const f0 = bk.fees, fill = bk.trade(s, dir * qty, price);
    pos.set(s, {dir, qty, entry: fill, sl: fill - dir * stop, tp: fill + dir * stop * P.rr, stop, t0: t, n: 0, be: false, fees: bk.fees - f0, fund: 0, risk: qty * stop});
  };
  for (const t of T){
    const bar = {}; for (const s of syms){ const i = idx[s].get(t); if (i !== undefined) bar[s] = i; }
    // 1) внутри свечи: стопы и тейки (если задеты оба — считаем, что сначала стоп)
    for (const [s, p] of [...pos]){
      const i = bar[s]; if (i === undefined) continue; const k = data.c[s][i];
      const slHit = p.dir > 0 ? k.l <= p.sl : k.h >= p.sl, tpHit = p.dir > 0 ? k.h >= p.tp : k.l <= p.tp;
      if (slHit) close(s, p.dir > 0 ? Math.min(k.o, p.sl) : Math.max(k.o, p.sl), p.be ? 'безубыток' : 'стоп', t);
      else if (tpHit) close(s, p.dir > 0 ? Math.max(k.o, p.tp) : Math.min(k.o, p.tp), 'тейк', t);
    }
    for (const s in bar) px[s] = data.c[s][bar[s]].c;
    // 2) фандинг за время свечи
    for (const s of syms) fc(s, t + ms, r => { const c = bk.fund(s, px[s], r); const p = pos.get(s); if (p) p.fund += c; });
    // 3) закрытие свечи: безубыток, трейлинг, выход по времени, дневной лимит
    const inds = {};
    const ind = s => inds[s] ||= B.indicators({candles: data.c[s].slice(Math.max(0, bar[s] - 121), bar[s]), price: px[s], chg24: 0});
    for (const [s, p] of [...pos]){
      if (bar[s] === undefined) continue;
      p.n++; const gain = (px[s] - p.entry) * p.dir;
      if (!p.be && gain >= p.stop){ p.sl = p.entry + p.dir * p.stop * 0.15; p.be = true; }
      if (gain >= p.stop * 1.6){ const ns = px[s] - p.dir * 1.1 * ind(s).atr; if ((ns - p.sl) * p.dir > 0) p.sl = ns; }
      if (p.n >= P.timeStop) close(s, px[s], 'время', t);
    }
    let eq = bk.equity(px);
    const dk = Math.floor((t + ms + TZ_SHIFT) / DAY);
    if (dk !== dayKey){ dayKey = dk; dayStart = eq; killed = false; }
    if (!killed && eq < dayStart * (1 - P.dailyLimit / 100)) killed = true;
    // 4) конвейер агентов
    const items = [];
    for (const s in bar){
      if (bar[s] < 210) continue;
      const d = ind(s);
      const trend = Math.tanh(((d.ema9 - d.ema21) / d.price) / (d.atrPct * 0.35));
      const mom = B.clamp((d.rsi - 50) / 25, -1, 1);
      // новостей в истории нет: их вес (0,35) распределён между трендом и импульсом в тех же пропорциях
      items.push({s, d, trend, mom, score: (0.45 * trend + 0.20 * mom) / 0.65});
    }
    const hot = items.filter(i => Math.abs(i.score) >= 0.28).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3);
    const openRiskPct = [...pos.values()].reduce((a, p) => a + p.risk, 0) / eq * 100;
    const sigs = [];
    for (const it of hot){
      const {s, d} = it, dir = it.score > 0 ? 1 : -1;
      if (dir < 0 && !P.shorts) continue;
      const stop = 1.6 * d.atr, parts = [];
      const ref = B.atrPctSeries(data.c[s].slice(Math.max(0, bar[s] - 200), bar[s])) || d.atrPct;
      const volR = B.clamp((d.atrPct / ref - 0.95) * 70, 0, 28); if (volR > 6) parts.push(volR);
      const ext = dir > 0 ? B.clamp((d.rsi - 66) * 2.2, 0, 26) : B.clamp((34 - d.rsi) * 2.2, 0, 26); if (ext > 4) parts.push(ext);
      const same = pos.get(s); if (same && same.dir === dir) parts.push(38);
      const sameDir = [...pos.entries()].filter(([x, p]) => p.dir === dir && x !== s).length; if (sameDir) parts.push(sameDir * 6);
      const heat = B.clamp(openRiskPct / (P.riskPct * P.maxPos) * 18, 0, 18); if (heat > 5) parts.push(heat);
      const room = dir > 0 ? d.high20 - d.price : d.price - d.low20; if (room < stop * 0.6) parts.push(10);
      const risk = Math.round(B.clamp(8 + parts.reduce((a, x) => a + x, 0), 3, 99));
      const mult = risk < 40 ? 1 : risk < 62 ? 0.5 : 0; if (!mult) continue;
      let qty = eq * P.riskPct / 100 * mult / stop;
      qty = Math.min(qty, Math.min(0.35 * eq, maxOrder(eq)) / d.price);
      const conf = Math.round(B.clamp(38 + 62 * Math.abs(it.score) - risk * 0.35, 5, 97));
      if (conf >= P.threshold) sigs.push({s, dir, qty, stop});
    }
    for (const [s, p] of [...pos]){ const it = items.find(i => i.s === s); if (it && it.score * p.dir < -0.32 && !sigs.some(x => x.s === s)) close(s, px[s], 'разворот', t); }
    for (const g of sigs){
      if (killed) break;
      const ex = pos.get(g.s); if (ex && ex.dir === g.dir) continue;
      if (ex) close(g.s, px[g.s], 'разворот', t);
      if (pos.size >= P.maxPos) continue;
      eq = bk.equity(px);
      let qty = Math.min(g.qty, maxOrder(eq) / px[g.s]);
      const free = eq - bk.gross(px);
      if (qty * px[g.s] * 1.002 > free * 0.98) qty = free * 0.98 / (px[g.s] * 1.002);
      if (qty * px[g.s] < 10) continue;
      open(g.s, g.dir, qty, px[g.s], g.stop, t);
    }
    pushCurve(curve, t + ms, bk.equity(px));
  }
  return {curve, trades, book: bk};
}

// ---------- трендовый ансамбль: каналы Дончиана на дневках + размер по волатильности ----------
// по мотивам Zarattini, Pagani, Barbon (2025) «Catching Crypto Trends»
export function simTrend(data, {cost, from, cash = 10000, lbs = LBS, tv = 0.25, cap = 1, shortW = 0, band = 0.2}){
  const syms = Object.keys(data.c).filter(s => data.c[s].length > 120), N = syms.length;
  const T = timeline(data.c, syms, 0);
  const idx = {}; for (const s of syms) idx[s] = new Map(data.c[s].map((k, i) => [k.t, i]));
  const st = {}; for (const s of syms) st[s] = lbs.map(() => ({on: 0, stop: 0, entry: 0, t0: 0}));
  const bk = new Book(cash, cost), px = {}, curve = [], eps = [];
  const fc = fundingCursor(data.f, syms, from);
  for (const t of T){
    const live = t >= from;
    const bar = {}; for (const s of syms){ const i = idx[s].get(t); if (i !== undefined) bar[s] = i; }
    for (const s in bar) px[s] = data.c[s][bar[s]].c;
    // фандинг за прошедшие сутки — по позициям, которые держали
    if (live) for (const s of syms) fc(s, t + DAY, r => bk.fund(s, px[s], r));
    const eq = bk.equity(px);
    for (const s in bar){
      const i = bar[s], c = data.c[s], close = c[i].c;
      let sig = 0;
      lbs.forEach((L, j) => {
        if (i < L) return;
        const g = st[s][j];
        let hiP = -Infinity, loP = Infinity; for (let k = i - L; k < i; k++){ const v = c[k].c; if (v > hiP) hiP = v; if (v < loP) loP = v; }
        let hiC = close, loC = close; for (let k = i - L + 1; k < i; k++){ const v = c[k].c; if (v > hiC) hiC = v; if (v < loC) loC = v; }
        const mid = (hiC + loC) / 2;
        const exit = () => { if (live && g.t0 >= from) eps.push({s, L, dir: g.on, ret: g.on * (close / g.entry - 1), t0: g.t0, t1: t}); g.on = 0; };
        if (g.on === 1){ g.stop = Math.max(g.stop, mid); if (close < g.stop) exit(); }
        else if (g.on === -1){ g.stop = Math.min(g.stop, mid); if (close > g.stop) exit(); }
        if (g.on === 0){
          if (close > hiP){ g.on = 1; g.stop = mid; g.entry = close; g.t0 = t; }
          else if (shortW > 0 && close < loP){ g.on = -1; g.stop = mid; g.entry = close; g.t0 = t; }
        }
        sig += g.on === 1 ? 1 : g.on === -1 ? -shortW : 0;
      });
      if (!live) continue;
      sig /= lbs.length;
      let scale = 0;
      if (i >= 91){ let m = 0; const r = []; for (let k = i - 89; k <= i; k++){ const x = Math.log(c[k].c / c[k - 1].c); r.push(x); m += x; } m /= r.length; const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(365); scale = sd > 0 ? Math.min(cap, tv / sd) : 0; }
      const target = sig * scale / N * eq / close, q = bk.q[s] || 0;
      if (target === 0 && q === 0) continue;
      if (target === 0 || q === 0 || Math.sign(target) !== Math.sign(q) || Math.abs(target - q) > band * Math.abs(q)) bk.trade(s, target - q, close);
    }
    if (live) pushCurve(curve, t + DAY, bk.equity(px));
  }
  return {curve, eps, book: bk};
}

// ---------- ориентиры: купить и держать ----------
function simHold(data, syms, from, to){
  const T = timeline(data.c, syms, from).filter(t => t < to), idx = {};
  for (const s of syms) idx[s] = new Map(data.c[s].map((k, i) => [k.t, i]));
  const q = {}, px = {}, curve = [];
  for (const t of T){
    for (const s of syms){ const i = idx[s].get(t); if (i !== undefined) px[s] = data.c[s][i].c; }
    if (!Object.keys(q).length && syms.every(s => px[s])) for (const s of syms) q[s] = 1 / syms.length / px[s];
    if (Object.keys(q).length) pushCurve(curve, t + DAY, syms.reduce((a, s) => a + q[s] * px[s], 0));
  }
  return curve;
}

// ---------- метрики ----------
function slice(curve, from, to = Infinity){
  if (!curve) return null;
  const j = curve.findIndex(p => p[0] >= from); if (j < 0) return null;
  const out = curve.slice(Math.max(0, j - 1)).filter(p => p[0] < to);
  return out.length >= 2 ? out : null;
}
export function metrics(curve){
  if (!curve || curve.length < 2) return null;
  const e0 = curve[0][1], e1 = curve[curve.length - 1][1], r = [];
  for (let i = 1; i < curve.length; i++) r.push(curve[i][1] / curve[i - 1][1] - 1);
  const n = r.length, mean = r.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  let peak = -Infinity, mdd = 0; for (const [, e] of curve){ peak = Math.max(peak, e); mdd = Math.max(mdd, 1 - e / peak); }
  const years = (curve[curve.length - 1][0] - curve[0][0]) / (365 * DAY), total = e1 / e0 - 1;
  const cagr = years >= 0.9 && e1 > 0 ? Math.pow(e1 / e0, 1 / years) - 1 : null;
  return {total, cagr, vol: sd * Math.sqrt(365), sharpe: sd > 0 ? mean / sd * Math.sqrt(365) : 0, mdd, days: n, from: curve[0][0], to: curve[curve.length - 1][0]};
}
function tradeStats(trades, from, to){
  const t = trades.filter(x => x.t0 >= from && x.t0 < to); if (!t.length) return {trades: 0};
  const w = t.filter(x => x.pnl > 0), gp = w.reduce((a, x) => a + x.pnl, 0), gl = -t.filter(x => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0);
  const why = {}; for (const x of t) why[x.reason] = (why[x.reason] || 0) + 1;
  return {trades: t.length, win: w.length / t.length, avgR: t.reduce((a, x) => a + x.r, 0) / t.length, pf: gl > 0 ? gp / gl : null, why};
}
function epStats(eps, from, to){
  const e = eps.filter(x => x.t0 >= from && x.t0 < to); if (!e.length) return {trades: 0};
  return {trades: e.length, win: e.filter(x => x.ret > 0).length / e.length, avgRet: e.reduce((a, x) => a + x.ret, 0) / e.length};
}
function years(curve){
  const out = {}; if (!curve) return out;
  let prev = curve[0];
  for (let i = 1; i < curve.length; i++){
    const y = new Date(curve[i][0]).getUTCFullYear(), yn = i + 1 < curve.length ? new Date(curve[i + 1][0]).getUTCFullYear() : null;
    if (yn !== y){ out[y] = curve[i][1] / prev[1] - 1; prev = curve[i]; }
  }
  return out;
}
const thin = (c, n = 400) => { if (!c) return []; const k = Math.max(1, Math.ceil(c.length / n)), e0 = c[0][1]; return c.filter((_, i) => i % k === 0 || i === c.length - 1).map(([t, e]) => [t, +(e / e0).toFixed(5)]); };
const row = (id, name, note, curve, extra = {}) => ({id, name, note, m: metrics(curve), years: years(curve), curve: thin(curve), ...extra});

// ---------- полный прогон ----------
const START = Date.UTC(2021, 0, 1), LOAD = Date.UTC(2020, 0, 1), PUB = Date.UTC(2025, 3, 1);
// загрузка истории с биржи (сеть, без тяжёлых вычислений)
export async function loadAll({ex, coins, symbolFor, now = Date.now(), log = () => {}}){
  const w120 = now - 120 * DAY, w365 = now - 365 * DAY, data = {d5: {c: {}, f: {}}, d1h: {c: {}, f: {}}, dd: {c: {}, f: {}}};
  for (const [n, s] of coins.entries()){
    const sym = symbolFor(s);
    log(`загружаю историю ${s} (${n + 1}/${coins.length})`);
    data.dd.c[s] = await loadCandles(ex, sym, '1d', LOAD, now);
    data.d1h.c[s] = await loadCandles(ex, sym, '1h', w365 - 240 * TF['1h'], now);
    data.d5.c[s] = await loadCandles(ex, sym, '5m', w120 - 240 * TF['5m'], now);
    data.dd.f[s] = await loadFunding(ex, sym, LOAD, now).catch(() => []);
  }
  for (const k of ['d1h', 'd5']) data[k].f = data.dd.f;
  return data;
}
// расчёт всех стратегий (тяжёлый — запускается в отдельном потоке)
export function computeAll(data, {coins, params: P, cost = {fee: 0.0005, slip: 0.0002}, now = Date.now()}){
  const t0 = Date.now(), w120 = now - 120 * DAY, w365 = now - 365 * DAY;
  const {d5, d1h, dd} = data;
  const noCost = {fee: 0, slip: 0, funding: false}, cost2 = {fee: cost.fee * 2, slip: cost.slip * 2};
  const a5 = simAgents(d5, {tf: '5m', cost, P, from: w120});
  const a5free = simAgents(d5, {tf: '5m', cost: noCost, P, from: w120});
  const a1h = simAgents(d1h, {tf: '1h', cost, P, from: w365});
  const tl = simTrend(dd, {cost, from: START});
  const tls = simTrend(dd, {cost, from: START, shortW: 0.5});
  const tl2 = simTrend(dd, {cost: cost2, from: START});
  const btc = simHold(dd, [coins.includes('BTC') ? 'BTC' : coins[0]], START, now), ew = simHold(dd, coins, START, now);
  const cut = (c, f) => slice(c, f);
  const costOf = (b, eq0 = 10000) => ({fees: b.fees / eq0, slip: b.slipCost / eq0, funding: b.funding / eq0, turnover: b.turnover / eq0});
  const first = {}; for (const s of coins) first[s] = dd.c[s] && dd.c[s].length ? dd.c[s][0].t : null;
  return {
    version: BT_VERSION, ts: Date.now(), took: Math.round((Date.now() - t0) / 1000), coins, cost, first, pub: PUB,
    params: {riskPct: P.riskPct, rr: P.rr, threshold: P.threshold, maxPos: P.maxPos, timeStop: P.timeStop, dailyLimit: P.dailyLimit, shorts: P.shorts},
    windows: [
      {id: 'w120', title: 'Последние 120 дней', from: w120, to: now, rows: [
        row('a5', 'Агенты сейчас (5 мин)', 'логика Рустама, Джамы и Нода как в офисе; новости не учтены', a5.curve, {stats: tradeStats(a5.trades, w120, now), costs: costOf(a5.book)}),
        row('a5free', 'То же без комиссий', 'чтобы увидеть, сколько съедают издержки', a5free.curve, {stats: tradeStats(a5free.trades, w120, now)}),
        row('tl', 'Тренд-ансамбль (лонг)', 'каналы Дончиана 5–360 дней, размер по волатильности', cut(tl.curve, w120), {stats: epStats(tl.eps, w120, now)}),
        row('tls', 'Тренд-ансамбль (лонг + шорт)', 'шорты с половинным весом', cut(tls.curve, w120), {stats: epStats(tls.eps, w120, now)}),
        row('btc', 'BTC: купить и держать', '', cut(btc, w120)),
        row('ew', '6 монет поровну: купить и держать', '', cut(ew, w120)),
      ]},
      {id: 'w365', title: 'Последние 365 дней', from: w365, to: now, rows: [
        row('a1h', 'Агенты на часовых свечах', 'та же логика, таймфрейм 1 час', a1h.curve, {stats: tradeStats(a1h.trades, w365, now), costs: costOf(a1h.book)}),
        row('tl', 'Тренд-ансамбль (лонг)', '', cut(tl.curve, w365), {stats: epStats(tl.eps, w365, now)}),
        row('tls', 'Тренд-ансамбль (лонг + шорт)', '', cut(tls.curve, w365), {stats: epStats(tls.eps, w365, now)}),
        row('btc', 'BTC: купить и держать', '', cut(btc, w365)),
        row('ew', '6 монет поровну: купить и держать', '', cut(ew, w365)),
      ]},
      {id: 'all', title: 'С 2021 года', from: START, to: now, rows: [
        row('tl', 'Тренд-ансамбль (лонг)', '', tl.curve, {stats: epStats(tl.eps, START, now), costs: costOf(tl.book), afterPub: metrics(cut(tl.curve, PUB))}),
        row('tls', 'Тренд-ансамбль (лонг + шорт)', '', tls.curve, {stats: epStats(tls.eps, START, now), costs: costOf(tls.book), afterPub: metrics(cut(tls.curve, PUB))}),
        row('tl2', 'Тренд-ансамбль при двойных издержках', 'проверка на устойчивость', tl2.curve, {afterPub: metrics(cut(tl2.curve, PUB))}),
        row('btc', 'BTC: купить и держать', '', btc, {afterPub: metrics(cut(btc, PUB))}),
        row('ew', '6 монет поровну: купить и держать', '', ew, {afterPub: metrics(cut(ew, PUB))}),
      ]},
    ],
  };
}

// краткая сводка для лога сервера
export function summaryLines(res){
  const pct = x => x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
  const out = [];
  for (const w of res.windows){
    out.push(`[backtest] ${w.title}:`);
    for (const r of w.rows){
      if (!r.m) { out.push(`[backtest]   ${r.name}: нет данных`); continue; }
      const s = r.stats && r.stats.trades != null ? `, сделок ${r.stats.trades}${r.stats.win != null ? `, прибыльных ${Math.round(r.stats.win * 100)}%` : ''}` : '';
      const c = r.costs ? `, комиссии ${pct(-r.costs.fees)}, проскальз. ${pct(-r.costs.slip)}, фандинг ${pct(-r.costs.funding)}` : '';
      const a = r.afterPub ? `; с 04.2025: ${pct(r.afterPub.total)}, просадка ${pct(-r.afterPub.mdd)}` : '';
      out.push(`[backtest]   ${r.name}: ${pct(r.m.total)}${r.m.cagr != null ? ` (${pct(r.m.cagr)}/год)` : ''}, Шарп ${r.m.sharpe.toFixed(2)}, просадка ${pct(-r.m.mdd)}${s}${c}${a}`);
    }
  }
  const yrs = res.windows[2].rows.map(r => `${r.name}: ` + Object.entries(r.years).map(([y, v]) => `${y} ${pct(v)}`).join(', '));
  for (const y of yrs) out.push('[backtest]   по годам — ' + y);
  return out;
}
