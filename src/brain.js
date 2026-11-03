// Логика агентов: Леон (сводка), Генри (риски), Марк (сигналы). Исполнение — в office.js
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const sgn = x => x > 0 ? 1 : x < 0 ? -1 : 0;
export const sideRu = d => d > 0 ? 'LONG' : 'SHORT';
export const VERDICT_RU = {ok: 'одобрено', caution: 'с осторожностью', reject: 'отклонено'};

export const PROFILES = {
  cautious:   {label: 'Осторожный',       riskPct: 0.5, rr: 2.4, threshold: 66, maxPos: 2, dailyLimit: 3, shorts: false, rumorTrust: 0.6, timeStop: 72},
  balanced:   {label: 'Сбалансированный', riskPct: 1.0, rr: 2.2, threshold: 58, maxPos: 3, dailyLimit: 5, shorts: true,  rumorTrust: 1.0, timeStop: 72},
  aggressive: {label: 'Агрессивный',      riskPct: 2.0, rr: 2.0, threshold: 50, maxPos: 5, dailyLimit: 8, shorts: true,  rumorTrust: 1.3, timeStop: 96},
};
export const PARAM_LIMITS = {
  riskPct: [0.25, 3], rr: [1.2, 3.5], threshold: [40, 85], maxPos: [1, 6], dailyLimit: [1, 15], rumorTrust: [0.3, 1.6], timeStop: [12, 288],
};

const COIN_NAMES = {BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP', DOGE: 'Dogecoin', ADA: 'Cardano', TON: 'Toncoin', AVAX: 'Avalanche', LINK: 'Chainlink', LTC: 'Litecoin', TRX: 'TRON', DOT: 'Polkadot'};
export const coinName = s => COIN_NAMES[s] || s;
const BETA = {BTC: 1, ETH: 1.15, SOL: 1.35, BNB: 0.85, XRP: 1.1, DOGE: 1.4};
export const betaOf = s => BETA[s] || 1.2;

export function fmtNum(x, dp) { return x.toLocaleString('ru-RU', {minimumFractionDigits: dp, maximumFractionDigits: dp}); }
export function priceDp(p) { return p >= 1000 ? 1 : p >= 100 ? 2 : p >= 1 ? 3 : p >= 0.01 ? 5 : 7; }
export function fmtPrice(p) { return '$' + fmtNum(p, priceDp(p)); }
export function qtyDp(p) { return p >= 1000 ? 4 : p >= 50 ? 3 : p >= 1 ? 2 : 0; }
export function fmtQty(q, p) { return fmtNum(q, qtyDp(p)); }
export function fmtUSD(x, sign) { const s = (sign && x > 0 ? '+' : '') + (x < 0 ? '−' : ''); return s + '$' + fmtNum(Math.abs(x), 2); }
export function fmtPct(x, d = 1) { return (x > 0 ? '+' : x < 0 ? '−' : '') + fmtNum(Math.abs(x * 100), d) + '%'; }

// ---------- индикаторы ----------
export function indicators(coin) {
  const cs = coin.candles;
  const closes = cs.slice(-120).map(k => k.c); closes.push(coin.price);
  const ema = (arr, n) => { const k = 2 / (n + 1); let e = arr[0]; for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; };
  const ema9 = ema(closes, 9), ema21 = ema(closes, 21);
  let ag = 0, al = 0; const n = 14;
  for (let i = 1; i <= n && i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) ag += d; else al -= d; }
  ag /= n; al /= n;
  for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; ag = (ag * (n - 1) + Math.max(d, 0)) / n; al = (al * (n - 1) + Math.max(-d, 0)) / n; }
  const rsi = al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al);
  const last = cs.slice(-15); let atr = 0;
  for (let i = 1; i < last.length; i++) { const k = last[i], p = last[i - 1].c; atr += Math.max(k.h - k.l, Math.abs(k.h - p), Math.abs(k.l - p)); }
  atr = atr / Math.max(1, last.length - 1) || coin.price * 0.004;
  const w20 = cs.slice(-20);
  return {price: coin.price, ema9, ema21, rsi, atr, atrPct: atr / coin.price, chg24: coin.chg24 || 0,
    high20: Math.max(...w20.map(k => k.h), coin.price), low20: Math.min(...w20.map(k => k.l), coin.price)};
}
export function atrPctSeries(cs) {
  // средняя волатильность свечи за последние ~200 свечей — «норма» для Генри
  const arr = cs.slice(-200); if (arr.length < 3) return 0.004;
  let s = 0; for (let i = 1; i < arr.length; i++) { const k = arr[i], p = arr[i - 1].c; s += Math.max(k.h - k.l, Math.abs(k.h - p), Math.abs(k.l - p)) / k.c; }
  return s / (arr.length - 1);
}

