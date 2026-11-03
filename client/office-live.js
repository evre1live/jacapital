// ================= офисный холст (живой режим) =================
// 3D-офис рисуется на нижнем холсте (WebGL), пузыри и подсказки — на верхнем 2D-холсте; без WebGL остаётся 2D-сцена
const office = $('#office'), octx = office.getContext('2d'), office3d = $('#office3d');
let OW = 0, OH = 0, ODPR = 1, O3_ON = false;
function sizeOffice(){ const r = office.getBoundingClientRect(); ODPR = Math.min(2, window.devicePixelRatio||1); OW = r.width; OH = r.height; office.width = Math.max(1,Math.round(OW*ODPR)); office.height = Math.max(1,Math.round(OH*ODPR)); }
function blitOffice(){
  if (!OW) sizeOffice();
  if (O3_ON && O3.render(OW, OH, Math.min(ODPR, 1.75))){ octx.setTransform(ODPR,0,0,ODPR,0,0); octx.clearRect(0, 0, OW, OH); O3.overlay(octx, OW, OH); return; }
  renderScene(octx, OW, OH, ODPR);
}
function renderAvatarSized(id, cv){ cv.width = 112; cv.height = 112; renderAvatar(id, cv); }
function start3D(){
  if (!office3d || new URLSearchParams(location.search).has('2d')) return;
  O3.init(office3d).then(ok=>{
    if (!ok){ office3d.remove(); return; }
    O3_ON = true; office.classList.add('is3d');
    O3.attach(office, (x, y)=>{ const id = hitAgent(x, y); if (id) selectAgent(id); }, (x, y)=>{ const id = hitAgent(x, y); hoverAgent = id; office.style.cursor = id ? 'pointer' : 'grab'; });
  });
}
function onAvatars3D(out){
  Object.assign(AVA, out);
  document.querySelectorAll('img.ava[data-aid]').forEach(img=>{ const u = AVA[img.dataset.aid]; if (u) img.src = u; });
}
function onThemeChanged(){ readCSS(); CH.sized = false; EQ.sized = false; if (uiReady){ drawChart(); drawSparks(); if (typeof drawEquity === 'function') drawEquity(); } }
function initOfficeUI(){
  office.addEventListener('pointermove', e=>{ if (O3_ON) return; const id = hitAgent(e.offsetX, e.offsetY); hoverAgent = id; office.style.cursor = id ? 'pointer' : 'default'; });
  office.addEventListener('pointerleave', ()=>{ hoverAgent = null; });
  office.addEventListener('click', e=>{ if (O3_ON) return; const id = hitAgent(e.offsetX, e.offsetY); if (id) selectAgent(id); });
  new ResizeObserver(()=>{ sizeOffice(); CH.sized = false; EQ.sized = false; if (uiReady){ drawChart(); drawSparks(); } }).observe(document.body);
  sizeOffice(); start3D(); initTheme();
  const sc = $('#officeScroll'); if (sc && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = (sc.scrollWidth - sc.clientWidth)/2;
}
bootLive();
