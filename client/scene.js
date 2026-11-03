// ================= SCENE: изометрическая мульт-диорама офиса =================
// Координаты пола: X — вдоль длинной стены с окнами (0..FW), Y — от этой стены к зрителю (0..FD), Z — вверх.
const SIM = {speed:1, paused:false};
const MEET = {active:false};
const REDUCED = typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const nowS = ()=>performance.now()/1000;

const FW = 430, FD = 205, WH = 108, SLAB = 12, WT = 6;
const SEAT_Y = 25, WALK_Y = 84, FRONT_Y = 70, DESK_Y = 36, DESK_D = 24, DESK_W = 62, DESK_H = 22;
const DX = [66, 154, 242, 330];
const SCENE_ASPECT = (FW+FD) / ((FW+FD)/2 + SLAB + WH + 18);
const CHS = 1.16;
const LOGO_IMG = new Image(); LOGO_IMG.onload = ()=>{ LY.cw = -1; }; LOGO_IMG.src = 'data:image/png;base64,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'; // масштаб человечков относительно мебели

// ---------- агенты ----------
const AGENT_DEFS = [
  {id:'nika',  name:'Леон',  role:'Аналитик трендов и новостей', short:'Тренды и новости', color:'#e06a22',
   look:{skin:'#f0c4a0', hair:'#5a3825', hairL:'#8a5a3c', shirt:'#d9682a', shirtL:'#f08d55', shirtD:'#a94c18', pants:'#2f3a55', shoes:'#3a2418', iris:'#5a3a22', style:'crop', acc:'phones', mug:'#f2ede4'},
   duties:['Следит за ценами, объёмами и трендами шести монет','Читает новости и оценивает надёжность источника','Каждые несколько свечей собирает сводку и отдаёт Генри']},
  {id:'boris', name:'Генри', role:'Риск-менеджер сделок',        short:'Сделки и риски',   color:'#1f9e98',
   look:{skin:'#efc19c', hair:'#c8c3cf', hairL:'#ebe8ef', shirt:'#f2f3f7', shirtL:'#ffffff', shirtD:'#c4c8d6', pants:'#4a4f68', shoes:'#2e2622', iris:'#3f6f8a', style:'bald', acc:'glasses', tie:'#1f9e98', mug:'#3a6b8c'},
   duties:['Оценивает перспективные идеи из сводки Леона','Считает стоп, тейк и размер позиции от капитала','Режет идеи с перегревом, слухами и перегрузом портфеля']},
  {id:'timur', name:'Марк', role:'Стратег сигналов',             short:'Сигналы',          color:'#6f80ea',
   look:{skin:'#c58e66', hair:'#24212b', hairL:'#3b3644', shirt:'#7383ec', shirtL:'#9aa6f6', shirtD:'#4d5cc2', pants:'#2e3044', shoes:'#1f1f28', iris:'#3b2618', style:'short', acc:'cap', cap:'#283063', capL:'#3c4790', mug:'#e8c24a'},
   duties:['Сводит тренд, новости и риск в уверенность сигнала','Пропускает к трейдеру только сигналы выше порога','Даёт команду закрыть позицию, если картина развернулась']},
  {id:'aliya', name:'Диана',  role:'Трейдер-исполнитель',          short:'Сделки',           color:'#e8487c',
   look:{skin:'#e4ad88', hair:'#221a24', hairL:'#463846', shirt:'#ea4f82', shirtL:'#f77ea4', shirtD:'#b8305f', pants:'#2e2a3a', shoes:'#4a2030', iris:'#4a2a1c', style:'long', acc:'earrings', mug:'#ffffff'},
   duties:['Открывает и закрывает позиции на демо-счёте','Ставит стоп-лосс и тейк-профит, переносит стоп в безубыток','Соблюдает лимит позиций и дневной лимит убытка']},
];
const AG = {};
AGENT_DEFS.forEach((d,i)=>{
  const dx = DX[i];
  AG[d.id] = Object.assign({}, d, {fem: d.id==='aliya', i, dx, sx:dx+40, ax:dx+75, x:dx+40, y:SEAT_Y, facing:'SW', seated:true, actions:[], queue:[], job:null,
    status:'На месте', bubble:null, emote:null, typing:false, phase:0, jumpT:0, armsUp:0, idle:0, nextIdle:rnd(8,18), cup:i!==3, holdCup:false, carry:false,
    plan:{x:dx+40, y:SEAT_Y}, exitPath:null, blinkAt:rnd(1,4), walkStatus:null});
});
const AG_LIST = AGENT_DEFS.map(d=>AG[d.id]);
let PLANES = [], selectedAgent = 'nika', hoverAgent = null, bellT = 0, flashNews = null;

function act(a, x){ a.actions.push(x); if (x.type==='walk') a.plan = {x:x.x, y:x.y}; if (x.type==='sit') a.plan = {x:a.sx, y:SEAT_Y}; }
function say(a, text, dur=2.6){ a.bubble = {text, t0:nowS(), dur}; }
function emote(a, kind, dur=1.6){ a.emote = {kind, until: nowS()+dur}; }

// маршрут: из-за стола — через проход между столами, дальше по дорожке Y=WALK_Y
function goTo(a, tx, ty, own, path){
  const p = a.plan, pts = [];
  if (p.y <= SEAT_Y + 4){ if (p.x !== a.ax) pts.push([a.ax, SEAT_Y]); pts.push([a.ax, WALK_Y]); }
  else if (a.exitPath){ pts.push(...a.exitPath); }
  else if (p.y !== WALK_Y) pts.push([p.x, WALK_Y]);
  a.exitPath = null;
  if (own){ pts.push([a.ax, WALK_Y]); pts.push([a.ax, SEAT_Y]); pts.push([a.sx, SEAT_Y]); }
  else {
    const route = path || [[tx, WALK_Y]];
    pts.push(...route); pts.push([tx, ty]);
    a.exitPath = route.slice().reverse();
  }
  for (const q of pts) act(a, {type:'walk', x:q[0], y:q[1]});
}
function returnToSeat(a){ act(a, {type:'call', fn:()=>{ a.walkStatus = 'Возвращается на место'; }}); goTo(a, 0, 0, true); act(a, {type:'sit'}); }

// ---- конвейер работы ----
function requestScan(){
  const n = AG.nika;
  if ((n.job && n.job.type==='scan') || n.queue.some(j=>j.type==='scan')) return;
  n.queue.push({type:'scan'});
}
function requestNews(item){
  const n = AG.nika;
  n.queue = n.queue.filter(j=>j.type!=='scan');
  n.queue.push({type:'news', news:item});
  flashNews = {tone:item.s, until:nowS()+3};
}
function deliver(to, payload){
  if (payload.type==='brief') to.queue = to.queue.filter(j=>j.type!=='brief');
  if (payload.type==='evals') to.queue = to.queue.filter(j=>j.type!=='evals');
  to.queue.push(payload);
}
function handoff(from, to, payload, text){
  const walk = !REDUCED && SIM.speed < 3 && !from.queue.length && !MEET.active && rand() < 0.6 && from.seated && !from.actions.length;
  if (walk){
    act(from, {type:'stand', status:`Несёт ${payloadName(payload)} → ${to.name}`});
    act(from, {type:'carry', v:true});
    goTo(from, to.sx, FRONT_Y);
    act(from, {type:'face', dir:'NE'});
    act(from, {type:'call', fn:()=>{ deliver(to, payload); say(from, text, 2.6); emote(to, 'paper', 1.2); from.carry = false; }});
    act(from, {type:'wait', dur:0.7, status:'Объясняет'});
    returnToSeat(from);
  } else {
    act(from, {type:'call', fn:()=>{ say(from, text, 2.4); spawnPlane(from, to, ()=>{ deliver(to, payload); emote(to,'paper',1); }); }});
    act(from, {type:'wait', dur:0.5, status:`${from.fem?'Отправила':'Отправил'} ${payloadName(payload)}`});
  }
}
function payloadName(p){ return p.type==='brief' ? 'сводку' : p.type==='evals' ? 'оценку рисков' : 'сигналы'; }
function endJob(a){ act(a, {type:'call', fn:()=>{ a.job = null; }}); }

function startJob(a, job){
  a.job = job;
  if (a.id==='nika'){
    const isNews = job.type==='news';
    if (isNews){ emote(a, '!', 1.8); say(a, job.news.coin ? `Новость по ${job.news.coin}!` : 'Новость по рынку!', 2); }
    act(a, {type:'work', dur: isNews?1.4:1.8, status: isNews?'Читает новость':'Сканирует рынок', done:()=>{
      const b = nikaScan(isNews ? job.news : null);
      post('nika','boris', nikaText(b, isNews?job.news:null), isNews?'news':'brief', isNews?{sym:job.news.coin, tone:job.news.s, rel:job.news.rel}:{});
      const top = b.hot[0] ? b.items.find(i=>i.sym===b.hot[0]) : null;
      const txt = top ? `Сводка: ${top.sym} ${top.score>0?'▲':'▼'}${Math.abs(top.score).toFixed(2)}` : 'Сводка: тихо';
      handoff(a, AG.boris, {type:'brief', brief:b}, txt);
      endJob(a);
    }});
  } else if (a.id==='boris'){
    act(a, {type:'work', dur:1.5, status:'Считает риски', done:()=>{
      const ev = borisEvaluate(job.brief);
      if (!ev.length && !S.pf.positions.length){ say(a, 'Идей нет, ждём', 2); a.job=null; return; }
      if (ev.length) post('boris','timur', borisText(ev), 'risk');
      const okc = ev.filter(e=>e.verdict!=='reject');
      const txt = ev.length ? ev.slice(0,2).map(e=>`${e.sym} риск ${e.risk}${e.verdict==='reject'?' ✗':' ✓'}`).join(' · ') : 'Позиции в норме';
      if (!okc.length && !S.pf.positions.length){ say(a, txt, 2.4); a.job=null; return; }
      handoff(a, AG.timur, {type:'evals', brief:job.brief, evals:ev}, txt);
      endJob(a);
    }});
  } else if (a.id==='timur'){
    act(a, {type:'work', dur:1.1, status:'Формирует сигналы', done:()=>{
      const res = timurSignals(job.brief, job.evals);
      if (job.evals.length || res.sigs.length) post('timur','aliya', timurText(res, job.evals), 'signal');
      if (!res.sigs.length){ if (job.evals.length) say(a, res.best ? `Слабо: ${res.best}% < ${S.params.threshold}%` : 'Сигналов нет', 2.2); a.job=null; return; }
      const s = res.sigs[0];
      const txt = s.type==='open' ? `${sideRu(s.dir)} ${s.sym} ${s.conf}%` : `Закрыть ${s.sym}`;
      handoff(a, AG.aliya, {type:'signals', sigs:res.sigs}, txt);
      endJob(a);
    }});
  } else if (a.id==='aliya'){
    act(a, {type:'work', dur: job.approved?0.6:0.9, status:'Исполняет ордера', done:()=>{
      const out = aliyaExecute(job.sigs, !!job.approved);
      for (const r of out) if (!r.silent) post('aliya', null, r.text, r.kind==='queued'?'signal':'trade');
      const main = out.find(r=>r.kind==='open') || out.find(r=>r.kind==='close') || out[0];
      if (main){
        if (main.kind==='open'){ say(a, `Открыла ${sideRu(main.pos.dir)} ${main.pos.sym}`, 2.6); emote(a,'!',1); }
        else if (main.kind==='close'){ say(a, `Закрыла ${main.c.sym}: ${fmtUSD(main.c.pnl,true)}`, 2.8); react(a, main.c); }
        else if (main.kind==='queued'){ say(a, 'Жду вашего решения', 2.8); }
        else say(a, main.text.replace(/^Пропускаю /,'Пропуск: ').slice(0,46), 2.6);
      }
      a.job = null;
    }});
  }
}
function react(a, c){
  if (c.pnl > 0){ emote(a, '$', 2); a.jumpT = 0.7; bellT = 1.2; }
  else emote(a, 'drop', 2);
}
function approvePending(id, ok){
  const p = S.pending.find(x=>x.id===id); if (!p) return;
  S.pending = S.pending.filter(x=>x!==p);
  if (ok){ AG.aliya.queue.unshift({type:'signals', sigs:[p], approved:true}); post('aliya', null, `Принято: исполняю ${sideRu(p.dir)} ${p.sym}.`, 'trade'); }
  else post('aliya', null, `Отклонено вами: ${sideRu(p.dir)} ${p.sym}.`, 'signal');
  emit('pending');
}

// ---- самолётики ----
function spawnPlane(from, to, done){
  const fx = from.seated ? from.sx-4 : from.x, fy = from.seated ? SEAT_Y+6 : from.y;
  PLANES.push({x0:fx, y0:fy, z0:from.seated?40:38, x1:to.sx-8, y1:SEAT_Y+8, z1:34, t:0, dur:0.95, done});
}