// ---------- новости → тон по монете ----------
export function sentimentFor(sym, news, p, now) {
  let s = 0, wsum = 0, relsum = 0;
  for (const n of news) {
    const ageH = (now - n.ts) / 3.6e6; if (ageH > 12 || ageH < 0) continue;
    const w = Math.exp(-ageH / 4) * (n.importance ?? 0.6);
    let rel = n.rel; if (rel < 0.5) rel *= p.rumorTrust;
    let k = 0;
    if (n.coins && n.coins.includes(sym)) k = 1; else if (!n.coins || !n.coins.length) k = 0.6 * betaOf(sym);
    if (!k || !n.s) continue;
    s += n.s * rel * w * k; wsum += w * k; relsum += n.rel * w * k;
  }
  return {sent: Math.tanh(s * 1.4), avgRel: wsum ? relsum / wsum : 1};
}

// ---------- Леон ----------
export function nikaScan(ctx, focus) {
  const {coins, state} = ctx; const p = state.params; const items = []; const now = Date.now();
  for (const sym of Object.keys(coins)) {
    const c = coins[sym]; if (!c.candles.length) continue;
    const ind = indicators(c);
    const trend = Math.tanh(((ind.ema9 - ind.ema21) / ind.price) / (ind.atrPct * 0.35));
    const mom = clamp((ind.rsi - 50) / 25, -1, 1);
    const {sent, avgRel} = sentimentFor(sym, state.news, p, now);
    const score = 0.45 * trend + 0.35 * sent + 0.20 * mom;
    const label = trend > 0.3 ? 'рост' : trend < -0.3 ? 'падение' : 'боковик';
    items.push({sym, price: ind.price, trend, mom, sent, avgRel, score, rsi: ind.rsi, atrPct: ind.atrPct, chg24: ind.chg24, label});
  }
  let hot = items.filter(i => Math.abs(i.score) >= 0.28).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3).map(i => i.sym);
  const fc = focus && focus.coins && focus.coins[0];
  if (fc && !hot.includes(fc)) { const it = items.find(i => i.sym === fc); if (it && Math.abs(it.score) >= 0.18) hot.unshift(fc); hot = hot.slice(0, 3); }
  const brief = {id: ctx.id(), ts: now, items, hot, focus: focus ? focus.id : null};
  state.brief = brief; state.stats.nika.briefs++;
  if (focus) { state.stats.nika.news++; if (focus.rel >= 0.7) state.stats.nika.reliable++; }
  return brief;
}
export function nikaText(brief, focus) {
  const parts = [];
  if (focus) {
    const where = focus.coins && focus.coins.length ? focus.coins.join(', ') : 'весь рынок';
    const title = focus.titleRu || focus.title;
    parts.push(`Новость (${where}): «${title}». Источник ${focus.source}, надёжность ${Math.round(focus.rel * 100)}%. Тон ${focus.s > 0.15 ? 'позитивный' : focus.s < -0.15 ? 'негативный' : 'нейтральный'}.`);
  }
  const up = brief.items.filter(i => i.label === 'рост').map(i => i.sym), dn = brief.items.filter(i => i.label === 'падение').map(i => i.sym);
  let s = 'Сводка: ' + (up.length ? 'растут ' + up.join(', ') : 'роста нет') + (dn.length ? '; падают ' + dn.join(', ') : '');
  if (brief.hot.length) s += '. Интересно: ' + brief.hot.map(sym => { const it = brief.items.find(i => i.sym === sym); return `${sym} ${it.score > 0 ? '▲' : '▼'}${Math.abs(it.score).toFixed(2)}`; }).join(', ') + '.';
  else s += '. Явных идей нет.';
  parts.push(s);
  return parts.join(' ');
}

