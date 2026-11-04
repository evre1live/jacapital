// Бэктест: история Binance (свечи и фандинг) → прогон стратегий с комиссиями, проскальзыванием и фандингом.
// Параметры стратегий заданы заранее, без подгонки под историю, чтобы результат не был переоптимизирован.
// Версия 2: тренд с ML-фильтром, фандинг-арбитраж, возврат к среднему, портфель стратегий; логика стратегий — в strategies.js (та же, что торгует).
import * as B from './brain.js';
import * as S from './strategies.js';

export const BT_VERSION = 3;
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

// ---------- общие помощники для свечей-колонок ----------
function timelineCols(cols, syms, from, to = Infinity){ const set = new Set(); for (const s of syms){ const c = cols[s]; for (let i = 0; i < c.n; i++) if (c.t[i] >= from && c.t[i] < to) set.add(c.t[i]); } return [...set].sort((a, b) => a - b); }
function walker(cols, syms, from){ const p = {}; for (const s of syms) p[s] = Math.max(0, S.idxAtOrBefore(cols[s], from - 1) + 1); return t => { const bar = {}; for (const s of syms){ const c = cols[s]; while (p[s] < c.n && c.t[p[s]] < t) p[s]++; if (p[s] < c.n && c.t[p[s]] === t) bar[s] = p[s]; } return bar; }; }
function startPx(cols, syms, from){ const px = {}; for (const s of syms){ const i = S.idxAtOrBefore(cols[s], from - 1); px[s] = cols[s].c[Math.max(0, i)]; } return px; }

// ---------- 1. трендовый ансамбль (+ необязательный ML-множитель) ----------
export function simTrend(dd, {cost, from, cash = 10000, P = S.TREND_P, series = null, mult = null}){
  const syms = Object.keys(dd.c).filter(s => dd.c[s].n > 120), N = syms.length, eps = [];
  const ser = series || Object.fromEntries(syms.map(s => [s, S.trendSeries(dd.c[s], P, eps)]));
  const T = timelineCols(dd.c, syms, from), at = walker(dd.c, syms, from);
  const bk = new Book(cash, cost), px = startPx(dd.c, syms, from), curve = [[Math.floor(from / DAY) * DAY - DAY, cash]];
  const fc = fundingCursor(dd.f, syms, from);
  for (const t of T){
    const bar = at(t);
    for (const s in bar) px[s] = dd.c[s].c[bar[s]];
    for (const s of syms) fc(s, t + DAY, r => bk.fund(s, px[s], r));
    const eq = bk.equity(px);
    for (const s in bar){
      const i = bar[s], close = px[s], m = mult ? mult[s][i] : 1;
      const target = ser[s].sig[i] * ser[s].scale[i] * m / N * eq / close, q = bk.q[s] || 0;
      if (target === 0 && q === 0) continue;
      if (target === 0 || q === 0 || Math.sign(target) !== Math.sign(q) || Math.abs(target - q) > P.band * Math.abs(q)) bk.trade(s, target - q, close);
    }
    pushCurve(curve, t + DAY, bk.equity(px));
  }
  return {curve, eps, book: bk, series: ser};
}

// ---------- 2. фандинг-арбитраж ----------
export function simCarry(dd, {from, cash = 10000, P = S.CARRY_P}){
  const syms = Object.keys(dd.f).filter(s => dd.f[s] && dd.f[s].length > 60), N = syms.length; if (!N) return null;
  const share = S.carryYieldShare(P), K = {}, ev = [], trades = [];
  for (const s of syms){ K[s] = cash / N; const on = S.carryStates(dd.f[s], P); dd.f[s].forEach((x, j) => { if (x.t >= from) ev.push({s, t: x.t, r: x.r, on: on[j]}); }); }
  ev.sort((a, b) => a.t - b.t);
  const cur = Object.fromEntries(syms.map(s => [s, 0])), curve = [[Math.floor(from / DAY) * DAY - DAY, cash]];
  let fund = 0, costs = 0, open = {};
  for (const e of ev){
    if (e.on !== cur[e.s]){ const c = K[e.s] * share * P.cost / 2; K[e.s] -= c; costs += c; cur[e.s] = e.on;
      if (e.on) open[e.s] = {t0: e.t, k0: K[e.s] + c}; else if (open[e.s]){ trades.push({s: e.s, t0: open[e.s].t0, t1: e.t, pnl: K[e.s] - open[e.s].k0}); delete open[e.s]; } }
    if (cur[e.s]){ const g = K[e.s] * share * e.r; K[e.s] += g; fund += g; }
    pushCurve(curve, e.t, syms.reduce((a, s) => a + K[s], 0));
  }
  const active = Object.values(cur).filter(Boolean).length;
  return {curve, trades, fund, costs, active};
}

