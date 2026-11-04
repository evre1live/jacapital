// Стратегии офиса — общий код для бэктеста и живой торговли: проверяется ровно то, что потом торгует.
// Свечи передаются колонками {t, o, h, l, c} (Float64Array или обычные массивы) — так история за годы занимает мегабайты, а не сотни.
export const DAY = 864e5, HOUR = 36e5;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function toCols(arr){
  const n = arr.length, o = {t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), n};
  for (let i = 0; i < n; i++){ const k = arr[i]; o.t[i] = k.t; o.o[i] = k.o; o.h[i] = k.h; o.l[i] = k.l; o.c[i] = k.c; }
  return o;
}
export function fromCols(s, i0 = 0){ const out = []; for (let i = i0; i < s.n; i++) out.push({t: s.t[i], o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i]}); return out; }
// индекс последнего бара с t <= x
export function idxAtOrBefore(s, x){ let lo = 0, hi = s.n - 1, r = -1; while (lo <= hi){ const m = (lo + hi) >> 1; if (s.t[m] <= x){ r = m; lo = m + 1; } else hi = m - 1; } return r; }

// ---------- 1. Трендовый ансамбль: каналы Дончиана 5–360 дней + размер по волатильности ----------
// по мотивам Zarattini, Pagani, Barbon (2025) «Catching Crypto Trends»
export const TREND_P = {lbs: [5, 10, 20, 30, 60, 90, 150, 250, 360], tv: 0.25, cap: 1, shortW: 0, band: 0.2};
export const TREND_LIMITS = {tv: [0.1, 0.5], cap: [0.5, 2], shortW: [0, 1], band: [0.05, 0.5]};
// по каждому дневному бару (после закрытия): sig — доля включённых каналов (−shortW…1), scale — множитель по волатильности
export function trendSeries(s, P = TREND_P, eps = null){
  const n = s.n, C = s.c, sig = new Float64Array(n), scale = new Float64Array(n);
  const st = P.lbs.map(() => ({on: 0, stop: 0, entry: 0, t0: 0}));
  for (let i = 0; i < n; i++){
    const close = C[i]; let sum = 0;
    for (let j = 0; j < P.lbs.length; j++){
      const L = P.lbs[j]; if (i < L) continue;
      const g = st[j];
      let hiP = -Infinity, loP = Infinity; for (let k = i - L; k < i; k++){ const v = C[k]; if (v > hiP) hiP = v; if (v < loP) loP = v; }
      let hiC = close, loC = close; for (let k = i - L + 1; k < i; k++){ const v = C[k]; if (v > hiC) hiC = v; if (v < loC) loC = v; }
      const mid = (hiC + loC) / 2;
      const exit = () => { if (eps) eps.push({L, dir: g.on, ret: g.on * (close / g.entry - 1), t0: g.t0, t1: s.t[i]}); g.on = 0; };
      if (g.on === 1){ g.stop = Math.max(g.stop, mid); if (close < g.stop) exit(); }
      else if (g.on === -1){ g.stop = Math.min(g.stop, mid); if (close > g.stop) exit(); }
      if (g.on === 0){
        if (close > hiP){ g.on = 1; g.stop = mid; g.entry = close; g.t0 = s.t[i]; }
        else if (P.shortW > 0 && close < loP){ g.on = -1; g.stop = mid; g.entry = close; g.t0 = s.t[i]; }
      }
      sum += g.on === 1 ? 1 : g.on === -1 ? -P.shortW : 0;
    }
    sig[i] = sum / P.lbs.length;
    if (i >= 91){
      let m = 0; const r = new Float64Array(90);
      for (let k = 0; k < 90; k++){ r[k] = Math.log(C[i - 89 + k] / C[i - 90 + k]); m += r[k]; }
      m /= 90; let v = 0; for (let k = 0; k < 90; k++) v += (r[k] - m) ** 2;
      const sd = Math.sqrt(v / 89) * Math.sqrt(365);
      scale[i] = sd > 0 ? Math.min(P.cap, P.tv / sd) : 0;
    }
  }
  return {sig, scale};
}