// ---- обновление ----
function faceFrom(dx, dy){ return Math.abs(dx) > Math.abs(dy) ? (dx>0?'SE':'NW') : (dy>0?'SW':'NE'); }
function updateScene(dt){
  const t = nowS();
  const k = SIM.paused ? 0 : 1;
  const work = dt*SIM.speed*k, walk = dt*Math.min(SIM.speed,3)*k;
  for (const a of AG_LIST){
    if (a.jumpT>0) a.jumpT = Math.max(0, a.jumpT-dt);
    if (a.armsUp>0) a.armsUp = Math.max(0, a.armsUp-dt);
    if (t > a.blinkAt + 0.14) a.blinkAt = t + rnd(2,5);
    a.walking = false;
    let guard = 0;
    while (guard++ < 6){
      const x = a.actions[0];
      if (!x){
        a.typing = a.seated && !SIM.paused && (Math.sin(t*0.7 + a.i*2) > 0.35);
        if (!SIM.paused && !MEET.active && a.queue.length){ a.idle = 0; startJob(a, a.queue.shift()); continue; }
        a.status = SIM.paused ? 'Пауза' : MEET.active ? 'На планёрке' : (a.id==='aliya' && S.pending.length ? 'Ждёт вашего решения' : 'Следит за рынком');
        if (!SIM.paused && !MEET.active && a.seated && SIM.speed <= 3){
          a.idle += dt;
          if (a.idle > a.nextIdle){
            a.idle = 0; a.nextIdle = rnd(12,26);
            if (rand() < 0.28 && !(a.id==='aliya' && S.pf.positions.length>2)) coffeeTrip(a);
            else a.armsUp = 1.3;
          }
        }
        break;
      }
      if (x.status) a.status = x.status;
      if (x.type==='work'){
        a.typing = true; x.t = (x.t||0) + work;
        if (x.t >= x.dur){ a.typing = false; a.actions.shift(); x.done && x.done(); continue; }
        break;
      }
      if (x.type==='walk'){
        a.typing = false;
        const dxx = x.x - a.x, dyy = x.y - a.y, d = Math.hypot(dxx, dyy);
        const sp = 44*walk;
        if (d <= sp || d < 0.01){ a.x = x.x; a.y = x.y; a.actions.shift(); continue; }
        a.x += dxx/d*sp; a.y += dyy/d*sp;
        a.facing = faceFrom(dxx, dyy);
        a.phase += sp*0.34; a.walking = sp > 0;
        a.status = a.walkStatus || 'Идёт';
        break;
      }
      if (x.type==='wait'){ x.t = (x.t||0)+walk; if (x.t >= x.dur){ a.actions.shift(); continue; } break; }
      if (x.type==='waitUntil'){ if (x.fn()){ a.actions.shift(); continue; } a.status = x.status || a.status; break; }
      a.actions.shift();
      if (x.type==='stand'){ a.seated = false; a.x = a.sx; a.y = SEAT_Y; a.walkStatus = x.status || null; }
      else if (x.type==='sit'){ a.walkStatus = null; a.seated = true; a.x = a.sx; a.y = SEAT_Y; a.facing = 'SW'; }
      else if (x.type==='face'){ a.facing = x.dir; }
      else if (x.type==='carry'){ a.carry = x.v; }
      else if (x.type==='call'){ x.fn(); }
    }
  }
  for (const p of PLANES){ p.t += walk/p.dur; if (p.t >= 1 && !p.fired){ p.fired = true; p.done(); } }
  PLANES = PLANES.filter(p=>p.t < 1);
  if (bellT>0) bellT = Math.max(0, bellT-dt);
}
function coffeeTrip(a){
  act(a, {type:'stand', status:'Идёт за кофе'});
  goTo(a, 36, 104);
  act(a, {type:'face', dir:'NW'});
  act(a, {type:'wait', dur:2.6, status:'Пьёт кофе'});
  act(a, {type:'call', fn:()=>{ a.holdCup = true; a.cup = false; }});
  returnToSeat(a);
  act(a, {type:'call', fn:()=>{ a.holdCup = false; a.cup = true; }});
}
const TABLE = {x:220, y:148, r:26};
const MEET_SPOTS = {
  nika:  {x:183, y:148, f:'SE'},
  boris: {x:220, y:111, f:'SW'},
  timur: {x:257, y:148, f:'NW'},
  aliya: {x:220, y:186, f:'NE', path:[[268, WALK_Y],[268, 186]]},
};
function gatherMeeting(){
  MEET.active = true;
  for (const a of AG_LIST){
    const m = MEET_SPOTS[a.id];
    act(a, {type:'call', fn:()=>{ if (a.seated){ a.seated=false; a.x=a.sx; a.y=SEAT_Y; } a.walkStatus='Идёт на планёрку'; }});
    goTo(a, m.x, m.y, false, m.path);
    act(a, {type:'face', dir:m.f});
    act(a, {type:'waitUntil', fn:()=>!MEET.active, status:'На планёрке'});
    returnToSeat(a);
  }
}
function endMeeting(){ MEET.active = false; }
function resetScene(){
  PLANES = []; MEET.active = false;
  for (const a of AG_LIST){ Object.assign(a, {x:a.sx, y:SEAT_Y, seated:true, facing:'SW', actions:[], queue:[], job:null, bubble:null, emote:null, carry:false, holdCup:false, plan:{x:a.sx,y:SEAT_Y}, exitPath:null}); }
}

// ================= ОТРИСОВКА =================
let LY = {cw:0, ch:0, dpr:1, s:1, ox:0, oy:0};
let STATIC = null, SPRITES = [], HITS = [];
function P(X, Y, Z=0){ return [LY.ox + (X-Y)*LY.s, LY.oy + (X+Y)*LY.s*0.5 - Z*LY.s]; }

// цвета
function hx(c){ c = c.replace('#',''); if (c.length===3) c = c.split('').map(x=>x+x).join(''); const n = parseInt(c,16); return [n>>16&255, n>>8&255, n&255]; }
function toHex(a){ return '#'+a.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }
function mix(c1, c2, t){ const a = hx(c1), b = hx(c2); return toHex(a.map((v,i)=>v+(b[i]-v)*t)); }
const lt = (c,t)=>mix(c,'#fff8ee',t), dk = (c,t)=>mix(c,'#20131f',t);
function rgba(c, a){ const v = hx(c); return `rgba(${v[0]},${v[1]},${v[2]},${a})`; }

// примитивы
function poly(c, pts){ c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i=1;i<pts.length;i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); }
function vgrad(c, pts, top, bot){ let y0 = Infinity, y1 = -Infinity; for (const p of pts){ y0 = Math.min(y0,p[1]); y1 = Math.max(y1,p[1]); } const g = c.createLinearGradient(0,y0,0,y1||y0+1); g.addColorStop(0,top); g.addColorStop(1,bot); return g; }
function face(c, pts3, col, o={}){
  const pts = pts3.map(p=>P(p[0],p[1],p[2]));
  poly(c, pts);
  c.fillStyle = o.flat ? col : vgrad(c, pts, lt(col, o.hl ?? 0.05), dk(col, o.sh ?? 0.07));
  c.fill();
  if (o.round){ c.lineJoin='round'; c.lineWidth = o.round*LY.s; c.strokeStyle = c.fillStyle; c.stroke(); }
  return pts;
}
function box(c, x, y, z, dx, dy, dz, col, o={}){
  const top = o.top || lt(col, 0.10), left = o.left || col, right = o.right || dk(col, 0.20);
  const r = o.round || 0;
  face(c, [[x+dx,y,z],[x+dx,y+dy,z],[x+dx,y+dy,z+dz],[x+dx,y,z+dz]], right, {round:r, hl:0.04, sh:0.10});
  face(c, [[x,y+dy,z],[x+dx,y+dy,z],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]], left, {round:r, hl:0.06, sh:0.08});
  face(c, [[x,y,z+dz],[x+dx,y,z+dz],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]], top, {round:r, hl:0.03, sh:0.0});
  if (o.edge !== false){
    const a = P(x,y+dy,z+dz), b = P(x+dx,y+dy,z+dz), d = P(x+dx,y,z+dz);
    c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]); c.lineTo(d[0],d[1]);
    c.strokeStyle = rgba('#ffffff', o.edgeA ?? 0.22); c.lineWidth = Math.max(0.6, 0.35*LY.s); c.lineJoin='round'; c.stroke();
  }
}
function softShadow(c, x, y, dx, dy, alpha=0.32, blur=7){
  const pts = [P(x,y),P(x+dx,y),P(x+dx,y+dy),P(x,y+dy)];
  c.save(); c.shadowColor = `rgba(45,25,35,${alpha})`; c.shadowBlur = blur*LY.s; c.shadowOffsetX = 9000;
  c.translate(-9000, 0); poly(c, pts); c.fillStyle = '#000'; c.fill(); c.restore();
}
function ellipseShadow(c, x, y, r, alpha=0.3, blur=6){
  const [cx, cy] = P(x,y);
  c.save(); c.shadowColor = `rgba(45,25,35,${alpha})`; c.shadowBlur = blur*LY.s; c.shadowOffsetX = 9000; c.translate(-9000,0);
  c.beginPath(); c.ellipse(cx, cy, r*1.414*LY.s, r*0.707*LY.s, 0, 0, Math.PI*2); c.fillStyle='#000'; c.fill(); c.restore();
}
function disc(c, x, y, z, r, col){ const [cx,cy] = P(x,y,z); c.beginPath(); c.ellipse(cx, cy, r*1.414*LY.s, r*0.707*LY.s, 0, 0, Math.PI*2); c.fillStyle = col; c.fill(); }
function cyl(c, x, y, z, r, h, col, o={}){
  const s = LY.s, [cx, cy0] = P(x,y,z), cy1 = cy0 - h*s, rx = r*1.414*s, ry = r*0.707*s;
  const g = c.createLinearGradient(cx-rx,0,cx+rx,0); g.addColorStop(0, lt(col,0.12)); g.addColorStop(0.55, col); g.addColorStop(1, dk(col,0.22));
  c.beginPath(); c.ellipse(cx, cy0, rx, ry, 0, 0, Math.PI); c.lineTo(cx-rx, cy1); c.ellipse(cx, cy1, rx, ry, 0, Math.PI, 0, true); c.closePath(); c.fillStyle = g; c.fill();
  c.beginPath(); c.ellipse(cx, cy1, rx, ry, 0, 0, Math.PI*2); c.fillStyle = o.top || lt(col,0.18); c.fill();
}
// плоскости для надписей и экранов
function planeY(c, X, Y, Z){ const [px,py] = P(X,Y,Z); c.translate(px,py); c.transform(LY.s, LY.s/2, 0, LY.s, 0, 0); } // u → +X, w → вниз
function planeX(c, X, Y, Z){ const [px,py] = P(X,Y,Z); c.translate(px,py); c.transform(LY.s, -LY.s/2, 0, LY.s, 0, 0); } // u → −Y, w → вниз
function rrect(c, x, y, w, h, r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }

