// ================= LIVE: состояние с сервера вместо симуляции =================
'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const sgn = x=>x>0?1:x<0?-1:0;
const rand = Math.random;
const rnd = (a=0,b=1)=>a+(b-a)*Math.random();
const rint = (a,b)=>Math.floor(rnd(a,b+1));
const pick = arr=>arr[Math.floor(Math.random()*arr.length)];
let COINS = [], COIN = {}, PROFILES = {}, CFGC = {}, TF_MS = 300000;
let START_CASH = 10000, TPC = 1, CANDLE_MS = 300000, BASE_TICK_SEC = 1;
let S = {coins:{}, news:[], pf:{cash:0, positions:[], closed:[], curve:[], fees:0, dayStart:0, peak:0, maxDD:0, startEquity:0}, brief:null, evals:[], evalLog:[], sigLog:[], pending:[], orders:[], feed:[], stats:{nika:{},boris:{},timur:{},aliya:{}}, params:{}, profile:'balanced', auto:true, tradingOn:true, selected:'BTC', status:{market:{ok:false}}, idx:0, tick:0};
let SERVER_OFFSET = 0;
const HOOKS = {};
function on(name, fn){ (HOOKS[name] ||= []).push(fn); }
function emit(name, ...a){ (HOOKS[name]||[]).forEach(f=>{ try{ f(...a); }catch(e){ console.error(e); } }); }
const VERDICT_RU = {ok:'одобрено', caution:'с осторожностью', reject:'отклонено'};
const sideRu = d => d>0 ? 'LONG' : 'SHORT';

function nowMs(){ return Date.now() + SERVER_OFFSET; }
function simNowMs(){ return nowMs(); }
function fmtTime(ts, withDate){
  const d = new Date(ts);
  const o = {hour:'2-digit', minute:'2-digit', timeZone: CFGC.tz || undefined};
  if (withDate){ o.day = '2-digit'; o.month = '2-digit'; }
  try { return d.toLocaleString('ru-RU', o).replace(',', ''); } catch(e){ return d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}); }
}
function dpOf(sym){ const p = S.coins[sym] ? S.coins[sym].price : 1; return p >= 1000 ? 1 : p >= 100 ? 2 : p >= 1 ? 3 : p >= 0.01 ? 5 : 7; }
function qpOf(sym){ const p = S.coins[sym] ? S.coins[sym].price : 1; return p >= 1000 ? 4 : p >= 50 ? 3 : p >= 1 ? 2 : 0; }
function fmtPrice(sym, p){ const dp = dpOf(sym); return '$'+p.toLocaleString('ru-RU',{minimumFractionDigits:dp, maximumFractionDigits:dp}); }
function fmtQty(sym, q){ const qp = qpOf(sym); return q.toLocaleString('ru-RU',{minimumFractionDigits:qp, maximumFractionDigits:qp}); }
function fmtUSD(x, sign){ const s = (sign && x>0?'+':'') + (x<0?'−':''); return s+'$'+Math.abs(x).toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2}); }
function fmtPct(x, d=1){ return (x>0?'+':x<0?'−':'')+Math.abs(x*100).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d})+'%'; }

const _ic = {};
function indicators(sym){
  const st = S.coins[sym]; if (!st) return {price:0, ema9:0, ema21:0, rsi:50, atr:0, atrPct:0, chg24:0, high20:0, low20:0};
  const key = (st.cur ? st.cur.t : 0) + ':' + st.price + ':' + st.candles.length;
  const c = _ic[sym]; if (c && c.key === key) return c.v;
  const cs = st.candles;
  const closes = cs.slice(-120).map(k=>k.c); closes.push(st.price);
  const ema = (arr,n)=>{ const k=2/(n+1); let e=arr[0]; for (let i=1;i<arr.length;i++) e = arr[i]*k + e*(1-k); return e; };
  const ema9 = ema(closes,9), ema21 = ema(closes,21);
  let ag=0, al=0; const n=14;
  for (let i=1;i<=n && i<closes.length;i++){ const d=closes[i]-closes[i-1]; if(d>0) ag+=d; else al-=d; }
  ag/=n; al/=n;
  for (let i=n+1;i<closes.length;i++){ const d=closes[i]-closes[i-1]; ag=(ag*(n-1)+Math.max(d,0))/n; al=(al*(n-1)+Math.max(-d,0))/n; }
  const rsi = al===0 ? (ag===0?50:100) : 100 - 100/(1+ag/al);
  const last = cs.slice(-15); let atr=0;
  for (let i=1;i<last.length;i++){ const k=last[i], p=last[i-1].c; atr += Math.max(k.h-k.l, Math.abs(k.h-p), Math.abs(k.l-p)); }
  atr = atr/Math.max(1,last.length-1) || st.price*0.004;
  const w20 = cs.slice(-20);
  const v = {price:st.price, ema9, ema21, rsi, atr, atrPct:atr/st.price, chg24: st.chg24||0,
    high20: Math.max(...w20.map(k=>k.h), st.price), low20: Math.min(...w20.map(k=>k.l), st.price)};
  _ic[sym] = {key, v}; return v;
}
function upnl(p){ const c = S.coins[p.sym]; return c ? (c.price-p.entry)*p.qty*p.dir : 0; }
function equity(){ let e = S.pf.cash; for (const p of S.pf.positions) e += p.entry*p.qty + upnl(p); return e; }