// ---------- 3. возврат к среднему на часовых ----------
export function simMR(h, {cost, from, cash = 10000, P = S.MR_P}){
  const syms = Object.keys(h.c).filter(s => h.c[s].n > P.trendMa + 20), N = syms.length;
  const ind = Object.fromEntries(syms.map(s => [s, S.mrIndicators(h.c[s], P)]));
  const T = timelineCols(h.c, syms, from), at = walker(h.c, syms, from);
  const bk = new Book(cash, cost), px = startPx(h.c, syms, from), pos = {}, trades = [], curve = [[Math.floor(from / DAY) * DAY - DAY, cash]];
  const fc = fundingCursor(h.f, syms, from);
  for (const t of T){
    const bar = at(t);
    for (const s in bar) px[s] = h.c[s].c[bar[s]];
    for (const s of syms) fc(s, t + S.HOUR, r => { const c = bk.fund(s, px[s], r); if (pos[s]) pos[s].fund += c; });
    for (const s in bar){
      const i = bar[s], d = S.mrDecide(ind[s], i, pos[s] || null, P);
      if (d.act === 'exit'){ const p = pos[s], f0 = bk.fees; bk.trade(s, -p.qty, px[s]); trades.push({s, t0: p.t0, t1: t, pnl: (px[s] - p.entry) * p.qty - p.fees - (bk.fees - f0) - p.fund, reason: d.why}); delete pos[s]; }
      else if (d.act === 'enter'){ const eq = bk.equity(px), qty = eq / N / px[s], f0 = bk.fees; bk.trade(s, qty, px[s]); pos[s] = {i0: i, entry: px[s], stop: d.stop, qty, t0: t, fees: bk.fees - f0, fund: 0}; }
    }
    pushCurve(curve, t + S.HOUR, bk.equity(px));
  }
  return {curve, trades, book: bk};
}

// ---------- портфель: веса стратегий обратно их недавней волатильности, пересчёт раз в месяц ----------
// не больше cap на одну стратегию: иначе самая тихая (фандинг) забирает почти весь капитал
function capWeights(w, cap){ if (w.length * cap < 1) return w; let x = [...w]; for (let it = 0; it < 10; it++){ const over = x.map(v => Math.max(0, v - cap)), ex = over.reduce((a, v) => a + v, 0); if (ex < 1e-9) break; x = x.map(v => Math.min(v, cap)); const free = x.map(v => v < cap ? v : 0), fz = free.reduce((a, v) => a + v, 0); x = x.map((v, k) => free[k] ? v + ex * free[k] / fz : v); } return x; }
export function combine(curves, from, {look = 90, every = 30, cap = 0.5, ids = Object.keys(curves)} = {}){
  const maps = ids.map(id => new Map(curves[id].map(([t, e]) => [t, e])));
  const days = [...maps[0].keys()].filter(t => t >= from - DAY && maps.every(m => m.has(t))).sort((a, b) => a - b);
  if (days.length < 3) return null;
  const R = ids.map((_, k) => days.slice(1).map((t, i) => maps[k].get(t) / maps[k].get(days[i]) - 1));
  let w = ids.map(() => 1 / ids.length), eq = 1; const curve = [[days[0], 1]], wlog = [];
  for (let i = 0; i < days.length - 1; i++){
    if (i % every === 0 && i >= 20){
      const sd = R.map(r => { const x = r.slice(Math.max(0, i - look), i), m = x.reduce((a, v) => a + v, 0) / x.length; return Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, x.length - 1)) || 1e-6; });
      const inv = sd.map(v => 1 / Math.max(v, 1e-4)), z = inv.reduce((a, v) => a + v, 0); w = capWeights(inv.map(v => v / z), cap); wlog.push({t: days[i], w});
    }
    eq *= 1 + R.reduce((a, r, k) => a + w[k] * r[i], 0); curve.push([days[i + 1], eq]);
  }
  return {curve, weights: w, ids, wlog};
}