// ---------- 2. Фильтр на машинном обучении (мета-разметка) поверх тренда ----------
// Модель не угадывает цену: она оценивает, насколько вероятно, что уже включённый трендовый сигнал заработает за следующие H дней,
// и масштабирует позицию. Обучение только на прошлом («вперёд по времени»), переобучение раз в квартал.
export const ML_P = {H: 7, refitDays: 91, minTrain: 300, l2: 2, iters: 400, lr: 0.3, maxMult: 1.6};
export const ML_FEATURES = ['сила тренда', 'волатильность 30д', 'волатильность 30д/90д', 'доходность 7д', 'доходность 30д', 'от максимума 20д', 'тренд BTC', 'ширина рынка', 'фандинг 7д'];
function retAt(C, i, k){ return i >= k ? C[i] / C[i - k] - 1 : 0; }
function volAt(C, i, k){ if (i < k + 1) return 0; let m = 0; for (let j = i - k + 1; j <= i; j++) m += Math.log(C[j] / C[j - 1]); m /= k; let v = 0; for (let j = i - k + 1; j <= i; j++) v += (Math.log(C[j] / C[j - 1]) - m) ** 2; return Math.sqrt(v / (k - 1)) * Math.sqrt(365); }
function fundAvg(f, t, n = 21){ if (!f || !f.length) return 0; let lo = 0, hi = f.length - 1, r = -1; while (lo <= hi){ const m = (lo + hi) >> 1; if (f[m].t <= t){ r = m; lo = m + 1; } else hi = m - 1; } if (r < 0) return 0; let s = 0, k = 0; for (let j = Math.max(0, r - n + 1); j <= r; j++){ s += f[j].r; k++; } return k ? s / k * 1095 : 0; }
// признаки для каждой монеты и дня; null — если сигнала нет или мало истории
export function mlFeatures(cols, series, funding = {}){
  const syms = Object.keys(cols), byT = new Map();
  for (const s of syms){ const c = cols[s]; for (let i = 0; i < c.n; i++){ let m = byT.get(c.t[i]); if (!m){ m = {}; byT.set(c.t[i], m); } m[s] = i; } }
  const btc = cols.BTC ? 'BTC' : syms[0], out = {};
  for (const s of syms){
    const c = cols[s], C = c.c, sg = series[s].sig, X = new Array(c.n).fill(null);
    for (let i = 95; i < c.n; i++){
      if (!(sg[i] > 0)) continue;
      const m = byT.get(c.t[i]); let br = 0, nb = 0; for (const s2 of syms){ const j = m[s2]; if (j !== undefined){ br += series[s2].sig[j]; nb++; } }
      const jb = m[btc]; const v30 = volAt(C, i, 30), v90 = volAt(C, i, 90);
      let hi20 = -Infinity; for (let k = i - 19; k <= i; k++) hi20 = Math.max(hi20, C[k]);
      X[i] = [sg[i], v30, v90 > 0 ? v30 / v90 : 1, retAt(C, i, 7), retAt(C, i, 30), C[i] / hi20 - 1, jb !== undefined ? series[btc].sig[jb] : 0, nb ? br / nb : 0, fundAvg(funding[s], c.t[i])];
    }
    out[s] = X;
  }
  return out;
}
export function fitLogit(X, y, P = ML_P){
  const n = X.length, d = X[0].length, mu = new Array(d).fill(0), sd = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mu[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map(x => x.map((v, j) => clamp((v - mu[j]) / sd[j], -5, 5)));
  const w = new Array(d).fill(0); let b = Math.log((y.reduce((a, v) => a + v, 0) + 1) / (n - y.reduce((a, v) => a + v, 0) + 1));
  for (let it = 0; it < P.iters; it++){
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++){ let z = b; for (let j = 0; j < d; j++) z += w[j] * Z[i][j]; const p = 1 / (1 + Math.exp(-z)), e = p - y[i]; gb += e; for (let j = 0; j < d; j++) gw[j] += e * Z[i][j]; }
    b -= P.lr * gb / n; for (let j = 0; j < d; j++) w[j] -= P.lr * (gw[j] / n + P.l2 * w[j] / n);
  }
  return {w, b, mu, sd, base: y.reduce((a, v) => a + v, 0) / n, n};
}
export function predictLogit(m, x){ let z = m.b; for (let j = 0; j < m.w.length; j++) z += m.w[j] * clamp((x[j] - m.mu[j]) / m.sd[j], -5, 5); return 1 / (1 + Math.exp(-z)); }
export function multFromProb(p, m, P = ML_P){ return clamp(p / Math.max(0.05, m.base), 0, P.maxMult); }
// обучающая выборка: признаки дня i и метка «доходность за следующие H дней > 0»; только примеры, чей исход известен к дате t
export function mlSamples(cols, feats, until, P = ML_P){
  const X = [], y = [];
  for (const s of Object.keys(cols)){ const c = cols[s], F = feats[s];
    for (let i = 0; i + P.H < c.n; i++){ if (!F[i] || c.t[i + P.H] >= until) continue; X.push(F[i]); y.push(c.c[i + P.H] > c.c[i] ? 1 : 0); } }
  return {X, y};
}
// множители позиции «вперёд по времени»: для каждого квартала модель обучена только на том, что было известно до его начала
export function mlWalkForward(cols, series, funding, from, P = ML_P){
  const feats = mlFeatures(cols, series, funding), mult = {}, preds = [];
  for (const s of Object.keys(cols)) mult[s] = new Float64Array(cols[s].n).fill(1);
  let tMax = 0; for (const s of Object.keys(cols)) tMax = Math.max(tMax, cols[s].t[cols[s].n - 1]);
  let model = null;
  for (let t = from; t <= tMax; t += P.refitDays * DAY){
    const {X, y} = mlSamples(cols, feats, t, P);
    if (X.length >= P.minTrain) model = fitLogit(X, y, P);
    if (!model) continue;
    for (const s of Object.keys(cols)){ const c = cols[s], F = feats[s];
      for (let i = 0; i < c.n; i++){ if (c.t[i] < t || c.t[i] >= t + P.refitDays * DAY || !F[i]) continue;
        const p = predictLogit(model, F[i]); mult[s][i] = multFromProb(p, model, P);
        if (i + P.H < c.n) preds.push({p, y: c.c[i + P.H] > c.c[i] ? 1 : 0}); } }
  }
  return {mult, preds, auc: auc(preds), model, feats};
}
export function auc(preds){
  const pos = preds.filter(x => x.y === 1).length, neg = preds.length - pos; if (!pos || !neg) return null;
  const s = [...preds].sort((a, b) => a.p - b.p); let rank = 0, sumPos = 0;
  for (let i = 0; i < s.length;){ let j = i; while (j < s.length && s[j].p === s[i].p) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) if (s[k].y === 1) sumPos += r; rank = j; i = j; }
  return (sumPos - pos * (pos + 1) / 2) / (pos * neg);
}

