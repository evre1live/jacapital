// Проверка переключения счетов через WebSocket (локально, на имитации)
import WebSocket from 'ws';
const base = process.argv[2] || 'http://127.0.0.1:8790', pass = process.argv[3] || 'demo-password';
const r = await fetch(base + '/login', {method: 'POST', body: new URLSearchParams({password: pass}), redirect: 'manual'});
const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
const ws = new WebSocket(base.replace('http', 'ws') + '/ws', {headers: {Cookie: cookie}});
const log = []; let hello = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'hello'){ hello++; log.push(`hello#${hello} account=${m.cfg.account} real=${m.cfg.real} venue="${m.cfg.venue}" accounts=${m.cfg.accounts.map(a=>`${a.id}:${a.ready?'ready':'off'}`).join(',')} cash=${Math.round(m.state.pf.cash)} auto=${m.state.auto}`); }
  else if (m.t === 'toast' || m.t === 'accounts') log.push(`${m.t}: ${m.text || JSON.stringify(m.accounts.map(a=>a.id+':'+a.ready))}`);
  else if (m.t === 'feed' && m.m.from === 'system') log.push('feed: ' + m.m.text); });
await new Promise(r => ws.on('open', r)); await wait(1500);
ws.send(JSON.stringify({t: 'account', id: 'binance'})); await wait(2500);
ws.send(JSON.stringify({t: 'account', id: 'nope'})); await wait(800);
ws.send(JSON.stringify({t: 'account', id: 'paper'})); await wait(1500);
console.log(log.join('\n')); ws.close(); process.exit(0);
