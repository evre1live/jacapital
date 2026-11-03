// ================= офисный холст (живой режим) =================
const office = $('#office'), octx = office.getContext('2d');
let OW = 0, OH = 0, ODPR = 1;
function sizeOffice(){ const r = office.getBoundingClientRect(); ODPR = Math.min(2, window.devicePixelRatio||1); OW = r.width; OH = r.height; office.width = Math.max(1,Math.round(OW*ODPR)); office.height = Math.max(1,Math.round(OH*ODPR)); }
function blitOffice(){ if (!OW) sizeOffice(); renderScene(octx, OW, OH, ODPR); }
function renderAvatarSized(id, cv){ cv.width = 112; cv.height = 112; renderAvatar(id, cv); }
function initOfficeUI(){
  office.addEventListener('pointermove', e=>{ const id = hitAgent(e.offsetX, e.offsetY); hoverAgent = id; office.style.cursor = id ? 'pointer' : 'default'; });
  office.addEventListener('pointerleave', ()=>{ hoverAgent = null; });
  office.addEventListener('click', e=>{ const id = hitAgent(e.offsetX, e.offsetY); if (id) selectAgent(id); });
  new ResizeObserver(()=>{ sizeOffice(); CH.sized = false; EQ.sized = false; if (uiReady){ drawChart(); drawSparks(); } }).observe(document.body);
  sizeOffice();
  const sc = $('#officeScroll'); if (sc && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = (sc.scrollWidth - sc.clientWidth)/2;
}
bootLive();
