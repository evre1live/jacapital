// JA Capital — сервер: котировки, новости, агенты, сделки, веб-интерфейс
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {CFG, validateConfig, binanceProblem} from './src/config.js';
import {makeData, makeAccounts, describeError, setServerIp, maskProxy} from './src/exchange.js';
import {ProxyAgent} from 'undici';
import {Worker} from 'node:worker_threads';
import ccxt from 'ccxt';
import {loadAll, summaryLines, BT_VERSION} from './src/backtest.js';
import {Engine, STRATS} from './src/engine.js';
import {Reviewer} from './src/review.js';
import {symbolFor} from './src/exchange.js';
import {Market} from './src/market.js';
import {News} from './src/news.js';
import {Office} from './src/office.js';
import {PROFILES, coinName, priceDp, qtyDp} from './src/brain.js';
import {aiEnabled} from './src/claude.js';
import {isAuthed, checkPassword, sessionCookie, clearCookie, loginPage} from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const errs = validateConfig();
if (errs.length){ console.error('Офис не запущен:\n - ' + errs.join('\n - ')); process.exit(1); }
if (!CFG.password) console.warn('[!] ACCESS_PASSWORD не задан — интерфейс открыт всем, кто знает адрес (допустимо только для виртуального счёта на своём компьютере).');
// настройка Binance при запуске: только имена переменных и длины, без самих значений
{
  const b = CFG.binance, has = v => v ? `задан (${v.length} симв.)` : 'НЕ ЗАДАН';
  const near = Object.keys(process.env).filter(k => /binance|bybit|exchange|api_?key|api_?secret|secret_?key|password/i.test(k)).sort();
  console.log(`[binance] BINANCE_ENV=${process.env.BINANCE_ENV ? b.env : `не задан (по умолчанию ${b.env})`}; BINANCE_API_KEY ${has(b.key)}; BINANCE_API_SECRET ${has(b.secret)}; ACCESS_PASSWORD ${!CFG.password ? 'НЕ ЗАДАН' : CFG.password.length < 10 ? 'короче 10 симв.' : 'задан'}; прокси ${b.proxy ? maskProxy(b.proxy) : 'нет'}; переменные с похожими именами: ${near.join(', ') || 'нет'}`);
  const problem = binanceProblem();
  console.log(problem ? `[binance] счёт не подключён: ${problem}` : '[binance] настройки в порядке, подключаюсь');
}

// внешний IP сервера — его нужно добавить в белый список ключа Binance, если список включён
let serverIp = '';
const viaProxy = !!CFG.binance.proxy;
async function detectIp(){
  const ips = new Set();
  // несколько запросов: и прокси, и Render могут выходить с разных адресов
  for (let i = 0; i < (viaProxy ? 4 : 3); i++){
    try {
      const r = await fetch('https://api.ipify.org?format=json', {signal: AbortSignal.timeout(8000), ...(viaProxy ? {dispatcher: new ProxyAgent(CFG.binance.proxy)} : {})});
      const j = await r.json(); if (j.ip) ips.add(j.ip);
    } catch (e) { if (viaProxy && !ips.size && i === 0) console.warn('[binance] прокси не отвечает:', String(e.message || e).slice(0, 160)); }
  }
  serverIp = [...ips].join(', '); setServerIp(serverIp, viaProxy);
  console.log(viaProxy ? `[binance] запросы к Binance идут через прокси ${maskProxy(CFG.binance.proxy)}; IP для белого списка: ${serverIp || 'не определён'}` : `IP сервера сейчас: ${serverIp || 'не определён'} (на Render меняется в пределах диапазонов из Connect → Outbound)`);
}
detectIp();
const data = makeData(CFG);
const market = new Market(data, CFG);
const accounts = makeAccounts(CFG, data);
let office = null, news = null, engine = null, reviewer = null;