// ---------- Генри ----------
export function borisEvaluate(ctx, brief) {
  const {coins, state} = ctx; const p = state.params, eq = ctx.equity(), out = [];
  const pos = state.pf.positions;
  const openRiskPct = pos.reduce((a, x) => a + (x.riskUSD || 0), 0) / eq * 100;
  for (const sym of brief.hot) {
    const it = brief.items.find(i => i.sym === sym);
    const c = coins[sym]; const ind = indicators(c);
    const dir = it.score > 0 ? 1 : -1;
    const base = {id: ctx.id(), ts: Date.now(), sym, dir, price: ind.price, score: it.score};
    if (dir < 0 && !p.shorts) { out.push({...base, risk: 100, verdict: 'reject', reasons: ['шорты выключены в настройках'], qty: 0, riskUSD: 0, sl: 0, tp: 0, stop: 0}); continue; }
    if (dir < 0 && ctx.marketType === 'spot') { out.push({...base, risk: 100, verdict: 'reject', reasons: ['на споте шорт невозможен'], qty: 0, riskUSD: 0, sl: 0, tp: 0, stop: 0}); continue; }
    const stop = 1.6 * ind.atr, tpd = stop * p.rr;
    const parts = [];
    const ref = c.atrRef || ind.atrPct;
    const volR = clamp((ind.atrPct / ref - 0.95) * 70, 0, 28); if (volR > 6) parts.push([volR, 'волатильность выше нормы']);
    const newsShare = Math.abs(0.35 * it.sent) / (Math.abs(it.score) + 1e-9);
    const newsR = clamp(newsShare * (1 - it.avgRel) * 70, 0, 26); if (newsR > 6) parts.push([newsR, 'идея держится на ненадёжных новостях']);
    const ext = dir > 0 ? clamp((ind.rsi - 66) * 2.2, 0, 26) : clamp((34 - ind.rsi) * 2.2, 0, 26);
    if (ext > 4) parts.push([ext, dir > 0 ? `перегрев, RSI ${ind.rsi.toFixed(0)}` : `перепроданность, RSI ${ind.rsi.toFixed(0)}`]);
    if (Math.abs(it.trend) > 0.25 && Math.abs(it.sent) > 0.25 && sgn(it.trend) !== sgn(it.sent)) parts.push([15, 'тренд и новости расходятся']);
    const same = pos.find(x => x.sym === sym);
    if (same && same.dir === dir) parts.push([38, 'уже есть позиция по монете']);
    const sameDir = pos.filter(x => x.dir === dir && x.sym !== sym).length; if (sameDir) parts.push([sameDir * 6, 'много позиций в одну сторону']);
    const heat = clamp(openRiskPct / (p.riskPct * p.maxPos) * 18, 0, 18); if (heat > 5) parts.push([heat, 'портфель уже нагружен']);
    const room = dir > 0 ? ind.high20 - ind.price : ind.price - ind.low20;
    if (room < stop * 0.6) parts.push([10, dir > 0 ? 'рядом сопротивление' : 'рядом поддержка']);
    const risk = Math.round(clamp(8 + parts.reduce((a, x) => a + x[0], 0), 3, 99));
    const verdict = risk < 40 ? 'ok' : risk < 62 ? 'caution' : 'reject';
    const mult = verdict === 'ok' ? 1 : verdict === 'caution' ? 0.5 : 0;
    const riskUSD = eq * p.riskPct / 100 * mult;
    let qty = stop > 0 ? riskUSD / stop : 0;
    qty = Math.min(qty, Math.min(0.35 * eq, ctx.maxOrderUsd) / ind.price);
    parts.sort((a, b) => b[0] - a[0]);
    out.push({...base, risk, verdict, reasons: parts.slice(0, 2).map(x => x[1]), stop, sl: ind.price - dir * stop, tp: ind.price + dir * tpd, qty, riskUSD: qty * stop});
  }
  const st = state.stats.boris; for (const e of out) { st.evals++; st[e.verdict]++; }
  state.evals = out; state.evalLog = [...out, ...state.evalLog].slice(0, 24);
  return out;
}
export function borisText(evals) {
  return evals.map(e => {
    const head = `${e.sym} ${sideRu(e.dir)} — риск ${e.risk}/100, ${VERDICT_RU[e.verdict]}`;
    if (e.verdict === 'reject') return `${head}: ${e.reasons.join('; ')}.`;
    const why = e.reasons.length ? ` (${e.reasons.join('; ')})` : '';
    return `${head}${why}. Стоп ${fmtPrice(e.sl)}, тейк ${fmtPrice(e.tp)}, объём ${fmtQty(e.qty, e.price)} ${e.sym}, риск ${fmtUSD(e.riskUSD)}.`;
  }).join(' ');
}

// ---------- Марк ----------
export function timurSignals(ctx, brief, evals) {
  const {state} = ctx; const p = state.params, sigs = []; let best = 0;
  for (const e of evals) {
    if (e.verdict === 'reject') continue;
    const conf = Math.round(clamp(38 + 62 * Math.abs(e.score) - e.risk * 0.35, 5, 97));
    best = Math.max(best, conf);
    if (conf >= p.threshold) sigs.push({id: ctx.id(), ts: Date.now(), type: 'open', sym: e.sym, dir: e.dir, conf, entry: e.price, sl: e.sl, tp: e.tp, stop: e.stop, qty: e.qty, riskUSD: e.riskUSD, risk: e.risk});
    else state.stats.timur.below++;
  }
  for (const pos of state.pf.positions) {
    const it = brief.items.find(i => i.sym === pos.sym);
    if (it && it.score * pos.dir < -0.32 && !sigs.some(s => s.sym === pos.sym)) sigs.push({id: ctx.id(), ts: Date.now(), type: 'close', sym: pos.sym, dir: pos.dir, posId: pos.id, conf: Math.round(50 + 50 * Math.abs(it.score))});
  }
  const st = state.stats.timur;
  for (const s of sigs) { if (s.type === 'open') { st.signals++; st.confSum += s.conf; } else st.closes++; }
  state.signals = sigs; state.sigLog = [...sigs, ...state.sigLog].slice(0, 30);
  return {sigs, best};
}
export function timurText(res, evals, p) {
  if (!res.sigs.length) return res.best ? `Сигналов нет: лучшая уверенность ${res.best}% ниже порога ${p.threshold}%.` : (evals.length ? 'Сигналов нет: Генри всё отклонил.' : 'Открытые позиции держим, разворота нет.');
  return res.sigs.map(s => s.type === 'open'
    ? `Сигнал: ${sideRu(s.dir)} ${s.sym}, уверенность ${s.conf}%. Вход ~${fmtPrice(s.entry)}, стоп ${fmtPrice(s.sl)}, тейк ${fmtPrice(s.tp)}.`
    : `Закрыть ${sideRu(s.dir)} ${s.sym}: картина развернулась.`).join(' ');
}