// ---------- статичный слой: пол, стены, окна ----------
function wainscot(c, plane, len){
  // нижние панели из тёмного дерева, рейка и плинтус
  c.save(); if (plane==='A') planeY(c, 0, 0, 34); else planeX(c, 0, FD, 34);
  const g = c.createLinearGradient(0, 0, 0, 34); g.addColorStop(0, '#5a2f1e'); g.addColorStop(1, '#3d1f14'); c.fillStyle = g; c.fillRect(0, 0, len, 34);
  c.fillStyle = '#7a4630'; c.fillRect(0, 0, len, 2.2); c.fillStyle = 'rgba(214,178,90,.55)'; c.fillRect(0, 2.2, len, 0.35);
  c.fillStyle = '#2a140c'; c.fillRect(0, 30, len, 4);
  for (let u = 5; u + 26 < len; u += 32){
    rrect(c, u, 6, 26, 21, 0.8); c.fillStyle = 'rgba(0,0,0,.12)'; c.fill();
    c.strokeStyle = 'rgba(255,214,170,.16)'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(u, 27); c.lineTo(u, 6); c.lineTo(u+26, 6); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.moveTo(u+26, 6); c.lineTo(u+26, 27); c.lineTo(u, 27); c.stroke();
    rrect(c, u+3, 9, 20, 15, 0.6); c.strokeStyle = 'rgba(255,214,170,.08)'; c.stroke();
  }
  c.restore();
}
function crown(c, plane, len){
  c.save(); if (plane==='A') planeY(c, 0, 0, WH); else planeX(c, 0, FD, WH);
  const g = c.createLinearGradient(0, 0, 0, 6); g.addColorStop(0, '#6a3a24'); g.addColorStop(1, '#3a1d12'); c.fillStyle = g; c.fillRect(0, 0, len, 6);
  c.fillStyle = 'rgba(214,178,90,.6)'; c.fillRect(0, 5.6, len, 0.4); c.restore();
}
function pictureLight(c, u, w, z){
  c.save(); planeX(c, 0, u, z); c.fillStyle = '#a8843a'; rrect(c, 0, 0, w, 1.8, 0.8); c.fill(); c.fillStyle = '#e2c272'; c.fillRect(0.6, 0.3, w-1.2, 0.5);
  c.fillRect(w/2-0.4, -3, 0.8, 3); c.restore();
}
function buildStatic(){
  const {cw, ch, dpr, s} = LY;
  STATIC = document.createElement('canvas'); STATIC.width = Math.round(cw*dpr); STATIC.height = Math.round(ch*dpr);
  const c = STATIC.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0);
  const bgG = c.createRadialGradient(cw*0.5, ch*0.55, 10, cw*0.5, ch*0.55, Math.max(cw,ch)*0.75);
  bgG.addColorStop(0,'#26304f'); bgG.addColorStop(1,'#11152a'); c.fillStyle = bgG; c.fillRect(0,0,cw,ch);
  c.save(); c.shadowColor='rgba(3,4,12,.65)'; c.shadowBlur = 40*s/1.2; c.shadowOffsetY = 18*s/1.2;
  poly(c, [P(-WT,-WT,-SLAB),P(FW,-WT,-SLAB),P(FW,FD,-SLAB),P(-WT,FD,-SLAB)]); c.fillStyle='#000'; c.fill(); c.restore();
  // плита: тёмное дерево
  face(c, [[FW,-WT,-SLAB],[FW,FD,-SLAB],[FW,FD,0],[FW,-WT,0]], '#3b2418', {hl:0.08, sh:0.25});
  face(c, [[-WT,FD,-SLAB],[FW,FD,-SLAB],[FW,FD,0],[-WT,FD,0]], '#4a2d1e', {hl:0.08, sh:0.22});
  face(c, [[FW,-WT,-3],[FW,FD,-3],[FW,FD,0],[FW,-WT,0]], '#6a4430', {flat:true});
  face(c, [[-WT,FD,-3],[FW,FD,-3],[FW,FD,0],[-WT,FD,0]], '#784e38', {flat:true});
  // пол: тёмный орех
  c.save();
  poly(c, [P(0,0),P(FW,0),P(FW,FD),P(0,FD)]); c.clip();
  c.save(); const [ox,oy] = P(0,0); c.translate(ox,oy); c.transform(s, s/2, -s, s/2, 0, 0);
  c.fillStyle = '#4a2d1d'; c.fillRect(0,0,FW,FD);
  const woods = ['#6a432c','#613c27','#71482f','#5c3925','#67412b'];
  for (let y=0, r=0; y<FD; y+=9, r++){
    let x = -((r*37)%60); let k = r;
    while (x < FW){ const len = 58 + ((r*13 + x)%3)*16; c.fillStyle = woods[(k++)%woods.length]; c.fillRect(x, y, len-0.35, 8.75); x += len; }
  }
  c.globalAlpha = 0.07; c.fillStyle = '#ffe2bf'; for (let y=0; y<FD; y+=9) c.fillRect(0, y+0.3, FW, 0.45); c.globalAlpha = 1;
  // ковровая дорожка под рабочими местами: бордо с золотой каймой
  rrect(c, 46, 4, FW-50, 72, 2.5); c.fillStyle = '#561c23'; c.fill();
  rrect(c, 49, 7, FW-56, 66, 1.8); c.strokeStyle = '#c29a4a'; c.lineWidth = 1.2; c.stroke();
  rrect(c, 52.5, 10.5, FW-63, 59, 1.2); c.strokeStyle = 'rgba(194,154,74,.45)'; c.lineWidth = 0.5; c.stroke();
  for (let x=62, i=0; x<FW-14; x+=15, i++) for (let y=17, j=0; y<66; y+=12.5, j++){
    c.beginPath(); c.moveTo(x, y-3.4); c.lineTo(x+4, y); c.lineTo(x, y+3.4); c.lineTo(x-4, y); c.closePath(); c.fillStyle = (i+j)%2 ? 'rgba(28,40,78,.75)' : 'rgba(120,40,40,.75)'; c.fill();
    c.beginPath(); c.arc(x, y, 0.9, 0, Math.PI*2); c.fillStyle = 'rgba(214,174,92,.65)'; c.fill();
  }
  c.fillStyle = 'rgba(236,224,196,.55)'; for (let y=5; y<75; y+=1.6){ c.fillRect(43.6, y, 2.4, 0.5); c.fillRect(FW-4, y, 2.4, 0.5); }
  // восточный ковёр под столом переговоров
  const rug = [[50,46,'#b8913f'],[47.5,43.5,'#1e2b4f'],[41,37.5,'#7a2028'],[38.5,35.2,'#1e2b4f'],[16,15,'#7a2028'],[13,12,'#b8913f'],[10.5,9.6,'#1e2b4f']];
  for (const [rx, ry, col] of rug){ c.beginPath(); c.ellipse(TABLE.x, TABLE.y, rx, ry, 0, 0, Math.PI*2); c.fillStyle = col; c.fill(); }
  c.save(); c.translate(TABLE.x, TABLE.y);
  for (let k=0; k<16; k++){ c.rotate(Math.PI/8); c.beginPath(); c.ellipse(26, 0, 6.5, 2.6, 0, 0, Math.PI*2); c.fillStyle = k%2 ? 'rgba(184,145,63,.55)' : 'rgba(150,60,55,.55)'; c.fill(); }
  c.restore();
  c.beginPath(); c.ellipse(TABLE.x, TABLE.y, 44.5, 40.8, 0, 0, Math.PI*2); c.setLineDash([1.4,1.6]); c.strokeStyle = 'rgba(214,178,90,.7)'; c.lineWidth = 0.6; c.stroke(); c.setLineDash([]);
  // тени у стен
  let g2 = c.createLinearGradient(0,0,0,18); g2.addColorStop(0,'rgba(10,8,20,.40)'); g2.addColorStop(1,'rgba(10,8,20,0)'); c.fillStyle = g2; c.fillRect(0,0,FW,18);
  g2 = c.createLinearGradient(0,0,18,0); g2.addColorStop(0,'rgba(10,8,20,.40)'); g2.addColorStop(1,'rgba(10,8,20,0)'); c.fillStyle = g2; c.fillRect(0,0,18,FD);
  c.restore();
  const warm = c.createRadialGradient(...P(FW*0.45, FD*0.45), 10, ...P(FW*0.45, FD*0.45), FW*s*0.9);
  warm.addColorStop(0,'rgba(255,206,140,.12)'); warm.addColorStop(1,'rgba(255,206,140,0)'); c.fillStyle = warm; c.fillRect(0,0,cw,ch);
  c.restore();
  // стены: тёмно-синие с деревянными панелями
  const NAVY = '#1c2b4b';
  face(c, [[0,0,0],[0,FD,0],[0,FD,WH],[0,0,WH]], dk(NAVY,0.04), {hl:0.07, sh:0.12});
  face(c, [[0,0,0],[FW,0,0],[FW,0,WH],[0,0,WH]], NAVY, {hl:0.08, sh:0.14});
  c.save(); planeY(c, 0, 0, WH); c.globalAlpha = 0.06; c.fillStyle = '#ffffff'; for (let u=8; u<FW; u+=8) c.fillRect(u, 0, 0.35, WH-34); c.restore();
  c.save(); planeX(c, 0, FD, WH); c.globalAlpha = 0.05; c.fillStyle = '#ffffff'; for (let u=8; u<FD; u+=8) c.fillRect(u, 0, 0.35, WH-34); c.restore();
  wainscot(c, 'A', FW); wainscot(c, 'B', FD);
  crown(c, 'A', FW); crown(c, 'B', FD);
  c.save(); const [cx0] = P(0,0,WH/2); const cg = c.createLinearGradient(cx0-30*s, 0, cx0+30*s, 0); cg.addColorStop(0,'rgba(5,8,20,0)'); cg.addColorStop(0.5,'rgba(5,8,20,.28)'); cg.addColorStop(1,'rgba(5,8,20,0)');
  poly(c, [P(0,0,0),P(0,0,WH),P(26,0,WH),P(26,0,0)]); c.fillStyle = cg; c.fill(); c.restore();
  // окна
  drawWindow(c, 34, 112, 40, 96, false);
  drawWindow(c, 336, 414, 40, 96, true);
  // табло в латунной раме
  c.save(); planeY(c, 128, 0, WH-4); rrect(c, -1, -1, 196, 17, 2.5); const bg2 = c.createLinearGradient(0,0,0,17); bg2.addColorStop(0,'#d8b25a'); bg2.addColorStop(1,'#8a6a2a'); c.fillStyle = bg2; c.fill();
  rrect(c, 2, 2, 190, 11, 1.5); c.fillStyle = '#120c0a'; c.fill(); c.restore();
  // экран в раме из тёмного дерева
  c.save(); planeY(c, 170, 0, 82); c.shadowColor='rgba(0,0,0,.45)'; c.shadowBlur = 6*s; c.shadowOffsetY = 3*s; rrect(c, -1.5, -1.5, 127, 61, 3); c.fillStyle = '#3a1d12'; c.fill(); c.shadowColor='transparent';
  c.strokeStyle = 'rgba(214,178,90,.7)'; c.lineWidth = 0.6; rrect(c, 0.8, 0.8, 122.4, 56.4, 2); c.stroke(); c.restore();
  // доска сигналов: зелёная кожа в латунной раме
  c.save(); planeY(c, 124, 0, 80); c.shadowColor='rgba(0,0,0,.4)'; c.shadowBlur = 5*s; c.shadowOffsetY = 2*s; rrect(c, 0, 0, 40, 46, 2); const fr = c.createLinearGradient(0,0,0,46); fr.addColorStop(0,'#d8b25a'); fr.addColorStop(1,'#8a6a2a'); c.fillStyle = fr; c.fill(); c.shadowColor='transparent';
  rrect(c, 2.2, 2.2, 35.6, 41.6, 1.2); c.fillStyle = '#21402f'; c.fill();
  c.fillStyle = 'rgba(255,255,255,.04)'; for (let i=0;i<60;i++) c.fillRect(3+((i*37)%34), 3+((i*23)%39), 0.6, 0.6);
  c.font = `700 4px "Golos Text", sans-serif`; c.fillStyle = '#d9b867'; c.fillText('СИГНАЛЫ', 9, 7.5); c.restore();
  // часы в латуни
  c.save(); planeY(c, 300, 0, 76); c.shadowColor='rgba(0,0,0,.45)'; c.shadowBlur = 5*s; c.shadowOffsetY = 2*s; c.beginPath(); c.arc(12, 12, 11.2, 0, Math.PI*2);
  const brass = c.createLinearGradient(0, 0, 24, 24); brass.addColorStop(0,'#ecd08a'); brass.addColorStop(1,'#8a6a2a'); c.fillStyle = brass; c.fill(); c.shadowColor='transparent';
  c.beginPath(); c.arc(12, 12, 9.2, 0, Math.PI*2); c.fillStyle = '#f6efdc'; c.fill();
  c.fillStyle = '#2a2230'; for (let h=0;h<12;h++){ const an = h/12*Math.PI*2; c.beginPath(); c.arc(12+Math.sin(an)*7.6, 12-Math.cos(an)*7.6, h%3===0?0.8:0.45, 0, Math.PI*2); c.fill(); } c.restore();
  // стена B: логотип JA Capital с подсветкой
  pictureLight(c, 122, 40, 99.5);
  if (LOGO_IMG.complete && LOGO_IMG.naturalWidth){
    c.save(); planeX(c, 0, 132, 95); c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 2.2*s; c.shadowOffsetX = 0.8*s; c.shadowOffsetY = 1.2*s;
    const lw = 60, lh = lw * LOGO_IMG.naturalHeight / LOGO_IMG.naturalWidth; c.drawImage(LOGO_IMG, 0, 0, lw, lh); c.restore();
  }
  // картина в золочёной раме над диваном
  c.save(); planeX(c, 0, 197, 86); c.shadowColor='rgba(0,0,0,.5)'; c.shadowBlur = 5*s; c.shadowOffsetY = 2*s;
  rrect(c, 0, 0, 48, 35, 1.2); const gf = c.createLinearGradient(0,0,48,35); gf.addColorStop(0,'#f0d68f'); gf.addColorStop(0.5,'#b8913f'); gf.addColorStop(1,'#7a5a22'); c.fillStyle = gf; c.fill(); c.shadowColor='transparent';
  c.save(); c.beginPath(); c.rect(4, 4, 40, 27); c.clip();
  const sk = c.createLinearGradient(0,4,0,31); sk.addColorStop(0,'#33476e'); sk.addColorStop(0.6,'#c99363'); sk.addColorStop(1,'#e6b77a'); c.fillStyle = sk; c.fillRect(4,4,40,27);
  c.fillStyle = '#4b5a3a'; c.beginPath(); c.moveTo(4,24); c.quadraticCurveTo(16,17,28,22); c.quadraticCurveTo(36,25,44,20); c.lineTo(44,31); c.lineTo(4,31); c.fill();
  c.fillStyle = '#2f3e28'; c.beginPath(); c.moveTo(4,28); c.quadraticCurveTo(20,23,44,27); c.lineTo(44,31); c.lineTo(4,31); c.fill();
  c.fillStyle = '#1f2a1c'; c.fillRect(33,15,0.9,9); c.beginPath(); c.ellipse(33.4,14.5,4.2,3.6,0,0,Math.PI*2); c.fill();
  c.fillStyle = '#e8d9b0'; c.fillRect(12,19.5,5,2.6); c.beginPath(); c.moveTo(11.4,19.6); c.lineTo(14.5,17.6); c.lineTo(17.6,19.6); c.fill();
  c.restore(); c.strokeStyle = 'rgba(60,40,10,.5)'; c.lineWidth = 0.5; c.strokeRect(4,4,40,27); c.restore();
  pictureLight(c, 187, 28, 90);
  // торцы и шапки стен
  face(c, [[-WT,-WT,WH],[FW,-WT,WH],[FW,0,WH],[0,0,WH],[0,FD,WH],[-WT,FD,WH]], '#eadfca', {flat:true});
  face(c, [[FW,-WT,0],[FW,0,0],[FW,0,WH],[FW,-WT,WH]], '#2a3554', {hl:0.04, sh:0.1});
  face(c, [[-WT,FD,0],[0,FD,0],[0,FD,WH],[-WT,FD,WH]], '#33406a', {hl:0.04, sh:0.1});
  face(c, [[FW,-WT,0],[FW,0,0],[FW,0,34],[FW,-WT,34]], '#3d1f14', {flat:true});
  face(c, [[-WT,FD,0],[0,FD,0],[0,FD,34],[-WT,FD,34]], '#4a2618', {flat:true});
  c.beginPath(); const e1 = P(FW,0,WH), e2 = P(0,0,WH), e3 = P(0,FD,WH); c.moveTo(...e1); c.lineTo(...e2); c.lineTo(...e3); c.strokeStyle = 'rgba(214,178,90,.45)'; c.lineWidth = 0.8; c.stroke();
}
function drawWindow(c, u0, u1, z0, z1, tower){
  const s = LY.s, w = u1-u0, h = z1-z0;
  c.save(); planeY(c, u0, 0, z1);
  c.shadowColor='rgba(0,0,0,.4)'; c.shadowBlur = 4*s; c.shadowOffsetY = 2*s;
  rrect(c, -3, -3, w+6, h+6, 1.5); c.fillStyle = '#4a2618'; c.fill(); c.shadowColor='transparent';
  const g = c.createLinearGradient(0,0,0,h); g.addColorStop(0,'#24305e'); g.addColorStop(0.55,'#6e4f84'); g.addColorStop(0.85,'#d98c62'); g.addColorStop(1,'#f2bd7c');
  c.fillStyle = g; c.fillRect(0,0,w,h);
  c.fillStyle = 'rgba(255,255,255,.75)'; for (let i=0;i<10;i++) c.fillRect(((i*31+u0)%w), ((i*17)%(h*0.35)), 0.6, 0.6);
  if (!tower){ c.beginPath(); c.arc(w*0.24, h*0.2, 4.2, 0, Math.PI*2); c.fillStyle = '#fff4d6'; c.fill(); c.beginPath(); c.arc(w*0.24+1.8, h*0.2-0.9, 3.6, 0, Math.PI*2); c.fillStyle = '#2c3566'; c.fill(); }
  let bx = 0, seed = tower ? 11 : 3;
  while (bx < w){
    seed = (seed*9301+49297)%233280; const bw = 5 + seed%8; seed = (seed*9301+49297)%233280; const bh = 9 + seed%(h*0.5|0);
    c.fillStyle = (seed%2) ? '#352a52' : '#3f3060'; c.fillRect(bx, h-bh, bw, bh);
    for (let wy=h-bh+2.5; wy<h-1.5; wy+=3) for (let wx=bx+1.2; wx<bx+bw-1.2; wx+=2.2){ seed=(seed*9301+49297)%233280; if (seed%4===0){ c.fillStyle = seed%3 ? '#ffd27a' : '#ffe9b8'; c.fillRect(wx, wy, 1, 1.2); } }
    bx += bw + 0.8;
  }
  if (tower){ const tx = w*0.62; c.fillStyle = '#261d3d'; c.fillRect(tx-0.7, 6, 1.4, h-6); c.beginPath(); c.moveTo(tx-3.5,h); c.lineTo(tx-0.8,h*0.45); c.lineTo(tx+0.8,h*0.45); c.lineTo(tx+3.5,h); c.fill(); c.beginPath(); c.ellipse(tx, h*0.36, 3.2, 2.2, 0, 0, Math.PI*2); c.fill(); }
  // переплёт из тёмного дерева
  c.fillStyle = '#4a2618'; c.fillRect(w/2-1.1, 0, 2.2, h); c.fillRect(0, h*0.5, w, 1.8);
  c.fillStyle = 'rgba(0,0,0,.25)'; for (const fx of [w*0.25, w*0.75]) c.fillRect(fx-0.4, 0, 0.8, h); c.fillRect(0, h*0.25, w, 0.7); c.fillRect(0, h*0.75, w, 0.7);
  c.fillStyle = 'rgba(255,255,255,.07)'; c.beginPath(); c.moveTo(w*0.55,0); c.lineTo(w*0.75,0); c.lineTo(w*0.35,h); c.lineTo(w*0.15,h); c.fill();
  c.restore();
  // подоконник
  face(c, [[u0-4,0,z0-2],[u1+4,0,z0-2],[u1+4,4.5,z0-2],[u0-4,4.5,z0-2]], '#6e3a25', {flat:true});
  face(c, [[u0-4,4.5,z0-3.6],[u1+4,4.5,z0-3.6],[u1+4,4.5,z0-2],[u0-4,4.5,z0-2]], '#3e1f14', {flat:true});
  // тяжёлые шторы и латунный карниз
  c.save(); planeY(c, u0-13, 0, z1+9);
  const dh = (z1+9) - (z0-18);
  for (const du of [0, w+15]){
    const dg = c.createLinearGradient(du, 0, du+11, 0);
    dg.addColorStop(0,'#3e1218'); dg.addColorStop(0.25,'#7a2430'); dg.addColorStop(0.5,'#4a161e'); dg.addColorStop(0.75,'#7a2430'); dg.addColorStop(1,'#3e1218');
    c.beginPath(); c.moveTo(du, 1.5); c.lineTo(du+11, 1.5); c.quadraticCurveTo(du+12.2, dh*0.6, du+11.6, dh); c.lineTo(du-0.6, dh); c.quadraticCurveTo(du-1.2, dh*0.6, du, 1.5); c.closePath(); c.fillStyle = dg; c.fill();
    c.fillStyle = 'rgba(214,178,90,.7)'; c.fillRect(du-0.8, dh*0.55, 12.6, 1.1);
  }
  c.fillStyle = '#b8913f'; rrect(c, -2, -0.6, w+30, 1.8, 0.9); c.fill();
  c.beginPath(); c.arc(-2, 0.3, 1.6, 0, Math.PI*2); c.arc(w+28, 0.3, 1.6, 0, Math.PI*2); c.fillStyle = '#e2c272'; c.fill();
  c.restore();
}
function sprite(minX,maxX,minY,maxY,maxZ, draw, extra){
  const corners = [];
  for (const X of [minX-10,maxX+10]) for (const Y of [minY-10,maxY+10]) for (const Z of [0,maxZ+4]) corners.push(P(X,Y,Z));
  const bx = Math.floor(Math.min(...corners.map(p=>p[0]))), by = Math.floor(Math.min(...corners.map(p=>p[1])));
  const bw = Math.ceil(Math.max(...corners.map(p=>p[0]))) - bx, bh = Math.ceil(Math.max(...corners.map(p=>p[1]))) - by;
  const cv = document.createElement('canvas'); cv.width = Math.max(1,Math.round(bw*LY.dpr)); cv.height = Math.max(1,Math.round(bh*LY.dpr));
  const c = cv.getContext('2d'); c.setTransform(LY.dpr,0,0,LY.dpr,-bx*LY.dpr,-by*LY.dpr);
  draw(c);
  return Object.assign({minX, maxX, minY, maxY, cv, bx, by, bw, bh}, extra||{});
}
function drawDesk(c, i){
  const a = AG_LIST[i], x = DX[i], y = DESK_Y;
  softShadow(c, x+1, y+1, DESK_W-2, DESK_D-1, 0.45, 6);
  const M = '#5b2f1e', ML = '#66351f', MR = '#43221a';
  box(c, x+2, y+2, 0, 16, DESK_D-4, DESK_H-2.5, M, {left:ML, right:MR, edgeA:0.12});
  for (let k=0;k<3;k++){ const z = 3 + k*5.6; face(c, [[x+3,y+DESK_D-2,z],[x+17,y+DESK_D-2,z],[x+17,y+DESK_D-2,z+0.5],[x+3,y+DESK_D-2,z+0.5]], '#2f160d', {flat:true}); const q = P(x+10, y+DESK_D-2, z+2.8); c.beginPath(); c.ellipse(q[0], q[1], 1.5*LY.s, 0.55*LY.s, 0, 0, Math.PI*2); c.fillStyle = '#d8b25a'; c.fill(); }
  box(c, x+DESK_W-5, y+2, 0, 3, DESK_D-4, DESK_H-2.5, M, {left:ML, right:MR, edgeA:0.12});
  box(c, x+18, y+DESK_D-4, 5, DESK_W-23, 1.6, DESK_H-7.5, ML, {left:'#6a3822', right:MR, edge:false});
  // столешница с зелёной кожаной вставкой
  box(c, x, y, DESK_H-2.5, DESK_W, DESK_D, 2.5, M, {top:'#6e3a25', left:'#4e2818', right:'#3a1d12', round:0.6, edgeA:0.14});
  const inl = [[x+3,y+2.6,DESK_H+0.02],[x+DESK_W-3,y+2.6,DESK_H+0.02],[x+DESK_W-3,y+DESK_D-2.6,DESK_H+0.02],[x+3,y+DESK_D-2.6,DESK_H+0.02]];
  face(c, inl, '#2c4a39', {hl:0.08, sh:0.04});
  const ip = inl.map(p=>P(p[0]+(p[0]>x+10?-1:1), p[1]+(p[1]>y+10?-1:1), p[2])); poly(c, ip); c.strokeStyle = 'rgba(214,178,90,.55)'; c.lineWidth = 0.35*LY.s; c.stroke();
  // латунная табличка с именем
  c.save(); planeY(c, x+26, y+DESK_D-2.2, 15.5); rrect(c, 0, 0, 22, 6.2, 1); const pg = c.createLinearGradient(0,0,0,6.2); pg.addColorStop(0,'#ecd08a'); pg.addColorStop(1,'#a8843a'); c.fillStyle = pg; c.fill();
  c.fillStyle = a.color; c.beginPath(); c.arc(2.6, 3.1, 1.15, 0, Math.PI*2); c.fill();
  c.font = `700 4.1px "Golos Text", sans-serif`; c.fillStyle = '#2a1a10'; c.textBaseline='middle'; c.fillText(a.name, 5, 3.3); c.restore();
  // банкирская лампа
  const lx = x+55, ly = y+6;
  disc(c, lx, ly, DESK_H, 3.2, '#8a6a2a'); cyl(c, lx, ly, DESK_H, 2.8, 1, '#b8913f');
  cyl(c, lx, ly, DESK_H+1, 0.55, 9.5, '#c9a24e');
  const [hx, hy] = P(lx-1, ly+1.5, DESK_H+11.5), sc = LY.s;
  c.save(); c.translate(hx, hy); c.rotate(Math.atan2(0.5, 1));
  c.beginPath(); c.ellipse(0, 0, 7*sc, 3.6*sc, 0, Math.PI, 0); c.closePath();
  const sg = c.createLinearGradient(0, -3.6*sc, 0, 0); sg.addColorStop(0,'#5fb37a'); sg.addColorStop(1,'#1f5a38'); c.fillStyle = sg; c.fill();
  c.beginPath(); c.ellipse(0, 0, 7*sc, 0.9*sc, 0, 0, Math.PI*2); c.fillStyle = '#fff1c4'; c.fill();
  c.fillStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.ellipse(-2.4*sc, -2.2*sc, 2.4*sc, 0.7*sc, -0.2, 0, Math.PI*2); c.fill();
  c.restore();
  // клавиатура и мышь
  box(c, a.sx-8, y+5, DESK_H, 15, 5.5, 0.9, '#2b2c34', {top:'#393a45', edge:false});
  c.fillStyle = 'rgba(255,255,255,.18)'; for (let k=0;k<6;k++){ const q = P(a.sx-6.5+k*2.2, y+7.5, DESK_H+0.95); c.fillRect(q[0]-0.6, q[1]-0.3, 1.4*LY.s/1.3, 0.7*LY.s/1.3); }
  const mp = P(a.sx+11, y+8, DESK_H+0.6); c.beginPath(); c.ellipse(mp[0], mp[1], 1.8*LY.s, 1.2*LY.s, 0, 0, Math.PI*2); c.fillStyle = '#2f3038'; c.fill();
  // бумаги
  box(c, x+22, y+11, DESK_H, 7, 9, 1.2, '#f4eedf', {edge:false});
  box(c, x+22.6, y+11.4, DESK_H+1.2, 6.4, 8.4, 0.6, '#fbf7ec', {edge:false});
  // монитор
  box(c, x+6, y+7, DESK_H, 7, 9, 0.6, '#3a3b46', {edge:false});
  box(c, x+8.4, y+10.6, DESK_H, 1.6, 1.8, 5, '#4a4b58', {edge:false});
  box(c, x+5, y+3, DESK_H+3.5, 3.2, 17, 14, '#24252e', {right:'#18191f', left:'#2e2f3a', round:0.5});
}
function drawChair(c, i){
  const sx = AG_LIST[i].sx, v = '#6a2324';
  softShadow(c, sx-6, SEAT_Y-6, 12, 12, 0.35, 5);
  box(c, sx-0.8, SEAT_Y-0.8, 0, 1.6, 1.6, 11, '#a8843a', {edge:false});
  box(c, sx-6, SEAT_Y-6, 11, 12, 12, 2.8, v, {round:1.4, edgeA:0.12});
  box(c, sx-6.5, SEAT_Y-8.8, 12, 13, 2.8, 23, v, {round:1.8, left:'#7a2a2a', edgeA:0.12});
  c.fillStyle = 'rgba(30,8,8,.55)'; for (let k=0;k<4;k++) for (let j=0;j<3;j++){ const q = P(sx-4.4+k*2.9+(j%2)*1.4, SEAT_Y-6, 19+j*4.4); c.beginPath(); c.arc(q[0], q[1], 0.42*LY.s, 0, Math.PI*2); c.fill(); }
}
function drawTable(c){
  const {x,y,r} = TABLE;
  ellipseShadow(c, x, y, r*0.75, 0.42, 8);
  cyl(c, x, y, 0, 7, 1.2, '#2e170f');
  cyl(c, x, y, 1, 2.4, 23, '#4a2618');
  const s = LY.s; const [cx, cy] = P(x, y, 24);
  const rx = r*1.414*s, ry = r*0.707*s;
  c.beginPath(); c.ellipse(cx, cy+2.2*s, rx, ry, 0, 0, Math.PI); c.lineTo(cx-rx, cy); c.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true); c.closePath(); c.fillStyle = '#3a1d12'; c.fill();
  const g = c.createRadialGradient(cx-rx*0.3, cy-ry*0.4, 4, cx, cy, rx); g.addColorStop(0,'#8a5236'); g.addColorStop(1,'#552b1b');
  c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); c.fillStyle = g; c.fill();
  c.beginPath(); c.ellipse(cx, cy, rx*0.82, ry*0.82, 0, 0, Math.PI*2); c.strokeStyle='rgba(214,178,90,.35)'; c.lineWidth = 0.7; c.stroke();
  box(c, x-8, y-10, 24, 11, 8, 0.7, '#c9ccd8', {edge:false});
  face(c, [[x-8,y-10,24.7],[x+3,y-10,24.7],[x+3,y-10,32],[x-8,y-10,32]], '#30344d', {flat:true});
  box(c, x+5, y+4, 24, 8, 6, 0.6, '#f4eedf', {edge:false});
  cyl(c, x-10, y+8, 24, 1.8, 3.4, '#f6f1e8'); cyl(c, x+12, y-6, 24, 1.6, 3.8, '#cfe0ea', {top:'#b5651d'});
}
function drawSofa(c){
  softShadow(c, 2, 146, 30, 56, 0.42, 7);
  const v = '#8a4a26';
  box(c, 3, 149, 1.5, 26, 50, 9.5, v, {round:1.6, edgeA:0.14});
  box(c, 2, 146, 1.5, 8, 56, 27, dk(v,0.10), {round:2.4, edgeA:0.14});
  box(c, 3, 145.5, 1.5, 27, 7, 19, lt(v,0.02), {round:3.2, edgeA:0.16});
  box(c, 3, 195.5, 1.5, 27, 7, 19, lt(v,0.02), {round:3.2, edgeA:0.16});
  box(c, 10, 153, 11, 19, 21, 3.8, lt(v,0.10), {round:1.8, edgeA:0.12});
  box(c, 10, 175, 11, 19, 20, 3.8, lt(v,0.10), {round:1.8, edgeA:0.12});
  c.fillStyle = 'rgba(40,16,6,.6)';
  for (let row=0; row<3; row++) for (let yy=150; yy<=197; yy+=5.5){ const q = P(10, yy + (row%2)*2.75, 16.5 + row*4.4); c.beginPath(); c.arc(q[0], q[1], 0.5*LY.s, 0, Math.PI*2); c.fill(); }
  c.fillStyle = '#d8b25a'; for (const ay of [152.5, 202.5]) for (let xx=5; xx<29; xx+=2.4){ const q = P(xx, ay, 3.5); c.beginPath(); c.arc(q[0], q[1], 0.36*LY.s, 0, Math.PI*2); c.fill(); }
  box(c, 10, 157, 15, 4, 10, 9, '#1e2b4f', {round:2.4});
  box(c, 10, 184, 15, 4, 9, 8, '#7a2028', {round:2.4});
}
function drawLamp(c){
  ellipseShadow(c, 12, 138, 5, 0.3, 4);
  cyl(c, 12, 138, 0, 4, 1, '#8a6a2a'); cyl(c, 12, 138, 1, 0.7, 50, '#c9a24e');
  const s = LY.s, [cx, cy] = P(12, 138, 50);
  c.beginPath(); c.moveTo(cx-5*s, cy); c.lineTo(cx+5*s, cy); c.lineTo(cx+3.4*s, cy-9*s); c.lineTo(cx-3.4*s, cy-9*s); c.closePath();
  const g = c.createLinearGradient(cx-5*s,0,cx+5*s,0); g.addColorStop(0,'#fbefd2'); g.addColorStop(1,'#d9bf8c'); c.fillStyle = g; c.fill();
  c.strokeStyle = 'rgba(140,100,50,.25)'; c.lineWidth = 0.4*s; for (let k=-4;k<=4;k+=1.6){ c.beginPath(); c.moveTo(cx+k*s, cy); c.lineTo(cx+k*0.68*s, cy-9*s); c.stroke(); }
  c.beginPath(); c.ellipse(cx, cy, 5*s, 1.6*s, 0, 0, Math.PI*2); c.fillStyle = '#fff4dc'; c.fill();
}
function drawCoffee(c){
  // буфет из красного дерева, кофемашина, графин; рядом глобус
  softShadow(c, 2, 86, 20, 36, 0.4, 5);
  box(c, 2, 86, 0, 18, 32, 21, '#5b2f1e', {left:'#66351f', right:'#43221a', edgeA:0.12});
  for (const yy of [97, 108]) face(c, [[20,yy,3],[20,yy+0.5,3],[20,yy+0.5,19],[20,yy,19]], '#2f160d', {flat:true});
  for (const [yy,zz] of [[95.5,11],[98.5,11],[106.5,11],[109.5,11]]){ const q = P(20, yy, zz); c.beginPath(); c.arc(q[0], q[1], 0.6*LY.s, 0, Math.PI*2); c.fillStyle = '#e2c272'; c.fill(); }
  for (const yy of [88, 99, 110]) { c.save(); planeX(c, 20, yy+8, 18); rrect(c, 0.8, 0, 6.4, 13, 0.6); c.strokeStyle = 'rgba(255,214,170,.14)'; c.lineWidth = 0.5; c.stroke(); c.restore(); }
  box(c, 1, 85, 21, 20, 34, 2, '#6e3a25', {top:'#7a4630', edgeA:0.15});
  box(c, 5, 90, 23, 11, 11, 13, '#b9bcc9', {right:'#8f93a5', left:'#c8cbd6', round:1});
  box(c, 6, 92, 36, 9, 7, 1.5, '#2b2e44', {edge:false});
  face(c, [[16,93,30],[16,98,30],[16,98,33.5],[16,93,33.5]], '#1c1f2e', {flat:true});
  const lp = P(16, 96, 32.2); c.beginPath(); c.arc(lp[0], lp[1], 0.9*LY.s, 0, Math.PI*2); c.fillStyle = '#4fd18b'; c.fill();
  cyl(c, 13, 97, 23, 1.6, 3, '#ffffff');
  disc(c, 10, 111, 23.05, 5.2, '#cfd3da'); disc(c, 10, 111, 23.1, 4.6, '#e6e9ee');
  cyl(c, 9, 110.5, 23, 2.3, 4.2, '#c8dce8', {top:'#b5651d'}); cyl(c, 9, 110.5, 27.2, 1.1, 1.6, '#d8e6ee'); cyl(c, 9, 110.5, 28.8, 1.5, 1.2, '#e6f0f5');
  cyl(c, 12.6, 113.6, 23, 1.2, 2.2, '#d0e2ec', {top:'#b5651d'}); cyl(c, 8, 114.6, 23, 1.2, 2.2, '#d0e2ec');
  // глобус на деревянной подставке
  softShadow(c, 3, 121, 11, 10, 0.32, 4);
  const s = LY.s, base = P(8.5, 126, 0), top = P(8.5, 126, 16);
  c.strokeStyle = '#4a2618'; c.lineWidth = 1.2*s; c.lineCap = 'round';
  for (const [fx, fy] of [[4,122],[13.5,123.5],[8,131]]){ const f = P(fx, fy, 0); c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(f[0], f[1]); c.stroke(); }
  const gc = P(8.5, 126, 23); const R = 6.6*s;
  const gg = c.createRadialGradient(gc[0]-R*0.35, gc[1]-R*0.4, R*0.1, gc[0], gc[1], R); gg.addColorStop(0,'#f1dfb0'); gg.addColorStop(1,'#a8865a');
  c.beginPath(); c.arc(gc[0], gc[1], R, 0, Math.PI*2); c.fillStyle = gg; c.fill();
  c.fillStyle = 'rgba(120,88,48,.55)'; for (const [ox2, oy2, rr2, rr3] of [[-2,-2,2.4,1.6],[2.4,1.2,1.8,2.4],[-1,3,1.4,1],[3,-3.4,1.2,0.9]]){ c.beginPath(); c.ellipse(gc[0]+ox2*s, gc[1]+oy2*s, rr2*s, rr3*s, 0.4, 0, Math.PI*2); c.fill(); }
  c.strokeStyle = '#c9a24e'; c.lineWidth = 0.7*s; c.beginPath(); c.ellipse(gc[0], gc[1], R*1.12, R*1.12, 0, -1.3, 2.0); c.stroke();
  void base;
}
function drawPrinter(c){
  // клубное кожаное кресло
  softShadow(c, 372, 156, 32, 24, 0.4, 6);
  const v = '#7a3a22';
  box(c, 375, 159, 1, 24, 18, 10, v, {round:1.6, edgeA:0.14});
  box(c, 397, 157, 1, 7, 22, 27, dk(v,0.08), {round:2.6, edgeA:0.14});
  box(c, 375, 155.5, 1, 27, 5.5, 18, lt(v,0.03), {round:2.8, edgeA:0.16});
  box(c, 375, 175, 1, 27, 5.5, 18, lt(v,0.03), {round:2.8, edgeA:0.16});
  box(c, 377, 161, 11, 20, 14, 3.4, lt(v,0.12), {round:1.6, edgeA:0.12});
  c.fillStyle = '#d8b25a'; for (let xx=376; xx<402; xx+=2.4){ const q = P(xx, 180.5, 3); c.beginPath(); c.arc(q[0], q[1], 0.36*LY.s, 0, Math.PI*2); c.fill(); }
}
function drawPlant(c, x, y, big){
  const s = LY.s; ellipseShadow(c, x, y, 6, 0.34, 4);
  cyl(c, x, y, 0, big?6:5, big?10:8, '#b8913f', {top:'#3a2a1e'});
  const [cx, cy] = P(x, y, big?10:8);
  const leaves = big ? [[-6,-10,5,9,-0.5],[6,-11,5,9,0.5],[0,-16,5,10,0],[-9,-4,4,7,-1],[9,-5,4,7,1],[-3,-20,4,7,-0.2],[4,-19,4,7,0.3]] : [[-4,-7,4,7,-0.5],[4,-8,4,7,0.5],[0,-12,4,8,0],[-6,-3,3,5,-1],[6,-3,3,5,1]];
  for (const [lx,ly,rx,ry,rot] of leaves){
    c.save(); c.translate(cx+lx*s, cy+ly*s); c.rotate(rot);
    const g = c.createLinearGradient(-rx*s, -ry*s, rx*s, ry*s); g.addColorStop(0,'#7cb86c'); g.addColorStop(1,'#2c6440');
    c.beginPath(); c.ellipse(0, 0, rx*s, ry*s, 0, 0, Math.PI*2); c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(30,70,40,.45)'; c.lineWidth = 0.5*s; c.beginPath(); c.moveTo(0, ry*s*0.8); c.lineTo(0, -ry*s*0.8); c.stroke();
    c.restore();
  }
}
function drawRack(c){
  // книжный шкаф из красного дерева
  softShadow(c, 6, 2, 24, 16, 0.42, 5);
  box(c, 6, 2, 0, 24, 16, 66, '#4e2818', {right:'#3a1d12', left:'#5b2f1e', round:0.5, edgeA:0.12});
  face(c, [[8,18,3],[28,18,3],[28,18,63],[8,18,63]], '#26120b', {flat:true});
  const cols = ['#6a2324','#1e2b4f','#2c4a39','#8a6a2a','#5a3a28','#d9c9a6','#3a2a4a','#7a2028','#2a3c5e'];
  let seed = 7;
  for (const zb of [4, 19, 34, 49]){
    face(c, [[8,18,zb-1.2],[28,18,zb-1.2],[28,18,zb],[8,18,zb]], '#6a3822', {flat:true});
    let bx = 8.6;
    while (bx < 27){
      seed = (seed*9301+49297)%233280; const w = 1.1 + (seed%10)/10; seed = (seed*9301+49297)%233280; const h = 9 + (seed%35)/10;
      if (bx + w > 27.6) break;
      const col = cols[seed % cols.length];
      face(c, [[bx,18,zb],[bx+w,18,zb],[bx+w,18,zb+h],[bx,18,zb+h]], col, {hl:0.1, sh:0.06});
      face(c, [[bx,18,zb+h-1.6],[bx+w,18,zb+h-1.6],[bx+w,18,zb+h-1.2],[bx,18,zb+h-1.2]], 'rgba(214,178,90,.7)', {flat:true});
      bx += w + 0.15;
    }
  }
  box(c, 5, 1, 66, 26, 18, 2.2, '#5b2f1e', {top:'#6e3a25', edgeA:0.15});
}
function buildSprites(){
  SPRITES = [];
  for (let i=0;i<4;i++){
    const x = DX[i];
    SPRITES.push(sprite(x, x+DESK_W, DESK_Y, DESK_Y+DESK_D, 42, c=>drawDesk(c,i), {kind:'desk', i}));
    SPRITES.push(sprite(AG_LIST[i].sx-6, AG_LIST[i].sx+6, SEAT_Y-9, SEAT_Y-5.5, 36, c=>drawChair(c,i), {kind:'chair', i}));
  }
  SPRITES.push(sprite(TABLE.x-TABLE.r, TABLE.x+TABLE.r, TABLE.y-TABLE.r, TABLE.y+TABLE.r, 34, drawTable, {kind:'table'}));
  SPRITES.push(sprite(2, 30, 146, 202, 28, drawSofa, {kind:'sofa'}));
  SPRITES.push(sprite(7, 17, 133, 143, 60, drawLamp, {kind:'lamp'}));
  SPRITES.push(sprite(1, 21, 85, 133, 40, drawCoffee, {kind:'coffee'}));
  SPRITES.push(sprite(372, 404, 156, 180, 34, drawPrinter, {kind:'printer'}));
  SPRITES.push(sprite(5, 31, 1, 19, 70, drawRack, {kind:'rack'}));
  SPRITES.push(sprite(40, 52, 24, 36, 32, c=>drawPlant(c, 46, 30, true), {kind:'plant'}));
  SPRITES.push(sprite(412, 424, 120, 132, 30, c=>drawPlant(c, 418, 126, true), {kind:'plant'}));
  SPRITES.push(sprite(34, 46, 186, 198, 26, c=>drawPlant(c, 40, 192, false), {kind:'plant'}));
  SPRITES.push(sprite(336, 348, 182, 194, 26, c=>drawPlant(c, 342, 188, false), {kind:'plant'}));
}