// совместимость со сценой: эти вызовы в живом режиме ничего не считают сами
function post(){ }
function nikaScan(){ return S.brief; }

// ---------- соединение ----------
let WS = null, WS_STATE = 'connecting', reqN = 1; const REQ = {};
function wsSend(o){ if (WS && WS.readyState === 1){ WS.send(JSON.stringify(o)); return true; } toast('Нет связи с сервером — повторю подключение'); return false; }
function connect(){
  WS_STATE = 'connecting'; emit('conn');
  const ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://') + location.host + '/ws');
  WS = ws;
  ws.onopen = ()=>{ WS_STATE = 'open'; emit('conn'); };
  ws.onclose = ()=>{ WS_STATE = 'closed'; emit('conn'); setTimeout(connect, 2500); };
  ws.onerror = ()=>{};
  ws.onmessage = ev=>{ let m; try { m = JSON.parse(ev.data); } catch(e){ return; } onServer(m); };
}
function applyCoins(coins, full){
  for (const [sym, c] of Object.entries(coins)){
    const st = S.coins[sym] || (S.coins[sym] = {price:0, candles:[], cur:null, chg24:0, atrRef:0.004});
    st.price = c.price; st.chg24 = c.chg24; st.atrRef = c.atrRef || st.atrRef;
    if (full && c.candles) st.candles = c.candles;
    if (c.cur){
      if (st.cur && c.cur.t > st.cur.t){ st.candles.push({...st.cur}); if (st.candles.length > 400) st.candles.shift(); }
      st.cur = {...c.cur};
    }
  }
}
function applyState(st){
  const sel = S.selected;
  Object.assign(S, st); S.selected = sel;
}
function onServer(m){
  switch (m.t){
    case 'loading': S.status = {market: m.status}; emit('status'); break;
    case 'hello': {
      CFGC = m.cfg; TF_MS = m.cfg.tfMs; CANDLE_MS = TF_MS; PROFILES = m.cfg.profiles;
      SERVER_OFFSET = (m.now || Date.now()) - Date.now();
      COINS = m.cfg.coins.map(c=>({sym:c.sym, name:c.name, dp:c.dp, qp:c.qp, vol:c.vol||0})); COIN = Object.fromEntries(COINS.map(c=>[c.sym,c]));
      S.coins = {}; applyCoins(m.coins, true);
      applyState(m.state); S.feed = m.feed || [];
      if (!S.coins[S.selected]) S.selected = COINS[0] ? COINS[0].sym : 'BTC';
      START_CASH = S.pf.startEquity || START_CASH;
      emit('hello'); break;
    }
    case 'tick': applyCoins(m.coins, false); emit('tick'); break;
    case 'candles': {
      const st = S.coins[m.sym]; if (!st) break;
      if (m.candles.length > 20){ st.candles = m.candles; }
      else for (const k of m.candles){ const i = st.candles.findIndex(x=>x.t===k.t); if (i>=0) st.candles[i] = k; else if (!st.cur || k.t < st.cur.t){ st.candles.push(k); st.candles.sort((a,b)=>a.t-b.t); } }
      break;
    }
    case 'state': applyState(m.state); START_CASH = S.pf.startEquity || START_CASH; emit('state'); break;
    case 'status': S.status = m.status; emit('status'); break;
    case 'feed': S.feed.unshift(m.m); if (S.feed.length > 200) S.feed.length = 200; emit('feed', m.m); break;
    case 'run': emit('run', m.run); break;
    case 'react': emit('react', m); break;
    case 'toast': toast(m.text); break;
    case 'accounts': CFGC.accounts = m.accounts; S.accounts = m.accounts; emit('accounts'); break;
    case 'review': S.review = m.review; emit('review'); break;
    case 'backtest': S.bt = m.bt; if (m.bt.res && m.bt.res.windows) S.btRes = m.bt.res; emit('backtest'); break;
    case 'chat': { const cb = REQ[m.reqId]; if (cb){ delete REQ[m.reqId]; cb(m); } break; }
    case 'meetStart': emit('meetStart'); break;
    case 'meeting': emit('meeting', m); break;
  }
}
