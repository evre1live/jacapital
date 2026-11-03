// ---------- тема: светлая (в офисе день) / тёмная (ночь) / авто (как в системе) ----------
const THEME = {mode:'auto', dark: document.documentElement.getAttribute('data-theme') === 'dark', ready:false};
try { THEME.mode = localStorage.getItem('jacap-theme') || 'auto'; } catch(e){}
const MQ_DARK = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function themeDark(mode){ return mode === 'dark' || (mode === 'auto' && !!(MQ_DARK && MQ_DARK.matches)); }
function applyTheme(mode, animate){
  const dark = themeDark(mode), changed = dark !== THEME.dark || !THEME.ready;
  THEME.mode = mode; THEME.dark = dark; THEME.ready = true;
  const root = document.documentElement;
  if (animate && changed && !REDUCED){ root.classList.add('theme-anim'); clearTimeout(applyTheme._t); applyTheme._t = setTimeout(()=>root.classList.remove('theme-anim'), 650); }
  root.setAttribute('data-theme', dark ? 'dark' : 'light'); root.setAttribute('data-theme-mode', mode);
  try { localStorage.setItem('jacap-theme', mode); } catch(e){}
  document.querySelectorAll('[data-theme-set]').forEach(b=>b.setAttribute('aria-pressed', String(b.dataset.themeSet === mode)));
  setSceneDaylight(!dark);
  if (changed && typeof onThemeChanged === 'function') onThemeChanged();
}
function initTheme(){
  document.querySelectorAll('[data-theme-set]').forEach(b=>b.addEventListener('click', ()=>applyTheme(b.dataset.themeSet, true)));
  if (MQ_DARK){ const f = ()=>{ if (THEME.mode === 'auto') applyTheme('auto', true); }; if (MQ_DARK.addEventListener) MQ_DARK.addEventListener('change', f); else if (MQ_DARK.addListener) MQ_DARK.addListener(f); }
  applyTheme(THEME.mode, false);
  const hdr = document.querySelector('.topbar');
  if (hdr && window.ResizeObserver) new ResizeObserver(()=>document.documentElement.style.setProperty('--hdr', hdr.offsetHeight + 'px')).observe(hdr);
}