function setLayout(cw, ch, dpr){
  const spanX = FW + FD, top = -WH - 14, bottom = (FW+FD)/2 + SLAB + 8;
  const s = Math.min(cw*0.965/spanX, ch*0.97/(bottom-top));
  LY = {cw, ch, dpr, s, ox: cw/2 - ((FW-FD)/2)*s, oy: (ch - (bottom-top)*s)/2 - top*s};
  buildStatic(); buildSprites();
}

// ---------- динамика на стенах ----------
function drawWallDynamic(c, t){
  const s = LY.s;
  // табло
  c.save(); planeY(c, 128, 0, WH-4); c.beginPath(); c.rect(3, 2.5, 188, 10); c.clip();
  c.font = `700 7.2px "JetBrains Mono", ui-monospace, monospace`; c.textBaseline = 'middle';
  const parts = COINS.map(cn=>{ const it = indicators(cn.sym); const p = S.coins[cn.sym].price; const ps = p>=1000? p.toFixed(1) : p>=10? p.toFixed(2) : p>=1? p.toFixed(3) : p.toFixed(4); return {a:`${cn.sym} ${ps} `, b:`${it.chg24>=0?'▲':'▼'}${Math.abs(it.chg24*100).toFixed(1)}%`, ch:it.chg24}; });
  const widths = parts.map(p=>c.measureText(p.a).width + c.measureText(p.b).width + 12); const total = widths.reduce((x,y)=>x+y,0);
  let x = 5 - (REDUCED ? 0 : (t*16) % total);
  c.shadowColor = 'rgba(255,170,60,.8)'; c.shadowBlur = 3*s;
  for (let rep=0; rep<3 && x<192; rep++) parts.forEach((p,i)=>{ if (x < 192 && x + widths[i] > 0){ c.fillStyle = '#ffb547'; c.fillText(p.a, x, 7.6); c.fillStyle = p.ch>=0 ? '#5ee39a' : '#ff7d88'; c.fillText(p.b, x + c.measureText(p.a).width, 7.6); } x += widths[i]; });
  c.restore();
  // большой экран — график выбранной монеты
  c.save(); planeY(c, 170, 0, 82);
  const sym = S.selected, st = S.coins[sym];
  const cs = st.candles.slice(-36).concat([st.cur]);
  let hi = -Infinity, lo = Infinity; for (const k of cs){ hi = Math.max(hi,k.h); lo = Math.min(lo,k.l); }
  const yv = v => 52 - (v-lo)/(hi-lo||1)*36;
  rrect(c, 2.5, 2.5, 119, 53, 1.5); const sg = c.createLinearGradient(0,0,0,56); sg.addColorStop(0,'#1b2142'); sg.addColorStop(1,'#121630'); c.fillStyle = sg; c.fill();
  c.strokeStyle = 'rgba(160,170,230,.10)'; c.lineWidth = 0.4; for (let gy=18; gy<54; gy+=9){ c.beginPath(); c.moveTo(4,gy); c.lineTo(120,gy); c.stroke(); }
  cs.forEach((k,i)=>{ const xx = 6 + i*3.1, up = k.c>=k.o; c.fillStyle = up ? '#4fd18b' : '#ff6b78'; c.fillRect(xx+0.8, yv(k.h), 0.5, Math.max(0.5, yv(k.l)-yv(k.h))); const y1 = yv(Math.max(k.o,k.c)), y2 = yv(Math.min(k.o,k.c)); c.fillRect(xx, y1, 2.1, Math.max(0.6, y2-y1)); });
  for (const pos of S.pf.positions.filter(p=>p.sym===sym)){ const yy = yv(clamp(pos.entry,lo,hi)); c.setLineDash([1.5,1.2]); c.strokeStyle = '#ffb547'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(4,yy); c.lineTo(120,yy); c.stroke(); c.setLineDash([]); }
  c.font = `700 5.4px "Golos Text", sans-serif`; c.fillStyle = '#dfe3ff'; c.textBaseline = 'top'; c.fillText(`${sym}/USDT`, 6, 5.5);
  const pp = st.price, ps = pp>=1000? pp.toFixed(1) : pp>=10? pp.toFixed(2) : pp>=1? pp.toFixed(3) : pp.toFixed(4);
  c.textAlign = 'right'; c.fillStyle = '#ffffff'; c.fillText(ps, 118, 5.5); c.textAlign = 'left';
  c.restore();
  // доска сигналов
  c.save(); planeY(c, 124, 0, 80);
  S.sigLog.slice(0,4).forEach((sg,i)=>{
    const nx = 4 + (i%2)*17.5, ny = 11 + Math.floor(i/2)*16.5;
    const col = sg.type==='close' ? '#9a8e72' : sg.dir>0 ? '#2f8a57' : '#a8323e';
    c.save(); c.translate(nx+7, ny+7); c.rotate(((i*37)%7-3)*0.02); c.shadowColor='rgba(0,0,0,.4)'; c.shadowBlur = 1.5*s; c.shadowOffsetY = 0.6*s;
    c.fillStyle = '#f3ead6'; c.fillRect(-7,-6.5,14,13); c.shadowColor='transparent';
    c.fillStyle = col; c.fillRect(-7,-6.5,14,2.2);
    c.fillStyle = '#c9a24e'; c.beginPath(); c.arc(0,-5.4,0.9,0,Math.PI*2); c.fill();
    c.font = `700 4px "Golos Text", sans-serif`; c.fillStyle = '#2a1f1a'; c.textAlign='center'; c.textBaseline='middle'; c.fillText(sg.sym, 0, -0.6);
    c.font = `700 3.4px "Golos Text", sans-serif`; c.fillStyle = sg.type==='close' ? '#6b6250' : sg.dir>0 ? '#1d6b3e' : '#8a1f2b'; c.fillText(sg.type==='close' ? 'закрыть' : (sg.dir>0?'▲ лонг':'▼ шорт'), 0, 3.6);
    c.restore();
  });
  c.restore();
  // часы
  c.save(); planeY(c, 300, 0, 76); const d = new Date(simNowMs()); const hh = d.getHours()%12 + d.getMinutes()/60, mm = d.getMinutes()/60;
  c.lineCap='round'; c.strokeStyle = '#2b2d40'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(12,12); c.lineTo(12+Math.sin(hh/12*Math.PI*2)*4.6, 12-Math.cos(hh/12*Math.PI*2)*4.6); c.stroke();
  c.lineWidth = 0.7; c.strokeStyle = '#7a2028'; c.beginPath(); c.moveTo(12,12); c.lineTo(12+Math.sin(mm*Math.PI*2)*7, 12-Math.cos(mm*Math.PI*2)*7); c.stroke();
  c.beginPath(); c.arc(12,12,0.9,0,Math.PI*2); c.fillStyle = '#2b2d40'; c.fill(); c.restore();
  // огонёк на телебашне
  if (Math.sin(t*3) > 0){ c.save(); planeY(c, 336, 0, 96); const tx = 78*0.62; c.beginPath(); c.arc(tx, 5.5, 0.9, 0, Math.PI*2); c.fillStyle = '#ff5d6c'; c.shadowColor = '#ff5d6c'; c.shadowBlur = 3*s; c.fill(); c.restore(); }
}
function drawScreen(c, a, t){
  // экран монитора: плоскость X = dx+8.2 (лицом к сидящему), u — вдоль −Y
  c.save(); planeX(c, a.dx+8.25, DESK_Y+19, DESK_H+16.5);
  const w = 15, h = 11.6;
  rrect(c, 0.6, 0.6, w, h, 0.8); const g = c.createLinearGradient(0,0,0,h); g.addColorStop(0,'#16224a'); g.addColorStop(1,'#0e1530'); c.fillStyle = g; c.fill();
  c.save(); c.beginPath(); c.rect(0.6, 0.6, w, h); c.clip();
  if (a.id==='nika'){
    const fl = flashNews && t < flashNews.until;
    if (fl && Math.sin(t*12)>0){ c.fillStyle = flashNews.tone>0?'#4fd18b':'#ff6b78'; c.fillRect(0.6,0.6,w,2); }
    for (let i=0;i<4;i++){ const yy = 3.4+i*2.3; const len = 4 + ((Math.floor(t*1.5)+i*7)%9); c.fillStyle = i===0?'#ffb547':'#6f80c8'; c.fillRect(1.8, yy, len, 1); }
  } else if (a.id==='boris'){
    const ev = S.evals.slice(0,3);
    if (!ev.length){ c.fillStyle = '#3b4a6b'; c.fillRect(2,8,12,0.8); }
    ev.forEach((e,i)=>{ const hh = Math.max(1, e.risk/100*9); c.fillStyle = e.verdict==='ok'?'#4fd18b':e.verdict==='caution'?'#ffb547':'#ff6b78'; c.fillRect(2.4+i*4.6, 11-hh, 3.2, hh); });
  } else if (a.id==='timur'){
    const sg = S.sigLog[0];
    if (sg && sg.type==='open'){
      c.fillStyle = sg.dir>0 ? '#4fd18b' : '#ff6b78'; c.beginPath();
      if (sg.dir>0){ c.moveTo(8,1.8); c.lineTo(11.5,5.6); c.lineTo(9,5.6); c.lineTo(9,8.8); c.lineTo(7,8.8); c.lineTo(7,5.6); c.lineTo(4.5,5.6); }
      else { c.moveTo(8,8.8); c.lineTo(11.5,5); c.lineTo(9,5); c.lineTo(9,1.8); c.lineTo(7,1.8); c.lineTo(7,5); c.lineTo(4.5,5); }
      c.fill(); c.fillStyle = '#8f9cf2'; c.fillRect(2, 10.2, 12*sg.conf/100, 0.9);
    } else { c.fillStyle = '#5b6aa8'; c.fillRect(4.5, 6, 7, 0.9); }
  } else {
    const st = S.coins[S.selected]; const cs = st.candles.slice(-7).concat([st.cur]);
    let hi=-Infinity, lo=Infinity; for (const k of cs){ hi=Math.max(hi,k.h); lo=Math.min(lo,k.l); }
    cs.forEach((k,i)=>{ const y1 = 1.8+(hi-Math.max(k.o,k.c))/(hi-lo||1)*8.5, y2 = 1.8+(hi-Math.min(k.o,k.c))/(hi-lo||1)*8.5; c.fillStyle = k.c>=k.o?'#4fd18b':'#ff6b78'; c.fillRect(1.6+i*1.75, y1, 1.1, Math.max(0.6,y2-y1)); });
  }
  c.restore();
  c.fillStyle = 'rgba(255,255,255,.07)'; c.beginPath(); c.moveTo(0.6,0.6); c.lineTo(7,0.6); c.lineTo(3,h); c.lineTo(0.6,h); c.fill();
  c.restore();
}
function drawRackLeds(c, t){ }
function drawShadowAt(c, x, y, sc=1, a=0.36){
  const [cx, cy] = P(x, y, 0), s = LY.s;
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, 8*s*sc); g.addColorStop(0, `rgba(50,25,35,${a})`); g.addColorStop(1, 'rgba(50,25,35,0)');
  c.save(); c.translate(cx, cy); c.scale(1, 0.5); c.translate(-cx, -cy); c.beginPath(); c.arc(cx, cy, 8*s*sc, 0, Math.PI*2); c.fillStyle = g; c.fill(); c.restore();
}
function limb(c, x0, y0, x1, y1, w, col){ c.beginPath(); c.moveTo(x0,y0); c.lineTo(x1,y1); c.lineWidth = w; c.lineCap = 'round'; c.strokeStyle = col; c.stroke(); }
function drawPerson(c, a, o){
  // o: facing, phase, walking, seated, blink, carry, cup, armsUp, jump(0..1), happy, typing, look
  const L = a.look, back = o.facing==='NW' || o.facing==='NE', mirror = o.facing==='SE' || o.facing==='NE';
  c.save();
  if (mirror) c.scale(-1, 1);
  const ph = o.phase||0, sw = o.walking ? Math.sin(ph) : 0;
  let jy = 0, sq = 1;
  if (o.jump > 0){ const tt = 1 - o.jump; jy = -Math.sin(tt*Math.PI)*12; sq = 1 + Math.sin(tt*Math.PI)*0.12 - (tt > 0.86 ? (1-tt)*0.6 : 0); }
  const bob = o.walking ? -Math.abs(Math.cos(ph))*0.9 : (o.typing && o.seated ? Math.sin(nowS()*9 + a.i)*0.25 : 0);
  c.translate(0, jy); c.scale(1/Math.sqrt(sq), sq); c.translate(0, bob);
  const skinG = (cx, cy, r)=>{ const g = c.createRadialGradient(cx-r*0.35, cy-r*0.45, r*0.1, cx, cy, r*1.15); g.addColorStop(0, lt(L.skin,0.35)); g.addColorStop(0.6, L.skin); g.addColorStop(1, dk(L.skin,0.16)); return g; };
  const shirtG = (y0, y1)=>{ const g = c.createLinearGradient(-7, y0, 7, y1); g.addColorStop(0, L.shirtL); g.addColorStop(0.5, L.shirt); g.addColorStop(1, L.shirtD); return g; };
  // длинные волосы сзади (вид спереди)
  if (!back && L.style==='long'){ c.beginPath(); c.moveTo(-9.6,-40); c.quadraticCurveTo(-12,-24,-9,-21.5); c.lineTo(9,-21.5); c.quadraticCurveTo(12,-24,9.8,-40); c.closePath(); c.fillStyle = L.hair; c.fill(); }
  // ноги
  if (!o.seated){
    const lift = o.walking ? Math.max(0, Math.cos(ph))*1.6 : 0, lift2 = o.walking ? Math.max(0, -Math.cos(ph))*1.6 : 0;
    const pg = c.createLinearGradient(-4,0,4,0); pg.addColorStop(0, lt(L.pants,0.12)); pg.addColorStop(1, dk(L.pants,0.15));
    limb(c, 2.6, -12, 2.8 - sw*2.4, -2.6 - lift2, 4.4, dk(L.pants,0.08));
    shoe(c, 2.8 - sw*2.4, -1.4 - lift2, L, back);
    limb(c, -2.6, -12, -2.8 + sw*2.4, -2.6 - lift, 4.4, pg);
    shoe(c, -2.8 + sw*2.4, -1.4 - lift, L, back);
  }
  // дальняя рука
  const shY = -25.6;
  const armFar = ()=>{
    if (o.armsUp) { limb(c, 6.2, shY, 7.5, -44, 3.6, L.shirtD); hand(c, 7.5, -44.5, L); return; }
    if (o.carry){ limb(c, 6.2, shY, 4.5, -18, 3.6, L.shirtD); return; }
    if (o.seated){ limb(c, 6.2, shY, 7.4, -18.5, 3.6, L.shirtD); return; }
    const an = -sw*0.45; limb(c, 6.2, shY, 6.6 + Math.sin(an)*9.5, shY + Math.cos(an)*10, 3.6, L.shirtD); hand(c, 6.6 + Math.sin(an)*10.6, shY + Math.cos(an)*11, L);
  };
  armFar();
  // туловище
  c.beginPath(); c.moveTo(-6.4,-25.2); c.quadraticCurveTo(-7.2,-27.6,-4.8,-27.9); c.lineTo(4.8,-27.9); c.quadraticCurveTo(7.2,-27.6,6.4,-25.2);
  c.lineTo(6.0,-13.2); c.quadraticCurveTo(5.9,-11.4,4.2,-11.4); c.lineTo(-4.2,-11.4); c.quadraticCurveTo(-5.9,-11.4,-6.0,-13.2); c.closePath();
  c.fillStyle = shirtG(-28, -11); c.fill();
  if (!back){
    if (L.acc==='phones'){ c.fillStyle = L.shirtD; c.beginPath(); c.ellipse(0.4,-27.4,4.6,1.8,0,0,Math.PI*2); c.fill(); c.strokeStyle = '#fff1e2'; c.lineWidth = 0.55; c.beginPath(); c.moveTo(-1.6,-26.3); c.lineTo(-1.8,-22.4); c.moveTo(1.4,-26.3); c.lineTo(1.2,-22.6); c.stroke(); rrect(c,-4.4,-18.6,8.4,4.6,1.6); c.fillStyle = rgba(L.shirtD,0.55); c.fill(); }
    if (L.tie){ c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(-2.6,-27.8); c.lineTo(0,-25.4); c.lineTo(-0.4,-27.9); c.fill(); c.beginPath(); c.moveTo(2.6,-27.8); c.lineTo(0,-25.4); c.lineTo(0.4,-27.9); c.fill();
      c.fillStyle = L.tie; c.beginPath(); c.moveTo(-0.9,-26.4); c.lineTo(0.9,-26.4); c.lineTo(0.6,-25.2); c.lineTo(-0.6,-25.2); c.fill(); c.beginPath(); c.moveTo(-0.6,-25.2); c.lineTo(0.6,-25.2); c.lineTo(1.3,-17.8); c.lineTo(0,-16.4); c.lineTo(-1.3,-17.8); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(-0.3,-24.8,0.4,6.5); }
    if (L.acc==='cap'){ c.fillStyle = dk(L.shirt,0.1); c.beginPath(); c.ellipse(0,-27.3,4.4,1.5,0,0,Math.PI*2); c.fill(); }
    if (L.style==='long'){ c.fillStyle = '#f8efe8'; c.beginPath(); c.moveTo(-2.6,-27.8); c.lineTo(2.6,-27.8); c.lineTo(0,-20.6); c.closePath(); c.fill();
      c.strokeStyle = dk(L.shirt,0.25); c.lineWidth = 0.6; c.beginPath(); c.moveTo(-2.8,-27.6); c.lineTo(0,-20.4); c.lineTo(2.8,-27.6); c.stroke();
      c.fillStyle = dk(L.shirt,0.35); c.beginPath(); c.arc(0.8,-17.6,0.55,0,Math.PI*2); c.arc(0.8,-14.9,0.55,0,Math.PI*2); c.fill(); }
  } else if (L.acc==='phones'){ c.fillStyle = L.shirtD; c.beginPath(); c.ellipse(0,-25.5,5.2,3.4,0,Math.PI,0); c.fill(); }
  // шея
  if (!back){ c.fillStyle = dk(L.skin,0.08); c.fillRect(-1.8,-29.4,3.6,2); }
  // ближняя рука
  const armNear = ()=>{
    if (o.armsUp){ limb(c, -6.2, shY, -7.6, -44, 3.6, L.shirt); hand(c, -7.6, -44.5, L); return; }
    if (o.carry){ limb(c, -6.2, shY, -4.2, -18.4, 3.6, L.shirt); rrect(c, -5.4, -22.5, 10.8, 6.6, 0.6); c.fillStyle = '#ffffff'; c.fill(); c.fillStyle = 'rgba(120,130,160,.6)'; c.fillRect(-3.8,-20.8,7,0.5); c.fillRect(-3.8,-19.2,5.6,0.5); c.fillRect(-3.8,-17.6,6.4,0.5); hand(c, -4.6, -17.8, L); hand(c, 4.4, -17.8, L); return; }
    if (o.seated){ limb(c, -6.2, shY, -7.6, -18.4, 3.6, L.shirt); return; }
    const an = sw*0.45; const hx0 = -6.6 + Math.sin(an)*10.6, hy0 = shY + Math.cos(an)*11;
    limb(c, -6.2, shY, -6.6 + Math.sin(an)*9.5, shY + Math.cos(an)*10, 3.6, L.shirt); hand(c, hx0, hy0, L);
    if (o.cup){ rrect(c, hx0-3.2, hy0-3.6, 3.2, 4, 0.7); c.fillStyle = a.look.mug || '#fff'; c.fill(); c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(hx0-2.8, hy0-3.3, 0.6, 3.2); }
  };
  armNear();
  // голова
  const hy = -38;
  if (back) headBack(c, L, hy, skinG);
  else headFront(c, a, L, hy, skinG, o);
  if (back && L.style==='long'){ c.beginPath(); c.moveTo(-8.8,-40); c.quadraticCurveTo(-10,-26,-6.4,-21); c.lineTo(6.4,-21); c.quadraticCurveTo(10,-26,8.8,-40); c.closePath(); const hg = c.createLinearGradient(0,-44,0,-21); hg.addColorStop(0, L.hairL); hg.addColorStop(1, L.hair); c.fillStyle = hg; c.fill(); }
  c.restore();
}
function shoe(c, x, y, L, back){ c.beginPath(); c.ellipse(x + (back?0.5:-0.7), y, 2.9, 1.55, 0, 0, Math.PI*2); c.fillStyle = L.shoes; c.fill(); c.beginPath(); c.ellipse(x + (back?0.2:-1.2), y-0.6, 1.2, 0.5, 0, 0, Math.PI*2); c.fillStyle = 'rgba(255,255,255,.18)'; c.fill(); }
function hand(c, x, y, L){ c.beginPath(); c.arc(x, y, 1.9, 0, Math.PI*2); c.fillStyle = L.skin; c.fill(); c.beginPath(); c.arc(x-0.5, y-0.6, 0.7, 0, Math.PI*2); c.fillStyle = 'rgba(255,255,255,.25)'; c.fill(); }
function headFront(c, a, L, hy, skinG, o){
  const style = L.style;
  // задняя часть причёски
  if (style==='bob'){ c.beginPath(); c.ellipse(0.4, hy+0.8, 11.2, 10.8, 0, 0, Math.PI*2); c.fillStyle = L.hair; c.fill(); c.fillRect(-10.6, hy, 21.6, 8.4); }
  // ухо (дальнее)
  c.beginPath(); c.ellipse(9.0, hy+1.2, 2.1, 2.6, 0, 0, Math.PI*2); c.fillStyle = dk(L.skin,0.06); c.fill();
  // голова
  c.beginPath(); c.ellipse(0, hy, 9.8, 9.4, 0, 0, Math.PI*2); c.fillStyle = skinG(-1.5, hy, 10); c.fill();
  c.beginPath(); c.ellipse(-1.4, hy+4.2, 7.4, 5.4, 0, 0, Math.PI*2); c.fill();
  // причёска спереди
  if (style==='bob'){
    c.beginPath(); c.moveTo(-10.4, hy+5.6); c.quadraticCurveTo(-11.4, hy-9.6, 0.4, hy-10.4); c.quadraticCurveTo(11.4, hy-9.8, 10.6, hy+5.8); c.lineTo(8.6, hy+5.8); c.quadraticCurveTo(8.4, hy-2.4, 3.2, hy-4.6); c.quadraticCurveTo(-3.6, hy-1.2, -8.2, hy-2.4); c.quadraticCurveTo(-8.6, hy+2, -8.4, hy+5.6); c.closePath();
    const hg = c.createLinearGradient(-8, hy-10, 6, hy+4); hg.addColorStop(0, L.hairL); hg.addColorStop(1, L.hair); c.fillStyle = hg; c.fill();
    c.strokeStyle = rgba('#ffffff',0.18); c.lineWidth = 0.7; c.beginPath(); c.moveTo(-5, hy-7.4); c.quadraticCurveTo(0, hy-9, 4, hy-7.6); c.stroke();
  } else if (style==='crop'){
    const hg = c.createLinearGradient(-8, hy-11, 6, hy+2); hg.addColorStop(0, L.hairL); hg.addColorStop(1, L.hair); c.fillStyle = hg;
    c.beginPath(); c.moveTo(-10.1, hy+2.4); c.quadraticCurveTo(-11.2, hy-10.8, 0.6, hy-11.2); c.quadraticCurveTo(11.2, hy-10.6, 10.3, hy+2.2); c.lineTo(9.0, hy+1.4); c.quadraticCurveTo(8.8, hy-4.6, 4.8, hy-5.6); c.quadraticCurveTo(0.6, hy-3.4, -3.6, hy-6.2); c.quadraticCurveTo(-7.8, hy-5.2, -8.9, hy+2); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-3.6, hy-6.2); c.quadraticCurveTo(-1, hy-11.8, 6.4, hy-9.6); c.quadraticCurveTo(1.6, hy-8.8, -3.6, hy-6.2); c.fill();
    c.strokeStyle = rgba('#ffffff',0.18); c.lineWidth = 0.7; c.beginPath(); c.moveTo(-4.6, hy-8.4); c.quadraticCurveTo(0.4, hy-10.6, 4.6, hy-9.2); c.stroke();
    c.fillStyle = L.hair; c.beginPath(); c.ellipse(-8.9, hy+1.6, 1.3, 2.8, 0, 0, Math.PI*2); c.fill(); c.beginPath(); c.ellipse(9.0, hy+1.4, 1.3, 2.8, 0, 0, Math.PI*2); c.fill();
  } else if (style==='bald'){
    c.fillStyle = L.hair; c.beginPath(); c.ellipse(-8.6, hy+0.6, 2.1, 3.6, 0.2, 0, Math.PI*2); c.fill(); c.beginPath(); c.ellipse(8.8, hy+0.4, 2.2, 3.8, -0.2, 0, Math.PI*2); c.fill();
    c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.ellipse(-3, hy-6.4, 3.4, 1.6, -0.3, 0, Math.PI*2); c.fill();
  } else if (style==='short'){
    c.fillStyle = L.hair; c.beginPath(); c.ellipse(-8.8, hy+1.4, 1.4, 3, 0, 0, Math.PI*2); c.fill(); c.beginPath(); c.ellipse(8.9, hy+1.2, 1.4, 3, 0, 0, Math.PI*2); c.fill();
  } else if (style==='long'){
    const hg = c.createLinearGradient(-8, hy-10, 6, hy+6); hg.addColorStop(0, L.hairL); hg.addColorStop(1, L.hair); c.fillStyle = hg;
    c.beginPath(); c.moveTo(-10.2, hy+9); c.quadraticCurveTo(-11.6, hy-10.4, 0.6, hy-10.2); c.quadraticCurveTo(11.4, hy-9.8, 10.2, hy+9.5); c.lineTo(8.2, hy+9.5); c.quadraticCurveTo(8.6, hy-3, 1.2, hy-6.4); c.quadraticCurveTo(-6.6, hy-3.6, -7.8, hy+9); c.closePath(); c.fill();
    c.strokeStyle = rgba('#ffffff',0.15); c.lineWidth = 0.7; c.beginPath(); c.moveTo(-6, hy-6.6); c.quadraticCurveTo(-1, hy-9.4, 3.6, hy-8); c.stroke();
  }
  // глаза
  const look = o.look || 0, blink = o.blink;
  const eyes = [[-4.6, hy+0.6, 2.6, 3.1], [2.5, hy+0.4, 2.2, 3.0]];
  for (const [ex, ey, rx, ry] of eyes){
    if (blink){ c.strokeStyle = dk(L.skin,0.45); c.lineWidth = 0.7; c.beginPath(); c.arc(ex, ey+0.3, rx*0.85, 0.15*Math.PI, 0.85*Math.PI); c.stroke(); continue; }
    c.beginPath(); c.ellipse(ex, ey, rx, ry, 0, 0, Math.PI*2); c.fillStyle = '#ffffff'; c.fill();
    const ix = ex - 0.5 + look, iy = ey + 0.35;
    c.beginPath(); c.arc(ix, iy, rx*0.7, 0, Math.PI*2); c.fillStyle = L.iris; c.fill();
    c.beginPath(); c.arc(ix, iy, rx*0.38, 0, Math.PI*2); c.fillStyle = '#140d14'; c.fill();
    c.beginPath(); c.arc(ix-0.6, iy-0.8, rx*0.24, 0, Math.PI*2); c.fillStyle = '#ffffff'; c.fill();
    c.beginPath(); c.arc(ix+0.55, iy+0.6, rx*0.1, 0, Math.PI*2); c.fill();
    c.strokeStyle = dk(L.skin,0.55); c.lineWidth = a.fem ? 0.8 : 0.5; c.beginPath(); c.ellipse(ex, ey, rx, ry, 0, 1.15*Math.PI, 1.9*Math.PI); c.stroke();
  }
  // брови
  c.strokeStyle = style==='bald' ? dk(L.hair,0.2) : dk(L.hair,0.05); c.lineWidth = 0.9; c.lineCap = 'round';
  const lift = o.happy ? -0.6 : 0;
  c.beginPath(); c.moveTo(-6.6, hy-3.4+lift); c.quadraticCurveTo(-4.6, hy-4.6+lift, -2.8, hy-3.6+lift); c.stroke();
  c.beginPath(); c.moveTo(1, hy-3.7+lift); c.quadraticCurveTo(2.6, hy-4.6+lift, 4.2, hy-3.6+lift); c.stroke();
  // нос, щёки, рот
  c.beginPath(); c.ellipse(-2.6, hy+3.6, 1.3, 1.0, 0, 0, Math.PI*2); c.fillStyle = dk(L.skin,0.12); c.fill();
  c.beginPath(); c.ellipse(-2.9, hy+3.3, 0.5, 0.35, 0, 0, Math.PI*2); c.fillStyle = 'rgba(255,255,255,.35)'; c.fill();
  for (const bx of [-6.8, 4.6]){ const g = c.createRadialGradient(bx, hy+4.6, 0, bx, hy+4.6, 2.6); g.addColorStop(0, a.fem ? 'rgba(255,120,120,.38)' : 'rgba(220,120,100,.14)'); g.addColorStop(1,'rgba(255,120,120,0)'); c.fillStyle = g; c.beginPath(); c.arc(bx, hy+4.6, 2.6, 0, Math.PI*2); c.fill(); }
  if (L.style==='bald'){ c.fillStyle = L.hair; c.beginPath(); c.ellipse(-3.6, hy+5.3, 1.9, 0.75, 0.1, 0, Math.PI*2); c.ellipse(-1.2, hy+5.3, 1.9, 0.75, -0.1, 0, Math.PI*2); c.fill(); }
  if (o.happy){ c.beginPath(); c.moveTo(-4.6, hy+6.2); c.quadraticCurveTo(-2.4, hy+9.6, -0.2, hy+6.2); c.closePath(); c.fillStyle = '#7a2f3a'; c.fill(); c.beginPath(); c.ellipse(-2.4, hy+7.9, 1.2, 0.6, 0, 0, Math.PI*2); c.fillStyle = '#ff8a8a'; c.fill(); }
  else { c.strokeStyle = '#8a3d44'; c.lineWidth = 0.75; c.beginPath(); c.arc(-2.4, hy+5.4, 1.9, 0.18*Math.PI, 0.82*Math.PI); c.stroke(); }
  // аксессуары
  if (L.acc==='glasses'){ c.strokeStyle = '#2b2b38'; c.lineWidth = 0.75; c.fillStyle = 'rgba(190,225,255,.16)'; for (const [ex,ey,r] of [[-4.6,hy+0.6,3.3],[2.5,hy+0.4,3.0]]){ c.beginPath(); c.arc(ex, ey, r, 0, Math.PI*2); c.fill(); c.stroke(); } c.beginPath(); c.moveTo(-1.3, hy+0.3); c.quadraticCurveTo(-1, hy-0.4, -0.5, hy+0.2); c.stroke(); c.beginPath(); c.moveTo(5.5, hy); c.lineTo(9, hy-0.6); c.stroke(); }
  if (L.acc==='phones'){ c.strokeStyle = '#33344a'; c.lineWidth = 1.8; c.beginPath(); c.arc(0.2, hy-0.6, 11.2, 1.08*Math.PI, 1.94*Math.PI); c.stroke();
    for (const [ex, w] of [[-12.3, 3.6],[9.3, 3.4]]){ rrect(c, ex, hy-2.4, w, 6.6, 1.5); c.fillStyle = a.color; c.fill(); c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(ex+0.7, hy-1.6, 0.7, 4.8); } }
  if (L.acc==='cap'){ const cg = c.createLinearGradient(-8, hy-12, 8, hy-2); cg.addColorStop(0, L.capL); cg.addColorStop(1, L.cap);
    c.beginPath(); c.moveTo(-10, hy-1.6); c.quadraticCurveTo(-10.6, hy-12.2, 0.4, hy-12.2); c.quadraticCurveTo(10.6, hy-12, 10, hy-1.6); c.closePath(); c.fillStyle = cg; c.fill();
    c.beginPath(); c.ellipse(-6.4, hy-2.2, 8.6, 2.4, -0.08, 0, Math.PI*2); c.fillStyle = dk(L.cap,0.12); c.fill();
    c.beginPath(); c.arc(-1.6, hy-7.4, 1.5, 0, Math.PI*2); c.fillStyle = '#9aa6f6'; c.fill(); }
  if (L.acc==='earrings'){ c.beginPath(); c.arc(9.4, hy+4.6, 0.95, 0, Math.PI*2); c.fillStyle = '#f6c54a'; c.fill(); }
}
function headBack(c, L, hy, skinG){
  c.beginPath(); c.ellipse(-9.0, hy+1.2, 2.1, 2.6, 0, 0, Math.PI*2); c.fillStyle = dk(L.skin,0.06); c.fill();
  c.beginPath(); c.ellipse(9.0, hy+1.2, 2.1, 2.6, 0, 0, Math.PI*2); c.fill();
  c.beginPath(); c.ellipse(0, hy, 9.8, 9.4, 0, 0, Math.PI*2); c.fillStyle = skinG(1, hy, 10); c.fill();
  const hg = c.createLinearGradient(-6, hy-10, 6, hy+8); hg.addColorStop(0, L.hairL || L.hair); hg.addColorStop(1, L.hair); c.fillStyle = hg;
  if (L.style==='bald'){ c.beginPath(); c.ellipse(0, hy+2.4, 9.6, 5.6, 0, 0, Math.PI); c.fill(); c.fillStyle = 'rgba(255,255,255,.3)'; c.beginPath(); c.ellipse(-2.6, hy-5.6, 3.2, 1.6, -0.3, 0, Math.PI*2); c.fill(); }
  else { c.beginPath(); c.ellipse(0, hy-0.6, 10.2, 9.8, 0, 0, Math.PI*2); c.fill(); if (L.style==='bob') c.fillRect(-10.6, hy, 21.2, 7.6); }
  if (L.acc==='cap'){ const cg = c.createLinearGradient(-8, hy-12, 8, hy-2); cg.addColorStop(0, L.capL); cg.addColorStop(1, L.cap); c.beginPath(); c.moveTo(-10, hy-1.4); c.quadraticCurveTo(-10.6, hy-12.2, 0, hy-12.2); c.quadraticCurveTo(10.6, hy-12, 10, hy-1.4); c.closePath(); c.fillStyle = cg; c.fill(); c.fillStyle = dk(L.cap,0.2); c.fillRect(-2.2, hy-2.6, 4.4, 1.4); }
  if (L.acc==='phones'){ c.strokeStyle = '#33344a'; c.lineWidth = 1.8; c.beginPath(); c.arc(0, hy-0.6, 11, 1.06*Math.PI, 1.94*Math.PI); c.stroke(); }
}
function drawEmote(c, a, t, sx, sy){
  const e = a.emote, pend = a.id==='aliya' && S.pending.length && !SIM.paused;
  const kind = e && t < e.until ? e.kind : pend ? '?' : SIM.paused ? 'z' : null;
  if (!kind) return;
  const s = LY.s, y = sy - 6*s + (REDUCED ? 0 : Math.sin(t*5)*0.8*s);
  c.save(); c.translate(sx + 8*s, y);
  c.shadowColor = 'rgba(30,15,30,.35)'; c.shadowBlur = 3*s; c.shadowOffsetY = 1*s;
  if (kind==='drop'){ c.beginPath(); c.moveTo(0,-4*s); c.quadraticCurveTo(3.4*s, 1*s, 0, 2.6*s); c.quadraticCurveTo(-3.4*s, 1*s, 0, -4*s); c.fillStyle = '#7cc4ea'; c.fill(); c.shadowColor='transparent'; c.beginPath(); c.ellipse(-0.8*s, 0, 0.7*s, 1.2*s, 0, 0, Math.PI*2); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill(); c.restore(); return; }
  if (kind==='paper'){ c.rotate(-0.15); rrect(c, -3.4*s, -4.2*s, 6.8*s, 8.4*s, 0.8*s); c.fillStyle = '#ffffff'; c.fill(); c.shadowColor='transparent'; c.fillStyle = '#9aa0c0'; for (let i=0;i<3;i++) c.fillRect(-2.2*s, (-2.2+i*2)*s, 4.4*s, 0.6*s); c.restore(); return; }
  const col = kind==='$' ? '#f6c54a' : kind==='!' ? '#ffb547' : kind==='z' ? '#b9bce0' : '#ffffff';
  c.beginPath(); c.arc(0, 0, 4.4*s, 0, Math.PI*2); c.fillStyle = col; c.fill(); c.shadowColor='transparent';
  if (kind==='$'){ c.beginPath(); c.arc(0,0,3.4*s,0,Math.PI*2); c.strokeStyle = '#d99b1f'; c.lineWidth = 0.6*s; c.stroke(); }
  c.font = `800 ${(kind==='z'?5:6)*s}px "Golos Text", sans-serif`; c.fillStyle = kind==='$' ? '#8a5a00' : '#2a1d2e'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(kind==='z' ? 'Zz' : kind, 0, 0.4*s);
  c.restore();
}