// ---------- ориентиры: купить и держать ----------
function simHold(dd, syms, from, to){
  const T = timelineCols(dd.c, syms, from, to), at = walker(dd.c, syms, from), q = {}, px = {}, curve = [];
  for (const t of T){
    const bar = at(t); for (const s in bar) px[s] = dd.c[s].c[bar[s]];
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
  const mo = S.monthly(curve);
  return {total, cagr, vol: sd * Math.sqrt(365), sharpe: sd > 0 ? mean / sd * Math.sqrt(365) : 0, mdd, days: n, from: curve[0][0], to: curve[curve.length - 1][0],
    months: mo.length, posMonths: mo.length ? mo.filter(x => x > 0).length / mo.length : null, worstMonth: mo.length ? Math.min(...mo) : null};
}
function tradeStats(trades, from, to){
  const t = trades.filter(x => x.t0 >= from && x.t0 < to); if (!t.length) return {trades: 0};
  const w = t.filter(x => x.pnl > 0), gp = w.reduce((a, x) => a + x.pnl, 0), gl = -t.filter(x => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0);
  const why = {}; for (const x of t) why[x.reason] = (why[x.reason] || 0) + 1;
  return {trades: t.length, win: w.length / t.length, avgR: t[0].r != null ? t.reduce((a, x) => a + x.r, 0) / t.length : null, pf: gl > 0 ? gp / gl : null, why};
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

// ---------- загрузка истории ----------
export const START = Date.UTC(2021, 0, 1), LOAD = Date.UTC(2020, 0, 1), PUB = Date.UTC(2025, 3, 1), ML_FROM = Date.UTC(2022, 0, 1);
export async function loadAll({ex, coins, symbolFor, now = Date.now(), log = () => {}}){
  const data = {dd: {c: {}, f: {}}, d1h: {c: {}, f: {}}};
  for (const [n, s] of coins.entries()){
    const sym = symbolFor(s);
    log(`загружаю историю ${s} (${n + 1}/${coins.length})`);
    data.dd.c[s] = S.toCols(await loadCandles(ex, sym, '1d', LOAD, now));
    data.d1h.c[s] = S.toCols(await loadCandles(ex, sym, '1h', START - 400 * TF['1h'], now));
    data.dd.f[s] = await loadFunding(ex, sym, LOAD, now).catch(() => []);
  }
  data.d1h.f = data.dd.f;
  return data;
}

// ---------- расчёт всех стратегий (тяжёлый — в отдельном потоке) ----------
export function computeAll(data, {coins, params: P, cost = {fee: 0.0005, slip: 0.0002}, now = Date.now()}){
  const t0 = Date.now(), w120 = now - 120 * DAY, w365 = now - 365 * DAY;
  const {dd, d1h} = data;
  const cost2 = {fee: cost.fee * 2, slip: cost.slip * 2};
  // старая логика агентов — для сравнения, на часовых свечах за год
  const syms1h = Object.keys(d1h.c);
  const legacy = {c: Object.fromEntries(syms1h.map(s => [s, S.fromCols(d1h.c[s], Math.max(0, S.idxAtOrBefore(d1h.c[s], w365) - 240))])), f: d1h.f};
  const a1h = simAgents(legacy, {tf: '1h', cost, P, from: w365});
  legacy.c = null;
  // тренд и тренд с ML-фильтром (модель обучается только на прошлом, первые прогнозы — с 2022 года)
  const tl = simTrend(dd, {cost, from: START});
  const ml = S.mlWalkForward(dd.c, tl.series, dd.f, ML_FROM);
  const tlml = simTrend(dd, {cost, from: ML_FROM, series: tl.series, mult: ml.mult});
  const tlFromMl = simTrend(dd, {cost, from: ML_FROM, series: tl.series});
  const tls = simTrend(dd, {cost, from: START, P: {...S.TREND_P, shortW: 0.5}});
  const tl2 = simTrend(dd, {cost: cost2, from: START, series: tl.series});
  const carry = simCarry(dd, {from: START});
  const mr = simMR(d1h, {cost, from: START});
  const mr2 = simMR(d1h, {cost: cost2, from: START});
  // портфель: тренд с ML + фандинг + возврат к среднему; и без ML — для сравнения
  const pick = (id, c) => c ? {[id]: c.curve} : {};
  const port = combine({...pick('tlml', tlml), ...pick('carry', carry), ...pick('mr', mr)}, ML_FROM);
  const port0 = combine({...pick('tl', tlFromMl), ...pick('carry', carry), ...pick('mr', mr)}, ML_FROM);
  const btcSym = coins.includes('BTC') ? 'BTC' : coins[0];
  const btc = simHold(dd, [btcSym], START, now), ew = simHold(dd, coins, START, now);
  const cut = (c, f) => slice(c, f);
  const costOf = (b, eq0 = 10000) => ({fees: b.fees / eq0, slip: b.slipCost / eq0, funding: b.funding / eq0, turnover: b.turnover / eq0});
  const first = {}; for (const s of coins) first[s] = dd.c[s] && dd.c[s].n ? dd.c[s].t[0] : null;
  const R = {
    tl: (w, f) => row('tl', 'Тренд-ансамбль', 'каналы Дончиана 5–360 дней, размер по волатильности', cut(tl.curve, f), {stats: epStats(tl.eps, f, now), ...(w === 'all' ? {costs: costOf(tl.book), afterPub: metrics(cut(tl.curve, PUB))} : {})}),
    tlml: (w, f) => row('tlml', 'Тренд + ML-фильтр', 'размер позиции по прогнозу модели; модель видит только прошлое', cut(tlml.curve, f), w === 'all' ? {afterPub: metrics(cut(tlml.curve, PUB))} : {}),
    carry: (w, f) => carry ? row('carry', 'Фандинг-арбитраж', 'спот + шорт фьючерса, пока фандинг выше 10% годовых; без плеча на споте, 2× на фьючерсе', cut(carry.curve, f), {stats: tradeStats(carry.trades, f, now), ...(w === 'all' ? {afterPub: metrics(cut(carry.curve, PUB))} : {})}) : null,
    mr: (w, f) => row('mr', 'Возврат к среднему (1 ч)', 'RSI-2 ниже 10 в восходящем тренде, выход над средней 5 ч', cut(mr.curve, f), {stats: tradeStats(mr.trades, f, now), ...(w === 'all' ? {costs: costOf(mr.book), afterPub: metrics(cut(mr.curve, PUB))} : {})}),
    port: (w, f) => port ? row('port', 'Портфель: тренд+ML, фандинг, возврат', 'веса обратно волатильности стратегий (не больше 50% на одну), пересчёт раз в месяц', cut(port.curve, f), w === 'all' ? {afterPub: metrics(cut(port.curve, PUB)), weights: port.weights, wids: port.ids} : {}) : null,
    port0: (w, f) => port0 ? row('port0', 'Тот же портфель без ML', '', cut(port0.curve, f), w === 'all' ? {afterPub: metrics(cut(port0.curve, PUB))} : {}) : null,
    btc: (w, f) => row('btc', 'BTC: купить и держать', '', cut(btc, f), w === 'all' ? {afterPub: metrics(cut(btc, PUB))} : {}),
    ew: (w, f) => row('ew', '6 монет поровну: купить и держать', '', cut(ew, f), w === 'all' ? {afterPub: metrics(cut(ew, PUB))} : {}),
  };
  const win = (id, title, from, ids, extra = []) => ({id, title, from, to: now, rows: [...extra, ...ids.map(k => R[k](id, from))].filter(Boolean)});
  return {
    version: BT_VERSION, ts: Date.now(), took: Math.round((Date.now() - t0) / 1000), coins, cost, first, pub: PUB, mlFrom: ML_FROM,
    params: {riskPct: P.riskPct, rr: P.rr, threshold: P.threshold, maxPos: P.maxPos, timeStop: P.timeStop, dailyLimit: P.dailyLimit, shorts: P.shorts},
    ml: {auc: ml.auc, n: ml.preds.length, features: S.ML_FEATURES, coef: ml.model ? ml.model.w.map(x => +x.toFixed(3)) : null, base: ml.model ? ml.model.base : null},
    carryNow: carry ? {active: carry.active} : null,
    mlModel: (() => { const m = finalModel(dd, tl.series, now); return m ? {...m, auc: ml.auc} : null; })(),
    // для распределения капитала: итоги стратегий с 2021 (тренд с ML — с 2022) и веса портфеля
    pick: {trend: metrics(tlml.curve), trendNoMl: metrics(tlFromMl.curve), trendNoMlAfterPub: metrics(cut(tlFromMl.curve, PUB)), carry: carry ? metrics(carry.curve) : null, mr: metrics(mr.curve), trendAfterPub: metrics(cut(tlml.curve, PUB)), carryAfterPub: carry ? metrics(cut(carry.curve, PUB)) : null, mrAfterPub: metrics(cut(mr.curve, PUB)),
      weights: port ? Object.fromEntries(port.ids.map((id, k) => [id === 'tlml' ? 'trend' : id, port.weights[k]])) : null},
    windows: [
      win('w120', 'Последние 120 дней', w120, ['tl', 'tlml', 'carry', 'mr', 'port', 'btc']),
      win('w365', 'Последние 365 дней', w365, ['tl', 'tlml', 'carry', 'mr', 'port', 'btc', 'ew'],
        [row('a1h', 'Прежние агенты (1 ч)', 'логика Рустама, Джамы и Нода; новости в истории недоступны', a1h.curve, {stats: tradeStats(a1h.trades, w365, now), costs: costOf(a1h.book)})]),
      win('oos', 'С 2022 года — все прогнозы ML вне обучающей выборки', ML_FROM, ['tl', 'tlml', 'carry', 'mr', 'port', 'port0', 'btc']),
      {id: 'all', title: 'С 2021 года', from: START, to: now, rows: [R.tl('all', START), R.tlml('all', ML_FROM), R.carry('all', START), R.mr('all', START),
        row('mr2', 'Возврат к среднему при двойных издержках', 'проверка на устойчивость', mr2.curve), row('tl2', 'Тренд при двойных издержках', 'проверка на устойчивость', tl2.curve, {afterPub: metrics(cut(tl2.curve, PUB))}),
        row('tls', 'Тренд лонг + шорт', 'шорты с половинным весом', tls.curve, {afterPub: metrics(cut(tls.curve, PUB))}), R.port('all', ML_FROM), R.port0('all', ML_FROM), R.btc('all', START), R.ew('all', START)].filter(Boolean)},
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
      const mo = r.m.posMonths != null ? `, месяцев в плюсе ${Math.round(r.m.posMonths * 100)}% (из ${r.m.months}), худший месяц ${pct(r.m.worstMonth)}` : '';
      const a = r.afterPub ? `; с 04.2025: ${pct(r.afterPub.total)}, просадка ${pct(-r.afterPub.mdd)}` : '';
      out.push(`[backtest]   ${r.name}: ${pct(r.m.total)}${r.m.cagr != null ? ` (${pct(r.m.cagr)}/год)` : ''}, Шарп ${r.m.sharpe.toFixed(2)}, просадка ${pct(-r.m.mdd)}${mo}${s}${c}${a}`);
    }
  }
  const all = res.windows.find(w => w.id === 'all');
  if (all) for (const r of all.rows) out.push(`[backtest]   по годам — ${r.name}: ` + Object.entries(r.years).map(([y, v]) => `${y} ${pct(v)}`).join(', '));
  if (res.ml) out.push(`[backtest] ML: AUC вне выборки ${res.ml.auc != null ? res.ml.auc.toFixed(3) : '—'} на ${res.ml.n} прогнозах (0,5 — угадывание); база ${res.ml.base != null ? Math.round(res.ml.base * 100) + '%' : '—'}; веса: ${res.ml.coef ? res.ml.features.map((f, i) => `${f} ${res.ml.coef[i]}`).join(', ') : '—'}`);
  return out;
}

// ---------- модель ML для живой торговли: обучена на всей доступной истории ----------
export function finalModel(dd, series, now = Date.now()){
  const feats = S.mlFeatures(dd.c, series, dd.f), {X, y} = S.mlSamples(dd.c, feats, now);
  if (X.length < S.ML_P.minTrain) return null;
  const m = S.fitLogit(X, y);
  return {w: m.w, b: m.b, mu: m.mu, sd: m.sd, base: m.base, n: m.n, ts: now};
}

// ---------- проверка изменения параметров: прежние и новые значения на одних и тех же данных ----------
// риск-слой (тормоз при просадке) — поверх дневной кривой портфеля
export function riskOverlay(curve, R){
  if (!curve || curve.length < 2) return curve;
  const out = [[curve[0][0], curve[0][1]]]; let e = curve[0][1], peak = e, halt = null;
  for (let i = 1; i < curve.length; i++){
    const r = curve[i][1] / curve[i - 1][1] - 1, t = curve[i][0];
    if (halt != null && t - halt > 14 * DAY){ halt = null; peak = e; }
    const dd = 1 - e / peak;
    if (halt == null && dd >= R.ddStop) halt = t;
    const k = halt != null ? 0 : dd >= R.ddBrake ? 0.5 : 1;
    e *= 1 + k * r; peak = Math.max(peak, e); out.push([t, e]);
  }
  return out;
}
export function strategyCurve(data, strategy, P, all, {cost = {fee: 0.0005, slip: 0.0002}} = {}){
  const {dd, d1h} = data;
  const trend = Pt => { const ser = Object.fromEntries(Object.keys(dd.c).filter(s => dd.c[s].n > 120).map(s => [s, S.trendSeries(dd.c[s], Pt)])); const ml = S.mlWalkForward(dd.c, ser, dd.f, ML_FROM); return simTrend(dd, {cost, from: START, P: Pt, series: ser, mult: ml.mult}).curve; };
  if (strategy === 'trend') return trend(P);
  if (strategy === 'carry'){ const c = simCarry(dd, {from: START, P}); return c && c.curve; }
  if (strategy === 'mr') return simMR(d1h, {cost, from: START, P}).curve;
  if (strategy === 'risk'){
    const cv = {trend: trend(all.trend)}; const c = simCarry(dd, {from: START, P: all.carry}); if (c) cv.carry = c.curve; cv.mr = simMR(d1h, {cost, from: START, P: all.mr}).curve;
    const ids = Object.keys(all.alloc || {}).filter(k => cv[k] && all.alloc[k] > 0);
    const port = combine(Object.fromEntries((ids.length ? ids : Object.keys(cv)).map(k => [k, cv[k]])), ML_FROM);
    return port && riskOverlay(port.curve, P);
  }
  throw new Error('Неизвестная стратегия: ' + strategy);
}
export function validateParams(data, {strategy, base, cand, all, windows}){
  const cb = strategyCurve(data, strategy, base, all), cc = strategyCurve(data, strategy, cand, all);
  const out = {strategy, windows: []};
  for (const w of windows){ out.windows.push({id: w.id, title: w.title, from: w.from, to: w.to, base: metrics(slice(cb, w.from, w.to)), cand: metrics(slice(cc, w.from, w.to))}); }
  return out;
}