// ---------- HTTP ----------
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8'};
function send(res, code, body, headers = {}){ res.writeHead(code, {'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers}); res.end(body); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return send(res, 200, JSON.stringify({ok: true, market: market.status.ok, ready: !!office}), {'Content-Type': 'application/json'});
  if (url.pathname === '/login' && req.method === 'POST'){
    let body = ''; req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      const pass = new URLSearchParams(body).get('password');
      const r = checkPassword(req, pass);
      if (r.ok) return send(res, 303, '', {Location: '/', 'Set-Cookie': sessionCookie(req)});
      setTimeout(() => send(res, 401, loginPage(r.error), {'Content-Type': 'text/html; charset=utf-8'}), 600);
    });
    return;
  }
  if (url.pathname === '/logout') return send(res, 303, '', {Location: '/', 'Set-Cookie': clearCookie});
  if (url.pathname === '/api/diag'){
    if (!isAuthed(req)) return send(res, 401, 'Нужен вход');
    const b = CFG.binance, mask = v => v ? `задан, ${v.length} символов, начинается на ${v.slice(0, 4)}…` : 'не задан';
    const d = {time: new Date().toISOString(), node: process.version, serverIp: serverIp || 'не определён', quotes: CFG.quotes, marketType: CFG.marketType, market: market.status,
      binance: {env: b.env, proxy: b.proxy ? maskProxy(b.proxy) : 'нет', key: mask(b.key), secret: b.secret ? `задан, ${b.secret.length} символов` : 'не задан', maxOrderUsd: b.maxOrderUsd},
      accounts: Object.values(accounts).map(a => ({id: a.id, label: a.label, configured: a.configured, ready: a.ready, error: a.error || '', raw: a.rawError || '', hedge: a.broker ? !!a.broker.hedge : null,
        timeOffsetMs: a.broker && a.broker.ex && a.broker.ex.options ? a.broker.ex.options.timeDifference ?? null : null, balance: a.broker ? a.broker.lastBalance || null : null})),
      active: office ? office.state.active : null};
    return send(res, 200, JSON.stringify(d, null, 2), {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  }
  if (url.pathname === '/api/backtest'){
    if (!isAuthed(req)) return send(res, 401, 'Нужен вход');
    return send(res, 200, JSON.stringify(btPublic(true)), {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  }
  if (!isAuthed(req)) return send(res, 200, loginPage(), {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Не найдено');
  const longCache = /^\/(vendor|models)\//.test(p);
  send(res, 200, fs.readFileSync(file), {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache'});
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({noServer: true, maxPayload: 64 * 1024});
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !isAuthed(req)){ socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
function sendTo(ws, msg){ if (ws.readyState === 1 && ws.bufferedAmount < 2e6) ws.send(JSON.stringify(msg)); }
function broadcast(msg){ const s = JSON.stringify(msg); for (const ws of wss.clients) if (ws.readyState === 1 && ws.bufferedAmount < 2e6) ws.send(s); }
function cfgPublic(){
  const acc = office ? office.acc : accounts.paper;
  return {serverIp, viaProxy, mode: acc.kind === 'paper' ? 'paper' : 'exchange', account: acc.id, real: !!acc.real, accounts: office ? office.accountsPublic() : [], quotes: CFG.quotes, marketType: CFG.marketType, venue: office ? office.venue() : '', tf: CFG.timeframe, tfMs: market.tf, tz: CFG.tz, ai: aiEnabled(), profiles: PROFILES,
    coins: Object.values(market.coins).map(c => ({sym: c.sym, name: coinName(c.sym), dp: priceDp(c.price || c.cur?.c || 1), qp: qtyDp(c.price || 1)}))};
}
function coinsPayload(full){
  const o = {}; for (const c of Object.values(market.coins)) o[c.sym] = {price: c.price, chg24: c.chg24, atrRef: c.atrRef, cur: c.cur, candles: full ? c.candles.slice(-240) : undefined};
  return o;
}
wss.on('connection', ws => {
  if (!office){ sendTo(ws, {t: 'loading', status: market.status}); }
  else { sendTo(ws, {t: 'hello', cfg: cfgPublic(), state: office.publicState(), feed: office.state.feed.slice(0, 120), coins: coinsPayload(true), now: Date.now()}); sendTo(ws, {t: 'backtest', bt: btPublic(true)}); if (reviewer) sendTo(ws, {t: 'review', review: reviewer.publicView()}); }
  ws.on('message', async raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!office) return;
    try {
      switch (m.t){
        case 'profile': office.setProfile(String(m.v)); break;
        case 'param': office.setParam(String(m.k), m.v); break;
        case 'auto': office.setAuto(!!m.v); break;
        case 'trading': office.setTrading(!!m.v); break;
        case 'approve': await office.approve(+m.id, !!m.ok); break;
        case 'close': await office.manualClose(+m.id); break;
        case 'reset': if (!office.resetPaper()) sendTo(ws, {t: 'toast', text: 'Сброс доступен только для виртуального счёта'}); break;
        case 'realStrat': {
          if (!engine) break;
          if (m.on && m.confirm !== true){ sendTo(ws, {t: 'toast', text: 'Для реального счёта нужно подтверждение'}); break; }
          await engine.setReal(!!m.on);
          broadcast({t: 'toast', text: m.on ? 'Тренд-стратегия включена на реальном счёте' : 'Стратегии на реальном счёте остановлены, их позиции закрыты'});
          office.post('system', null, m.on ? 'Тренд-стратегия включена на реальном счёте по решению владельца.' : 'Стратегии на реальном счёте остановлены по решению владельца; их позиции закрыты.', 'system');
          break;
        }
        case 'realMult': {
          if (!engine) break;
          const id = Object.values(accounts).find(a => a.real && a.kind === 'exchange')?.id; if (!id) break;
          const k = engine.setRealMult(id, m.v);
          office.post('system', null, `Размер позиций на реальном счёте: ×${k}.`, 'system');
          break;
        }
        case 'review': {
          if (!reviewer) break;
          if (reviewer.running){ sendTo(ws, {t: 'toast', text: 'Разбор уже идёт'}); break; }
          if (reviewer.lastOk && Date.now() - reviewer.lastOk.ts < 30 * 60e3){ sendTo(ws, {t: 'toast', text: 'Последний разбор был меньше 30 минут назад'}); break; }
          sendTo(ws, {t: 'toast', text: 'Claude разбирает сделки — это займёт 1–3 минуты'});
          reviewer.run('по запросу из интерфейса').catch(e => sendTo(ws, {t: 'toast', text: e.code === 'no_key' ? 'На сервере не задан ANTHROPIC_API_KEY' : 'Разбор не удался: ' + e.message}));
          break;
        }
        case 'backtestRun': {
          if (BT.running) sendTo(ws, {t: 'toast', text: 'Бэктест уже идёт: ' + BT.text});
          else { runBacktestBg('по запросу из интерфейса'); sendTo(ws, {t: 'toast', text: 'Запускаю бэктест — это займёт несколько минут.'}); }
          break;
        }
        case 'reconnect': {
          const a = accounts[String(m.id)];
          if (!a || a.kind !== 'exchange') break;
          if (!a.configured){ sendTo(ws, {t: 'toast', text: a.error}); break; }
          sendTo(ws, {t: 'toast', text: `Проверяю «${a.label}»…`});
          const ok = await office.connectAccount(a.id, {manual: true});
          sendTo(ws, {t: 'toast', text: ok ? `«${a.label}» подключён` : `«${a.label}»: ${a.error}`});
          sendTo(ws, {t: 'accounts', accounts: office.accountsPublic(), active: office.state.active});
          break;
        }
        case 'account': {
          try { await office.switchAccount(String(m.id), m.confirm === true); }
          catch (e) { sendTo(ws, {t: 'toast', text: e.message}); sendTo(ws, {t: 'accounts', accounts: office.accountsPublic(), active: office.state.active}); }
          break;
        }
        case 'chat': {
          try { const text = await office.chat(String(m.agent), m.turns); sendTo(ws, {t: 'chat', reqId: m.reqId, agent: m.agent, text}); }
          catch (e) { sendTo(ws, {t: 'chat', reqId: m.reqId, agent: m.agent, error: e.code === 'no_key' ? 'На сервере не задан ANTHROPIC_API_KEY — разговор с агентами выключен.' : e.message}); }
          break;
        }
        case 'meeting': {
          broadcast({t: 'meetStart'});
          try { const d = await office.meeting(); broadcast({t: 'meeting', data: d}); }
          catch (e) { broadcast({t: 'meeting', error: e.code === 'no_key' ? 'На сервере не задан ANTHROPIC_API_KEY — планёрка выключена.' : e.message}); }
          break;
        }
      }
    } catch (e) { console.error('[ws]', e); sendTo(ws, {t: 'toast', text: 'Ошибка: ' + e.message}); }
  });
});

// ---------- бэктест: история Binance → стратегии с комиссиями и фандингом ----------
const BT_FILE = path.join(CFG.dataDir, 'backtest.json');
const BT = {running: false, text: '', error: '', res: null, hist: null, histTs: 0, loading: null};
try { const j = JSON.parse(fs.readFileSync(BT_FILE, 'utf8')); if (j && j.version === BT_VERSION) BT.res = j; } catch {}
function btPublic(full){ return {running: BT.running, text: BT.text, error: BT.error, res: full ? BT.res : (BT.res ? {ts: BT.res.ts} : null)}; }
function btStatus(text){ BT.text = text; broadcast({t: 'backtest', bt: btPublic(false)}); }
async function runBacktestBg(why){
  if (BT.running || !office) return;
  if (CFG.quotes !== 'binance' && process.env.BACKTEST !== 'force'){ BT.error = 'Бэктест работает только с котировками Binance (QUOTES=binance).'; return; }
  BT.running = true; BT.error = ''; const t0 = Date.now();
  console.log(`[backtest] старт (${why})`);
  try {
    // для фьючерсов — то же подключение, что и котировки: общий учёт лимитов Binance и без второй загрузки рынков
    const ex = CFG.marketType === 'swap' ? data : new ccxt.binance({enableRateLimit: true, timeout: 20000, options: {defaultType: 'swap', fetchMarkets: ['linear']}});
    const coins = Object.keys(market.coins), now = Date.now();
    const hist = await loadAll({ex, coins, symbolFor: b => symbolFor(b, 'swap'), now, log: btStatus});
    BT.hist = hist; BT.histTs = now;
    btStatus('считаю стратегии');
    const params = {...office.state.params};
    const res = await new Promise((ok, bad) => {
      const w = new Worker(new URL('./src/backtest-worker.js', import.meta.url), {workerData: {data: hist, opts: {coins, params, now}}});
      w.once('message', m => m.ok ? ok(m.res) : bad(new Error(m.error))); w.once('error', bad);
    });
    res.took = Math.round((Date.now() - t0) / 1000);
    BT.res = res;
    try { fs.mkdirSync(CFG.dataDir, {recursive: true}); fs.writeFileSync(BT_FILE, JSON.stringify(res)); } catch (e) { console.warn('[backtest] не сохранил:', e.message); }
    for (const l of summaryLines(res)) console.log(l);
    console.log(`[backtest] готово за ${res.took} с`);
    applyBacktest(res);
    BT.text = '';
  } catch (e) {
    BT.error = describeError(e); BT.text = '';
    console.warn('[backtest] ошибка:', String(e && e.stack || e).slice(0, 600));
  } finally {
    BT.running = false;
    broadcast({t: 'backtest', bt: btPublic(true)});
  }
}

// ---------- результаты бэктеста → распределение капитала между стратегиями ----------
// стратегия получает долю, только если на истории у неё Шарп ≥ 0,5, просадка ≤ 25% и нет заметного убытка после 04.2025
function applyBacktest(res){
  if (!office || !res || !res.pick) return;
  const pk = res.pick, st = office.state.strat, pass = (m, ap) => !!(m && m.sharpe >= 0.5 && m.mdd <= 0.25 && (!ap || ap.total > -0.05));
  const useMl = !!(res.mlModel && res.ml && res.ml.auc != null && res.ml.auc >= 0.52 && pk.trendNoMl && pk.trend && pk.trend.sharpe >= pk.trendNoMl.sharpe);
  const tm = useMl ? pk.trend : pk.trendNoMl || pk.trend, tap = useMl ? pk.trendAfterPub : pk.trendNoMlAfterPub || pk.trendAfterPub;
  const ok = {trend: pass(tm, tap), carry: pass(pk.carry, pk.carryAfterPub), mr: pass(pk.mr, pk.mrAfterPub)};
  const w = pk.weights || {}, alloc = {legacy: 0}; let z = 0;
  for (const k of ['trend', 'carry', 'mr']){ alloc[k] = ok[k] ? (w[k] || 1 / 3) : 0; z += alloc[k]; }
  if (z > 0){
    // доли по риску, но не больше половины капитала на одну стратегию (если прошла проверку только одна — ей всё)
    const ks = ['trend', 'carry', 'mr'].filter(k => alloc[k] > 0), cap = Math.max(0.5, 1 / ks.length);
    for (const k of ks) alloc[k] /= z;
    for (let it = 0; it < 5; it++){ const ex = ks.reduce((a, k) => a + Math.max(0, alloc[k] - cap), 0); if (ex < 1e-9) break; const free = ks.filter(k => alloc[k] < cap); for (const k of ks) alloc[k] = Math.min(alloc[k], cap); const fz = free.reduce((a, k) => a + alloc[k], 0); for (const k of free) alloc[k] += fz ? ex * alloc[k] / fz : ex / free.length; }
    for (const k of ks) alloc[k] = Math.round(alloc[k] * 1000) / 1000;
  }
  st.alloc = alloc; st.model = useMl ? res.mlModel : null; st.useMl = useMl;
  for (const k of ['trend', 'carry', 'mr']) st.status[k] = ok[k] ? (office.state.gate[k] && office.state.gate[k].real ? 'допущена к реальному счёту' : 'проверка на виртуальном счёте') : 'выключена: не прошла проверку на истории';
  st.btCheck = {ts: res.ts, ok, useMl, auc: res.ml ? res.ml.auc : null};
  const p = x => x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%';
  office.post('timur', null, `Бэктест пересчитан. Распределение капитала: тренд ${p(alloc.trend)}, фандинг-арбитраж ${p(alloc.carry)}, возврат к среднему ${p(alloc.mr)}.` +
    Object.entries(ok).filter(([, v]) => !v).map(([k]) => ` ${STRATS[k].name} выключен: не прошёл проверку на истории.`).join('') +
    ` ML-фильтр ${useMl ? `включён (качество прогноза AUC ${res.ml.auc.toFixed(3)})` : `выключен: ${res.ml && res.ml.auc != null ? `AUC ${res.ml.auc.toFixed(3)} — ` : ''}не лучше тренда без него`}.`, 'system');
  office.touch(); pushStrat();
}
// история для проверки поправок: та же, что у бэктеста; если сервер перезапускался — загружаем заново
async function ensureHist(){
  if (BT.hist && Date.now() - BT.histTs < 8 * 864e5) return BT.hist;
  if (BT.loading) return BT.loading;
  BT.loading = (async () => {
    const ex = CFG.marketType === 'swap' ? data : new ccxt.binance({enableRateLimit: true, timeout: 20000, options: {defaultType: 'swap', fetchMarkets: ['linear']}});
    const hist = await loadAll({ex, coins: Object.keys(market.coins), symbolFor: b => symbolFor(b, 'swap'), now: Date.now()});
    BT.hist = hist; BT.histTs = Date.now(); return hist;
  })();
  try { return await BT.loading; } finally { BT.loading = null; }
}
function inWorker(task, opts){
  return new Promise((ok, bad) => {
    const w = new Worker(new URL('./src/backtest-worker.js', import.meta.url), {workerData: {task, data: BT.hist, opts}});
    w.once('message', m => m.ok ? ok(m.res) : bad(new Error(m.error))); w.once('error', bad);
  });
}
async function validateChange(strategy, base, cand, windows){
  await ensureHist();
  const st = office.state.strat;
  return inWorker('validate', {strategy, base, cand, windows, all: {...st.params, alloc: st.alloc}});
}
async function retrainModel(){
  const st = office.state.strat; if (!st.useMl) return;
  try { await ensureHist(); const m = await inWorker('model', {trend: st.params.trend, now: Date.now()}); if (m){ st.model = {...m, auc: st.model ? st.model.auc : null}; office.touch(); console.log('[engine] модель ML переобучена под новые параметры тренда'); } }
  catch (e) { console.warn('[engine] переобучение модели:', e.message); }
}
function btSummary(){
  const r = BT.res; if (!r || !r.windows) return null;
  const pick = w => w ? w.rows.filter(x => x.m).map(x => ({strategy: x.name, total_pct: Math.round(x.m.total * 1000) / 10, sharpe: Math.round(x.m.sharpe * 100) / 100, max_dd_pct: Math.round(x.m.mdd * 1000) / 10, positive_months_pct: x.m.posMonths != null ? Math.round(x.m.posMonths * 100) : null})) : null;
  return {computed: new Date(r.ts).toISOString().slice(0, 10), since_2021: pick(r.windows.find(w => w.id === 'all')), last_365d: pick(r.windows.find(w => w.id === 'w365')), ml_auc: r.ml ? r.ml.auc : null};
}
// допуск к реальному счёту: прошла бэктест + не меньше 21 дня на виртуальном счёте без заметного убытка
function evaluateGate(){
  const st = office.state.strat, gate = office.state.gate, eq = office.equity(office.state.books.paper), days = (Date.now() - st.since) / 864e5, pnl = engine.dailyPnl();
  for (const k of ['trend', 'mr']){
    if (gate[k] && gate[k].real) continue;
    const okBt = st.btCheck && st.btCheck.ok && st.btCheck.ok[k], share = st.alloc[k] || 0;
    if (okBt && days >= 21 && share > 0 && (pnl[k] || 0) >= -0.02 * share * eq){
      gate[k] = {real: true, ts: Date.now(), days: Math.round(days), pnl: Math.round((pnl[k] || 0) * 100) / 100};
      st.status[k] = 'допущена к реальному счёту';
      office.post('system', null, `Стратегия «${STRATS[k].name}» прошла проверку: бэктест и ${Math.round(days)} дней на виртуальном счёте (результат ${(pnl[k] || 0) >= 0 ? '+' : '−'}$${Math.abs(pnl[k] || 0).toFixed(2)}). Её сделки теперь разрешены на реальном счёте — переключить счёт можно в шапке.`, 'system');
    }
  }
  office.touch();
}
let stratT = null;
function pushStrat(){ clearTimeout(stratT); stratT = setTimeout(() => { if (reviewer) broadcast({t: 'review', review: reviewer.publicView()}); }, 300); }

// ---------- запуск ----------
let stateT = null;
const pushState = () => { clearTimeout(stateT); stateT = setTimeout(() => broadcast({t: 'state', state: office.publicState()}), 250); };

async function start(){
  server.listen(CFG.port, () => console.log(`JA Capital слушает порт ${CFG.port}`));
  for (let attempt = 1; ; attempt++){
    try { await market.init(); break; }
    catch (e) { market.status = {ok: false, error: describeError(e), fails: attempt}; console.error('[market] запуск:', market.status.error); broadcast({t: 'loading', status: market.status}); await new Promise(r => setTimeout(r, Math.min(60000, 5000 * attempt))); }
  }
  office = new Office({CFG, market, accounts});
  engine = new Engine({office, market, CFG});
  reviewer = new Reviewer({office, engine, CFG, validate: validateChange});
  reviewer.btSummary = btSummary; reviewer.onTrendChange = () => retrainModel();
  office.extra = () => ({strat: engine.publicView()});
  if (BT.res && BT.res.pick && !office.state.strat.btCheck) applyBacktest(BT.res);
  news = new News(CFG, office.state, () => office.ctx.id());
  await office.initAccount();
  // биржевые счета: активный подключаем сразу, остальные — в фоне
  const exIds = Object.values(accounts).filter(a => a.kind === 'exchange' && a.configured).map(a => a.id);
  if (office.acc.kind === 'exchange' && !(await office.connectAccount(office.state.active))){
    const failed = office.acc;
    office.state.active = 'paper';
    office.post('system', null, `Счёт «${failed.label}» сейчас недоступен: ${failed.error} Офис работает на виртуальном счёте; переключиться обратно можно в шапке, когда связь появится.`, 'system');
  }
  for (const id of exIds) if (!accounts[id].ready) office.connectAccount(id);
  console.log(`Счёт: ${office.venue()}. Доступно: ${Object.values(accounts).filter(a => a.configured).map(a => a.label).join(', ')}. Монеты: ${Object.keys(market.coins).join(', ')}. Таймфрейм ${CFG.timeframe}. Claude: ${aiEnabled() ? 'подключен' : 'нет ключа'}.`);
  if (!office.state.feed.length) office.post('system', null, `Офис открыт. Счёт: ${office.venue()}. Рустам начинает следить за рынком.`, 'system');

  office.on('feed', m => broadcast({t: 'feed', m}));
  office.on('state', pushState);
  office.on('pending', pushState);
  office.on('run', run => broadcast({t: 'run', run}));
  office.on('react', r => broadcast({t: 'react', ...r}));
  office.on('open', p => broadcast({t: 'toast', text: `Артур открыл ${p.dir > 0 ? 'LONG' : 'SHORT'} ${p.sym}${office.acc.real ? ' на реальном счёте' : ''}`}));
  office.on('accounts', () => broadcast({t: 'accounts', accounts: office.accountsPublic(), active: office.state.active}));
  office.on('review', pushStrat);
  office.on('reset', () => { news.state = office.state; broadcast({t: 'hello', cfg: cfgPublic(), state: office.publicState(), feed: office.state.feed.slice(0, 120), coins: coinsPayload(true), now: Date.now()}); });
  market.on('tick', async () => {
    broadcast({t: 'tick', now: Date.now(), coins: coinsPayload(false)});
    await office.onTick();
  });
  market.on('candles', (sym, candles) => broadcast({t: 'candles', sym, candles}));
  market.on('candle', async syms => { if (syms.includes(Object.keys(market.coins)[0])) await office.onCandle(); });
  market.on('status', () => broadcast({t: 'status', status: {market: market.status, ai: aiEnabled()}}));

  // хорошо бы иметь пару сводок до первой новости
  setInterval(() => market.pollTickers(), CFG.tickerSec * 1000);
  await market.pollTickers();
  setInterval(() => office.runPipeline(null), CFG.scanSec * 1000);
  setTimeout(() => office.runPipeline(null), 3000);
  const pollNews = async () => {
    try {
      const items = await news.poll();
      if (!items.length || news.lastWasFirst) { pushState(); return; }
      const strong = items.filter(i => i.importance >= 0.45).slice(0, 2);
      for (const it of strong){
        if (Date.now() - office.lastFocusAt < 45000){ office.post('nika', null, `К сведению: «${it.titleRu || it.title}» (${it.source}).`, 'news', {coins: it.coins, tone: it.s, rel: it.rel, link: it.link}); continue; }
        office.lastFocusAt = Date.now();
        await office.runPipeline(it);
      }
      pushState();
    } catch (e) { console.warn('[news]', e.message); }
  };
  news.on('items', (items, first) => { if (first && items.length) office.post('nika', null, `Свежих новостей за последние часы: ${items.length}. Учту их в сводках.`, 'news'); });
  setTimeout(pollNews, 8000);
  setInterval(pollNews, CFG.newsSec * 1000);
  const exAccounts = () => Object.values(accounts).filter(a => a.kind === 'exchange' && a.configured);
  setInterval(async () => {
    for (const a of exAccounts()){ if (a.ready) await a.broker.balance(); else await office.connectAccount(a.id); }
    pushState();
  }, 60000);
  setInterval(() => { for (const a of exAccounts()) if (a.ready) office.reconcile(a.id).catch(e => console.warn('[reconcile]', e.message)); }, 5 * 60000);
  setInterval(() => office.save(), 30000);
  broadcast({t: 'hello', cfg: cfgPublic(), state: office.publicState(), feed: office.state.feed.slice(0, 120), coins: coinsPayload(true), now: Date.now()});
  // стратегии: решения на закрытии дневных и часовых свечей и после событий фандинга
  setTimeout(() => engine.tick(), 15000);
  setInterval(() => engine.tick(), 60000);
  // работа над ошибками: каждый день в 09:30 по Ташкенту (04:30 UTC); если давно не было — через 20 минут после запуска
  const reviewDue = () => { const l = reviewer.lastOk; return !l || Date.now() - l.ts > 20 * 36e5; };
  setInterval(() => { const d = new Date(); if (d.getUTCHours() === 4 && d.getUTCMinutes() >= 30 && d.getUTCMinutes() < 32 && reviewDue() && !reviewer.running && aiEnabled()) reviewer.run().catch(() => {}); }, 60000);
  setTimeout(() => { if (reviewDue() && aiEnabled() && !reviewer.running) reviewer.run('после запуска сервера').catch(() => {}); }, 8 * 60000);
  setInterval(() => { try { evaluateGate(); } catch (e) { console.warn('[gate]', e.message); } }, 6 * 36e5);
  // бэктест в фоне: при первом запуске и раз в неделю
  if (process.env.BACKTEST !== 'off' && (!BT.res || Date.now() - BT.res.ts > 7 * 864e5)) setTimeout(() => runBacktestBg(BT.res ? 'прошла неделя' : 'первый запуск'), 20000);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('Сохраняю состояние и выключаюсь…'); if (office) office.save(); process.exit(0); });
process.on('unhandledRejection', e => console.error('[unhandled]', e));
start();