// ---------- сортировка по глубине ----------
function depthOrder(a, b){
  const sx = a.maxX <= b.minX ? -1 : b.maxX <= a.minX ? 1 : 0;
  const sy = a.maxY <= b.minY ? -1 : b.maxY <= a.minY ? 1 : 0;
  if (sx && sy) return sx===sy ? sx : 0;
  return sx || sy || 0;
}
function sortDepth(objs){
  const n = objs.length, indeg = new Array(n).fill(0), adj = objs.map(()=>[]);
  for (let i=0;i<n;i++) for (let j=i+1;j<n;j++){ const o = depthOrder(objs[i], objs[j]); if (o<0){ adj[i].push(j); indeg[j]++; } else if (o>0){ adj[j].push(i); indeg[i]++; } }
  const key = o=>o.minX+o.maxX+o.minY+o.maxY;
  const ready = []; for (let i=0;i<n;i++) if (!indeg[i]) ready.push(i);
  const out = [], used = new Array(n).fill(false);
  while (out.length < n){
    if (!ready.length){ let best=-1; for (let i=0;i<n;i++) if (!used[i] && (best<0 || key(objs[i])<key(objs[best]))) best=i; ready.push(best); indeg[best]=0; }
    ready.sort((p,q)=>key(objs[q])-key(objs[p]));
    const i = ready.pop(); if (used[i]) continue; used[i] = true; out.push(objs[i]);
    for (const j of adj[i]) if (--indeg[j]===0 && !used[j]) ready.push(j);
  }
  return out;
}

