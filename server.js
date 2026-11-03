// JA Capital — сервер: котировки, новости, агенты, сделки, веб-интерфейс
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {CFG, validateConfig} from './src/config.js';
import {makeExchanges, describeError} from './src/exchange.js';
import {Market} from './src/market.js';
import {News} from './src/news.js';
import {PaperBroker, ExchangeBroker} from './src/broker.js';
import {Office} from './src/office.js';
import {PROFILES, coinName, priceDp, qtyDp} from './src/brain.js';
import {aiEnabled} from './src/claude.js';
import {isAuthed, checkPassword, sessionCookie, clearCookie, loginPage} from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const errs = validateConfig();
if (errs.length){ console.error('Офис не запущен:\n - ' + errs.join('\n - ')); process.exit(1); }
if (!CFG.password) console.warn('[!] ACCESS_PASSWORD не задан — интерфейс открыт всем, кто знает адрес (допустимо только в режиме paper на своём компьютере).');

const {data, trade} = makeExchanges(CFG);
const market = new Market(data, CFG);
const broker = CFG.mode === 'exchange' ? new ExchangeBroker(trade, CFG) : new PaperBroker();
let office = null, news = null;

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
  return {mode: CFG.mode, exchange: CFG.exchange, exchangeEnv: CFG.exchangeEnv, marketType: CFG.marketType, venue: office ? office.venue() : '', tf: CFG.timeframe, tfMs: market.tf, tz: CFG.tz, ai: aiEnabled(), profiles: PROFILES,
    coins: Object.values(market.coins).map(c => ({sym: c.sym, name: coinName(c.sym), dp: priceDp(c.price || c.cur?.c || 1), qp: qtyDp(c.price || 1)}))};
}
function coinsPayload(full){
  const o = {}; for (const c of Object.values(market.coins)) o[c.sym] = {price: c.price, chg24: c.chg24, atrRef: c.atrRef, cur: c.cur, candles: full ? c.candles.slice(-240) : undefined};
  return o;
}
wss.on('connection', ws => {
  if (!office){ sendTo(ws, {t: 'loading', status: market.status}); }
  else sendTo(ws, {t: 'hello', cfg: cfgPublic(), state: office.publicState(), feed: office.state.feed.slice(0, 120), coins: coinsPayload(true), now: Date.now()});
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

// ---------- запуск ----------
let stateT = null;
const pushState = () => { clearTimeout(stateT); stateT = setTimeout(() => broadcast({t: 'state', state: office.publicState()}), 250); };

async function start(){
  server.listen(CFG.port, () => console.log(`JA Capital слушает порт ${CFG.port}`));
  for (let attempt = 1; ; attempt++){
    try { await market.init(); break; }
    catch (e) { market.status = {ok: false, error: describeError(e), fails: attempt}; console.error('[market] запуск:', market.status.error); broadcast({t: 'loading', status: market.status}); await new Promise(r => setTimeout(r, Math.min(60000, 5000 * attempt))); }
  }
  if (CFG.mode === 'exchange'){
    for (let attempt = 1; ; attempt++){
      try { await broker.init(Object.values(market.coins).map(c => c.symbol)); break; }
      catch (e) { console.error('[broker] запуск:', describeError(e)); broadcast({t: 'loading', status: {ok: false, error: describeError(e)}}); await new Promise(r => setTimeout(r, Math.min(60000, 5000 * attempt))); }
    }
  }
  office = new Office({CFG, market, broker});
  news = new News(CFG, office.state, () => office.ctx.id());
  await office.initAccount();
  console.log(`Режим: ${office.venue()}. Монеты: ${Object.keys(market.coins).join(', ')}. Таймфрейм ${CFG.timeframe}. Claude: ${aiEnabled() ? 'подключен' : 'нет ключа'}.`);
  if (!office.state.feed.length) office.post('system', null, `Офис открыт. Счёт: ${office.venue()}. Леон начинает следить за рынком.`, 'system');

  office.on('feed', m => broadcast({t: 'feed', m}));
  office.on('state', pushState);
  office.on('pending', pushState);
  office.on('run', run => broadcast({t: 'run', run}));
  office.on('react', r => broadcast({t: 'react', ...r}));
  office.on('open', p => broadcast({t: 'toast', text: `Виктор открыл ${p.dir > 0 ? 'LONG' : 'SHORT'} ${p.sym}`}));
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
  if (CFG.mode === 'exchange') setInterval(async () => { await broker.balance(); pushState(); }, 60000);
  if (CFG.mode === 'exchange') setInterval(() => office.reconcile().catch(e => console.warn('[reconcile]', e.message)), 5 * 60000);
  setInterval(() => office.save(), 30000);
  broadcast({t: 'hello', cfg: cfgPublic(), state: office.publicState(), feed: office.state.feed.slice(0, 120), coins: coinsPayload(true), now: Date.now()});
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('Сохраняю состояние и выключаюсь…'); if (office) office.save(); process.exit(0); });
process.on('unhandledRejection', e => console.error('[unhandled]', e));
start();
