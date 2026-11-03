// ================= UI (живой режим): панели, графики, связь с сервером =================
const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const esc = s=>String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AVA = {};
const TAG_RU = {news:'Новость', brief:'Сводка', risk:'Риск', signal:'Сигнал', trade:'Сделка', meet:'Планёрка', chat:'Разговор', system:'Система'};
const FILTERS = [['all','Все'],['news','Новости'],['risk','Риски'],['signal','Сигналы'],['trade','Сделки'],['meet','Claude']];
const FILTER_TAGS = {news:['news','brief'], risk:['risk'], signal:['signal'], trade:['trade','system'], meet:['meet','chat']};
let feedFilter = 'all', activeTab = 'feed', uiReady = false;
const CSS = {};
function readCSS(){ const cs = getComputedStyle(document.documentElement); for (const k of ['text','muted','faint','line','up','down','accent','panel','panel-2','grid','ref','ema9','ema21']) CSS[k] = cs.getPropertyValue('--'+k).trim(); }
function alpha(c, a){ c = String(c||'').trim(); if (c[0] !== '#') return c; let h = c.slice(1); if (h.length === 3) h = h.split('').map(x=>x+x).join(''); const n = parseInt(h.slice(0,6), 16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
const CHATS = {nika:[], boris:[], timur:[], aliya:[]};
let chatBusy = false;

function toast(text, ms=2800){ const t = $('#toast'); if (!t) return; t.textContent = text; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(()=>{ t.hidden = true; }, ms); }

// ---------- запуск ----------
function bootLive(){
  readCSS();
  initScene();
  SIM.speed = 1; SIM.paused = false;
  initStaticUI();
  on('hello', ()=>{ if (!uiReady) initDataUI(); else rebuildAfterHello(); });
  on('state', ()=>{ if (!uiReady) return; syncControls(); renderApproval(); if (activeTab==='port') renderPortfolio(false); });
  on('feed', m=>{ if (uiReady) addFeedItem(m, true); });
  on('status', renderStatus); on('conn', renderStatus);
  on('accounts', renderAccounts); on('hello', renderAccounts); on('state', ()=>{ if (S.account && S.account.id !== shownAccount) renderAccounts(); });
  on('meetStart', ()=>{ if (!MEET.active){ gatherMeeting(); for (const a of AG_LIST) say(a, '…', 60); } updateMeetBtn(); });
  on('meeting', async m=>{
    if (m.error){ for (const a of AG_LIST) a.bubble = null; toast(m.error, 4500); endMeeting(); updateMeetBtn(); return; }
    for (const a of AG_LIST) a.bubble = null;
    for (const a of AG_LIST){ const line = m.data && m.data[a.id]; if (!line) continue; say(a, line, 3.4); await new Promise(r=>setTimeout(r, 3300)); }
    if (m.data && m.data.profile && m.data.profile !== S.profile) offerProfile(m.data.profile);
    await new Promise(r=>setTimeout(r, 2000)); endMeeting(); updateMeetBtn();
  });
  connect();
  requestAnimationFrame(frame);
}
let lastT = performance.now(), lastUI = 0, lastChart = 0;
function frame(now){
  const dt = Math.min(0.1, (now-lastT)/1000); lastT = now;
  updateScene(dt);
  if (S.coins[S.selected] && S.coins[S.selected].cur){ renderWorld(); blitOffice(); }
  if (uiReady && now - lastUI > 300){ lastUI = now; updateUI(); }
  if (uiReady && now - lastChart > 500){ lastChart = now; drawChart(); }
  requestAnimationFrame(frame);
}

function initStaticUI(){
  for (const a of AG_LIST){ const cv = document.createElement('canvas'); renderAvatarSized(a.id, cv); AVA[a.id] = cv.toDataURL(); }
  $('#crew').innerHTML = AG_LIST.map(a=>`<button type="button" data-agent="${a.id}" aria-pressed="false" style="--c:${a.color}"><img class="ava" alt="" data-aid="${a.id}" src="${AVA[a.id]}"><span class="who"><span class="nm">${a.name}<small>${a.short}</small></span><span class="st" data-st="${a.id}">—</span></span></button>`).join('');
  $$('#crew button').forEach(b=>b.addEventListener('click', ()=>selectAgent(b.dataset.agent)));
  $('#filters').innerHTML = FILTERS.map(([k,l])=>`<button type="button" data-f="${k}" aria-pressed="${k==='all'}">${l}</button>`).join('');
  $$('#filters button').forEach(b=>b.addEventListener('click', ()=>{ feedFilter = b.dataset.f; $$('#filters button').forEach(x=>x.setAttribute('aria-pressed', x===b)); renderFeed(); }));
  $('#tFeed').onclick = ()=>setTab('feed'); $('#tPort').onclick = ()=>setTab('port'); $('#tAgent').onclick = ()=>setTab('agent');
  $$('.tabs [role=tab]').forEach((b,i,all)=>b.addEventListener('keydown', e=>{ if (e.key==='ArrowRight'||e.key==='ArrowLeft'){ const j=(i+(e.key==='ArrowRight'?1:-1)+all.length)%all.length; all[j].click(); all[j].focus(); } }));
  $('#selAccount').onchange = onAccountChange;
  $('#chkTrade').onchange = e=>wsSend({t:'trading', v:e.target.checked});
  $('#chkAuto').onchange = e=>wsSend({t:'auto', v:e.target.checked});
  $('#selProfile').onchange = e=>{ if (e.target.value!=='custom') wsSend({t:'profile', v:e.target.value}); };
  $('#bMeet').onclick = ()=>{ if (MEET.active) return; if (!CFGC.ai){ toast('Планёрка работает, когда на сервере задан ANTHROPIC_API_KEY', 4000); return; } wsSend({t:'meeting'}); $('#bMeet').disabled = true; };
  initOfficeUI();
  addEventListener('resize', ()=>{ CH.sized = false; EQ.sized = false; drawChart(); drawSparks(); });
  renderStatus();
}
function initDataUI(){
  uiReady = true;
  $('#watch').innerHTML = COINS.map(c=>`<button type="button" class="wrow" data-sym="${c.sym}" aria-pressed="${S.selected===c.sym}"><span class="wsym"><b>${c.sym}</b><small>${esc(c.name)}</small></span><canvas class="spark" data-sp="${c.sym}" aria-hidden="true"></canvas><span class="wpx" data-px="${c.sym}">—<small>—</small></span><span class="wch" data-ch="${c.sym}">—</span></button>`).join('');
  $$('.wrow').forEach(b=>b.addEventListener('click', ()=>{ S.selected = b.dataset.sym; $$('.wrow').forEach(x=>x.setAttribute('aria-pressed', x===b)); drawChart(); drawSparks(); }));
  const cw = $('#cwrap');
  cw.addEventListener('pointermove', e=>{ const r = cw.getBoundingClientRect(); CH.hover = {x:e.clientX-r.left, y:e.clientY-r.top}; drawChart(); });
  cw.addEventListener('pointerleave', ()=>{ CH.hover = null; $('#tip').hidden = true; drawChart(); });
  $('#tfNote').textContent = `свечи по ${tfRu(CFGC.tf)}`;
  syncControls(); renderFeed(); renderApproval(); updateUI(); drawSparks(); drawChart(); renderStatus();
  $('#loading').hidden = true;
}
function rebuildAfterHello(){ for (const k in CHATS) CHATS[k] = []; syncControls(); renderFeed(); renderApproval(); if (activeTab==='port') renderPortfolio(true); if (activeTab==='agent') buildAgentPanel(); }
function tfRu(tf){ const m = String(tf).match(/^(\d+)([mhd])$/); if (!m) return tf; return m[1] + ' ' + ({m:'мин', h:'ч', d:'дн'})[m[2]]; }
function syncControls(){
  $('#chkTrade').checked = !!S.tradingOn; $('#chkAuto').checked = !!S.auto;
  const sel = $('#selProfile'); sel.querySelector('[value=custom]').hidden = S.profile!=='custom'; sel.value = S.profile;
}
// ---------- выбор счёта ----------
let shownAccount = null;
function renderAccounts(){
  const sel = $('#selAccount'); if (!sel) return;
  const list = (S.accounts && S.accounts.length ? S.accounts : CFGC.accounts) || [];
  const active = (S.account && S.account.id) || CFGC.account || 'paper';
  const acc = list.find(a=>a.id===active) || {};
  shownAccount = active;
  sel.innerHTML = list.map(a=>{
    const why = !a.configured ? ' — не настроен' : (!a.ready && a.kind==='exchange') ? ' — нет связи' : '';
    return `<option value="${a.id}"${a.id===active?' selected':''}${!a.configured?' disabled':''} title="${esc((a.error||a.note||'').slice(0,200))}">${esc(a.label + why)}${a.positions && a.id!==active ? ` · позиций: ${a.positions}` : ''}</option>`;
  }).join('');
  sel.value = active;
  const real = !!acc.real;
  if (real) document.documentElement.setAttribute('data-real', ''); else document.documentElement.removeAttribute('data-real');
  const chip = $('#acctChip'); if (chip){ chip.textContent = real ? 'РЕАЛЬНЫЕ ДЕНЬГИ' : acc.kind==='exchange' ? 'ДЕМО-СЧЁТ' : 'ВИРТУАЛЬНЫЙ'; chip.className = 'chip-demo' + (real ? ' real' : acc.kind==='exchange' ? ' exch' : ''); }
}
function onAccountChange(e){
  const id = e.target.value, list = (S.accounts && S.accounts.length ? S.accounts : CFGC.accounts) || [];
  const a = list.find(x=>x.id===id); const back = ()=>{ e.target.value = (S.account && S.account.id) || CFGC.account; };
  if (!a){ back(); return; }
  if (!a.configured){ toast(a.error || 'Счёт не настроен на сервере', 4500); back(); return; }
  if (a.real){ back(); openAcctModal(a); return; }
  wsSend({t:'account', id}); toast(`Переключаю на «${a.label}»…`);
}
function openAcctModal(a){
  const m = $('#acctModal'); $('#amTitle').textContent = `Перейти на «${a.label}»?`;
  $('#amText').textContent = 'Агенты будут открывать и закрывать сделки на настоящие деньги этого счёта.' + (a.error && !a.ready ? ` Сейчас нет связи: ${a.error}` : '');
  $('#amMax').textContent = (a.note.match(/ордер до (\$[\d\s,.]+)/) || [,'лимита MAX ордера'])[1];
  $('#amAgree').checked = false; $('#amOk').disabled = true; m.hidden = false; $('#amCancel').focus();
  $('#amAgree').onchange = ev=>{ $('#amOk').disabled = !ev.target.checked; };
  const close = ()=>{ m.hidden = true; document.removeEventListener('keydown', onKey); $('#selAccount').focus(); };
  const onKey = ev=>{ if (ev.key==='Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('#amCancel').onclick = close;
  m.onclick = ev=>{ if (ev.target===m) close(); };
  $('#amOk').onclick = ()=>{ wsSend({t:'account', id:a.id, confirm:true}); toast(`Подключаю «${a.label}»…`, 3500); close(); };
}
function renderStatus(){
  const el = $('#conn'); if (!el) return;
  const m = S.status && S.status.market;
  let cls = 'ok', txt = CFGC.venue || 'Подключение…';
  if (WS_STATE !== 'open'){ cls = 'warn'; txt = 'Нет связи с сервером…'; }
  else if (m && !m.ok){ cls = 'bad'; txt = m.error || 'Биржа недоступна'; }
  el.className = 'conn ' + cls; el.textContent = txt; el.title = txt;
  const ld = $('#loadingText'); if (ld && !uiReady) ld.textContent = (m && m.error) ? m.error : WS_STATE==='open' ? 'Загружаю котировки…' : 'Подключаюсь к серверу…';
}
function updateMeetBtn(){ const b = $('#bMeet'); b.disabled = MEET.active; b.textContent = MEET.active ? 'Идёт планёрка…' : 'Планёрка с Claude'; }
function setTab(t){
  activeTab = t;
  const map = {feed:['#tFeed','#pFeed'], port:['#tPort','#pPort'], agent:['#tAgent','#pAgent']};
  for (const [k,[tb,pn]] of Object.entries(map)){ $(tb).setAttribute('aria-selected', k===t); $(tb).tabIndex = k===t?0:-1; $(pn).hidden = k!==t; }
  if (!uiReady) return;
  if (t==='port'){ EQ.sized = false; renderPortfolio(true); }
  if (t==='agent') buildAgentPanel();
}
function selectAgent(id, switchTab=true){
  selectedAgent = id;
  $$('#crew button').forEach(b=>b.setAttribute('aria-pressed', b.dataset.agent===id));
  if (switchTab) setTab('agent'); else if (activeTab==='agent') buildAgentPanel();
}

// ---------- лента ----------
function feedMatches(m){ return feedFilter==='all' || (FILTER_TAGS[feedFilter]||[]).includes(m.tag); }
function feedItemHTML(m){
  const a = AG[m.from];
  const to = m.to ? (m.to==='office' ? 'всем' : m.to==='you' ? 'вам' : AG[m.to] ? AG[m.to].name : '') : null;
  const t = fmtTime(m.ts);
  let extra = '';
  if (m.tag==='news' && m.rel!=null){ const lv = Math.round(m.rel*5); extra = ` <span class="relbar" title="Надёжность источника ${Math.round(m.rel*100)}%">${[1,2,3,4,5].map(i=>`<i class="${i<=lv?'on':''}"></i>`).join('')}</span>`; }
  const link = m.link && /^https?:\/\//.test(m.link) ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">источник</a>` : '';
  if (!a) return `<li class="msg sys" data-id="${m.id}"><div><div class="meta"><b>Офис</b><span class="tag">${TAG_RU[m.tag]||''}</span><span class="t">${t}</span></div><p>${esc(m.text)}</p></div></li>`;
  return `<li class="msg" data-id="${m.id}" style="--c:${a.color}"><img class="ava" alt="" data-aid="${a.id}" src="${AVA[a.id]}"><div><div class="meta"><b>${a.name}</b>${to?`→ ${to}`:''}<span class="tag ${m.tag}">${TAG_RU[m.tag]||''}</span>${extra}<span class="t">${t}</span></div><p>${esc(m.text)}${link}</p></div></li>`;
}
function renderFeed(){ const list = S.feed.filter(feedMatches).slice(0, 100); $('#feed').innerHTML = list.length ? list.map(feedItemHTML).join('') : `<li class="empty">Здесь пока тихо. Сообщения появятся, когда агенты начнут работу.</li>`; }
function addFeedItem(m, fresh){
  if (!feedMatches(m)) return;
  const ol = $('#feed'); const empty = ol.querySelector('.empty'); if (empty) empty.remove();
  ol.insertAdjacentHTML('afterbegin', feedItemHTML(m));
  if (fresh && !REDUCED) ol.firstElementChild.classList.add('fresh');
  while (ol.children.length > 100) ol.lastElementChild.remove();
}

// ---------- шапка, команда, рынок ----------
function updateUI(){
  const eq = equity(), pf = S.pf;
  const day = eq - pf.dayStart, tot = eq - (pf.startEquity || eq);
  $('#kEq').textContent = fmtUSD(eq);
  setPnl($('#kDay'), day, pf.dayStart ? day/pf.dayStart : 0);
  setPnl($('#kTot'), tot, pf.startEquity ? tot/pf.startEquity : 0);
  $('#kPos').textContent = `${pf.positions.length} из ${S.params.maxPos || '—'}`;
  $('#kTime').textContent = fmtTime(nowMs(), true);
  for (const a of AG_LIST){
    const el = document.querySelector(`[data-st="${a.id}"]`); if (!el) continue;
    if (el.textContent !== a.status) el.textContent = a.status;
    const busy = a.actions.length && a.actions[0].type==='work', walk = !a.seated;
    el.classList.toggle('busy', !!busy); el.classList.toggle('walk', walk && !busy);
  }
  for (const c of COINS){
    const it = indicators(c.sym);
    const px = document.querySelector(`[data-px="${c.sym}"]`); if (!px) continue;
    const b = S.brief && S.brief.items.find(i=>i.sym===c.sym);
    px.innerHTML = `${esc(fmtPrice(c.sym, it.price))}<small>${b ? b.label : ''}${b && Math.abs(b.sent)>0.2 ? (b.sent>0?' · позитив':' · негатив') : ''}</small>`;
    const ch = document.querySelector(`[data-ch="${c.sym}"]`); ch.textContent = fmtPct(it.chg24); ch.className = 'wch '+(it.chg24>=0?'up':'down');
  }
  if (!updateUI._n) updateUI._n = 0;
  if (++updateUI._n % 6 === 0) drawSparks();
  updateChartHead();
  if (activeTab==='port') renderPortfolio(false);
  if (activeTab==='agent') updateAgentPanel();
  const pc = $('#pendCount'); pc.hidden = !S.pending.length; pc.textContent = S.pending.length;
  if (!MEET.active && $('#bMeet').disabled && !$('#bMeet').dataset.lock) updateMeetBtn();
}
function setPnl(el, v, pct){ el.textContent = `${fmtUSD(v,true)} · ${fmtPct(pct,2)}`; el.className = v>0.005 ? 'up' : v<-0.005 ? 'down' : ''; }
function drawSparks(){
  for (const c of COINS){
    const cv = document.querySelector(`[data-sp="${c.sym}"]`); if (!cv) continue;
    const r = cv.getBoundingClientRect(); if (!r.width) continue;
    const dpr = Math.min(2, devicePixelRatio||1);
    if (cv.width !== Math.round(r.width*dpr)){ cv.width = Math.round(r.width*dpr); cv.height = Math.round(r.height*dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,r.width,r.height);
    const st = S.coins[c.sym]; const pts = st.candles.slice(-72).map(k=>k.c); pts.push(st.price); if (pts.length < 2) continue;
    let hi = Math.max(...pts), lo = Math.min(...pts); if (hi===lo){ hi+=1; lo-=1; }
    const X = i=>1 + i/(pts.length-1)*(r.width-5), Y = v=>2 + (1-(v-lo)/(hi-lo))*(r.height-5);
    const up = pts[pts.length-1] >= pts[0]; const col = up ? CSS.up : CSS.down;
    x.beginPath(); pts.forEach((v,i)=>i?x.lineTo(X(i),Y(v)):x.moveTo(X(i),Y(v))); x.strokeStyle = col; x.lineWidth = 1.5; x.lineJoin = 'round'; x.stroke();
    x.lineTo(X(pts.length-1), r.height); x.lineTo(X(0), r.height); x.closePath();
    const gr = x.createLinearGradient(0,0,0,r.height); gr.addColorStop(0, up?alpha(CSS.up,.22):alpha(CSS.down,.22)); gr.addColorStop(1,'rgba(0,0,0,0)'); x.fillStyle = gr; x.fill();
    x.beginPath(); x.arc(X(pts.length-1), Y(pts[pts.length-1]), 2.2, 0, Math.PI*2); x.fillStyle = col; x.fill();
  }
}

// ---------- большой график ----------
const CH = {hover:null, sized:false, w:0, h:0};
function updateChartHead(){
  const sym = S.selected, it = indicators(sym), b = S.brief && S.brief.items.find(i=>i.sym===sym);
  $('#cSym').textContent = `${sym}/USDT`;
  $('#cPx').textContent = fmtPrice(sym, it.price);
  const ch = $('#cCh'); ch.textContent = `${fmtPct(it.chg24)} за 24 ч`; ch.className = 'mono '+(it.chg24>=0?'up':'down');
  const chips = [`<span class="pill">RSI ${it.rsi.toFixed(0)}</span>`, `<span class="pill">Волат. ${(it.atrPct*100).toFixed(2)}%</span>`];
  if (b){ chips.push(`<span class="pill ${b.label==='рост'?'up':b.label==='падение'?'down':''}">Тренд: ${b.label}</span>`); chips.push(`<span class="pill ${b.sent>0.2?'up':b.sent<-0.2?'down':''}">Новости ${b.sent>=0?'+':'−'}${Math.abs(b.sent).toFixed(2)}</span>`); }
  const pos = S.pf.positions.find(p=>p.sym===sym);
  if (pos){ const u = upnl(pos); chips.push(`<span class="pill ${u>=0?'up':'down'}">${sideRu(pos.dir)} ${fmtUSD(u,true)}</span>`); }
  const html = chips.join(''); if ($('#cChips').innerHTML !== html) $('#cChips').innerHTML = html;
}
function niceTicks(lo, hi, n=4){
  const span = hi-lo || Math.abs(hi)*0.01 || 1; const step0 = span/n; const mag = Math.pow(10, Math.floor(Math.log10(step0))); const e = step0/mag;
  const step = (e>=7.5?10:e>=3.5?5:e>=1.5?2:1)*mag; const out = [];
  for (let v = Math.ceil(lo/step)*step; v <= hi+step*1e-6; v += step) out.push(+v.toPrecision(12));
  return out;
}
function emaSeries(vals, n){ const k = 2/(n+1); const out = []; let e = vals[0]; for (let i=0;i<vals.length;i++){ e = i ? vals[i]*k + e*(1-k) : vals[0]; out.push(e); } return out; }
function axisFmt(sym, v){ const dp = dpOf(sym); return v.toLocaleString('ru-RU', {minimumFractionDigits: dp>2?dp-1:0, maximumFractionDigits: dp>2?dp-1:dp}); }
function drawChart(){
  const cv = $('#chart'); const r = cv.getBoundingClientRect(); if (!r.width) return;
  const sym = S.selected, st = S.coins[sym]; if (!st || !st.cur) return;
  const dpr = Math.min(2, devicePixelRatio||1);
  if (!CH.sized || CH.w !== r.width || CH.h !== r.height){ CH.w = r.width; CH.h = r.height; cv.width = Math.round(r.width*dpr); cv.height = Math.round(r.height*dpr); CH.sized = true; }
  const x = cv.getContext('2d'); x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,CH.w,CH.h);
  const N = CH.w < 520 ? 48 : 84;
  const all = st.candles.slice(-(N+60)).concat([st.cur]);
  const e9 = emaSeries(all.map(k=>k.c), 9).slice(-N), e21 = emaSeries(all.map(k=>k.c), 21).slice(-N);
  const cs = all.slice(-N); const n = cs.length; const firstT = cs[0].t;
  const pL = 4, pR = 72, pT = 12, pB = 22;
  const plotW = CH.w - pL - pR, plotH = CH.h - pT - pB, volH = Math.round(plotH*0.17), priceH = plotH - volH - 8;
  let hi = -Infinity, lo = Infinity;
  for (const k of cs){ hi = Math.max(hi,k.h); lo = Math.min(lo,k.l); }
  for (const v of e9.concat(e21)){ hi = Math.max(hi,v); lo = Math.min(lo,v); }
  const pos = S.pf.positions.find(p=>p.sym===sym);
  if (pos) for (const v of [pos.sl,pos.tp,pos.entry]){ hi = Math.max(hi,v); lo = Math.min(lo,v); }
  const padv = (hi-lo)*0.06 || hi*0.001; hi += padv; lo -= padv;
  const step = plotW / N;
  const X = i => pL + i*step + step/2, Y = v => pT + (1-(v-lo)/(hi-lo))*priceH;
  const iOf = ts => Math.floor((ts - firstT)/TF_MS);
  const font = getComputedStyle(document.body).fontFamily;
  x.font = `11px ${font}`; x.textBaseline = 'middle';
  const curY = Y(st.price);
  for (const v of niceTicks(lo, hi, 4)){
    const yy = Math.round(Y(v))+0.5; if (yy < pT || yy > pT+priceH) continue;
    x.strokeStyle = CSS.grid; x.lineWidth = 1; x.beginPath(); x.moveTo(pL, yy); x.lineTo(pL+plotW, yy); x.stroke();
    if (Math.abs(yy - curY) < 14) continue;
    x.fillStyle = CSS.faint; x.textAlign = 'left'; x.fillText(axisFmt(sym, v), pL+plotW+8, yy);
  }
  x.textBaseline = 'alphabetic'; x.textAlign = 'center';
  const every = Math.max(1, Math.round(3600000/TF_MS)) * (N > 60 && TF_MS <= 60000 ? 2 : 1);
  cs.forEach((k,i)=>{ if (Math.round(k.t/TF_MS) % every === 0){ x.fillStyle=CSS.grid; x.fillRect(Math.round(X(i)), pT, 1, plotH); x.fillStyle = CSS.faint; x.fillText(fmtTime(k.t), X(i), CH.h-6); } });
  const vmax = Math.max(...cs.map(k=>k.v)) || 1; const vb = pT + plotH; const bw = Math.max(1.5, step*0.62);
  cs.forEach((k,i)=>{ const hgt = Math.max(1, k.v/vmax*volH); x.fillStyle = k.c>=k.o ? alpha(CSS.up,.28) : alpha(CSS.down,.28); x.fillRect(X(i)-bw/2, vb-hgt, bw, hgt); });
  cs.forEach((k,i)=>{
    const col = k.c >= k.o ? CSS.up : CSS.down; x.fillStyle = col;
    x.fillRect(Math.round(X(i))-0.5, Y(k.h), 1, Math.max(1, Y(k.l)-Y(k.h)));
    const y1 = Y(Math.max(k.o,k.c)), y2 = Y(Math.min(k.o,k.c)); x.fillRect(X(i)-bw/2, y1, bw, Math.max(1, y2-y1));
  });
  const lineS = (arr, col)=>{ x.beginPath(); arr.forEach((v,i)=>i?x.lineTo(X(i+(n-arr.length)),Y(v)):x.moveTo(X(i+(n-arr.length)),Y(v))); x.strokeStyle = col; x.lineWidth = 1.6; x.lineJoin='round'; x.stroke(); };
  lineS(e21.slice(-n), CSS.ema21); lineS(e9.slice(-n), CSS.ema9);
  if (pos){
    const lvl = (v, col, label)=>{ const yy = Math.round(Y(v))+0.5; x.setLineDash([4,3]); x.strokeStyle = col; x.lineWidth = 1; x.beginPath(); x.moveTo(pL, yy); x.lineTo(pL+plotW, yy); x.stroke(); x.setLineDash([]); x.font = `600 10.5px ${font}`; x.textAlign='right'; x.textBaseline='bottom'; x.fillStyle = col; x.fillText(label, pL+plotW-4, yy-2); };
    lvl(pos.tp, CSS.up, `Тейк ${axisFmt(sym,pos.tp)}`); lvl(pos.sl, CSS.down, `Стоп ${axisFmt(sym,pos.sl)}`); lvl(pos.entry, CSS.muted, `Вход ${sideRu(pos.dir)}`);
  }
  const marks = [];
  for (const c of S.pf.closed){ if (c.sym!==sym) continue; if (c.tsClose < firstT) continue; marks.push({i:iOf(c.ts), v:c.entry, dir:c.dir, kind:'in'}); marks.push({i:iOf(c.tsClose), v:c.exit, dir:c.dir, kind:'out', win:c.pnl>0}); }
  if (pos) marks.push({i:iOf(pos.ts), v:pos.entry, dir:pos.dir, kind:'in'});
  for (const m of marks){
    if (m.i < 0 || m.i >= n) continue; const cx = X(m.i), cy = Y(m.v);
    x.lineWidth = 2; x.strokeStyle = CSS.panel;
    if (m.kind==='in'){ x.beginPath(); if (m.dir>0){ x.moveTo(cx, cy+4); x.lineTo(cx-5, cy+12); x.lineTo(cx+5, cy+12); } else { x.moveTo(cx, cy-4); x.lineTo(cx-5, cy-12); x.lineTo(cx+5, cy-12); } x.closePath(); x.fillStyle = m.dir>0 ? CSS.up : CSS.down; x.stroke(); x.fill(); }
    else { x.beginPath(); x.arc(cx, cy, 4.5, 0, Math.PI*2); x.fillStyle = m.win ? CSS.up : CSS.down; x.stroke(); x.fill(); x.fillStyle = CSS.panel; x.fillRect(cx-2, cy-0.75, 4, 1.5); }
  }
  const newsAt = {};
  for (const nw of S.news){ if (nw.ts < firstT) continue; if (nw.coins && nw.coins.length && !nw.coins.includes(sym)) continue; const i = iOf(nw.ts); if (i<0 || i>=n) continue; (newsAt[i] ||= []).push(nw); }
  for (const [i, arr] of Object.entries(newsAt)){ const nw = arr[0]; x.save(); x.translate(X(+i), pT+4); x.rotate(Math.PI/4); x.fillStyle = nw.s>=0 ? CSS.up : CSS.down; x.globalAlpha = 0.45 + nw.rel*0.55; x.fillRect(-3.5,-3.5,7,7); x.restore(); }
  const last = cs[n-1], ly = Y(last.c);
  x.setLineDash([2,3]); x.strokeStyle = CSS.ref; x.beginPath(); x.moveTo(pL, Math.round(ly)+0.5); x.lineTo(pL+plotW, Math.round(ly)+0.5); x.stroke(); x.setLineDash([]);
  const lbl = axisFmt(sym, last.c); x.font = `600 11px ${font}`; const lw = x.measureText(lbl).width + 10;
  x.fillStyle = last.c>=last.o ? CSS.up : CSS.down; x.fillRect(pL+plotW+3, ly-9, lw, 18);
  x.fillStyle = '#ffffff'; x.textAlign='left'; x.textBaseline='middle'; x.fillText(lbl, pL+plotW+8, ly);
  const tip = $('#tip');
  if (CH.hover && CH.hover.x >= pL && CH.hover.x <= pL+plotW){
    const i = clamp(Math.floor((CH.hover.x - pL)/step), 0, n-1); const k = cs[i];
    x.strokeStyle = CSS.ref; x.lineWidth = 1; x.beginPath(); x.moveTo(Math.round(X(i))+0.5, pT); x.lineTo(Math.round(X(i))+0.5, pT+plotH); x.stroke();
    tip.innerHTML = '';
    const h = document.createElement('div'); h.className = 'h'; h.textContent = `${fmtTime(k.t, true)}${i===n-1?' · текущая свеча':''}`; tip.append(h);
    const row = (a,b,cls)=>{ const d = document.createElement('div'); d.className='r'; const s1 = document.createElement('span'); s1.textContent=a; const s2=document.createElement('span'); s2.textContent=b; if (cls) s2.className=cls; d.append(s1,s2); tip.append(d); };
    row('Закрытие', fmtPrice(sym,k.c), k.c>=k.o?'up':'down'); row('Открытие', fmtPrice(sym,k.o)); row('Макс / мин', `${axisFmt(sym,k.h)} / ${axisFmt(sym,k.l)}`);
    const ei = i - (n - e9.slice(-n).length); if (ei >= 0) row('EMA 9 / 21', `${axisFmt(sym,e9.slice(-n)[ei])} / ${axisFmt(sym,e21.slice(-n)[ei])}`);
    for (const nw of (newsAt[i]||[])){ const d = document.createElement('div'); d.className='n'; d.textContent = `${nw.s>=0?'▲':'▼'} ${nw.titleRu || nw.title} — ${nw.source}, ${Math.round(nw.rel*100)}%`; tip.append(d); }
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = CH.hover.x + 14; if (tx + tw > CH.w) tx = CH.hover.x - tw - 14;
    tip.style.left = Math.max(0,tx)+'px'; tip.style.top = clamp(CH.hover.y - th/2, 0, CH.h - th)+'px';
  } else tip.hidden = true;
}

// ---------- портфель ----------
const EQ = {sized:false, hover:null};
let portBuilt = false;
function renderPortfolio(full){
  const el = $('#pPort');
  if (full || !portBuilt){
    const paper = CFGC.mode === 'paper';
    el.innerHTML = `<div class="venue">${esc(CFGC.venue||'')}</div><div id="killBox"></div><div class="kgrid" id="pK"></div>
      <div class="sec">Капитал<span class="note">${paper ? 'виртуальный счёт' : 'оценка по сделкам офиса'}</span></div>
      <div class="eqbox" id="eqbox"><canvas id="eqc"></canvas><div class="tip" id="eqtip" hidden></div></div>
      <div id="pendBox"></div>
      <div class="sec">Открытые позиции</div><div id="posBox"></div>
      <div class="sec">История сделок<span class="note" id="histNote"></span></div><div id="histBox"></div>
      ${paper ? `<div class="resetbox"><button type="button" class="btn btn-sm" id="bReset">Начать заново</button><span id="resetNote">Сбросит виртуальный счёт и историю.</span></div>` : ''}`;
    portBuilt = true; EQ.sized = false; $('#posBox')._k = null;
    const box = $('#eqbox');
    box.addEventListener('pointermove', e=>{ const r = box.getBoundingClientRect(); EQ.hover = {x:e.clientX-r.left, y:e.clientY-r.top}; drawEquity(); });
    box.addEventListener('pointerleave', ()=>{ EQ.hover = null; drawEquity(); });
    if ($('#bReset')) $('#bReset').onclick = onReset;
    el.onclick = e=>{
      const b = e.target.closest('[data-close]'); if (b){ b.disabled = true; b.textContent = 'Закрываю…'; wsSend({t:'close', id:+b.dataset.close}); }
      const ap = e.target.closest('[data-appr]'); if (ap){ approvePending(+ap.dataset.appr, ap.dataset.ok==='1'); ap.closest('.appr-row').style.opacity = .5; }
    };
  }
  const eq = equity(), pf = S.pf;
  const inPos = pf.positions.reduce((a,p)=>a+p.entry*p.qty,0);
  const bal = pf.balance;
  const kp = [
    ['Капитал', fmtUSD(eq)], bal ? ['Баланс биржи', fmtUSD(bal.total)] : ['Свободно', fmtUSD(pf.cash)], ['В позициях', fmtUSD(inPos)],
    ['Сделок', String(pf.closedCount||0)], ['Винрейт', pf.closedCount ? Math.round(pf.wins/pf.closedCount*100)+'%' : '—'], ['Профит-фактор', pf.grossLoss>0 ? (pf.grossWin/pf.grossLoss).toFixed(2) : '—'],
    ['Макс. просадка', fmtPct(-(pf.maxDD||0),1)], ['Комиссии', fmtUSD(pf.fees||0)], ['P&L с начала', `<span class="${eq>=pf.startEquity?'up':'down'}">${fmtUSD(eq-pf.startEquity,true)}</span>`],
  ];
  $('#pK').innerHTML = kp.map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join('');
  $('#killBox').innerHTML = (pf.killed ? `<div class="killnote"><b>Стоп-кран.</b> Дневной лимит убытка ${S.params.dailyLimit}% достигнут, новые сделки — со следующего дня.</div>` : '') + (!S.tradingOn ? `<div class="killnote" style="background:#33280c;border-color:#6b5114;color:#ffe2a8"><b>Торговля на паузе.</b> Стопы и тейки открытых позиций работают.</div>` : '');
  const ph = S.pending.length ? `<div class="sec">Ждут вашего решения</div>` + S.pending.map(p=>pendRow(p, true)).join('') : '';
  const pb = $('#pendBox'); if (pb._h !== ph){ pb._h = ph; pb.innerHTML = ph; }
  const posKey = pf.positions.map(p=>p.id).join(','); const posBox = $('#posBox');
  if (posBox._k !== posKey){
    posBox._k = posKey;
    posBox.innerHTML = pf.positions.length ? `<table class="tbl"><thead><tr><th>Монета</th><th class="num">Вход → сейчас</th><th class="num">P&L</th><th></th></tr></thead><tbody>${pf.positions.map(p=>
      `<tr data-pid="${p.id}"><td><b class="mono">${p.sym}</b> <span class="side-pill ${p.dir>0?'l':'s'}">${sideRu(p.dir)}</span><br><small style="color:var(--faint)" data-f="lv"></small></td>
      <td class="num">${esc(fmtPrice(p.sym,p.entry))}<br><small style="color:var(--faint)" data-f="px"></small></td><td class="num" data-f="pnl"></td>
      <td class="num"><button type="button" class="btn btn-sm" data-close="${p.id}" aria-label="Закрыть ${sideRu(p.dir)} ${p.sym}">Закрыть</button></td></tr>`).join('')}</tbody></table>` : `<div class="empty">Открытых позиций нет. Артур ждёт сигнал от Нода.</div>`;
  }
  for (const p of pf.positions){
    const tr = posBox.querySelector(`[data-pid="${p.id}"]`); if (!tr) continue;
    const u = upnl(p), px = S.coins[p.sym] ? S.coins[p.sym].price : p.entry;
    tr.querySelector('[data-f=lv]').textContent = `стоп ${fmtPrice(p.sym,p.sl)}${p.be?' · б/у':''} · тейк ${fmtPrice(p.sym,p.tp)}`;
    tr.querySelector('[data-f=px]').textContent = fmtPrice(p.sym, px);
    const c = tr.querySelector('[data-f=pnl]'); c.className = 'num '+(u>=0?'up':'down'); c.innerHTML = `${fmtUSD(u,true)}<br><small>${fmtPct(u/(p.entry*p.qty))}</small>`;
  }
  const cl = pf.closed; const hist = cl.slice(0, 30);
  $('#histNote').textContent = pf.closedCount ? `последние ${hist.length} из ${pf.closedCount}` : '';
  const hb = $('#histBox'); const hk = (pf.closedCount||0)+':'+(cl[0]&&cl[0].id);
  if (hb._k !== hk){ hb._k = hk; hb.innerHTML = hist.length ? `<table class="tbl"><thead><tr><th>Время</th><th>Сделка</th><th class="num">P&L</th></tr></thead><tbody>${hist.map(c=>`<tr><td class="mono" style="color:var(--faint);white-space:nowrap">${fmtTime(c.tsClose)}</td><td><b class="mono">${c.sym}</b> <span class="side-pill ${c.dir>0?'l':'s'}">${sideRu(c.dir)}</span> <small style="color:var(--faint)">${esc(c.reason)}</small></td><td class="num ${c.pnl>=0?'up':'down'}">${fmtUSD(c.pnl,true)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">Сделок пока нет.</div>`; }
  drawEquity();
}
function pendRow(p, exp){
  const left = Math.max(0, Math.round((p.expiresAt - nowMs())/60000));
  return `<div class="appr-row"><div class="what"><b>${sideRu(p.dir)} ${p.sym}</b> · уверенность ${p.conf}%<small>Вход ~${esc(fmtPrice(p.sym,p.entry))}, риск ${esc(fmtUSD(p.riskUSD))}${exp?`, ещё ${left} мин`:''}</small></div><button type="button" class="btn btn-sm btn-ok" data-appr="${p.id}" data-ok="1">Исполнить</button><button type="button" class="btn btn-sm btn-no" data-appr="${p.id}" data-ok="0">Отклонить</button></div>`;
}
function pendMini(p){ return `<div class="appr-row"><div class="what"><b>${sideRu(p.dir)} ${p.sym}</b> · ${p.conf}%</div><button type="button" class="btn btn-sm btn-ok" data-appr="${p.id}" data-ok="1" aria-label="Исполнить ${sideRu(p.dir)} ${p.sym}">Исполнить</button><button type="button" class="btn btn-sm btn-no" data-appr="${p.id}" data-ok="0" aria-label="Отклонить ${sideRu(p.dir)} ${p.sym}">✕</button></div>`; }
function renderApproval(){
  const el = $('#approval');
  if (!S.pending.length){ el.hidden = true; el.innerHTML = ''; el._h = ''; return; }
  const more = S.pending.length - 2;
  const h = `<h4><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block"></span>Артур ждёт решения</h4>` + S.pending.slice(0,2).map(pendMini).join('') + (more>0 ? `<div class="appr-more">Ещё ${more} — во вкладке «Портфель»</div>` : '');
  if (el._h !== h){ el._h = h; el.innerHTML = h; }
  el.hidden = false;
  el.onclick = e=>{ const ap = e.target.closest('[data-appr]'); if (ap){ approvePending(+ap.dataset.appr, ap.dataset.ok==='1'); ap.closest('.appr-row').style.opacity = .5; } };
}
function drawEquity(){
  const cv = $('#eqc'); if (!cv) return; const r = cv.getBoundingClientRect(); if (!r.width) return;
  const dpr = Math.min(2, devicePixelRatio||1);
  if (!EQ.sized || EQ.w !== r.width){ EQ.w = r.width; EQ.h = r.height; cv.width = Math.round(r.width*dpr); cv.height = Math.round(r.height*dpr); EQ.sized = true; }
  const x = cv.getContext('2d'); x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,EQ.w,EQ.h);
  const pts = S.pf.curve.slice(-300).concat([{ts:nowMs(), e:equity()}]); const base = S.pf.startEquity || pts[0].e;
  if (pts.length < 2){ x.fillStyle = CSS.faint; x.font = `12px ${getComputedStyle(document.body).fontFamily}`; x.fillText('График появится после первых свечей', 10, EQ.h/2); return; }
  const vals = pts.map(p=>p.e).concat([base]);
  let hi = Math.max(...vals), lo = Math.min(...vals); const pad = (hi-lo)*0.12 || 10; hi += pad; lo -= pad;
  const pL = 6, pR = 64, pT = 8, pB = 8, w = EQ.w-pL-pR, h = EQ.h-pT-pB;
  const X = i=>pL + i/(pts.length-1)*w, Y = v=>pT + (1-(v-lo)/(hi-lo))*h;
  x.font = `11px ${getComputedStyle(document.body).fontFamily}`; x.textBaseline = 'middle'; x.textAlign = 'left';
  for (const v of niceTicks(lo, hi, 3)){ const yy = Math.round(Y(v))+0.5; x.strokeStyle=CSS.grid; x.beginPath(); x.moveTo(pL,yy); x.lineTo(pL+w,yy); x.stroke(); x.fillStyle = CSS.faint; x.fillText('$'+Math.round(v).toLocaleString('ru-RU'), pL+w+6, yy); }
  const by = Math.round(Y(base))+0.5; x.setLineDash([3,3]); x.strokeStyle = CSS.ref; x.beginPath(); x.moveTo(pL,by); x.lineTo(pL+w,by); x.stroke(); x.setLineDash([]);
  const end = pts[pts.length-1].e, up = end >= base, col = up ? CSS.up : CSS.down;
  x.beginPath(); pts.forEach((p,i)=>i?x.lineTo(X(i),Y(p.e)):x.moveTo(X(i),Y(p.e))); x.strokeStyle = col; x.lineWidth = 2; x.lineJoin='round'; x.stroke();
  x.lineTo(X(pts.length-1), pT+h); x.lineTo(X(0), pT+h); x.closePath();
  const gr = x.createLinearGradient(0,pT,0,pT+h); gr.addColorStop(0, up?alpha(CSS.up,.20):alpha(CSS.down,.20)); gr.addColorStop(1,'rgba(0,0,0,0)'); x.fillStyle = gr; x.fill();
  x.beginPath(); x.arc(X(pts.length-1), Y(end), 3.5, 0, Math.PI*2); x.fillStyle = col; x.fill(); x.lineWidth = 2; x.strokeStyle = CSS.panel; x.stroke();
  const tip = $('#eqtip');
  if (EQ.hover && EQ.hover.x>=pL && EQ.hover.x<=pL+w){
    const i = Math.round(clamp((EQ.hover.x-pL)/w,0,1)*(pts.length-1)); const p = pts[i];
    x.strokeStyle=CSS.ref; x.lineWidth=1; x.beginPath(); x.moveTo(Math.round(X(i))+0.5,pT); x.lineTo(Math.round(X(i))+0.5,pT+h); x.stroke();
    tip.innerHTML = ''; const hh = document.createElement('div'); hh.className='h'; hh.textContent = fmtTime(p.ts, true); const rr = document.createElement('div'); rr.className='r'; const a1=document.createElement('span'); a1.textContent='Капитал'; const a2=document.createElement('span'); a2.textContent=fmtUSD(p.e); rr.append(a1,a2); tip.append(hh, rr);
    tip.hidden = false; let tx = EQ.hover.x+12; if (tx+tip.offsetWidth > EQ.w) tx = EQ.hover.x - tip.offsetWidth - 12; tip.style.left = Math.max(0,tx)+'px'; tip.style.top = '6px';
  } else tip.hidden = true;
}
let resetArm = 0;
function onReset(){
  const b = $('#bReset');
  if (Date.now() - resetArm > 4000){ resetArm = Date.now(); b.textContent = 'Точно сбросить?'; b.classList.add('btn-no'); $('#resetNote').textContent = 'Нажмите ещё раз в течение 4 секунд.'; setTimeout(()=>{ const bb = $('#bReset'); if (bb && Date.now()-resetArm >= 4000){ bb.textContent='Начать заново'; bb.classList.remove('btn-no'); $('#resetNote').textContent='Сбросит виртуальный счёт и историю.'; } }, 4100); return; }
  resetArm = 0; wsSend({t:'reset'});
}

// ---------- карточка агента ----------
function kpisFor(id){
  const st = S.stats || {};
  const g = (o,k)=> (o && o[k]) || 0;
  if (id==='nika') return [['Сводок', g(st.nika,'briefs')], ['Новостей', g(st.nika,'news')], ['Надёжных', g(st.nika,'news') ? Math.round(g(st.nika,'reliable')/g(st.nika,'news')*100)+'%' : '—']];
  if (id==='boris') return [['Оценок', g(st.boris,'evals')], ['Одобрено', g(st.boris,'ok') + (g(st.boris,'caution')?` +${g(st.boris,'caution')}`:'')], ['Отклонено', g(st.boris,'reject')]];
  if (id==='timur') return [['Сигналов', g(st.timur,'signals')], ['Ср. уверенность', g(st.timur,'signals') ? Math.round(g(st.timur,'confSum')/g(st.timur,'signals'))+'%' : '—'], ['Ниже порога', g(st.timur,'below')]];
  const pf = S.pf;
  return [['Ордеров', g(st.aliya,'orders')], ['Винрейт', pf.closedCount ? Math.round(pf.wins/pf.closedCount*100)+'%' : '—'], ['P&L сделок', `<span class="${(pf.realized||0)>=0?'up':'down'}">${fmtUSD(pf.realized||0,true)}</span>`]];
}
function workFor(id){
  if (id==='nika'){
    const b = S.brief; if (!b) return `<div class="empty">Сводок ещё нет.</div>`;
    const rows = [...b.items].sort((p,q)=>Math.abs(q.score)-Math.abs(p.score)).map(i=>`<tr><td><b class="mono">${i.sym}</b>${b.hot.includes(i.sym)?' <span class="pill" style="background:#3a2610;color:#ffcf8a">идея</span>':''}</td><td>${i.label}</td><td class="num ${i.sent>0.15?'up':i.sent<-0.15?'down':''}">${i.sent>=0?'+':'−'}${Math.abs(i.sent).toFixed(2)}</td><td class="num ${i.score>0?'up':'down'}">${i.score>=0?'+':'−'}${Math.abs(i.score).toFixed(2)}</td></tr>`).join('');
    const news = S.news.slice(0,6).map(n=>`<li><span class="${n.s>=0?'up':'down'}">${n.s>=0?'▲':'▼'}</span> ${n.link && /^https?:/.test(n.link) ? `<a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.titleRu || n.title)}</a>` : esc(n.titleRu || n.title)} <small style="color:var(--faint)">· ${esc(n.source)}, ${Math.round(n.rel*100)}% · ${fmtTime(n.ts)}</small></li>`).join('');
    return `<table class="tbl"><thead><tr><th>Монета</th><th>Тренд</th><th class="num">Новости</th><th class="num">Оценка</th></tr></thead><tbody>${rows}</tbody></table><div class="sec">Последние новости</div><ul class="duties" style="list-style:none;padding:0">${news||'<li class="empty">Новостей пока нет.</li>'}</ul>`;
  }
  if (id==='boris'){
    const ev = S.evalLog.slice(0,8); if (!ev.length) return `<div class="empty">Оценок пока нет.</div>`;
    return `<table class="tbl"><thead><tr><th>Идея</th><th class="num">Риск</th><th>Вердикт</th></tr></thead><tbody>${ev.map(e=>`<tr><td><b class="mono">${e.sym}</b> <span class="side-pill ${e.dir>0?'l':'s'}">${sideRu(e.dir)}</span><br><small style="color:var(--faint)">${esc(e.reasons.join('; ')||'чисто')}</small></td><td class="num">${e.risk}</td><td><span class="pill ${e.verdict==='ok'?'up':e.verdict==='reject'?'down':''}">${VERDICT_RU[e.verdict]}</span></td></tr>`).join('')}</tbody></table>`;
  }
  if (id==='timur'){
    const sg = S.sigLog.slice(0,8); if (!sg.length) return `<div class="empty">Сигналов пока не было. Порог сейчас ${S.params.threshold}%.</div>`;
    return `<table class="tbl"><thead><tr><th>Время</th><th>Сигнал</th><th class="num">Уверенность</th></tr></thead><tbody>${sg.map(s=>`<tr><td class="mono" style="color:var(--faint)">${fmtTime(s.ts)}</td><td>${s.type==='open'?`<span class="side-pill ${s.dir>0?'l':'s'}">${sideRu(s.dir)}</span>`:'закрыть'} <b class="mono">${s.sym}</b></td><td class="num">${s.conf}%</td></tr>`).join('')}</tbody></table>`;
  }
  const o = S.orders.slice(0,8); if (!o.length) return `<div class="empty">Ордеров пока нет.</div>`;
  return `<table class="tbl"><thead><tr><th>Время</th><th>Ордер</th></tr></thead><tbody>${o.map(r=>`<tr><td class="mono" style="color:var(--faint)">${fmtTime(r.ts)}</td><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table>`;
}
const CONTROLS = {
  nika:[{k:'rumorTrust', label:'Доверие к слухам', min:0.3, max:1.6, step:0.1, fmt:v=>`×${(+v).toFixed(1)}`, hint:'Вес новостей из источников с надёжностью ниже 50%.'}],
  boris:[{k:'riskPct', label:'Риск на сделку', min:0.25, max:3, step:0.25, fmt:v=>`${(+v).toFixed(2)}% капитала`, hint:'Сколько капитала теряется, если сработает стоп.'},
         {k:'rr', label:'Тейк к стопу', min:1.2, max:3.5, step:0.1, fmt:v=>`${(+v).toFixed(1)} : 1`, hint:'Во сколько раз цель дальше стопа.'}],
  timur:[{k:'threshold', label:'Порог уверенности', min:40, max:85, step:1, fmt:v=>`${v}%`, hint:'Сигналы ниже порога до Артура не доходят.'}],
  aliya:[{k:'maxPos', label:'Максимум позиций', min:1, max:6, step:1, fmt:v=>String(v), hint:'Одновременно открытых сделок.'},
         {k:'dailyLimit', label:'Дневной лимит убытка', min:1, max:15, step:1, fmt:v=>`${v}%`, hint:'После него новые сделки до конца дня не открываются.'},
         {k:'timeStop', label:'Выход по времени', min:12, max:288, step:12, fmt:v=>`через ${v} свеч.`, hint:'Закрыть позицию, если за это время не сработали ни стоп, ни тейк.'},
         {k:'shorts', label:'Разрешить шорты', bool:true, hint:'Ставки на падение цены (только фьючерсы).'}],
};
function buildAgentPanel(){
  if (!uiReady) return;
  const id = selectedAgent, a = AG[id], el = $('#pAgent');
  const ctl = CONTROLS[id].map(c=> c.bool
    ? `<div class="ctl"><label for="p_${c.k}">${c.label}</label><label class="switch"><input type="checkbox" id="p_${c.k}" data-pk="${c.k}" ${S.params[c.k]?'checked':''}></label><div class="hint">${c.hint}</div></div>`
    : `<div class="ctl"><label for="p_${c.k}">${c.label}</label><output id="o_${c.k}">${c.fmt(S.params[c.k])}</output><input type="range" id="p_${c.k}" data-pk="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${S.params[c.k]}"><div class="hint">${c.hint}</div></div>`).join('');
  const quick = {nika:['Что сейчас на рынке?','Какой новости ты не доверяешь?','Какая монета самая горячая?'], boris:['Какие риски видишь?','Почему отклонил последнюю идею?','Не перегружен ли портфель?'], timur:['Почему такой сигнал?','Что нужно для сигнала по BTC?','Какой порог ты бы поставил?'], aliya:['Как дела у счёта?','Что с открытыми позициями?','Какая сделка была лучшей?']}[id];
  const acc = {nika:'Рустама', boris:'Джаму', timur:'Нода', aliya:'Артура'}[id], ins = {nika:'Рустамом', boris:'Джамой', timur:'Нодом', aliya:'Артуром'}[id];
  const ai = CFGC.ai
    ? `<div class="chat" id="chatLog"></div><div class="quick" id="quick">${quick.map(q=>`<button type="button">${esc(q)}</button>`).join('')}</div><form class="chatform" id="chatForm"><input id="chatIn" aria-label="Вопрос агенту" type="text" maxlength="400" placeholder="Спросите ${acc} о работе" autocomplete="off"><button class="btn btn-accent" type="submit" id="chatSend">Спросить</button></form>`
    : `<div class="ainote">Разговор с агентом включится, когда на сервере будет задан ANTHROPIC_API_KEY.</div>`;
  el.innerHTML = `<div class="ahead" style="--c:${a.color}"><img class="ava" alt="" data-aid="${id}" src="${AVA[id]}"><div><h2>${a.name}</h2><p class="role">${a.role}</p><p class="now" id="aNow">${esc(a.status)}</p></div></div>
    <ul class="duties">${a.duties.map(d=>`<li>${d}</li>`).join('')}</ul>
    <div class="kgrid" id="aK" style="margin-top:10px"></div>
    <div class="sec">Настройки<span class="note" id="profNote">профиль: ${S.profile==='custom'?'свой':(PROFILES[S.profile]||{label:''}).label.toLowerCase()}</span></div>${ctl}
    <div class="sec">Последняя работа</div><div id="aWork"></div>
    <div class="sec">Разговор с ${ins}<span class="note">через Claude</span></div>${ai}`;
  $$('[data-pk]', el).forEach(inp=>{
    const c = CONTROLS[id].find(x=>x.k===inp.dataset.pk);
    inp.addEventListener('input', ()=>{ if (!c.bool) $('#o_'+c.k).textContent = c.fmt(+inp.value); });
    inp.addEventListener('change', ()=>{ wsSend({t:'param', k:c.k, v: c.bool ? inp.checked : +inp.value}); $('#profNote').textContent = 'профиль: свой'; });
  });
  const form = $('#chatForm');
  if (form){
    renderChat(id);
    form.addEventListener('submit', e=>{ e.preventDefault(); const v = $('#chatIn').value.trim(); if (v && !chatBusy) sendChat(id, v); });
    $$('#quick button').forEach(b=>b.addEventListener('click', ()=>{ if (!chatBusy) sendChat(id, b.textContent); }));
  }
  updateAgentPanel();
}
function updateAgentPanel(){
  const id = selectedAgent, a = AG[id];
  const now = $('#aNow'); if (!now) return; if (now.textContent !== a.status) now.textContent = a.status;
  const k = kpisFor(id).map(([l,v])=>`<div><span>${l}</span><b>${v}</b></div>`).join(''); if ($('#aK').innerHTML !== k) $('#aK').innerHTML = k;
  const w = workFor(id); const wb = $('#aWork'); if (wb._h !== w){ wb.innerHTML = w; wb._h = w; }
}
function renderChat(id){
  const log = $('#chatLog'); if (!log) return; const a = AG[id];
  if (!CHATS[id].length){ log.innerHTML = `<div class="bub ai" style="--c:${a.color}">${esc({nika:'Привет! Я слежу за трендами и новостями. Спросите, что сейчас происходит на рынке.', boris:'Джама. Считаю риски и режу лишнее. Спрашивайте.', timur:'Нод на связи. Могу объяснить любой сигнал и порог.', aliya:'Артур. Исполняю сделки. Спросите про позиции или результат.'}[id])}</div>`; return; }
  log.innerHTML = CHATS[id].map(m=>`<div class="bub ${m.role==='user'?'me':'ai'}${m.err?' err':''}" style="--c:${a.color}">${esc(m.content)}</div>`).join('');
}
function sendChat(id, text){
  const a = AG[id];
  CHATS[id].push({role:'user', content:text}); renderChat(id); $('#chatIn').value = '';
  const log = $('#chatLog'); const bub = document.createElement('div'); bub.className = 'bub ai'; bub.style.setProperty('--c', a.color); bub.textContent = 'Думает…'; log.append(bub);
  chatBusy = true; $('#chatSend').disabled = true; say(a, '…', 40);
  const reqId = reqN++;
  const turns = CHATS[id].filter(m=>!m.err).slice(-8).map(m=>({role:m.role, content:m.content}));
  REQ[reqId] = m=>{
    chatBusy = false; a.bubble = null;
    if (m.error) CHATS[id].push({role:'assistant', content:m.error, err:true});
    else { CHATS[id].push({role:'assistant', content:m.text}); say(a, m.text.split(/(?<=[.!?])\s/)[0].slice(0,90), 5); }
    if (selectedAgent===id && $('#chatLog')){ renderChat(id); const s = $('#chatSend'); if (s) s.disabled = false; }
  };
  if (!wsSend({t:'chat', reqId, agent:id, turns})){ REQ[reqId]({error:'Нет связи с сервером.'}); }
}
function offerProfile(prof){
  if (!PROFILES[prof]) return;
  const ol = $('#feed'); const li = document.createElement('li'); li.className = 'msg sys';
  const d = document.createElement('div'); const p = document.createElement('p'); p.textContent = `Применить профиль «${PROFILES[prof].label}», который предложила планёрка?`;
  const b = document.createElement('button'); b.type='button'; b.className='btn btn-sm btn-accent'; b.style.marginTop='6px'; b.textContent = `Применить «${PROFILES[prof].label}»`;
  b.onclick = ()=>{ wsSend({t:'profile', v:prof}); li.remove(); };
  d.append(p, b); li.append(d); ol.prepend(li);
}