// ---------- 3. Фандинг-арбитраж: покупка на споте + шорт фьючерса, пока фандинг высокий ----------
// Цена почти не влияет на результат (позиция нейтральна к рынку): доход — фандинг, который лонги платят шортам каждые 8 часов.
export const CARRY_P = {enter: 0.10, exit: 0.03, nEnter: 21, nExit: 9, lev: 2, cost: 0.0038};
export const CARRY_LIMITS = {enter: [0.04, 0.3], exit: [0, 0.15], nEnter: [6, 45], nExit: [3, 21], lev: [1, 3]};
// по каждому событию фандинга: была ли позиция открыта перед ним (решение принимается по прошлым ставкам)
export function carryStates(f, P = CARRY_P){
  const on = new Uint8Array(f.length); let cur = 0;
  const avg = (j, n) => { let s = 0, k = 0; for (let i = Math.max(0, j - n); i < j; i++){ s += f[i].r; k++; } return k ? s / k * 1095 : 0; };
  for (let j = 0; j < f.length; j++){
    if (j >= P.nEnter){
      if (!cur && avg(j, P.nEnter) > P.enter && avg(j, 3) > 0) cur = 1;
      else if (cur && avg(j, P.nExit) < P.exit) cur = 0;
    }
    on[j] = cur;
  }
  return on;
}
// доля капитала, которая зарабатывает фандинг: спот N + маржа фьючерса N/lev
export const carryYieldShare = P => 1 / (1 + 1 / P.lev);

// ---------- 4. Возврат к среднему на часовых свечах (RSI-2 в восходящем тренде) ----------
export const MR_P = {rsiN: 2, entry: 10, exitMa: 5, trendMa: 200, maxHold: 36, stopAtr: 3};
export const MR_LIMITS = {entry: [3, 25], exitMa: [3, 20], trendMa: [50, 400], maxHold: [6, 96], stopAtr: [1.5, 6]};
export function rsiSeries(C, n){
  const out = new Float64Array(C.length).fill(50); let ag = 0, al = 0;
  for (let i = 1; i < C.length; i++){ const d = C[i] - C[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n){ ag += g / n; al += l / n; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
    if (i >= n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  return out;
}
export function smaSeries(C, n){ const out = new Float64Array(C.length); let s = 0; for (let i = 0; i < C.length; i++){ s += C[i]; if (i >= n) s -= C[i - n]; out[i] = i >= n - 1 ? s / n : NaN; } return out; }
export function atrSeries(s, n = 14){ const out = new Float64Array(s.n); let a = 0; for (let i = 1; i < s.n; i++){ const tr = Math.max(s.h[i] - s.l[i], Math.abs(s.h[i] - s.c[i - 1]), Math.abs(s.l[i] - s.c[i - 1])); a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n; out[i] = a; } return out; }
// решение на закрытии бара i: войти / выйти / держать; pos = {i0, entry, stop} или null
export function mrDecide(ind, i, pos, P = MR_P){
  const {C, rsi, smaX, smaT, atr} = ind, px = C[i];
  if (pos){
    if (px <= pos.stop) return {act: 'exit', why: 'стоп'};
    if (px > smaX[i]) return {act: 'exit', why: 'возврат к средней'};
    if (i - pos.i0 >= P.maxHold) return {act: 'exit', why: 'по времени'};
    return {act: 'hold'};
  }
  if (!(smaT[i] > 0) || !(atr[i] > 0)) return {act: 'none'};
  if (px > smaT[i] && rsi[i] < P.entry) return {act: 'enter', stop: px - P.stopAtr * atr[i]};
  return {act: 'none'};
}
export function mrIndicators(s, P = MR_P){ return {C: s.c, rsi: rsiSeries(s.c, P.rsiN), smaX: smaSeries(s.c, P.exitMa), smaT: smaSeries(s.c, P.trendMa), atr: atrSeries(s)}; }

// ---------- помесячная статистика для оценки «ровности» ----------
export function monthly(curve){
  const out = []; if (!curve || curve.length < 2) return out;
  let prev = curve[0][1], key = null, last = null;
  for (const [t, e] of curve){ const d = new Date(t), k = d.getUTCFullYear() * 12 + d.getUTCMonth(); if (key === null) key = k; if (k !== key){ out.push(last / prev - 1); prev = last; key = k; } last = e; }
  if (last != null) out.push(last / prev - 1);
  return out;
}