// ---------- кадр ----------
function renderWorld(){ /* совместимость: сцена рисуется в renderScene */ }
function renderScene(ctx, cw, ch, dpr){
  if (!cw || !ch) return;
  if (!STATIC || LY.cw !== cw || LY.ch !== ch || LY.dpr !== dpr) setLayout(cw, ch, dpr);
  const t = nowS(), s = LY.s;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.drawImage(STATIC, 0, 0, cw, ch);
  drawWallDynamic(ctx, t);
  const objs = [];
  for (const sp of SPRITES){
    objs.push({minX:sp.minX, maxX:sp.maxX, minY:sp.minY, maxY:sp.maxY, draw:()=>{
      ctx.drawImage(sp.cv, sp.bx, sp.by, sp.bw, sp.bh);
      if (sp.kind==='desk') deskDynamic(ctx, AG_LIST[sp.i], t);
      if (sp.kind==='rack') drawRackLeds(ctx, t);
    }});
  }
  HITS = [];
  for (const a of AG_LIST){
    const r = a.seated ? 4 : 3.5;
    objs.push({minX:a.x-r, maxX:a.x+r, minY:a.y-r, maxY:a.y+r, draw:()=>{
      const [px, py] = P(a.x, a.y, 0);
      if (hoverAgent===a.id || selectedAgent===a.id){ ctx.save(); ctx.translate(px, py); ctx.scale(1, 0.5); ctx.beginPath(); ctx.arc(0, 0, 10*s, 0, Math.PI*2); ctx.fillStyle = selectedAgent===a.id ? 'rgba(255,181,71,.30)' : 'rgba(255,255,255,.18)'; ctx.fill(); ctx.lineWidth = 1.2*s/1; ctx.strokeStyle = selectedAgent===a.id ? 'rgba(255,181,71,.85)' : 'rgba(255,255,255,.4)'; ctx.stroke(); ctx.restore(); }
      if (!a.seated) drawShadowAt(ctx, a.x, a.y, (a.jumpT>0 ? 0.75 : 1)*CHS);
      const blink = t > a.blinkAt && t < a.blinkAt + 0.14;
      ctx.save(); ctx.translate(px, py); ctx.scale(s*CHS, s*CHS);
      drawPerson(ctx, a, {facing:a.facing, phase:a.phase, walking:a.walking && !SIM.paused, seated:a.seated, blink, carry:a.carry, cup:a.holdCup, armsUp:a.armsUp>0, jump:a.jumpT>0 ? a.jumpT/0.7 : 0, happy:a.jumpT>0 || (a.emote && a.emote.kind==='$' && t < a.emote.until), typing:a.typing, look: a.seated ? -0.6 : 0});
      ctx.restore();
      const top = P(a.x, a.y, 50*CHS);
      HITS.push({id:a.id, x0:px-10*s, x1:px+10*s, y0:top[1]-2*s, y1:py+2*s});
    }});
  }
  for (const o of sortDepth(objs)) o.draw();
  // самолётики
  for (const p of PLANES){
    const tt = clamp(p.t,0,1); const x = p.x0+(p.x1-p.x0)*tt, y = p.y0+(p.y1-p.y0)*tt, z = p.z0+(p.z1-p.z0)*tt + Math.sin(tt*Math.PI)*30;
    drawShadowAt(ctx, x, y, 0.35, 0.22);
    const [sx2, sy2] = P(x, y, z), [nx, ny] = P(p.x1, p.y1, p.z1);
    const ang = Math.atan2(ny - sy2 - Math.cos(tt*Math.PI)*30*s, nx - sx2);
    ctx.save(); ctx.translate(sx2, sy2); ctx.rotate(ang); ctx.scale(s, s);
    ctx.shadowColor = 'rgba(30,20,40,.25)'; ctx.shadowBlur = 2*s; ctx.shadowOffsetY = 1*s;
    ctx.beginPath(); ctx.moveTo(6,0); ctx.lineTo(-5,-4); ctx.lineTo(-3,0); ctx.lineTo(-5,4); ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.shadowColor='transparent'; ctx.beginPath(); ctx.moveTo(6,0); ctx.lineTo(-3,0); ctx.lineTo(-5,4); ctx.closePath(); ctx.fillStyle = '#dfe3f0'; ctx.fill();
    ctx.restore();
  }
  // эмоции
  for (const a of AG_LIST){ const [hx2, hy2] = P(a.x, a.y, 50*CHS + (a.jumpT>0 ? Math.sin((1-a.jumpT/0.7)*Math.PI)*12 : 0)); drawEmote(ctx, a, t, hx2, hy2); }
  // свет ламп и мониторов
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const a of AG_LIST){
    glowAt(ctx, P(a.dx+52, DESK_Y+10, DESK_H+2), 26*s, 'rgba(255,200,120,.17)');
    glowAt(ctx, P(a.dx+54, DESK_Y+7, DESK_H+11), 9*s, 'rgba(120,220,150,.10)');
    glowAt(ctx, P(a.dx+10, DESK_Y+11, DESK_H+10), 16*s, 'rgba(110,150,255,.09)');
  }
  glowAt(ctx, P(12, 138, 48), 40*s, 'rgba(255,200,120,.17)');
  glowAt(ctx, P(0, 103, 84), 34*s, 'rgba(255,214,150,.12)');
  glowAt(ctx, P(0, 174, 76), 26*s, 'rgba(255,214,150,.10)');
  ctx.restore();
  renderOverlay(ctx, s, cw, ch);
}
function glowAt(c, p, r, col){ const g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(p[0]-r, p[1]-r, r*2, r*2); }
function deskDynamic(c, a, t){
  drawScreen(c, a, t);
  const s = LY.s;
  if (a.seated){
    const up = a.typing && Math.sin(t*22 + a.i) > 0;
    for (const [dxh, u] of [[-4.6, up], [3.4, !up && a.typing]]){
      const [hx2, hy2] = P(a.sx + dxh, DESK_Y + 7.5, DESK_H + 1.2 + (u ? 0.8 : 0));
      const [sx0, sy0] = P(a.sx + dxh*1.45, DESK_Y + 0.5, DESK_H + 7);
      c.beginPath(); c.moveTo(sx0, sy0); c.lineTo(hx2, hy2 - 0.6*s); c.lineWidth = 3.9*s; c.lineCap = 'round'; c.strokeStyle = dxh < 0 ? a.look.shirt : a.look.shirtD; c.stroke();
      c.beginPath(); c.arc(hx2, hy2, 2.1*s, 0, Math.PI*2); c.fillStyle = a.look.skin; c.fill();
    }
  }
  if (a.cup){ cyl(c, a.dx+49, DESK_Y+15, DESK_H, 2, 4, a.look.mug); const hp = P(a.dx+51.8, DESK_Y+15, DESK_H+2.2); c.beginPath(); c.arc(hp[0], hp[1], 1.1*s, -1.2, 1.2); c.strokeStyle = a.look.mug; c.lineWidth = 0.7*s; c.stroke(); }
  if (a.id==='aliya'){
    const sh = bellT>0 ? Math.sin(t*50)*0.6 : 0;
    cyl(c, a.dx+32+sh, DESK_Y+17, DESK_H, 2.8, 0.6, '#7a5a2a');
    const [bx, by] = P(a.dx+32+sh, DESK_Y+17, DESK_H+0.6); const g = c.createRadialGradient(bx-1*s, by-3*s, 0.3*s, bx, by-1.5*s, 4*s); g.addColorStop(0,'#fff0b0'); g.addColorStop(1,'#d39a1f');
    c.beginPath(); c.ellipse(bx, by, 2.6*s*1.2, 1.3*s, 0, 0, Math.PI); c.arc(bx, by, 2.6*s*1.2, 0, Math.PI, true); c.fillStyle = g; c.fill();
    c.beginPath(); c.arc(bx, by-3.4*s, 0.7*s, 0, Math.PI*2); c.fillStyle = '#d39a1f'; c.fill();
  }
}

// ---- аватар для интерфейса ----
function renderAvatar(id, cv){
  const a = AG[id]; const c = cv.getContext('2d');
  c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,cv.width,cv.height);
  const sc = cv.height/31; c.setTransform(sc, 0, 0, sc, cv.width/2 + 0.6*sc, cv.height + 19.5*sc);
  drawPerson(c, a, {facing:'SW', seated:true, happy:true});
}

// ---- оверлей: пузыри, маркер выбора, пауза ----
function renderOverlay(ctx, s, cw, chh){
  const t = nowS();
  const fs = Math.round(clamp(s*9.6, 11, 14));
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const maxW = Math.min(190, Math.max(110, 70*s));
  ctx.font = `600 ${fs}px "Golos Text", system-ui, sans-serif`;
  const placed = [];
  const order = AG_LIST.filter(a=>a.bubble).sort((p,q)=>q.bubble.t0-p.bubble.t0);
  for (const a of order){
    const b = a.bubble; if (!b) continue;
    const age = t - b.t0; if (age > b.dur){ a.bubble = null; continue; }
    const lines = wrap(ctx, b.text, maxW - 18).slice(0,3);
    const bw = Math.max(...lines.map(l=>ctx.measureText(l).width)) + 20, bh = lines.length*(fs+4) + 12;
    const [hx0, hy0] = P(a.x, a.y, 66);
    let x = clamp(hx0 - bw/2, 4, cw - bw - 4);
    let y = hy0 - bh - 4;
    for (let g2=0; g2<6; g2++){ const hit = placed.find(r=> x < r.x+r.w+6 && x+bw+6 > r.x && y < r.y+r.h+8 && y+bh+8 > r.y); if (!hit) break; y = hit.y - bh - 10; }
    if (y < 2) y = 2;
    placed.push({x, y, w:bw, h:bh});
    const pop = age < 0.18 ? age/0.18 : age > b.dur-0.25 ? (b.dur-age)/0.25 : 1;
    const sc = REDUCED ? 1 : 0.85 + 0.15*clamp(pop,0,1);
    ctx.save(); ctx.globalAlpha = clamp(pop,0,1);
    ctx.translate(x + bw/2, y + bh); ctx.scale(sc, sc); ctx.translate(-(x + bw/2), -(y + bh));
    ctx.shadowColor = 'rgba(20,10,30,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    rrect(ctx, x, y, bw, bh, 11); ctx.fillStyle = '#fffaf1'; ctx.fill();
    const tx = clamp(hx0, x+14, x+bw-14);
    ctx.beginPath(); ctx.moveTo(tx-7, y+bh-1); ctx.lineTo(tx+1, y+bh+8); ctx.lineTo(tx+6, y+bh-1); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = a.color; ctx.beginPath(); ctx.arc(x+11, y+6+fs/2+1, 3.2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#2a2236';
    lines.forEach((l,i)=>ctx.fillText(l, x+19, y+6+i*(fs+4)));
    ctx.restore();
  }
  const sA = AG[selectedAgent];
  if (sA){ const [mx, my0] = P(sA.x, sA.y, 62); const my = my0 - 4 + (REDUCED?0:Math.sin(t*4)*2); if (!sA.bubble){ ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.moveTo(mx-6,my-8); ctx.lineTo(mx+6,my-8); ctx.lineTo(mx,my); ctx.closePath(); ctx.fill(); } }
  if (SIM.paused){
    const fz = Math.round(clamp(s*14, 16, 26)); ctx.font = `700 ${fz}px "Golos Text", sans-serif`; ctx.textAlign = 'center';
    const tw = ctx.measureText('Пауза').width + 36;
    ctx.fillStyle = 'rgba(28,24,48,.82)'; rrect(ctx, cw/2 - tw/2, chh*0.06, tw, fz+18, (fz+18)/2); ctx.fill();
    ctx.fillStyle = '#ffb547'; ctx.fillText('Пауза', cw/2, chh*0.06+9); ctx.textAlign = 'left';
  }
}
function wrap(ctx, text, maxW){
  const words = String(text).split(/\s+/); const lines = []; let cur = '';
  for (const w of words){ const tst = cur ? cur+' '+w : w; if (ctx.measureText(tst).width > maxW && cur){ lines.push(cur); cur = w; } else cur = tst; }
  if (cur) lines.push(cur);
  if (lines.length > 3){ lines.length = 3; lines[2] = lines[2].replace(/.{0,2}$/, '…'); }
  return lines;
}
// попадание по CSS-координатам холста
function hitAgent(cx, cy){
  for (let i=HITS.length-1;i>=0;i--){ const h = HITS[i]; if (cx>=h.x0 && cx<=h.x1 && cy>=h.y0 && cy<=h.y1) return h.id; }
  for (const sp of SPRITES){ if (sp.kind==='desk' && cx>=sp.bx+sp.bw*0.15 && cx<=sp.bx+sp.bw*0.85 && cy>=sp.by+sp.bh*0.2 && cy<=sp.by+sp.bh*0.85) return AG_LIST[sp.i].id; }
  return null;
}
function initScene(){
  on('candle', ()=>{ if (S.idx % S.params.scanEvery === 0) requestScan(); });
  on('news', n=>requestNews(n));
  on('auto-close', c=>{
    const a = AG.aliya;
    post('aliya', null, `Сработал ${c.reason}: ${sideRu(c.dir)} ${c.sym} ${fmtUSD(c.pnl,true)} (${fmtPct(c.pct)}).`, 'trade', {sym:c.sym});
    say(a, `${c.reason==='тейк-профит'?'Тейк':c.reason==='по времени'?'Выход по времени':'Стоп'} ${c.sym}: ${fmtUSD(c.pnl,true)}`, 3);
    react(a, c);
  });
  on('manage', (pos, text)=>{ post('aliya', null, text, 'trade', {sym:pos.sym}); });
  on('kill', v=>{ if (v){ post('aliya', null, `Дневной лимит убытка ${S.params.dailyLimit}% достигнут — новые сделки на паузе до следующего дня.`, 'system'); say(AG.aliya, 'Стоп-кран: лимит дня', 3.5); emote(AG.aliya,'drop',3); } else post('aliya', null, 'Новый торговый день: лимит убытка сброшен.', 'system'); });
}
