// ================= 3D-ОФИС (Three.js): реалистичная комната, свет, фигуры =================
// Логика агентов остаётся в scene.js (координаты пола X 0..430, Y 0..205, Z вверх).
// Здесь — только отрисовка. В three.js: x = X, y = Z (вверх), z = Y.
const O3 = (()=>{
  let THREE = null, RoomEnvironment = null, RoundedBoxGeometry = null;
  let renderer = null, scene = null, camera = null;
  let ok = false, failed = false, building = null;
  const st = {w:0, h:0, dpr:1, az:0, el:0, zoom:1, drag:null, lastT:0};
  const FIG = {}, DYN = {}, M = {}, LAMPS = [];
  let planeMeshes = [], selRing = null, hovRing = null, mugs = {}, bell = null, avatarsDone = false;
  const PLATES = [], SCREENS = [], PLANTS = [[46, 30, true], [418, 126, true], [40, 192, false], [342, 188, false]];
  const deg = Math.PI/180;
  const T = {x:224, y:30, z:104};
  const FACE_YAW = {SE: Math.PI/2, NW: -Math.PI/2, SW: 0, NE: Math.PI};
  const FS = 0.9;   // масштаб фигур

  // ---------- запуск ----------
  function init(canvas){
    if (ok) return Promise.resolve(true);
    if (failed) return Promise.resolve(false);
    if (building) return building;
    building = (async ()=>{
      try {
        THREE = await import('three');
        ({RoomEnvironment} = await import('three/addons/environments/RoomEnvironment.js'));
        ({RoundedBoxGeometry} = await import('three/addons/geometries/RoundedBoxGeometry.js'));
        renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true, powerPreference:'high-performance'});
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        scene = new THREE.Scene(); scene.background = null;
        const pm = new THREE.PMREMGenerator(renderer);
        scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.32;
        camera = new THREE.PerspectiveCamera(28, 1.47, 20, 5000);
        buildMaterials(); buildRoom(); buildFurniture(); buildDecor(); buildLights();
        for (const a of AG_LIST) FIG[a.id] = makeFigure(a);
        buildPlanes();
        setStyle(STYLE0, {redraw:false});
        loadModels();
        loadProps();
        loadWindowPhotos();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(()=>{ for (const k in DYN) DYN[k].last = -1; refreshStaticText(); });
        ok = true;
      } catch (e) { console.warn('[3D] недоступно, остаётся 2D:', e); failed = true; }
      return ok;
    })();
    return building;
  }

  // ---------- хелперы ----------
  function std(color, o={}){ return new THREE.MeshStandardMaterial({color, roughness:0.7, ...o}); }
  function phys(color, o={}){ return new THREE.MeshPhysicalMaterial({color, roughness:0.5, ...o}); }
  // группы мебели: процедурные детали собираются в группу, которую потом заменяет модель
  let CUR = null; const GRP = {};
  function grp(name){ const g = new THREE.Group(); g.name = name; scene.add(g); GRP[name] = g; CUR = g; return g; }
  function put(o){ (CUR || scene).add(o); return o; }
  function add(mesh, shadow=true){ mesh.castShadow = shadow; mesh.receiveShadow = true; put(mesh); return mesh; }
  function boxAt(x0, y0, z0, dx, dy, dz, mat, r=0, parent=null, shadow=true){
    const g = r > 0 ? new RoundedBoxGeometry(dx, dz, dy, 3, Math.min(r, dx/2-0.01, dy/2-0.01, dz/2-0.01)) : new THREE.BoxGeometry(dx, dz, dy);
    const m = new THREE.Mesh(g, mat); m.position.set(x0+dx/2, z0+dz/2, y0+dy/2);
    m.castShadow = shadow; m.receiveShadow = true; (parent || CUR || scene).add(m); return m;
  }
  function cylAt(x, y, z0, r, h, mat, seg=28, rTop=null, parent=null, open=false){
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop ?? r, r, h, seg, 1, open), mat);
    m.position.set(x, z0+h/2, y); m.castShadow = true; m.receiveShadow = true; (parent || CUR || scene).add(m); return m;
  }
  function sphereAt(x, y, z, r, mat, parent=null){ const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat); m.position.set(x, z, y); m.castShadow = true; (parent || CUR || scene).add(m); return m; }
  // плоскость на стене A (Y=0, лицом к +Y) или на стене B (X=0, лицом к +X); u — вдоль стены, z — высота центра
  function wallPlane(wall, u, z, w, h, mat, off=0.4){
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    if (wall==='A'){ m.position.set(u, z, off); }
    else { m.position.set(off, z, u); m.rotation.y = Math.PI/2; }
    m.receiveShadow = true; scene.add(m); return m;
  }
  function canvasTex(w, h, draw, opts={}){
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); draw(c, w, h);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (opts.repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opts.repeat); }
    t.userData = {cv, c, draw};
    return t;
  }
  function redraw(t){ const {cv, c, draw} = t.userData; c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,cv.width,cv.height); draw(c, cv.width, cv.height); t.needsUpdate = true; }
  function noise(c, w, h, n, col, a){ c.fillStyle = col; c.globalAlpha = a; for (let i=0;i<n;i++){ c.fillRect(Math.random()*w, Math.random()*h, 1+Math.random()*2, 1); } c.globalAlpha = 1; }
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif', MONO = '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, monospace';


  // ================= СТИЛИ ИНТЕРЬЕРА =================
  // Каждый стиль задаёт отделку (стены, панели, панели внизу, пол), дерево отделки, металл, текстиль, ковры и свет.
  // Текстуры рисуются заново при смене стиля; геометрия комнаты и мебель не меняются.
  const STYLES = {
    club: {name:'Клуб (сейчас)',
      floor:{kind:'planks', tones:['#6a432c','#613c27','#72492f','#5b3824','#674029','#6e452c'], seam:'rgba(20,10,5,.55)', grain:'#2a170d', rough:0.48, clear:0.35},
      wall:{kind:'walnut', c:['#4a2a19','#563320','#462817'], rough:0.45, clear:0.5},
      main:{kind:'plaid', base:'#18203a', bands:'rgba(190,150,100,.55)|rgba(205,165,110,.75)|rgba(70,45,30,.6)|rgba(180,140,92,.42)|rgba(40,30,30,.5)', rough:0.95, clear:0},
      alt:{kind:'wood', c:['#4a2a19','#563320','#462817'], tint:'#d8c8b8', rough:0.42, clear:0.55},
      wains:{kind:'panels', c:['#55321f','#3a2214'], rough:0.42, clear:0.45},
      trim:['#5a2e1d','#71402a','#3b1d12'], metal:['#caa04c', 0.28], gilt:'#d4ae5c', drape:['#5e1a24','#c45a68'], cap:'#ece2cd',
      rug:{kind:'persian'}, art:'landscape', board:{bg:'#21402f', grain:'#0b1a10', title:'#d9b867'},
      light:{lamp:'#ffd79a', floor:'#ffc98a', mul:1, spot:'#ffdcaa', expDay:1.0, expNight:1.08, envDay:0.62, envNight:0.32, hemiNight:'#ffe9cf'}},
    mayfair: {name:'Мэйфэр',
      floor:{kind:'herring', tones:['#4b3020','#57381f','#603f27','#452a1a','#5a3a25'], seam:'rgba(15,8,4,.6)', grain:'#22130a', rough:0.42, clear:0.5},
      wall:{kind:'lacquer', c:['#1d3a2e','#234537'], rough:0.22, clear:0.9},
      main:{kind:'plaid', base:'#16271f', bands:'rgba(25,35,70,.75)|rgba(140,40,40,.85)|rgba(10,18,14,.6)|rgba(28,40,78,.55)|rgba(196,160,90,.55)', rough:0.95, clear:0},
      alt:{kind:'wood', c:['#4e2c1a','#5d3622','#472716'], tint:'#e4d4c2', rough:0.38, clear:0.6},
      wains:{kind:'panels', c:['#24443a','#163026'], rough:0.25, clear:0.85},
      trim:['#4a2a1a','#6a3e26','#2e180e'], metal:['#b48c4c', 0.36], gilt:'#c9a256', drape:['#4a1018','#a8404e'], cap:'#e7dcc4',
      art:'landscape', board:{bg:'#1d3a2e', grain:'#0b1a10', title:'#d4b06a'},
      rug:{kind:'persian', pal:{ivory:'#e0cfae', cream:'#ecdfc4', navy:'#1d2a4a', navy2:'#2a3b63', blue:'#4d6e98', sky:'#93abc6', gold:'#b8893a', olive:'#5d6b35', rust:'#9a3b2b', tan:'#b98d5c', ink:'#24202a', wine:'#7a2324', wine2:'#8f2f2a'}},
      light:{lamp:'#ffcb86', floor:'#ffbf7a', mul:1.15, spot:'#ffd29a', expDay:0.98, expNight:1.05, envDay:0.55, envNight:0.28, hemiNight:'#ffdfc0'}},
    manhattan: {name:'Манхэттен', props:'manhattan', pendants:true,
      floor:{kind:'wide', tones:['#2c2724','#332c28','#28231f','#37302b','#2f2925'], seam:'rgba(0,0,0,.6)', grain:'#120e0c', rough:0.55, clear:0.2},
      wall:{kind:'slats', c:['#3b2c23','#46342a','#110b08'], rough:0.6, clear:0.15},
      main:{kind:'marble', base:'#111113', vein:'#d9d4cb', vein2:'#8d8a86', rough:0.12, clear:1},
      alt:{kind:'lacquer', c:['#151517','#1d1d20'], rough:0.18, clear:0.95},
      wains:{kind:'plain', c:['#1c1815','#14110f'], rough:0.4, clear:0.4},
      trim:['#141416','#1d1d20','#0b0b0c'], metal:['#a88b5e', 0.3], gilt:'#b39668', drape:['#2b2b2f','#5a5a62'], cap:'#2a2826',
      rug:{kind:'modern', pal:{field:'#3b3936', field2:'#34322f', border:'#262422', line:'#a88b5e'}}, art:'abstract-dark', board:{bg:'#1b1b1e', grain:'#000000', title:'#c8a97e'},
      light:{lamp:'#ffc487', floor:'#ffb877', mul:1.35, spot:'#ffcf96', expDay:0.95, expNight:1.12, envDay:0.5, envNight:0.24, hemiNight:'#ffd9b0'}},
    riviera: {name:'Ривьера',
      floor:{kind:'chevron', tones:['#b57d47','#a9733f','#c18a54','#9f6a3a','#b98149'], seam:'rgba(60,30,10,.45)', grain:'#6b4220', rough:0.4, clear:0.55},
      wall:{kind:'fluted', c:['#efe6d6','#d9cdb9'], rough:0.3, clear:0.7},
      main:{kind:'marble', base:'#f2ede4', vein:'#9c9182', vein2:'#c9a35a', rough:0.14, clear:1},
      alt:{kind:'lacquer', c:['#0f4a3a','#145a47'], rough:0.16, clear:0.95},
      wains:{kind:'panels', c:['#ebe0cd','#d8cab2'], rough:0.3, clear:0.7},
      trim:['#e7dccb','#f1e8da','#cbbca3'], metal:['#d6b15c', 0.2], gilt:'#dcb763', drape:['#0d4234','#3d8a6c'], cap:'#f3ece0',
      rug:{kind:'deco', pal:{field:'#0f4a3a', field2:'#0c3f31', motif:'#efe4cf', border:'#c9a35a', ink:'#0a2e24'}}, art:'landscape', board:{bg:'#0f4a3a', grain:'#06261d', title:'#d6b15c'},
      light:{lamp:'#ffdcae', floor:'#ffd09a', mul:0.95, spot:'#ffe2b8', expDay:1.04, expNight:1.05, envDay:0.7, envNight:0.34, hemiNight:'#ffe8d0'}},
    zurich: {name:'Цюрих',
      floor:{kind:'wide', tones:['#cdb79a','#c7b093','#d5c0a4','#c1a98b','#cbb496'], seam:'rgba(90,70,50,.35)', grain:'#8f765a', rough:0.62, clear:0.08},
      wall:{kind:'plaster', c:['#d9cebf','#cfc3b2','#e2d8ca'], rough:0.92, clear:0},
      main:{kind:'slats', c:['#b99b75','#c4a681','#5e4a37'], rough:0.6, clear:0.1},
      alt:{kind:'fabric', c:['#57524c','#4a4540','#655f58'], rough:1, clear:0},
      wains:{kind:'plain', c:['#cbbfae','#c0b3a1'], rough:0.85, clear:0},
      trim:['#b08f68','#c4a47c','#8c6f4f'], metal:['#b9bdc3', 0.34], gilt:'#c2c4c8', drape:['#d4cab8','#ebe3d6'], cap:'#e9e3d9',
      rug:{kind:'modern', pal:{field:'#dbd2c3', field2:'#d2c8b8', border:'#c6b9a6', line:'#8d9688'}}, art:'abstract-light', board:{bg:'#4a4641', grain:'#2a2724', title:'#e6ddd0'},
      light:{lamp:'#ffe6c8', floor:'#ffdcb4', mul:0.9, spot:'#fff0d8', expDay:1.02, expNight:1.0, envDay:0.75, envNight:0.36, hemiNight:'#fff0e0'}},
  };
  const STYLE0 = (()=>{ try { const q = new URLSearchParams(location.search).get('style'); if (q && STYLES[q]) return q; } catch {} return 'manhattan'; })();
  let STY = STYLES[STYLE0];
  const STYLE_TEX = [];   // текстуры, которые перерисовываются при смене стиля
  const PANELS = [];      // настенные панели: {mat, tex, role, w, h}
  const PENDANTS = [];    // подвесные светильники: [x, y, z]
  const GLOWS = [];       // светящиеся материалы (подсветка винного шкафа): {m, day, night}
  const pick = (arr, i) => arr[Math.abs(i) % arr.length];

  // --- пол ---
  function drawFloor(c, w, h){
    const f = STY.floor, R = rng(5);
    c.fillStyle = f.tones[0]; c.fillRect(0, 0, w, h);
    const grainIn = (len, wd)=>{ c.globalAlpha = 0.16; c.strokeStyle = f.grain; c.lineWidth = 1;
      for (let k=0;k<6;k++){ c.beginPath(); const yy = wd*(0.12 + k*0.15); c.moveTo(0, yy); for (let xx=0; xx<=len; xx+=30) c.lineTo(xx, yy + Math.sin(xx*0.025 + k*1.7)*wd*0.06); c.stroke(); } c.globalAlpha = 1; };
    const plank = (len, wd, col)=>{ const g = c.createLinearGradient(0, 0, len, 0); g.addColorStop(0, col); g.addColorStop(0.5, pick(f.tones, (R()*99)|0)); g.addColorStop(1, col);
      c.fillStyle = g; c.fillRect(0, 0, len, wd); grainIn(len, wd); c.strokeStyle = f.seam; c.lineWidth = 2; c.strokeRect(0, 0, len, wd); };
    if (f.kind === 'planks' || f.kind === 'wide'){
      const rows = f.kind === 'wide' ? 7 : 12, ph = h/rows;
      for (let r=0; r<rows; r++){ let x = -((r*97)%260) * (f.kind === 'wide' ? 1.6 : 1);
        while (x < w){ const len = f.kind === 'wide' ? 620 + ((R()*4)|0)*140 : 220 + ((R()*3)|0)*90; c.save(); c.translate(x, r*ph); plank(len, ph, pick(f.tones, (R()*99)|0)); c.restore(); x += len; } }
    } else if (f.kind === 'herring'){
      // «ёлочка»: в повёрнутой на 45° системе — лесенка из горизонтальных и вертикальных досок; период по x = √2·a, по y = √2·b
      const b = 1024/16/Math.SQRT2 * (w/1024), a = 4*b, S = Math.SQRT1_2;
      c.save(); c.transform(S, S, -S, S, 0, 0);   // (u, v) → x = (u − v)/√2, y = (u + v)/√2
      for (let m=-14; m<=14; m++) for (let k=-30; k<=40; k++){
        const ou = k*b + m*a, ov = k*b - m*a;
        c.save(); c.translate(ou, ov); plank(a, b, pick(f.tones, (R()*99)|0)); c.restore();
        c.save(); c.translate(ou + a, ov + b - a); c.rotate(Math.PI/2); c.translate(0, -b); plank(a, b, pick(f.tones, (R()*99)|0)); c.restore();
      }
      c.restore();
    } else if (f.kind === 'chevron'){
      const cols = 4, cw = w/cols, half = cw/2, step = h/Math.round(h/(half*0.36));
      for (let col=0; col<cols; col++){ const x0 = col*cw;
        for (let y = -half; y < h + half; y += step){
          for (const side of [0, 1]){ const tone = pick(f.tones, (R()*99)|0);
            c.beginPath();
            if (!side){ c.moveTo(x0, y + half); c.lineTo(x0 + half, y); c.lineTo(x0 + half, y + step); c.lineTo(x0, y + half + step); }
            else { c.moveTo(x0 + half, y); c.lineTo(x0 + cw, y + half); c.lineTo(x0 + cw, y + half + step); c.lineTo(x0 + half, y + step); }
            c.closePath(); c.fillStyle = tone; c.fill(); c.strokeStyle = f.seam; c.lineWidth = 2; c.stroke();
            c.save(); c.clip(); c.globalAlpha = 0.14; c.strokeStyle = f.grain; c.lineWidth = 1;
            for (let k=1;k<5;k++){ c.beginPath(); const dy = step*k/5; if (!side){ c.moveTo(x0, y + half + dy); c.lineTo(x0 + half, y + dy); } else { c.moveTo(x0 + half, y + dy); c.lineTo(x0 + cw, y + half + dy); } c.stroke(); }
            c.restore(); c.globalAlpha = 1; } } }
    }
    noise(c, w, h, 9000, '#000000', 0.08);
  }

  // --- стены (тайл, повторяется вдоль стены) ---
  function drawWall(c, w, h, spec){
    const k = spec || STY.wall, col = k.c;
    if (k.kind === 'walnut'){
      const g = c.createLinearGradient(0,0,w,0); g.addColorStop(0,col[0]); g.addColorStop(0.5,col[1]); g.addColorStop(1,col[2]||col[0]); c.fillStyle = g; c.fillRect(0,0,w,h);
      for (let i=0;i<70;i++){ const x0 = (i*37 % w) + Math.sin(i)*6; c.strokeStyle = i%3 ? 'rgba(25,12,6,.22)' : 'rgba(120,72,40,.18)'; c.lineWidth = 1 + (i%4); c.beginPath();
        for (let y=0; y<=h; y+=16){ const x = x0 + Math.sin(y*0.012 + i)*5 + Math.sin(y*0.05 + i*2)*1.5; y ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
      for (let i=0;i<6;i++){ const cx = (i*173)%w, cy = (i*311)%h; c.strokeStyle = 'rgba(30,14,6,.18)'; c.lineWidth = 1.5; for (let r=4;r<26;r+=4){ c.beginPath(); c.ellipse(cx, cy, r*0.6, r*2.2, 0, 0, Math.PI*2); c.stroke(); } }
      noise(c, w, h, 12000, '#1a0c05', 0.10);
    } else if (k.kind === 'lacquer'){
      const g = c.createLinearGradient(0,0,0,h); g.addColorStop(0,col[1]); g.addColorStop(1,col[0]); c.fillStyle = g; c.fillRect(0,0,w,h);
      noise(c, w, h, 4000, '#000000', 0.04);
    } else if (k.kind === 'plaster'){
      c.fillStyle = col[0]; c.fillRect(0,0,w,h); const R = rng(9);
      for (let i=0;i<160;i++){ const x = R()*w, y = R()*h, r = 30 + R()*120, g = c.createRadialGradient(x, y, 0, x, y, r); const cc = i%2 ? col[1] : (col[2]||col[0]);
        g.addColorStop(0, cc); g.addColorStop(1, 'rgba(0,0,0,0)'); c.globalAlpha = 0.35; c.fillStyle = g; c.fillRect(x-r, y-r, r*2, r*2); }
      c.globalAlpha = 1; noise(c, w, h, 30000, '#ffffff', 0.05); noise(c, w, h, 30000, '#000000', 0.05);
    } else if (k.kind === 'slats'){
      c.fillStyle = col[2]; c.fillRect(0,0,w,h);
      const n = 8, sw = w/n, gap = sw*0.18;
      for (let i=0;i<n;i++){ const x = i*sw + gap/2, g = c.createLinearGradient(x, 0, x + sw - gap, 0); g.addColorStop(0, col[0]); g.addColorStop(0.5, col[1]); g.addColorStop(1, col[0]);
        c.fillStyle = g; c.fillRect(x, 0, sw - gap, h);
        c.globalAlpha = 0.18; c.strokeStyle = '#000'; for (let j=0;j<5;j++){ c.beginPath(); const xx = x + (sw - gap)*(0.15 + j*0.17); c.moveTo(xx, 0); for (let y=0;y<=h;y+=24) c.lineTo(xx + Math.sin(y*0.02 + i + j)*1.5, y); c.stroke(); } c.globalAlpha = 1;
        const sh = c.createLinearGradient(x + sw - gap, 0, x + sw, 0); sh.addColorStop(0, 'rgba(0,0,0,.55)'); sh.addColorStop(1, 'rgba(0,0,0,.1)'); c.fillStyle = sh; c.fillRect(x + sw - gap, 0, gap, h); }
      noise(c, w, h, 8000, '#000000', 0.06);
    } else if (k.kind === 'fluted'){
      const n = 10, fw = w/n;
      for (let i=0;i<n;i++){ const x = i*fw, g = c.createLinearGradient(x, 0, x + fw, 0);
        g.addColorStop(0, shade(col[1], -0.12)); g.addColorStop(0.18, col[1]); g.addColorStop(0.45, col[0]); g.addColorStop(0.62, shade(col[0], 0.05)); g.addColorStop(0.9, col[1]); g.addColorStop(1, shade(col[1], -0.18));
        c.fillStyle = g; c.fillRect(x, 0, fw, h); }
      noise(c, w, h, 6000, '#000000', 0.04);
    }
  }
  function shade(hex, k){ const n = parseInt(hex.slice(1), 16); let r = n>>16, g = (n>>8)&255, b = n&255; const f = k < 0 ? 0 : 255, t = Math.abs(k);
    r = Math.round(r + (f - r)*t); g = Math.round(g + (f - g)*t); b = Math.round(b + (f - b)*t); return `rgb(${r},${g},${b})`; }

  // --- настенные панели: рисуются целиком под размер панели ---
  function drawPanel(c, w, h, spec, ppu){
    const k = spec, col = k.c || [];
    if (k.kind === 'plaid'){
      const tile = document.createElement('canvas'); tile.width = tile.height = 512; const t = tile.getContext('2d');
      drawPlaid(t, 512, 512, k);
      const pat = c.createPattern(tile, 'repeat'), sc = 13*ppu/512; c.save(); c.scale(sc, sc); c.fillStyle = pat; c.fillRect(0, 0, w/sc, h/sc); c.restore();
    } else if (k.kind === 'wood'){
      const tile = document.createElement('canvas'); tile.width = 512; tile.height = 1024; drawWall(tile.getContext('2d'), 512, 1024, {kind:'walnut', c:k.c});
      const pat = c.createPattern(tile, 'repeat'), sc = 34*ppu/512; c.save(); c.scale(sc, h/1024); c.fillStyle = pat; c.fillRect(0, 0, w/sc, 1024); c.restore();
    } else if (k.kind === 'marble'){
      c.fillStyle = k.base; c.fillRect(0, 0, w, h); const R = rng(Math.round(w*7 + h));
      // облачные пятна
      for (let i=0;i<40;i++){ const x = R()*w, y = R()*h, r = (0.1 + R()*0.3)*Math.max(w, h), g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, k.vein2); g.addColorStop(1, 'rgba(0,0,0,0)'); c.globalAlpha = 0.05; c.fillStyle = g; c.fillRect(x-r, y-r, r*2, r*2); }
      c.globalAlpha = 1;
      const vein = (wd, alpha, color)=>{ let x = R()*w, y = -h*0.1; const ang = 0.7 + R()*0.9; c.strokeStyle = color; c.globalAlpha = alpha; c.lineWidth = wd; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y);
        while (y < h*1.1 && x > -w*0.2 && x < w*1.2){ const st = 12 + R()*30; x += Math.cos(ang + (R() - 0.5)*1.3)*st*(R() < 0.5 ? 1 : 0.6); y += Math.sin(ang)*st; c.lineTo(x, y); } c.stroke(); c.globalAlpha = 1; };
      for (let i=0;i<5;i++){ c.shadowColor = k.vein; c.shadowBlur = 6; vein(2.2 + R()*2.5, 0.75, k.vein); c.shadowBlur = 0; }
      for (let i=0;i<14;i++) vein(0.6 + R()*0.9, 0.45, i%3 ? k.vein : k.vein2);
      for (let i=0;i<4;i++) vein(1.2, 0.7, k.vein2);
      noise(c, w, h, w*h/30, '#ffffff', 0.03);
    } else if (k.kind === 'lacquer'){
      const g = c.createLinearGradient(0, 0, w*0.6, h); g.addColorStop(0, col[1]); g.addColorStop(1, col[0]); c.fillStyle = g; c.fillRect(0, 0, w, h);
      noise(c, w, h, w*h/60, '#000000', 0.03);
    } else if (k.kind === 'fabric'){
      c.fillStyle = col[0]; c.fillRect(0, 0, w, h); const R = rng(3);
      for (let i=0;i<w*h/14;i++){ const x = R()*w, y = R()*h; c.fillStyle = R() < 0.5 ? col[1] : (col[2]||col[0]); c.globalAlpha = 0.55; c.beginPath(); c.arc(x, y, 0.8 + R()*1.6, 0, Math.PI*2); c.fill(); }
      c.globalAlpha = 1; noise(c, w, h, w*h/8, '#000000', 0.05);
    } else if (k.kind === 'slats' || k.kind === 'fluted'){
      const tile = document.createElement('canvas'); tile.width = 512; tile.height = 512; drawWall(tile.getContext('2d'), 512, 512, {kind:k.kind, c:k.c});
      const pat = c.createPattern(tile, 'repeat'), sc = (k.kind === 'slats' ? 40 : 30)*ppu/512; c.save(); c.scale(sc, h/512); c.fillStyle = pat; c.fillRect(0, 0, w/sc, 512); c.restore();
    }
  }
  // абстрактная живопись для современных стилей: крупные плоскости, дуга и мазок
  function drawAbstractArt(c, w, h, light){
    const bg = light ? '#ece6dc' : '#18181a', a1 = light ? '#b9a58a' : '#a88b5e', a2 = light ? '#5d5a55' : '#d9d4cb', a3 = light ? '#8d9688' : '#3a3633';
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = a3; c.fillRect(w*0.08, h*0.52, w*0.5, h*0.36);
    c.beginPath(); c.arc(w*0.66, h*0.42, h*0.3, 0, Math.PI*2); c.fillStyle = a1; c.fill();
    c.strokeStyle = a2; c.lineWidth = h*0.05; c.lineCap = 'round'; c.beginPath(); c.moveTo(w*0.12, h*0.28); c.bezierCurveTo(w*0.36, h*0.12, w*0.52, h*0.7, w*0.9, h*0.62); c.stroke();
    c.fillStyle = a2; c.globalAlpha = 0.85; c.fillRect(w*0.74, h*0.12, w*0.012, h*0.76); c.globalAlpha = 1;
    noise(c, w, h, 9000, light ? '#000000' : '#ffffff', 0.05);
  }
  function drawPlaid(c, w, h, k){
    c.fillStyle = k.base; c.fillRect(0,0,w,h);
    const cols = k.bands.split('|');
    const bands = [[0.02,0.10,0],[0.14,0.02,1],[0.18,0.02,1],[0.34,0.012,2],[0.48,0.16,3],[0.53,0.018,4],[0.59,0.018,4],[0.75,0.02,1],[0.86,0.01,1]];
    for (const [p0, wd, ci] of bands){ c.fillStyle = cols[ci % cols.length]; c.fillRect(p0*w, 0, wd*w, h); c.fillRect(0, p0*h, w, wd*h); }
    c.globalAlpha = 0.10; c.strokeStyle = '#000'; c.lineWidth = 1; for (let i=-h; i<w; i+=4){ c.beginPath(); c.moveTo(i, 0); c.lineTo(i+h, h); c.stroke(); } c.globalAlpha = 1;
    noise(c, w, h, 26000, '#ffffff', 0.05); noise(c, w, h, 26000, '#000000', 0.10);
  }

  // --- ковры: современный и ар-деко ---
  function drawModernRunner(c, w, h){
    const P = STY.rug.pal; c.clearRect(0, 0, w, h);
    c.fillStyle = P.border; c.fillRect(0, 0, w, h);
    const b = h*0.11; c.fillStyle = P.field; c.fillRect(b, b, w - b*2, h - b*2);
    c.strokeStyle = P.line; c.lineWidth = Math.max(2, h*0.008); c.strokeRect(b*0.55, b*0.55, w - b*1.1, h - b*1.1);
    const R = rng(4); for (let i=0;i<w*h/90;i++){ c.fillStyle = R() < 0.5 ? P.field2 : P.border; c.globalAlpha = 0.25; c.fillRect(R()*w, R()*h, 2, 2); }
    c.globalAlpha = 1; weave(c, w, h, Math.max(3, Math.round(h/220)), 0.04);
  }
  function drawModernRound(c, w, h){
    const P = STY.rug.pal, R0 = w/2; c.clearRect(0, 0, w, h); c.save(); c.translate(R0, R0);
    const ring = (r, col)=>{ c.beginPath(); c.arc(0, 0, R0*r, 0, Math.PI*2); c.fillStyle = col; c.fill(); };
    ring(0.97, P.border); ring(0.86, P.field); c.strokeStyle = P.line; c.lineWidth = Math.max(2, w*0.004); c.beginPath(); c.arc(0, 0, R0*0.915, 0, Math.PI*2); c.stroke();
    c.restore(); const R = rng(6); for (let i=0;i<w*h/90;i++){ c.fillStyle = R() < 0.5 ? P.field2 : P.border; c.globalAlpha = 0.25; c.fillRect(R()*w, R()*h, 2, 2); } c.globalAlpha = 1;
    c.save(); c.globalCompositeOperation = 'destination-in'; c.beginPath(); c.arc(R0, R0, R0*0.97, 0, Math.PI*2); c.fill(); c.restore();
    c.save(); c.beginPath(); c.arc(R0, R0, R0*0.97, 0, Math.PI*2); c.clip(); weave(c, w, h, Math.max(3, Math.round(w/400)), 0.04); c.restore();
  }
  function drawDecoRunner(c, w, h){
    const P = STY.rug.pal; c.clearRect(0, 0, w, h);
    c.fillStyle = P.border; c.fillRect(0, 0, w, h);
    const b = h*0.07; c.fillStyle = P.field; c.fillRect(b, b, w - b*2, h - b*2);
    c.strokeStyle = P.border; c.lineWidth = h*0.012; c.strokeRect(b*1.6, b*1.6, w - b*3.2, h - b*3.2);
    // веера ар-деко
    const fy0 = b*2.3, fh = h - fy0*2, r = fh*0.42;
    for (let x = fy0 + r, i = 0; x < w - fy0 - r*0.5; x += r*1.9, i++){
      for (const [cy, dir] of [[fy0 + fh*0.5 + r*0.45, -1], [fy0 + fh*0.5 - r*0.45, 1]]){
        c.save(); c.translate(x + (dir < 0 ? 0 : r*0.95), cy);
        for (let k=0;k<9;k++){ const a0 = (dir < 0 ? Math.PI : 0) + k/9*Math.PI, a1 = a0 + Math.PI/9*0.82;
          c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, a0, a1); c.closePath(); c.fillStyle = k%2 ? P.motif : P.field2; c.fill(); }
        c.beginPath(); c.arc(0, 0, r*0.3, dir < 0 ? Math.PI : 0, dir < 0 ? Math.PI*2 : Math.PI); c.fillStyle = P.border; c.fill();
        c.strokeStyle = P.border; c.lineWidth = r*0.035; c.beginPath(); c.arc(0, 0, r*1.06, dir < 0 ? Math.PI : 0, dir < 0 ? Math.PI*2 : Math.PI); c.stroke();
        c.restore(); } }
    weave(c, w, h, Math.max(3, Math.round(h/220)), 0.05);
  }
  function drawDecoRound(c, w, h){
    const P = STY.rug.pal, R0 = w/2; c.clearRect(0, 0, w, h); c.save(); c.translate(R0, R0);
    const ring = (r, col)=>{ c.beginPath(); c.arc(0, 0, R0*r, 0, Math.PI*2); c.fillStyle = col; c.fill(); };
    ring(0.97, P.border); ring(0.92, P.field); ring(0.84, P.border); ring(0.82, P.field);
    for (let k=0;k<32;k++){ const a0 = k/32*Math.PI*2, a1 = a0 + Math.PI*2/32*0.6; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R0*0.7, a0, a1); c.closePath(); c.fillStyle = k%2 ? P.motif : P.field2; c.fill(); }
    ring(0.4, P.field); ring(0.36, P.border); ring(0.3, P.field2);
    for (let k=0;k<8;k++){ c.save(); c.rotate(k*Math.PI/4); c.beginPath(); c.moveTo(0, -R0*0.06); c.lineTo(R0*0.24, 0); c.lineTo(0, R0*0.06); c.closePath(); c.fillStyle = P.motif; c.fill(); c.restore(); }
    ring(0.07, P.border); c.restore();
    c.save(); c.globalCompositeOperation = 'destination-in'; c.beginPath(); c.arc(R0, R0, R0*0.97, 0, Math.PI*2); c.fill(); c.restore();
    c.save(); c.beginPath(); c.arc(R0, R0, R0*0.97, 0, Math.PI*2); c.clip(); weave(c, w, h, Math.max(3, Math.round(w/400)), 0.05); c.restore();
  }

  // --- смена стиля ---
  const RUG_BASE = {};
  function setStyle(name, opts = {}){
    const s = STYLES[name]; if (!s) return false; STY = s;
    if (!THREE || !scene) return true;
    Object.assign(RUG, RUG_BASE, (s.rug && s.rug.pal) || {});
    if (opts.redraw !== false){ for (const t of STYLE_TEX) redraw(t); for (const p of PANELS) restylePanel(p); if (DYN.board) DYN.board.last = -1; }
    const W = s.wall, F = s.floor, Wn = s.wains;
    Object.assign(M.floor, {roughness:F.rough, clearcoat:F.clear});
    for (const m of [M.wallA, M.wallB]) Object.assign(m, {roughness:W.rough, clearcoat:W.clear});
    for (const m of [M.wainsA, M.wainsB]) Object.assign(m, {roughness:Wn.rough, clearcoat:Wn.clear});
    M.mahog.color.set(s.trim[0]); M.mahogL.color.set(s.trim[1]); M.mahogD.color.set(s.trim[2]);
    M.brass.color.set(s.metal[0]); M.brass.roughness = s.metal[1]; M.gilt.color.set(s.gilt);
    M.velvet.color.set(s.drape[0]); M.velvet.sheenColor.set(s.drape[1]);
    M.cream.color.set(s.cap);
    if (GRP.pendants) GRP.pendants.visible = !!s.pendants; for (const l of LIGHT.pendants || []) l.visible = !!s.pendants;
    for (const l of LIGHT.lamps){ if (l.userData.kind === 'pendant' || l.userData.kind === 'wine') continue; if (l.isSpotLight) l.color.set(s.light.spot); else l.color.set(l.userData.kind === 'floor' ? s.light.floor : s.light.lamp); }
    applyDay();
    return true;
  }
  function restylePanel(p){
    const spec = STY[p.role]; redraw(p.tex);
    const ph = spec.kind === 'marble' || spec.kind === 'lacquer';
    Object.assign(p.mat, {roughness:spec.rough, clearcoat:spec.clear ?? 0, clearcoatRoughness:ph ? 0.08 : 0.3});
    p.mat.color.set(spec.tint || '#ffffff'); p.mat.needsUpdate = true;
  }

  // ---------- материалы ----------
  function buildMaterials(){
    const wood = canvasTex(1024, 1024, drawFloor, {repeat:[3.2, 1.6]}); STYLE_TEX.push(wood);
    M.floor = phys('#ffffff', {map:wood, roughness:0.48, clearcoat:0.35, clearcoatRoughness:0.35});
    M.slab = phys('#3b2418', {roughness:0.55});
    M.slabTrim = phys('#6e4630', {roughness:0.45, clearcoat:0.4});
    // стены, панели и пол рисуются по текущему стилю (см. STYLES)
    const wtA = canvasTex(512, 1024, (c, w, h)=>drawWall(c, w, h), {repeat:[FW/34, 1]}), wtB = canvasTex(512, 1024, (c, w, h)=>drawWall(c, w, h), {repeat:[FD/34, 1]}); STYLE_TEX.push(wtA, wtB);
    M.wallA = phys('#ffffff', {map:wtA, roughness:0.45, clearcoat:0.5, clearcoatRoughness:0.3});
    M.wallB = phys('#ffffff', {map:wtB, roughness:0.45, clearcoat:0.5, clearcoatRoughness:0.3});
    const waA = wainsTex(430), waB = wainsTex(205); STYLE_TEX.push(waA, waB);
    M.wainsA = phys('#ffffff', {map:waA, roughness:0.42, clearcoat:0.45, clearcoatRoughness:0.3});
    M.wainsB = phys('#ffffff', {map:waB, roughness:0.42, clearcoat:0.45, clearcoatRoughness:0.3});
    M.mahog = phys('#5a2e1d', {roughness:0.4, clearcoat:0.65, clearcoatRoughness:0.22});
    M.mahogL = phys('#71402a', {roughness:0.38, clearcoat:0.6, clearcoatRoughness:0.25});
    M.mahogD = phys('#3b1d12', {roughness:0.45, clearcoat:0.5, clearcoatRoughness:0.3});
    M.brass = std('#caa04c', {metalness:1, roughness:0.28});
    M.gilt = std('#d4ae5c', {metalness:1, roughness:0.35});
    M.steel = std('#c7ccd6', {metalness:0.9, roughness:0.3});
    M.ox = phys('#6b2324', {roughness:0.52, clearcoat:0.35, clearcoatRoughness:0.45, sheen:0.35, sheenColor:new THREE.Color('#b04848')});
    M.cog = phys('#8a4824', {roughness:0.5, clearcoat:0.4, clearcoatRoughness:0.4, sheen:0.3, sheenColor:new THREE.Color('#d08050')});
    M.cogL = phys('#9a5630', {roughness:0.5, clearcoat:0.4, clearcoatRoughness:0.4});
    M.green = std('#2c4a39', {roughness:0.68});
    M.velvet = phys('#5e1a24', {roughness:0.92, sheen:1, sheenRoughness:0.45, sheenColor:new THREE.Color('#c45a68'), side:THREE.DoubleSide});
    M.cream = std('#ece2cd', {roughness:0.85});
    M.paper = std('#f6f1e6', {roughness:0.9});
    M.dark = std('#1b1c22', {roughness:0.35, metalness:0.3});
    M.plastic = std('#2a2b33', {roughness:0.4});
    M.glass = phys('#d8e8f0', {roughness:0.04, transparent:true, opacity:0.28, metalness:0, clearcoat:1});
    M.amber = phys('#a8561a', {roughness:0.1, transparent:true, opacity:0.85});
    M.ceramic = phys('#f5f1ea', {roughness:0.25, clearcoat:0.8});
    M.leaf = std('#3f7a4a', {roughness:0.6}); M.leaf2 = std('#5c9a5c', {roughness:0.6});
    M.soil = std('#2e2118', {roughness:1});
    M.felt = std('#21402f', {roughness:0.95});
    M.shade = std('#f3e4c2', {roughness:0.9, emissive:new THREE.Color('#ffcf88'), emissiveIntensity:0.55, side:THREE.DoubleSide});
    M.lampGlass = phys('#2f7a4c', {roughness:0.15, transmission:0, emissive:new THREE.Color('#1c5a34'), emissiveIntensity:0.6, clearcoat:1, side:THREE.DoubleSide});
    M.bulb = std('#fff2cc', {emissive:new THREE.Color('#ffe2a0'), emissiveIntensity:2.2});
  }
  function wainsTex(len){
    const ppu = 6; // пикселей на единицу
    return canvasTex(Math.round(len*ppu), 34*ppu, (c, w, h)=>{
      const Wn = STY.wains, g = c.createLinearGradient(0,0,0,h); g.addColorStop(0,Wn.c[0]); g.addColorStop(1,Wn.c[1]); c.fillStyle = g; c.fillRect(0,0,w,h);
      if (Wn.kind === 'plain'){ c.globalAlpha = 0.25; c.fillStyle = '#000'; for (let x=0; x<w; x+=ppu*6) c.fillRect(x, 0, 2, h); c.globalAlpha = 1; noise(c, w, h, w*h/160, '#000000', 0.06); return; }
      const dark = /^#[0-6]/.test(Wn.c[0]);
      for (let k=0;k<w/6;k++){ const x0 = k*6 + Math.sin(k)*3; c.strokeStyle = k%3 ? 'rgba(20,10,5,.16)' : 'rgba(130,80,45,.12)'; c.lineWidth = 1 + k%3; c.beginPath(); for (let y=0;y<=h;y+=12){ const x = x0 + Math.sin(y*0.02 + k)*3; y ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
      if (!dark) c.globalAlpha = 0.5;
      for (let u=5; u+26<len; u+=32){
        const x = u*ppu, y = 6*ppu, pw = 26*ppu, ph = 21*ppu;
        c.fillStyle = 'rgba(0,0,0,.14)'; c.fillRect(x, y, pw, ph);
        c.strokeStyle = 'rgba(255,214,170,.20)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y+ph); c.lineTo(x, y); c.lineTo(x+pw, y); c.stroke();
        c.strokeStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.moveTo(x+pw, y); c.lineTo(x+pw, y+ph); c.lineTo(x, y+ph); c.stroke();
        c.strokeStyle = 'rgba(255,214,170,.09)'; c.lineWidth = 2; c.strokeRect(x+3*ppu, y+3*ppu, pw-6*ppu, ph-6*ppu);
      }
      c.globalAlpha = 1; noise(c, w, h, w*h/120, '#170b06', dark ? 0.12 : 0.05);
    });
  }

  // ---------- комната ----------
  function buildRoom(){
    boxAt(-WT, -WT, -SLAB, FW+WT, FD+WT, SLAB-0.01, M.slab, 0, null, false);
    boxAt(-WT, -WT, -3, FW+WT, FD+WT, 3-0.01, M.slabTrim, 0, null, false);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), M.floor); fl.rotation.x = -Math.PI/2; fl.position.set(FW/2, 0, FD/2); fl.receiveShadow = true; scene.add(fl);
    // стены
    boxAt(-WT, -WT, 0, FW+WT, WT, WH, M.wallA, 0, null, true);
    boxAt(-WT, 0, 0, WT, FD, WH, M.wallB, 0, null, true);
    // панели, рейка, плинтус, карниз
    boxAt(0, 0, 0, FW, 0.8, 34, M.wainsA, 0, null, false);
    boxAt(0, 0, 0, 0.8, FD, 34, M.wainsB, 0, null, false);
    boxAt(0, 0, 33, FW, 1.8, 2.4, M.mahogL); boxAt(0, 0, 33, 1.8, FD, 2.4, M.mahogL);
    boxAt(0, 0, 0, FW, 1.4, 3.6, M.mahogD); boxAt(0, 0, 0, 1.4, FD, 3.6, M.mahogD);
    boxAt(0, 0, WH-6, FW, 2.4, 6, M.mahog); boxAt(0, 0, WH-6, 2.4, FD, 6, M.mahog);
    boxAt(0, 2.2, WH-6.4, FW, 0.4, 0.5, M.brass, 0, null, false); boxAt(2.2, 0, WH-6.4, 0.4, FD, 0.5, M.brass, 0, null, false);
    boxAt(-WT, -WT, WH, FW+WT, WT, 0.6, M.cream, 0, null, false); boxAt(-WT, 0, WH, WT, FD, 0.6, M.cream, 0, null, false);
    // ковровая дорожка под столами и круглый ковёр под столом для планёрок
    const runner = canvasTex(3072, 584, (c, w, h)=> STY.rug.kind === 'modern' ? drawModernRunner(c, w, h) : STY.rug.kind === 'deco' ? drawDecoRunner(c, w, h) : drawRunnerRug(c, w, h)); STYLE_TEX.push(runner);
    const rm = std('#ffffff', {map:runner, roughness:1, alphaTest:0.5}); const r = new THREE.Mesh(new THREE.PlaneGeometry(386, 72), rm); r.rotation.x = -Math.PI/2; r.position.set(43+193, 0.12, 4+36); r.receiveShadow = true; scene.add(r);
    const round = canvasTex(1536, 1536, (c, w, h)=> STY.rug.kind === 'modern' ? drawModernRound(c, w, h) : STY.rug.kind === 'deco' ? drawDecoRound(c, w, h) : drawRoundRug(c, w, h)); STYLE_TEX.push(round);
    const rr = new THREE.Mesh(new THREE.CircleGeometry(1, 96), std('#ffffff', {map:round, roughness:1, alphaTest:0.5}));
    rr.rotation.x = -Math.PI/2; rr.scale.set(53, 53, 1); rr.position.set(TABLE.x, 0.14, TABLE.y); rr.receiveShadow = true; scene.add(rr);
  }

  // ---------- ковры: по референсам (дорожка — светлое поле и синяя кайма, круглый — синее поле и бордовая кайма) ----------
  const RUG = {ivory:'#e9dfc6', cream:'#f3ead6', navy:'#1c2b55', navy2:'#25386b', blue:'#5f86b8', sky:'#a3bcd8', gold:'#b88f33', olive:'#6e7b3b', rust:'#a4533a', tan:'#c7a774', ink:'#272834', wine:'#6e2424', wine2:'#82302b'};
  setTimeout(()=>{ if (!Object.keys(RUG_BASE).length) Object.assign(RUG_BASE, RUG); });
  function rng(seed){ let t = seed >>> 0; return ()=>{ t += 0x6D2B79F5; let r = Math.imul(t ^ t >>> 15, 1 | t); r ^= r + Math.imul(r ^ r >>> 7, 61 | r); return ((r ^ r >>> 14) >>> 0) / 4294967296; }; }
  function rpoly(c, x, y, r, n, rot=0){ c.beginPath(); for (let k=0;k<n;k++){ const a = rot + k/n*Math.PI*2; k ? c.lineTo(x+Math.cos(a)*r, y+Math.sin(a)*r) : c.moveTo(x+Math.cos(a)*r, y+Math.sin(a)*r); } c.closePath(); }
  function star8(c, x, y, r, col){ c.fillStyle = col; rpoly(c, x, y, r, 4, 0); c.fill(); rpoly(c, x, y, r, 4, Math.PI/4); c.fill(); }
  function rosette(c, x, y, r, petal, ring, core, n=8){
    c.save(); c.translate(x, y);
    for (let k=0;k<n;k++){ c.rotate(Math.PI*2/n); c.beginPath(); c.ellipse(r*0.55, 0, r*0.45, r*0.2, 0, 0, Math.PI*2); c.fillStyle = petal; c.fill(); c.lineWidth = Math.max(1, r*0.04); c.strokeStyle = RUG.ink; c.globalAlpha = 0.55; c.stroke(); c.globalAlpha = 1; }
    c.beginPath(); c.arc(0, 0, r*0.36, 0, Math.PI*2); c.fillStyle = ring; c.fill();
    c.beginPath(); c.arc(0, 0, r*0.17, 0, Math.PI*2); c.fillStyle = core; c.fill(); c.restore();
  }
  function octMotif(c, x, y, r, fill, inner, core){
    c.fillStyle = fill; rpoly(c, x, y, r, 8, Math.PI/8); c.fill(); c.lineWidth = Math.max(1.5, r*0.05); c.strokeStyle = RUG.ink; c.globalAlpha = 0.5; c.stroke(); c.globalAlpha = 1;
    rosette(c, x, y, r*0.72, inner, core, RUG.gold, 8);
    for (let k=0;k<4;k++){ const a = k*Math.PI/2 + Math.PI/4; star8(c, x + Math.cos(a)*r*0.8, y + Math.sin(a)*r*0.8, r*0.11, RUG.cream); }
  }
  function sprig(c, x, y, len, ang, stem, leaf){
    c.save(); c.translate(x, y); c.rotate(ang); c.strokeStyle = stem; c.lineWidth = Math.max(2, len*0.07); c.lineCap = 'round';
    c.beginPath(); c.moveTo(-len/2, 0); c.lineTo(len/2, 0); c.stroke();
    for (let k=0;k<3;k++){ const px = -len/2 + len*(0.3 + k*0.22); for (const sgn of [-1, 1]){ c.beginPath(); c.moveTo(px, 0); c.lineTo(px - len*0.14, sgn*len*0.22); c.lineTo(px - len*0.05, sgn*len*0.08); c.closePath(); c.fillStyle = leaf; c.fill(); } }
    c.beginPath(); c.moveTo(len/2 + len*0.12, 0); c.lineTo(len/2 - len*0.04, -len*0.1); c.lineTo(len/2 - len*0.04, len*0.1); c.closePath(); c.fillStyle = stem; c.fill();
    c.restore();
  }
  function hookMotif(c, x, y, s, col){ c.strokeStyle = col; c.lineWidth = s*0.22; c.lineCap = 'square'; c.beginPath(); c.moveTo(x - s, y - s*0.5); c.lineTo(x - s, y + s*0.5); c.lineTo(x, y + s*0.5); c.lineTo(x, y - s*0.5); c.lineTo(x + s, y - s*0.5); c.lineTo(x + s, y + s*0.5); c.stroke(); }
  function weave(c, w, h, cell, a=0.06){
    c.globalAlpha = a; c.fillStyle = '#000';
    for (let x=0; x<w; x+=cell) c.fillRect(x, 0, 1, h);
    for (let y=0; y<h; y+=cell) c.fillRect(0, y, w, 1);
    c.globalAlpha = 1; noise(c, w, h, w*h/40, '#000000', 0.07); noise(c, w, h, w*h/90, '#ffffff', 0.05);
  }
  function fringeX(c, x0, x1, y0, y1){ // нити бахромы по короткой стороне
    for (let y=y0; y<y1; y+=5){ const len = (x1 - x0) * (0.75 + ((y*7919)%13)/52); c.strokeStyle = (y/5)%2 ? '#efe6d2' : '#e2d6bc'; c.lineWidth = 2.4; c.beginPath(); const dir = x1 > x0 ? 1 : -1; c.moveTo(x0, y); c.quadraticCurveTo(x0 + dir*len*0.5, y + Math.sin(y)*2, x0 + dir*len, y + Math.sin(y*0.3)*3); c.stroke(); }
  }
  function drawRunnerRug(c, w, h){
    c.clearRect(0, 0, w, h);
    const F = Math.round(w*0.012), x0 = F, x1 = w - F, W = x1 - x0;
    fringeX(c, x0, 0, h*0.04, h*0.96); fringeX(c, x1, w, h*0.04, h*0.96);
    // основа и каймы
    c.fillStyle = RUG.tan; c.fillRect(x0, 0, W, h);
    const g1 = h*0.022, guard = h*0.045, bord = h*0.16;
    c.fillStyle = RUG.cream; c.fillRect(x0 + g1, g1, W - g1*2, h - g1*2);
    const bx = x0 + g1 + guard, by = g1 + guard;
    c.fillStyle = RUG.navy; c.fillRect(bx, by, x1 - g1 - guard - bx, h - by*2);
    const fx0 = bx + bord, fy0 = by + bord, fx1 = x1 - g1 - guard - bord, fy1 = h - by - bord;
    c.fillStyle = RUG.cream; c.fillRect(fx0 - guard, fy0 - guard, fx1 - fx0 + guard*2, fy1 - fy0 + guard*2);
    c.fillStyle = RUG.ivory; c.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
    // «Т»-узор на бордюрных полосах
    const tees = (ax, ay, bx2, by2, horiz) => { const n = Math.floor((horiz ? bx2 - ax : by2 - ay) / (guard*0.9)); for (let k=0;k<n;k++){ const t = (k + 0.5)/n; const px = horiz ? ax + (bx2 - ax)*t : ax, py = horiz ? ay : ay + (by2 - ay)*t; c.fillStyle = k%2 ? RUG.navy : RUG.rust; c.fillRect(px - guard*0.12, py - guard*0.25, guard*0.24, guard*0.5); c.fillRect(px - guard*0.3, py - guard*0.25, guard*0.6, guard*0.12); } };
    tees(x0 + g1, g1 + guard/2, x1 - g1, 0, true); tees(x0 + g1, h - g1 - guard/2, x1 - g1, 0, true);
    tees(fx0 - guard, fy0 - guard/2, fx1 + guard, 0, true); tees(fx0 - guard, fy1 + guard/2, fx1 + guard, 0, true);
    tees(x0 + g1 + guard/2, g1 + guard, 0, h - g1 - guard, false); tees(x1 - g1 - guard/2, g1 + guard, 0, h - g1 - guard, false);
    // мотивы каймы: восьмиугольные розетки и ветки
    const bm = by + bord/2, step = bord*2.2;
    for (let x = bx + bord*0.9, k = 0; x < x1 - g1 - guard - bord*0.6; x += step, k++){
      for (const yy of [bm, h - bm]){
        octMotif(c, x, yy, bord*0.36, k%2 ? RUG.cream : RUG.sky, k%2 ? RUG.rust : RUG.navy2, RUG.cream);
        sprig(c, x + step/2, yy, bord*0.8, 0, RUG.gold, k%2 ? RUG.blue : RUG.cream);
      }
    }
    for (const xx of [bx + bord/2, x1 - g1 - guard - bord/2]){ octMotif(c, xx, h/2, bord*0.34, RUG.cream, RUG.rust, RUG.cream); sprig(c, xx, h/2 - bord*1.1, bord*0.7, Math.PI/2, RUG.gold, RUG.blue); sprig(c, xx, h/2 + bord*1.1, bord*0.7, -Math.PI/2, RUG.gold, RUG.blue); }
    // поле: крупные медальоны по центру, вокруг — розетки, звёзды, крюки и ветки
    const FH = fy1 - fy0, cy = (fy0 + fy1)/2, period = FH*2.1;
    let i = 0;
    for (let x = fx0 + period*0.55; x < fx1 - period*0.2; x += period, i++){
      if (i % 2 === 0){
        c.fillStyle = RUG.gold; c.save(); c.translate(x, cy);
        for (let k=0;k<4;k++){ c.rotate(Math.PI/2); c.fillRect(-FH*0.07, 0, FH*0.14, FH*0.34); c.fillRect(-FH*0.17, FH*0.18, FH*0.34, FH*0.08); }
        c.restore(); rosette(c, x, cy, FH*0.17, RUG.sky, RUG.navy, RUG.gold);
      } else {
        octMotif(c, x, cy, FH*0.26, RUG.navy, RUG.blue, RUG.cream);
      }
      for (const sy of [-1, 1]){
        rosette(c, x + period*0.27, cy + sy*FH*0.3, FH*0.11, i%2 ? RUG.olive : RUG.blue, RUG.cream, RUG.rust);
        rosette(c, x - period*0.27, cy + sy*FH*0.3, FH*0.09, i%2 ? RUG.rust : RUG.sky, RUG.navy, RUG.gold);
        star8(c, x, cy + sy*FH*0.38, FH*0.05, RUG.navy);
        hookMotif(c, x + period*0.12, cy + sy*FH*0.2, FH*0.035, RUG.tan);
        hookMotif(c, x - period*0.12, cy - sy*FH*0.2, FH*0.035, RUG.olive);
        sprig(c, x + period*0.46, cy + sy*FH*0.22, FH*0.22, sy*0.6, RUG.olive, RUG.gold);
      }
      star8(c, x + period/2, cy, FH*0.07, RUG.navy2); rosette(c, x + period/2, cy, FH*0.05, RUG.gold, RUG.cream, RUG.rust, 6);
      // усики от медальона, как на старых коврах
      c.strokeStyle = i%2 ? RUG.olive : RUG.gold; c.lineWidth = Math.max(2, FH*0.012); c.globalAlpha = 0.8;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]){ c.beginPath(); c.moveTo(x + sx*FH*0.2, cy + sy*FH*0.08); c.quadraticCurveTo(x + sx*FH*0.42, cy + sy*FH*0.05, x + sx*FH*0.5, cy + sy*FH*0.26); c.stroke(); }
      c.globalAlpha = 1;
    }
    // мелкие мотивы по всему полю (сетка со случайным сдвигом, вокруг крупных — пусто)
    const R0 = rng(7), big = [];
    for (let x = fx0 + period*0.55, k = 0; x < fx1 - period*0.2; x += period, k++){ big.push([x, cy, FH*0.36]); for (const sy of [-1,1]){ big.push([x + period*0.27, cy + sy*FH*0.3, FH*0.15]); big.push([x - period*0.27, cy + sy*FH*0.3, FH*0.13]); } big.push([x + period/2, cy, FH*0.1]); }
    const cell = FH*0.12, smallCols = [RUG.navy, RUG.rust, RUG.blue, RUG.olive, RUG.gold, RUG.navy2, RUG.sky];
    for (let y = fy0 + cell*0.6; y < fy1 - cell*0.4; y += cell) for (let x = fx0 + cell*0.6; x < fx1 - cell*0.4; x += cell){
      const px = x + (R0() - 0.5)*cell*0.6, py = y + (R0() - 0.5)*cell*0.6;
      if (big.some(([bx2, by2, br]) => Math.hypot(px - bx2, py - by2) < br + cell*0.35)) continue;
      const t = R0(), col = smallCols[Math.floor(R0()*smallCols.length)], sz = cell*(0.22 + R0()*0.16);
      if (t < 0.28) star8(c, px, py, sz*0.8, col);
      else if (t < 0.52) rosette(c, px, py, sz*1.1, col, RUG.cream, RUG.rust, 6);
      else if (t < 0.7) hookMotif(c, px, py, sz*0.55, col);
      else if (t < 0.86){ c.fillStyle = col; rpoly(c, px, py, sz*0.7, 4, 0); c.fill(); c.fillStyle = RUG.cream; rpoly(c, px, py, sz*0.3, 4, 0); c.fill(); }
      else sprig(c, px, py, sz*2.2, (R0() - 0.5)*2, RUG.olive, RUG.gold);
    }
    weave(c, w, h, Math.max(3, Math.round(h/220)));
    // мягкая тень по краю
    const eg = c.createLinearGradient(0, 0, 0, h); eg.addColorStop(0, 'rgba(0,0,0,.18)'); eg.addColorStop(0.03, 'rgba(0,0,0,0)'); eg.addColorStop(0.97, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,.18)');
    c.globalCompositeOperation = 'source-atop'; c.fillStyle = eg; c.fillRect(x0, 0, W, h); c.globalCompositeOperation = 'source-over';
  }
  function drawRoundRug(c, w, h){
    c.clearRect(0, 0, w, h);
    const R = w/2; c.save(); c.translate(R, R);
    // бахрома по кругу
    for (let k=0;k<720;k++){ const a = k/720*Math.PI*2, r0 = R*0.945, r1 = R*(0.985 + ((k*37)%11)/600); c.strokeStyle = k%2 ? '#efe6d2' : '#ddd0b4'; c.lineWidth = 2; c.beginPath(); c.moveTo(Math.cos(a)*r0, Math.sin(a)*r0); c.lineTo(Math.cos(a + 0.004)*r1, Math.sin(a + 0.004)*r1); c.stroke(); }
    const ring = (r, col) => { c.beginPath(); c.arc(0, 0, R*r, 0, Math.PI*2); c.fillStyle = col; c.fill(); };
    ring(0.95, RUG.cream); ring(0.915, RUG.navy); ring(0.895, RUG.ivory); ring(0.885, RUG.wine);
    // кайма: вьющаяся лоза с цветами
    const rb = R*0.81, n = 30;
    c.strokeStyle = RUG.tan; c.lineWidth = R*0.012; c.beginPath();
    for (let k=0; k<=720; k++){ const a = k/720*Math.PI*2, rr = rb + Math.sin(a*n)*R*0.035; k ? c.lineTo(Math.cos(a)*rr, Math.sin(a)*rr) : c.moveTo(Math.cos(a)*rr, Math.sin(a)*rr); } c.stroke();
    for (let k=0;k<n*2;k++){ const a = (k + 0.25)/(n*2)*Math.PI*2, rr = rb + (k%2 ? -1 : 1)*R*0.035;
      c.save(); c.rotate(a); c.translate(rr, 0);
      if (k%2){ rosette(c, 0, 0, R*0.034, RUG.cream, RUG.navy, RUG.gold, 8); } else { c.beginPath(); c.ellipse(0, 0, R*0.022, R*0.04, 0, 0, Math.PI*2); c.fillStyle = RUG.navy2; c.fill(); c.beginPath(); c.ellipse(0, 0, R*0.012, R*0.022, 0, 0, Math.PI*2); c.fillStyle = RUG.sky; c.fill(); }
      for (const s of [-1, 1]){ c.beginPath(); c.ellipse(s*R*0.006, s*R*0.05, R*0.01, R*0.022, s*0.6, 0, Math.PI*2); c.fillStyle = RUG.olive; c.fill(); }
      c.restore(); }
    ring(0.745, RUG.ivory); ring(0.735, RUG.gold); ring(0.725, RUG.navy);
    // бусинки на охранной полосе
    for (let k=0;k<160;k++){ const a = k/160*Math.PI*2; c.beginPath(); c.arc(Math.cos(a)*R*0.74, Math.sin(a)*R*0.74, R*0.004, 0, Math.PI*2); c.fillStyle = k%2 ? RUG.wine : RUG.navy; c.fill(); }
    // поле: симметричные ветви с пальметтами, листьями и цветами
    for (let k=0;k<8;k++){
      c.save(); c.rotate(k*Math.PI/4 + Math.PI/8);
      for (const s of [1, -1]){
        c.save(); c.scale(1, s);
        c.strokeStyle = RUG.tan; c.lineWidth = R*0.008; c.globalAlpha = 0.85;
        c.beginPath(); c.moveTo(R*0.3, 0); c.bezierCurveTo(R*0.42, R*0.12, R*0.55, R*0.05, R*0.66, R*0.16); c.stroke();
        c.beginPath(); c.moveTo(R*0.45, R*0.07); c.bezierCurveTo(R*0.48, R*0.2, R*0.4, R*0.26, R*0.33, R*0.24); c.stroke(); c.globalAlpha = 1;
        // пальметта
        c.save(); c.translate(R*0.6, R*0.11); c.rotate(-0.4);
        c.beginPath(); c.moveTo(0, -R*0.05); c.bezierCurveTo(R*0.05, -R*0.02, R*0.04, R*0.04, 0, R*0.06); c.bezierCurveTo(-R*0.04, R*0.04, -R*0.05, -R*0.02, 0, -R*0.05); c.fillStyle = RUG.tan; c.fill();
        c.beginPath(); c.moveTo(0, -R*0.025); c.bezierCurveTo(R*0.025, 0, R*0.02, R*0.03, 0, R*0.035); c.bezierCurveTo(-R*0.02, R*0.03, -R*0.025, 0, 0, -R*0.025); c.fillStyle = RUG.rust; c.fill(); c.restore();
        rosette(c, R*0.4, R*0.17, R*0.03, RUG.cream, RUG.gold, RUG.wine, 8);
        rosette(c, R*0.68, R*0.26, R*0.026, RUG.sky, RUG.cream, RUG.navy, 6);
        for (const [lx, ly, la] of [[0.5, 0.1, 0.7], [0.36, 0.25, -0.5], [0.55, 0.2, 1.2], [0.64, 0.07, -0.2]]){ c.beginPath(); c.ellipse(R*lx, R*ly, R*0.022, R*0.008, la, 0, Math.PI*2); c.fillStyle = RUG.olive; c.fill(); }
        for (const [dx, dy] of [[0.47, 0.29], [0.62, 0.32], [0.33, 0.12], [0.7, 0.05]]){ c.beginPath(); c.arc(R*dx, R*dy, R*0.009, 0, Math.PI*2); c.fillStyle = RUG.cream; c.fill(); }
        c.restore();
      }
      c.restore();
    }
    // мелкий цветочный узор по всему полю: один сектор, повторённый 16 раз с отражением
    const R1 = rng(11), bits = [];
    for (let k=0;k<70;k++){ const rr = R*(0.3 + R1()*0.4), a = R1()*Math.PI/8; bits.push([rr, a, R1(), R1()]); }
    for (let k=0;k<16;k++) for (const sgn of [1, -1]){
      c.save(); c.rotate(k*Math.PI/8); c.scale(1, sgn);
      for (const [rr, a, t, u] of bits){ const x = Math.cos(a)*rr, y = Math.sin(a)*rr;
        if (t < 0.35){ c.beginPath(); c.ellipse(x, y, R*0.014, R*0.005, a + u*3, 0, Math.PI*2); c.fillStyle = u < 0.5 ? RUG.olive : '#4f6a6e'; c.fill(); }
        else if (t < 0.6){ c.beginPath(); c.arc(x, y, R*0.0055, 0, Math.PI*2); c.fillStyle = u < 0.5 ? RUG.cream : RUG.sky; c.fill(); }
        else if (t < 0.8) rosette(c, x, y, R*0.016, u < 0.5 ? RUG.tan : RUG.cream, RUG.wine, RUG.gold, 6);
        else { c.strokeStyle = RUG.tan; c.globalAlpha = 0.6; c.lineWidth = R*0.004; c.beginPath(); c.arc(x, y, R*0.03, a, a + 1.6); c.stroke(); c.globalAlpha = 1; } }
      c.restore();
    }
    // центральный медальон-звезда
    c.save();
    for (let k=0;k<16;k++){ c.rotate(Math.PI/8); c.beginPath(); c.moveTo(R*0.15, -R*0.06); c.quadraticCurveTo(R*0.36, 0, R*0.15, R*0.06); c.closePath(); c.fillStyle = k%2 ? RUG.tan : '#b07a45'; c.fill(); c.strokeStyle = RUG.cream; c.lineWidth = R*0.005; c.stroke();
      c.beginPath(); c.moveTo(R*0.17, -R*0.025); c.quadraticCurveTo(R*0.27, 0, R*0.17, R*0.025); c.closePath(); c.fillStyle = k%2 ? RUG.rust : RUG.wine; c.fill(); }
    c.restore();
    ring(0.19, RUG.cream); ring(0.18, RUG.navy);
    for (let k=0;k<12;k++){ c.save(); c.rotate(k*Math.PI/6); c.beginPath(); c.ellipse(R*0.11, 0, R*0.05, R*0.018, 0, 0, Math.PI*2); c.fillStyle = k%2 ? RUG.tan : RUG.gold; c.fill(); c.restore(); }
    rosette(c, 0, 0, R*0.07, RUG.cream, RUG.wine, RUG.gold, 8);
    c.restore();
    // ворс и узелки
    c.save(); c.beginPath(); c.arc(R, R, R*0.95, 0, Math.PI*2); c.clip(); weave(c, w, h, Math.max(3, Math.round(w/400))); c.restore();
  }

  // ---------- мебель ----------
  function buildFurniture(){
    for (let i=0;i<4;i++) buildDesk(i);
    buildTable(); buildSofa(); buildArmchair(); buildSideboard(); buildBookcase(); buildFloorLamp();
    PLANTS.forEach(([x, y, big], k)=>{ grp('plant'+k); buildPlant(x, y, big); CUR = null; });
  }
  function buildDesk(i){
    const a = AG_LIST[i], x = DX[i], y = DESK_Y, H = DESK_H, D = DESK_D, W = DESK_W;
    grp('desk'+i);
    boxAt(x+2, y+2, 0, 16, D-4, H-2.5, M.mahog, 0.4);
    boxAt(x+W-5, y+2, 0, 3, D-4, H-2.5, M.mahog, 0.3);
    boxAt(x+18, y+D-4, 5, W-23, 1.6, H-7.5, M.mahogD, 0.2);
    for (let k=0;k<3;k++){ const z = 2.4 + k*5.8; boxAt(x+3, y+D-2.05, z, 14, 0.3, 5.2, M.mahogL, 0.15, null, false); sphereAt(x+10, y+D-1.6, z+2.6, 0.55, M.brass); }
    boxAt(x, y, H-2.5, W, D, 2.5, M.mahog, 0.6);
    const inlay = canvasTex(512, 200, (c, w, h)=>{ c.fillStyle = '#2b4938'; c.fillRect(0,0,w,h); noise(c, w, h, 9000, '#0d1a12', 0.25); c.strokeStyle = '#c9a24e'; c.lineWidth = 3; c.strokeRect(10,10,w-20,h-20); });
    const il = new THREE.Mesh(new THREE.PlaneGeometry(W-6, D-5.2), std('#ffffff', {map:inlay, roughness:0.62})); il.rotation.x = -Math.PI/2; il.position.set(x+W/2, H+0.03, y+D/2); il.receiveShadow = true; put(il);
    CUR = null;
    // табличка
    const plate = canvasTex(256, 72, (c, w, h)=>{ const g = c.createLinearGradient(0,0,0,h); g.addColorStop(0,'#efd38c'); g.addColorStop(1,'#a8843a'); c.fillStyle = g; c.fillRect(0,0,w,h); c.strokeStyle = 'rgba(80,50,10,.6)'; c.lineWidth = 3; c.strokeRect(3,3,w-6,h-6); c.fillStyle = a.color; c.beginPath(); c.arc(28, h/2, 9, 0, Math.PI*2); c.fill(); c.font = `700 36px ${FONT}`; c.fillStyle = '#2a1a10'; c.textBaseline = 'middle'; c.fillText(a.name, 48, h/2+2); });
    DYN['plate'+i] = plate;
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(22, 6.2), std('#ffffff', {map:plate, metalness:0.6, roughness:0.35})); pm.position.set(x+37, 12.4, y+D-1.8+0.05); scene.add(pm); PLATES[i] = pm;
    // банкирская лампа
    const lx = x+55, ly = y+6;
    grp('lamp'+i);
    cylAt(lx, ly, H, 3, 1, M.brass); cylAt(lx, ly, H+1, 0.5, 10, M.brass, 12);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 13, 24, 1, true, 0, Math.PI), M.lampGlass);
    shade.rotation.z = Math.PI/2; shade.position.set(lx-1.5, H+11.6, ly+1.5); shade.castShadow = true; put(shade);
    const bulb = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.4), M.bulb); bulb.rotation.x = Math.PI/2; bulb.position.set(lx-1.5, H+11.2, ly+1.5); put(bulb);
    CUR = null;
    LAMPS.push([lx-1.5, ly+3, H+9, 'desk']);
    // клавиатура, мышь, бумаги (группа «на столе» поднимается вместе с высотой стола)
    grp('top'+i);
    boxAt(a.sx-8, y+2.4, H, 16, 5.5, 0.9, M.plastic, 0.3);
    const mouse = sphereAt(a.sx+12, y+5, H+0.5, 1.5, M.plastic); mouse.scale.set(1, 0.5, 1.4);
    boxAt(x+22, y+11, H, 7, 9, 0.5, M.paper, 0, null, false); boxAt(x+22.5, y+11.3, H+0.5, 6.6, 8.6, 0.3, M.paper, 0, null, false);
    CUR = null;
    // монитор
    grp('monitor'+i);
    boxAt(x+6, y+7, H, 7, 9, 0.6, M.dark, 0.25);
    boxAt(x+8.6, y+10.8, H, 1.4, 1.4, 6, M.dark);
    boxAt(x+5, y+3, H+3.5, 3, 17, 14, M.dark, 0.5);
    CUR = null;
    const scr = canvasTex(320, 248, (c, w, h)=>drawScreenTex(c, w, h, a));
    DYN['screen'+i] = scr;
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 12.2), new THREE.MeshBasicMaterial({map:scr, toneMapped:false}));
    sm.rotation.y = Math.PI/2; sm.position.set(x+8.05, H+3.5+7, y+3+8.5); scene.add(sm); SCREENS[i] = sm;
    // кресло
    const sx = a.sx;
    grp('chair'+i);
    cylAt(sx, SEAT_Y, 0, 4.5, 1, M.brass); cylAt(sx, SEAT_Y, 1, 0.9, 6, M.brass, 12);
    boxAt(sx-7, SEAT_Y-6.5, 7, 14, 14, 2.8, M.ox, 1.3);
    boxAt(sx-7.5, SEAT_Y-9.6, 8, 15, 3.2, 24, M.ox, 1.5);
    for (let k=0;k<4;k++) for (let j=0;j<3;j++) sphereAt(sx-5.2+k*3.4+(j%2)*1.7, SEAT_Y-6.35, 15+j*4.6, 0.45, M.mahogD);
    CUR = null;
    // чашка
    CUR = GRP['top'+i];
    const cup = cylAt(x+49, y+15, H, 1.9, 3.6, std(a.look.mug || '#f5f1ea', {roughness:0.25}));
    mugs[a.id] = cup;
    if (a.id === 'aliya'){ bell = new THREE.Group(); const d = new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 10, 0, Math.PI*2, 0, Math.PI/2), M.brass); d.castShadow = true; bell.add(d); const b2 = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.5, 20), M.mahogD); b2.position.y = -0.2; bell.add(b2); bell.position.set(x+32, H+0.5, y+17); put(bell); }
    CUR = null;
  }
  function buildTable(){
    const {x, y, r} = TABLE;
    grp('table');
    cylAt(x, y, 0, 7, 1.2, M.mahogD); cylAt(x, y, 1, 2.4, 21.6, M.mahogD, 20);
    cylAt(x, y, 22.6, r, 2.2, M.mahog, 64);
    grp('tableTop');
    const lt = boxAt(x-8, y-10, 24.8, 11, 8, 0.6, M.steel, 0.2);
    const ls = new THREE.Mesh(new THREE.BoxGeometry(11, 7.2, 0.4), M.dark); ls.position.set(x-2.5, 28.4, y-10.2); ls.rotation.x = -0.25; ls.castShadow = true; put(ls);
    boxAt(x+5, y+4, 24.8, 8, 6, 0.3, M.paper, 0, null, false);
    cylAt(x-10, y+8, 24.8, 1.8, 3.4, M.ceramic); cylAt(x+12, y-6, 24.8, 1.5, 3.8, M.glass); cylAt(x+12, y-6, 24.9, 1.3, 1.6, M.amber);
    void lt; CUR = null;
  }
  function buildSofa(){
    grp('sofa');
    boxAt(3, 149, 1.5, 26, 50, 9.5, M.cog, 1.8);
    boxAt(2, 146, 1.5, 8, 56, 27, M.cog, 2.5);
    boxAt(3, 145.5, 1.5, 27, 7, 18, M.cogL, 3);
    boxAt(3, 195.5, 1.5, 27, 7, 18, M.cogL, 3);
    for (const yy of [149, 199]){ const rc = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 27, 24), M.cogL); rc.rotation.z = Math.PI/2; rc.position.set(16.5, 19, yy); rc.castShadow = true; rc.receiveShadow = true; put(rc); }
    boxAt(10, 153, 11, 19, 21, 4, M.cogL, 1.8); boxAt(10, 175, 11, 19, 20, 4, M.cogL, 1.8);
    for (let row=0; row<3; row++) for (let yy=151; yy<=196; yy+=5.6) sphereAt(10.05, yy + (row%2)*2.8, 16.8 + row*4.4, 0.55, M.mahogD);
    for (let xx=5; xx<29; xx+=2.4){ sphereAt(xx, 152.6, 3.6, 0.35, M.brass); sphereAt(xx, 202.6, 3.6, 0.35, M.brass); }
    const p1 = boxAt(11, 157, 15, 4, 10, 9, std('#1e2b4f', {roughness:0.9}), 2.4); p1.rotation.x = 0.18;
    const p2 = boxAt(11, 184, 15, 4, 9, 8, std('#7a2028', {roughness:0.9}), 2.4); p2.rotation.x = -0.15;
    for (const fx of [4, 28]) for (const fy of [148, 200]) cylAt(fx, fy, 0, 0.9, 1.5, M.mahogD, 10);
    CUR = null;
  }
  function buildArmchair(){
    grp('armchair');
    boxAt(375, 159, 1, 24, 18, 10, M.cog, 1.6);
    boxAt(397, 157, 1, 7, 22, 27, M.cog, 2.6);
    boxAt(375, 155.5, 1, 27, 5.5, 17, M.cogL, 2.6); boxAt(375, 175, 1, 27, 5.5, 17, M.cogL, 2.6);
    for (const yy of [158.2, 177.8]){ const rc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 27, 20), M.cogL); rc.rotation.z = Math.PI/2; rc.position.set(388.5, 17.5, yy); rc.castShadow = true; put(rc); }
    boxAt(377, 161, 11, 20, 14, 3.4, M.cogL, 1.6);
    for (let xx=376; xx<402; xx+=2.4) sphereAt(xx, 180.6, 3, 0.35, M.brass);
    CUR = null;
  }
  function buildSideboard(){
    grp('sideboard');
    boxAt(2, 86, 0, 18, 32, 21, M.mahog, 0.5);
    boxAt(1, 85, 21, 20, 34, 2, M.mahogL, 0.4);
    for (const yy of [96.8, 107.8]) boxAt(19.9, yy, 3, 0.3, 0.6, 16, M.mahogD, 0, null, false);
    for (const [yy, zz] of [[95.6, 11], [98.4, 11], [106.6, 11], [109.4, 11]]) sphereAt(20.2, yy, zz, 0.6, M.brass);
    grp('sideTop');
    boxAt(5, 90, 23, 11, 11, 13, M.steel, 1);
    boxAt(6, 92, 36, 9, 7, 1.2, M.dark, 0.3);
    sphereAt(16.1, 96, 31.5, 0.6, std('#4fd18b', {emissive:new THREE.Color('#4fd18b'), emissiveIntensity:1.5}));
    cylAt(13, 97, 23, 1.6, 3, M.ceramic);
    cylAt(10, 111, 23, 5, 0.4, M.steel, 32);
    cylAt(9, 110.5, 23.4, 2.3, 4.6, M.glass); cylAt(9, 110.5, 23.5, 2.1, 3, M.amber); cylAt(9, 110.5, 28, 1, 1.6, M.glass, 16); sphereAt(9, 110.5, 30.4, 1.2, M.glass);
    cylAt(12.6, 113.6, 23.4, 1.2, 2.2, M.glass, 16); cylAt(8, 114.6, 23.4, 1.2, 2.2, M.glass, 16);
    CUR = null;
    // глобус (своя группа — в «Манхэттене» скрыт)
    grp('globe');
    const top = new THREE.Vector3(8.5, 15, 126);
    for (const [fx, fy] of [[4,122],[13.5,123.5],[8,131]]){ const f = new THREE.Vector3(fx, 0, fy); const len = top.distanceTo(f); const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, len, 8), M.mahogD); leg.position.copy(top).add(f).multiplyScalar(0.5); leg.lookAt(top); leg.rotateX(Math.PI/2); leg.castShadow = true; put(leg); }
    const gt = canvasTex(512, 256, (c, w, h)=>{ c.fillStyle = '#e4cf9c'; c.fillRect(0,0,w,h); c.fillStyle = 'rgba(120,88,48,.6)'; for (const [x0,y0,rx,ry] of [[90,90,55,40],[130,170,30,50],[250,80,70,45],[280,160,40,40],[400,100,45,30],[420,190,30,25]]){ c.beginPath(); c.ellipse(x0,y0,rx,ry,0.3,0,Math.PI*2); c.fill(); } c.strokeStyle = 'rgba(90,60,30,.35)'; c.lineWidth = 1.5; for (let k=1;k<8;k++){ c.beginPath(); c.moveTo(0,k*h/8); c.lineTo(w,k*h/8); c.stroke(); c.beginPath(); c.moveTo(k*w/8,0); c.lineTo(k*w/8,h); c.stroke(); } });
    const globe = sphereAt(8.5, 126, 23, 6.6, std('#ffffff', {map:gt, roughness:0.45}));
    globe.rotation.z = 0.35; DYN.globe = globe;
    const mer = new THREE.Mesh(new THREE.TorusGeometry(7.4, 0.35, 8, 40, Math.PI*1.3), M.brass); mer.position.set(8.5, 23, 126); mer.rotation.set(0, Math.PI/4, -0.6); put(mer);
    CUR = null;
  }
  function buildBookcase(){
    grp('bookcase');
    boxAt(5, 1, 0, 26, 2, 68, M.mahogD); boxAt(5, 1, 0, 1.6, 18, 68, M.mahog); boxAt(29.4, 1, 0, 1.6, 18, 68, M.mahog);
    boxAt(4, 0.5, 66.5, 28, 19.5, 2.4, M.mahogL, 0.4); boxAt(5, 1, 0, 26, 18, 3, M.mahog);
    const cols = ['#6a2324','#1e2b4f','#2c4a39','#8a6a2a','#5a3a28','#d9c9a6','#3a2a4a','#7a2028','#2a3c5e'].map(c=>std(c, {roughness:0.75}));
    let seed = 7;
    for (const zb of [3, 19, 35, 51]){
      boxAt(6.6, 2.5, zb-1.2, 22.8, 16, 1.2, M.mahog);
      let bx = 7;
      while (bx < 28){
        seed = (seed*9301+49297)%233280; const w = 1.1 + (seed%10)/10; seed = (seed*9301+49297)%233280; const h = 9 + (seed%35)/10;
        if (bx + w > 28.8) break;
        const b = boxAt(bx, 5, zb, w, 12, h, cols[seed % cols.length], 0, null, false); b.castShadow = false;
        bx += w + 0.12;
      }
    }
    CUR = null;
  }
  function buildPendants(){
    // бронзовые колпаки на шнурах над каждым столом: снаружи бронза, внутри и по кромке — тёплое свечение
    grp('pendants');
    const strip = std('#fff1d6', {emissive:new THREE.Color('#ffd9a0'), emissiveIntensity:1.6, side:THREE.BackSide}); M.pendantStrip = strip;
    const cable = std('#141414', {roughness:0.5, metalness:0.6});
    const prof = [[0.01, 6.2], [1.1, 6.2], [1.3, 5.4], [2.2, 4.4], [3.8, 2.9], [5.4, 1.2], [6.2, 0.15], [6.3, 0]].reverse().map(([r, y])=>new THREE.Vector2(r, y));   // снизу вверх — нормали наружу
    const shellG = new THREE.LatheGeometry(prof, 40), innerG = new THREE.LatheGeometry(prof.map(v=>new THREE.Vector2(v.x*0.96, v.y - 0.12)), 40);
    const rimM = std('#fff1d6', {emissive:new THREE.Color('#ffd9a0'), emissiveIntensity:1.6}); M.pendantRim = rimM;
    // ореол под колпаком: мягкое тёплое свечение, ночью ярче
    const haloT = canvasTex(128, 128, (c, w, h)=>{ const g = c.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2); g.addColorStop(0, 'rgba(255,214,150,1)'); g.addColorStop(0.25, 'rgba(255,196,120,.55)'); g.addColorStop(1, 'rgba(255,180,100,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    const halo = M.pendantHalo = new THREE.SpriteMaterial({map:haloT, color:'#ffd6a0', blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:0.5});
    for (const x of DX){ const cx = x + 31, cy = 50, z = 70;
      const shell = new THREE.Mesh(shellG, M.brass); shell.position.set(cx, z, cy); add(shell);
      const inner = new THREE.Mesh(innerG, strip); inner.position.set(cx, z, cy); add(inner, false);
      const hs = new THREE.Sprite(halo); hs.position.set(cx, z - 0.5, cy); hs.scale.set(19, 19, 1); hs.renderOrder = 5; put(hs);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.22, 8, 48), rimM); rim.rotation.x = Math.PI/2; rim.position.set(cx, z + 0.1, cy); add(rim, false);
      cylAt(cx, cy, z + 6.2, 0.7, 1.2, M.brass, 16);
      const cord = cylAt(cx, cy, z + 7.4, 0.22, WH - z - 7.4, cable, 8); cord.castShadow = false;
      PENDANTS.push([cx, cy, z + 1]);
    }
    CUR = null;
  }
  function buildFloorLamp(){
    grp('floorlamp');
    cylAt(12, 138, 0, 4, 1, M.brass); cylAt(12, 138, 1, 0.6, 49, M.brass, 12);
    cylAt(12, 138, 46, 5.2, 9, M.shade, 32, 3.6, null, true);
    LAMPS.push([12, 138, 49, 'floor']);
    CUR = null;
  }
  function buildPlant(x, y, big){
    const r = big ? 6 : 5, h = big ? 10 : 8;
    cylAt(x, y, 0, r*0.85, h, M.brass, 28, r); cylAt(x, y, h-0.8, r*0.92, 0.6, M.soil, 24);
    const n = big ? 14 : 10;
    for (let k=0;k<n;k++){
      const ang = k/n*Math.PI*2 + (k%3)*0.3, lean = 0.35 + (k%4)*0.12, len = (big ? 9 : 7) + (k%3)*1.6;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), k%2 ? M.leaf : M.leaf2);
      leaf.scale.set(1.8, len*0.5, 0.5);
      const g = new THREE.Group(); g.position.set(x, h, y); g.rotation.y = ang; leaf.position.set(0, len*0.45, 0); g.rotation.z = lean; g.add(leaf); leaf.castShadow = true; put(g);
    }
  }

  // ---------- стены: окна, табло, экран, доска, часы, логотип, картина ----------
  function buildDecor(){
    buildWindow(34, 112, false); buildWindow(336, 414, true);
    buildPendants();
    // филёнки: клетка и дерево в ореховых рамках (стена A — с окнами, стена B — с логотипом)
    wallPanel('A', 127, 324, 38, 86, 'plaid');
    wallPanel('A', 3, 19, 38, 96, 'wood');
    wallPanel('B', 5, 56, 38, 96, 'plaid');
    wallPanel('B', 61, 143, 38, 96, 'wood');
    wallPanel('B', 148, 201, 38, 96, 'plaid');
    // табло
    boxAt(127, 0, 88.5, 196, 1.6, 16, M.brass, 0.4);
    const tick = canvasTex(4096, 96, (c, w, h)=>drawTicker(c, w, h), {});
    tick.wrapS = THREE.RepeatWrapping; tick.repeat.set(0.25, 1); DYN.ticker = tick;
    wallPlane('A', 128+95, 96.5, 190, 11, new THREE.MeshBasicMaterial({map:tick, toneMapped:false}), 1.7);
    // экран
    boxAt(168.5, 0, 22.5, 127, 2, 61, M.mahogD, 0.6);
    boxAt(169.6, 1.9, 23.6, 124.8, 0.3, 58.8, M.brass, 0, null, false);
    const chart = canvasTex(1024, 456, (c, w, h)=>drawChartTex(c, w, h)); DYN.chart = chart;
    wallPlane('A', 232, 53, 119, 53, new THREE.MeshBasicMaterial({map:chart, toneMapped:false}), 2.45);
    // экран с тепловой картой рынка (стена B, над стеллажом)
    boxAt(0.2, 7.5, 62.5, 1.6, 46, 27, M.dark, 0.5); boxAt(1.75, 8.1, 63.1, 0.25, 44.8, 25.8, M.brass, 0, null, false);
    const heat = canvasTex(1024, 576, (c, w, h)=>drawHeatTex(c, w, h)); DYN.heat = heat;
    wallPlane('B', 30.5, 76, 44, 24.75, new THREE.MeshBasicMaterial({map:heat, toneMapped:false}), 2.1);
    // доска сигналов
    boxAt(124, 0, 34, 40, 1.6, 46, M.brass, 0.5);
    const board = canvasTex(400, 460, (c, w, h)=>drawBoardTex(c, w, h)); DYN.board = board;
    wallPlane('A', 144, 57, 35.6, 41.6, std('#ffffff', {map:board, roughness:0.9}), 1.7);
    // часы
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10.3, 1.1, 16, 48), M.brass); ring.position.set(312, 64, 1.4); ring.castShadow = true; scene.add(ring);
    const clock = canvasTex(256, 256, (c, w, h)=>drawClockTex(c, w, h)); DYN.clock = clock;
    const cf = new THREE.Mesh(new THREE.CircleGeometry(9.6, 48), std('#ffffff', {map:clock, roughness:0.4})); cf.position.set(312, 64, 1.2); scene.add(cf);
    // логотип на стене B
    const lt = new THREE.Texture(LOGO_IMG); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 8;
    const markLoaded = ()=>{ lt.needsUpdate = true; };
    if (LOGO_IMG.complete && LOGO_IMG.naturalWidth) markLoaded(); else LOGO_IMG.addEventListener('load', markLoaded);
    const ratio = LOGO_IMG.naturalWidth ? LOGO_IMG.naturalHeight/LOGO_IMG.naturalWidth : 408/560;
    // объёмный логотип: лицевой слой + затемнённые слои «толщины», тень падает на панель
    const LW = 38, LH = LW*ratio, LZ = 67, LY = 102;
    const depthMat = new THREE.MeshDepthMaterial({map:lt, alphaTest:0.5, depthPacking:THREE.RGBADepthPacking});
    const LAYERS = 9, D0 = 0.55, D1 = 2.1;
    for (let k=0; k<LAYERS; k++){
      const front = k === LAYERS - 1, off = D0 + (D1 - D0) * k/(LAYERS - 1);
      const m = front ? std('#ffffff', {map:lt, alphaTest:0.5, roughness:0.32, metalness:0.25})
                      : std(k < 2 ? '#3a3a3a' : '#7a7a7a', {map:lt, alphaTest:0.5, roughness:0.55, metalness:0.1});
      const pl = wallPlane('B', LY, LZ, LW, LH, m, off);
      pl.castShadow = front; pl.receiveShadow = !front; if (front) pl.customDepthMaterial = depthMat;
    }
    boxAt(0.5, LY - 16, 96.5, 3, 32, 1.3, M.brass, 0.4);
    // картина
    boxAt(0, 149, 51, 1.8, 48, 35, M.gilt, 0.5);
    const pic = canvasTex(400, 270, (c, w, h)=>{ if (STY.art && STY.art.startsWith('abstract')) return drawAbstractArt(c, w, h, STY.art === 'abstract-light');
      const sk = c.createLinearGradient(0,0,0,h); sk.addColorStop(0,'#33476e'); sk.addColorStop(0.6,'#c99363'); sk.addColorStop(1,'#e6b77a'); c.fillStyle = sk; c.fillRect(0,0,w,h);
      c.fillStyle = '#4b5a3a'; c.beginPath(); c.moveTo(0,200); c.quadraticCurveTo(120,130,240,180); c.quadraticCurveTo(320,205,400,160); c.lineTo(400,270); c.lineTo(0,270); c.fill();
      c.fillStyle = '#2f3e28'; c.beginPath(); c.moveTo(0,240); c.quadraticCurveTo(200,190,400,232); c.lineTo(400,270); c.lineTo(0,270); c.fill();
      c.fillStyle = '#1f2a1c'; c.fillRect(290,110,7,80); c.beginPath(); c.ellipse(294,105,38,32,0,0,Math.PI*2); c.fill();
      c.fillStyle = '#e8d9b0'; c.fillRect(80,160,46,24); c.beginPath(); c.moveTo(74,161); c.lineTo(103,140); c.lineTo(132,161); c.fill();
      noise(c, w, h, 14000, '#000', 0.08);
    }); STYLE_TEX.push(pic);
    wallPlane('B', 173, 68.5, 40, 27, std('#ffffff', {map:pic, roughness:0.6}), 1.95);
    boxAt(0.5, 159, 89.6, 3, 28, 1.2, M.brass, 0.4);
    DYN.chart.last = DYN.board.last = DYN.ticker.last = DYN.clock.last = DYN.heat.last = -1;
  }
  function wallPanel(wall, u0, u1, z0, z1, kind){
    const w = u1 - u0, h = z1 - z0, inset = 1.6;
    let mat;
    const role = kind === 'plaid' ? 'main' : 'alt', ppu = 8, pw = w - inset*2, phh = h - inset*2;
    const tex = canvasTex(Math.round(pw*ppu), Math.round(phh*ppu), (c, cw, ch)=>drawPanel(c, cw, ch, STY[role], ppu));
    mat = phys('#ffffff', {map:tex, roughness:0.9}); PANELS.push({mat, tex, role, w:pw, h:phh}); restylePanel(PANELS[PANELS.length - 1]);
    const p = wallPlane(wall, u0 + w/2, z0 + h/2, w - inset*2, h - inset*2, mat, 0.25); p.receiveShadow = true;
    // рамка-молдинг
    const fr = (a0, b0, a1, b1)=> wall === 'A' ? boxAt(a0, 0, b0, a1 - a0, 1.1, b1 - b0, M.mahogL, 0.25, null, false) : boxAt(0, a0, b0, 1.1, a1 - a0, b1 - b0, M.mahogL, 0.25, null, false);
    fr(u0, z0, u1, z0 + inset); fr(u0, z1 - inset, u1, z1); fr(u0, z0, u0 + inset, z1); fr(u1 - inset, z0, u1, z1);
    // верхний и нижний брус
    if (wall === 'A'){ boxAt(u0 - 1, 0, z0 - 1.4, w + 2, 0.7, 1.4, M.mahogD, 0, null, false); } else { boxAt(0, u0 - 1, z0 - 1.4, 0.7, w + 2, 1.4, M.mahogD, 0, null, false); }
  }
  function buildWindow(u0, u1, tower){
    const w = u1-u0, z0 = 40, z1 = 96, h = z1-z0;
    const city = canvasTex(512, Math.round(512*h/w), (c, W2, H2)=>{
      const sc = W2/w;
      const g = c.createLinearGradient(0,0,0,H2); g.addColorStop(0,'#1d2752'); g.addColorStop(0.55,'#5e4578'); g.addColorStop(0.85,'#c97e5c'); g.addColorStop(1,'#eab274'); c.fillStyle = g; c.fillRect(0,0,W2,H2);
      c.fillStyle = 'rgba(255,255,255,.8)'; for (let i=0;i<26;i++) c.fillRect((i*97+u0*3)%W2, (i*53)%(H2*0.35), 2, 2);
      if (!tower){ c.beginPath(); c.arc(W2*0.24, H2*0.2, 26, 0, Math.PI*2); c.fillStyle = '#fff4d6'; c.fill(); c.beginPath(); c.arc(W2*0.24+11, H2*0.2-6, 22, 0, Math.PI*2); c.fillStyle = '#26305f'; c.fill(); }
      let bx = 0, seed = tower ? 11 : 3;
      while (bx < W2){ seed = (seed*9301+49297)%233280; const bw = (5 + seed%8)*sc; seed = (seed*9301+49297)%233280; const bh = (9 + seed%(h*0.5|0))*sc;
        c.fillStyle = (seed%2) ? '#2f2549' : '#382b56'; c.fillRect(bx, H2-bh, bw, bh);
        for (let wy=H2-bh+12; wy<H2-6; wy+=16) for (let wx=bx+6; wx<bx+bw-6; wx+=11){ seed=(seed*9301+49297)%233280; if (seed%4===0){ c.fillStyle = seed%3 ? '#ffd27a' : '#ffe9b8'; c.fillRect(wx, wy, 5, 6); } }
        bx += bw + 4; }
      if (tower){ const tx = W2*0.62; c.fillStyle = '#211a37'; c.fillRect(tx-4, 30, 8, H2-30); c.beginPath(); c.moveTo(tx-20,H2); c.lineTo(tx-5,H2*0.45); c.lineTo(tx+5,H2*0.45); c.lineTo(tx+20,H2); c.fill(); c.beginPath(); c.ellipse(tx, H2*0.36, 18, 12, 0, 0, Math.PI*2); c.fill(); c.fillStyle = '#ff5d6c'; c.beginPath(); c.arc(tx, 28, 4, 0, Math.PI*2); c.fill(); }
    });
    const cityDay = canvasTex(512, Math.round(512*h/w), (c, W2, H2)=>drawCityDay(c, W2, H2, W2/w, h, u0, tower));
    const cm = new THREE.MeshBasicMaterial({map:city, toneMapped:false, color:new THREE.Color(0.85,0.85,0.9)});
    CITY.push({mat:cm, night:city, day:cityDay, u0, u1, z0, z1});
    wallPlane('A', u0+w/2, z0+h/2, w, h, cm, 0.35);
    buildSunPatch(u0, u1, z0, z1);
    wallPlane('A', u0+w/2, z0+h/2, w, h, M.glass, 1.4);
    // рама и переплёт
    boxAt(u0-3, 0, z0-3, w+6, 2.2, 3, M.mahog); boxAt(u0-3, 0, z1, w+6, 2.2, 3, M.mahog);
    boxAt(u0-3, 0, z0, 3, 2.2, h, M.mahog); boxAt(u1, 0, z0, 3, 2.2, h, M.mahog);
    boxAt(u0+w/2-1.1, 0, z0, 2.2, 1.9, h, M.mahog); boxAt(u0, 0, z0+h*0.5-0.9, w, 1.9, 1.8, M.mahog);
    for (const fx of [0.25, 0.75]) boxAt(u0+w*fx-0.4, 0, z0, 0.8, 1.6, h, M.mahogD, 0, null, false);
    for (const fz of [0.25, 0.75]) boxAt(u0, 0, z0+h*fz-0.35, w, 1.6, 0.7, M.mahogD, 0, null, false);
    boxAt(u0-4, 0, z0-4.5, w+8, 5, 2, M.mahogL, 0.4);
    // шторы
    const dh = (z1+9) - (z0-18);
    for (const du of [u0-13, u1+2]){
      const g = new THREE.PlaneGeometry(11, dh, 28, 1); const pos = g.attributes.position;
      for (let k=0;k<pos.count;k++){ const px = pos.getX(k); pos.setZ(k, Math.sin((px+5.5)/11*Math.PI*4)*0.9); }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, M.velvet); m.position.set(du+5.5, (z1+9+z0-18)/2, 3.2); m.castShadow = true; m.receiveShadow = true; scene.add(m);
      boxAt(du-0.4, 2.2, z0+12, 11.8, 2.6, 1.2, M.gilt, 0.3, null, false);
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, w+30, 12), M.brass); rod.rotation.z = Math.PI/2; rod.position.set(u0+w/2, z1+9, 4); rod.castShadow = true; scene.add(rod);
    for (const ex of [u0-15, u1+15]) sphereAt(ex, 4, z1+9, 1.5, M.brass);
  }

  // ---------- день и ночь (светлая и тёмная темы) ----------
  let DAY = document.documentElement.getAttribute('data-theme') !== 'dark';
  const CITY = [], SUN = [], LIGHT = {lamps:[]};
  function drawCityDay(c, W2, H2, sc, h, u0, tower){
    const g = c.createLinearGradient(0,0,0,H2); g.addColorStop(0,'#5aa2e6'); g.addColorStop(0.6,'#9fcdf2'); g.addColorStop(1,'#dcefff'); c.fillStyle = g; c.fillRect(0,0,W2,H2);
    c.fillStyle = 'rgba(255,255,255,.85)';
    for (const [cx0, cy0, k] of [[0.18,0.16,1],[0.62,0.1,0.8],[0.85,0.28,0.6]]){ const cx = ((cx0*W2 + u0*2.3) % W2), cy = cy0*H2; for (const [dx, dy, r] of [[0,0,22],[22,4,17],[-20,6,15],[8,-10,16]]){ c.beginPath(); c.arc(cx+dx*k, cy+dy*k, r*k, 0, Math.PI*2); c.fill(); } }
    if (!tower){ const sg = c.createRadialGradient(W2*0.78, H2*0.16, 4, W2*0.78, H2*0.16, 70); sg.addColorStop(0,'rgba(255,253,235,1)'); sg.addColorStop(0.25,'rgba(255,246,210,.9)'); sg.addColorStop(1,'rgba(255,246,210,0)'); c.fillStyle = sg; c.fillRect(0,0,W2,H2); }
    let bx = 0, seed = tower ? 11 : 3;
    while (bx < W2){ seed = (seed*9301+49297)%233280; const bw = (5 + seed%8)*sc; seed = (seed*9301+49297)%233280; const bh = (9 + seed%(h*0.5|0))*sc;
      const bg = c.createLinearGradient(bx, 0, bx+bw, 0); const base = (seed%2) ? ['#a9b9cc','#8c9db3'] : ['#c3ccd8','#a3afbf']; bg.addColorStop(0, base[0]); bg.addColorStop(1, base[1]);
      c.fillStyle = bg; c.fillRect(bx, H2-bh, bw, bh);
      c.fillStyle = 'rgba(255,255,255,.35)';
      for (let wy=H2-bh+12; wy<H2-6; wy+=16) for (let wx=bx+6; wx<bx+bw-6; wx+=11){ c.fillRect(wx, wy, 5, 6); }
      bx += bw + 4; }
    if (tower){ const tx = W2*0.62; c.fillStyle = '#7d8aa0'; c.fillRect(tx-4, 30, 8, H2-30); c.beginPath(); c.moveTo(tx-20,H2); c.lineTo(tx-5,H2*0.45); c.lineTo(tx+5,H2*0.45); c.lineTo(tx+20,H2); c.fill(); c.beginPath(); c.ellipse(tx, H2*0.36, 18, 12, 0, 0, Math.PI*2); c.fill(); c.fillStyle = '#e8eef6'; c.fillRect(tx-14, H2*0.35, 28, 3); }
    c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(0, 0, W2, H2);
  }
  function buildSunPatch(u0, u1, z0, z1){
    // солнечный свет из окна на полу: параллелограмм с тенью от переплёта
    const tex = canvasTex(256, 256, (c, w, h)=>{
      c.clearRect(0,0,w,h);
      const g = c.createLinearGradient(0,0,0,h); g.addColorStop(0,'rgba(255,240,205,.0)'); g.addColorStop(0.18,'rgba(255,240,205,.85)'); g.addColorStop(0.85,'rgba(255,240,205,.85)'); g.addColorStop(1,'rgba(255,240,205,0)');
      c.fillStyle = g; c.fillRect(8,0,w-16,h);
      c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
      c.fillRect(w/2-5, 0, 10, h); c.fillRect(0, h/2-4, w, 8);
      for (const fx of [0.25,0.75]) c.fillRect(w*fx-2, 0, 4, h); for (const fy of [0.25,0.75]) c.fillRect(0, h*fy-2, w, 4);
      c.globalCompositeOperation = 'source-over';
    });
    const kx = 0.32, ky = 0.62, y0 = z0*ky, y1 = z1*ky;
    const P4 = [[u0 + z0*kx, y0], [u1 + z0*kx, y0], [u1 + z1*kx, y1], [u0 + z1*kx, y1]];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P4.flatMap(([x, y])=>[x, 0.22, y]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0,1, 1,1, 1,0, 0,0], 2));
    geo.setIndex([0,2,1, 0,3,2]);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({map:tex, transparent:true, opacity:0.6, blending:THREE.AdditiveBlending, depthWrite:false, toneMapped:false, color:new THREE.Color('#ffe7b8')}));
    m.renderOrder = 2; scene.add(m); SUN.push(m);
  }
  // фото за окнами: одна панорама на всю стену (models/env/nyc_day.jpg и nyc_night.jpg, кадр одинаковый);
  // каждое окно показывает свой кусок. Нет файлов — остаётся нарисованный город.
  function loadWindowPhotos(){
    const tl = new THREE.TextureLoader();
    const one = (file, key)=> tl.load(`./models/env/${file}`, tex=>{
      const asp = tex.image.width / tex.image.height, panoH = FW / asp;   // высота панорамы в единицах сцены
      for (const cty of CITY){
        const t = tex.clone(); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        const w = cty.u1 - cty.u0, h = cty.z1 - cty.z0;
        t.repeat.set(w / FW, Math.min(1, h / panoH)); t.offset.set(cty.u0 / FW, Math.max(0, Math.min(1 - t.repeat.y, 0.42 - t.repeat.y/2)));
        t.needsUpdate = true; cty[key] = t;
      }
      applyDay();
    }, undefined, ()=>{});
    one('nyc_day.jpg', 'photoDay'); one('nyc_night.jpg', 'photoNight');
  }
  function applyDay(){
    if (!scene) return;
    for (const cty of CITY){ cty.mat.map = DAY ? (cty.photoDay || cty.day) : (cty.photoNight || cty.night); cty.mat.color.set(DAY ? '#ffffff' : '#d9d9e6'); cty.mat.needsUpdate = true; }
    for (const m of SUN) m.visible = DAY;
    const Lt = STY.light;
    renderer.toneMappingExposure = DAY ? Lt.expDay : Lt.expNight;
    scene.environmentIntensity = DAY ? Lt.envDay : Lt.envNight;
    if (LIGHT.hemi){ LIGHT.hemi.color.set(DAY ? '#eef4ff' : Lt.hemiNight); LIGHT.hemi.groundColor.set(DAY ? '#6b5444' : '#2a1a1a'); LIGHT.hemi.intensity = DAY ? 1.05 : 0.55; }
    if (LIGHT.key){ LIGHT.key.color.set(DAY ? '#fffaf0' : '#fff1dc'); LIGHT.key.intensity = DAY ? 2.0 : 1.6; }
    if (LIGHT.fill){ LIGHT.fill.color.set(DAY ? '#cfe0ff' : '#9fb4ff'); LIGHT.fill.intensity = DAY ? 0.45 : 0.25; }
    if (LIGHT.sky) LIGHT.sky.intensity = DAY ? 1.15 : 0;
    if (LIGHT.win){ LIGHT.win.color.set(DAY ? '#cfe4ff' : '#7f8fd0'); LIGHT.win.intensity = DAY ? 4200 : 1800; }
    for (const l of LIGHT.lamps) l.intensity = l.userData.base * (DAY ? 0.35 : 1) * Lt.mul;
    if (M.shade) M.shade.emissiveIntensity = DAY ? 0.15 : 0.55;
    if (M.lampGlass) M.lampGlass.emissiveIntensity = DAY ? 0.15 : 0.6;
    if (M.bulb) M.bulb.emissiveIntensity = DAY ? 0.6 : 2.2;
    if (M.pendantStrip) M.pendantStrip.emissiveIntensity = DAY ? 0.5 : 1.8;
    if (M.pendantRim) M.pendantRim.emissiveIntensity = DAY ? 0.4 : 1.6;
    if (M.pendantHalo) M.pendantHalo.opacity = DAY ? 0.1 : 0.55;
    for (const g of GLOWS) g.m.emissiveIntensity = DAY ? g.day : g.night;
  }
  function setDay(day){ DAY = !!day; if (ok) applyDay(); }

  // ---------- свет ----------
  function buildLights(){
    LIGHT.hemi = new THREE.HemisphereLight('#ffe9cf', '#2a1a1a', 0.55); scene.add(LIGHT.hemi);
    const key = LIGHT.key = new THREE.DirectionalLight('#fff1dc', 1.6);
    key.position.set(FW*0.5 + 260, 420, FD*0.5 + 330); key.target.position.set(FW*0.5, 0, FD*0.5);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -300; sc.right = 300; sc.top = 260; sc.bottom = -260; sc.near = 50; sc.far = 1400;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6; key.shadow.radius = 4;
    scene.add(key); scene.add(key.target);
    const fill = LIGHT.fill = new THREE.DirectionalLight('#9fb4ff', 0.25); fill.position.set(-200, 200, 400); scene.add(fill);
    const sky = LIGHT.sky = new THREE.DirectionalLight('#dbe9ff', 0); sky.position.set(FW*0.5 - 60, 260, -260); sky.target.position.set(FW*0.5, 0, FD*0.6); scene.add(sky); scene.add(sky.target);
    for (const [x, y, z, kind] of LAMPS){
      const p = new THREE.PointLight(kind==='floor' ? '#ffc98a' : '#ffd79a', kind==='floor' ? 5200 : 2600, kind==='floor' ? 180 : 110, 2);
      p.position.set(x, z, y); p.userData.base = p.intensity; p.userData.kind = kind; LIGHT.lamps.push(p); scene.add(p);
    }
    for (const [ty, tz, w] of [[102, 67, 0.45], [173, 68, 0.5]]){
      const sp = new THREE.SpotLight('#ffdcaa', 9000, 120, w, 0.7, 2); sp.position.set(14, tz+34, ty); sp.target.position.set(0, tz, ty); sp.userData.base = sp.intensity; LIGHT.lamps.push(sp); scene.add(sp); scene.add(sp.target);
    }
    // подвесы: узкий тёплый конус вниз — пятно света на столе и полу
    for (const [x, y, z] of PENDANTS){ const p = new THREE.SpotLight('#ffcf94', 20000, 150, 0.66, 0.8, 2); p.position.set(x, z, y); p.target.position.set(x, 0, y); p.userData.base = p.intensity; p.userData.kind = 'pendant'; LIGHT.lamps.push(p); LIGHT.pendants = (LIGHT.pendants || []).concat(p); scene.add(p); scene.add(p.target); }
    const win = LIGHT.win = new THREE.PointLight('#7f8fd0', 1800, 160, 2); win.position.set(220, 70, 20); scene.add(win);
  }

  // ---------- динамические текстуры ----------
  function fmtP(p){ return p>=1000? p.toFixed(1) : p>=10? p.toFixed(2) : p>=1? p.toFixed(3) : p.toFixed(4); }
  function drawTicker(c, w, h){
    c.fillStyle = '#120c0a'; c.fillRect(0,0,w,h);
    if (!COINS.length || !S.coins) return;
    c.font = `700 52px ${MONO}`; c.textBaseline = 'middle';
    let x = 20;
    while (x < w){
      for (const cn of COINS){
        const st0 = S.coins[cn.sym]; if (!st0) continue;
        const ch = indicators(cn.sym).chg24; const a = `${cn.sym} ${fmtP(st0.price)} `, b = `${ch>=0?'▲':'▼'}${Math.abs(ch*100).toFixed(1)}%   `;
        c.shadowColor = 'rgba(255,170,60,.9)'; c.shadowBlur = 8; c.fillStyle = '#ffb547'; c.fillText(a, x, h/2+2); x += c.measureText(a).width;
        c.fillStyle = ch>=0 ? '#5ee39a' : '#ff7d88'; c.shadowColor = c.fillStyle; c.fillText(b, x, h/2+2); x += c.measureText(b).width;
        if (x > w) break;
      }
    }
    c.shadowBlur = 0;
  }
  function drawChartTex(c, w, h){
    const g = c.createLinearGradient(0,0,0,h); g.addColorStop(0,'#141b38'); g.addColorStop(1,'#0c1126'); c.fillStyle = g; c.fillRect(0,0,w,h);
    const sym = S.selected, st0 = S.coins && S.coins[sym]; if (!st0 || !st0.cur) return;
    const cs = st0.candles.slice(-40).concat([st0.cur]);
    let hi = -Infinity, lo = Infinity; for (const k of cs){ hi = Math.max(hi,k.h); lo = Math.min(lo,k.l); }
    const pad = (hi-lo)*0.08 || hi*0.001; hi += pad; lo -= pad;
    const top = 70, bot = h-26, yv = v => bot - (v-lo)/(hi-lo||1)*(bot-top);
    c.strokeStyle = 'rgba(160,170,230,.12)'; c.lineWidth = 2; for (let k=0;k<5;k++){ const yy = top + k*(bot-top)/4; c.beginPath(); c.moveTo(20,yy); c.lineTo(w-20,yy); c.stroke(); }
    const step = (w-60)/cs.length;
    cs.forEach((k,i)=>{ const xx = 30 + i*step, up = k.c>=k.o; c.fillStyle = up ? '#4fd18b' : '#ff6b78'; c.fillRect(xx+step*0.35, yv(k.h), 3, Math.max(2, yv(k.l)-yv(k.h))); const y1 = yv(Math.max(k.o,k.c)), y2 = yv(Math.min(k.o,k.c)); c.fillRect(xx, y1, step*0.72, Math.max(3, y2-y1)); });
    for (const pos of S.pf.positions.filter(p=>p.sym===sym)){ const yy = yv(clamp(pos.entry,lo,hi)); c.setLineDash([12,8]); c.strokeStyle = '#ffb547'; c.lineWidth = 3; c.beginPath(); c.moveTo(20,yy); c.lineTo(w-20,yy); c.stroke(); c.setLineDash([]); }
    c.font = `700 40px ${FONT}`; c.fillStyle = '#dfe3ff'; c.textBaseline = 'top'; c.fillText(`${sym}/USDT`, 28, 18);
    c.textAlign = 'right'; c.fillStyle = '#ffffff'; c.fillText(fmtP(st0.price), w-28, 18); c.textAlign = 'left';
  }
  function drawBoardTex(c, w, h){
    const Bd = STY.board || {bg:'#21402f', grain:'#0b1a10', title:'#d9b867'};
    c.fillStyle = Bd.bg; c.fillRect(0,0,w,h); noise(c, w, h, 6000, Bd.grain, 0.3);
    c.font = `700 34px ${FONT}`; c.fillStyle = Bd.title; c.textAlign = 'center'; c.fillText('СИГНАЛЫ', w/2, 52);
    (S.sigLog || []).slice(0,4).forEach((sg,i)=>{
      const cx = 105 + (i%2)*190, cy = 165 + Math.floor(i/2)*170;
      c.save(); c.translate(cx, cy); c.rotate(((i*37)%7-3)*0.02);
      c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 10; c.shadowOffsetY = 4; c.fillStyle = '#f3ead6'; c.fillRect(-78,-70,156,140); c.shadowColor = 'transparent';
      c.fillStyle = sg.type==='close' ? '#9a8e72' : sg.dir>0 ? '#2f8a57' : '#a8323e'; c.fillRect(-78,-70,156,24);
      c.fillStyle = '#c9a24e'; c.beginPath(); c.arc(0,-58,7,0,Math.PI*2); c.fill();
      c.fillStyle = '#2a1f1a'; c.font = `800 40px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(sg.sym, 0, -6);
      c.font = `700 26px ${FONT}`; c.fillStyle = sg.type==='close' ? '#6b6250' : sg.dir>0 ? '#1d6b3e' : '#8a1f2b';
      c.fillText(sg.type==='close' ? 'закрыть' : (sg.dir>0 ? '▲ лонг' : '▼ шорт') + ` ${sg.conf}%`, 0, 40);
      c.restore();
    });
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }
  // тепловая карта: площадь — примерная капитализация, цвет — изменение за 24 ч
  const CAP = {BTC:50, ETH:18, BNB:7, SOL:6, XRP:6, DOGE:3, ADA:2, TON:2, AVAX:1.5, LINK:1.5, LTC:1, TRX:2, DOT:1};
  function drawHeatTex(c, w, h){
    c.fillStyle = '#0c0c0e'; c.fillRect(0, 0, w, h);
    c.font = `700 30px ${FONT}`; c.fillStyle = '#c8a97e'; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText('РЫНОК · 24 Ч', 28, 34);
    if (!COINS.length || !S.coins) return;
    const items = COINS.map(cn => ({sym:cn.sym, w:CAP[cn.sym] || 1.5, st:S.coins[cn.sym]})).filter(x => x.st).sort((a, b) => b.w - a.w);
    const tiles = [];
    const split = (arr, x, y, ww, hh)=>{
      if (arr.length === 1){ tiles.push({...arr[0], x, y, ww, hh}); return; }
      const tot = arr.reduce((a, b) => a + b.w, 0); let acc = 0, k = 0;
      while (k < arr.length - 1 && acc + arr[k].w <= tot/2) acc += arr[k++].w;
      if (k === 0){ acc = arr[0].w; k = 1; }
      const f = acc / tot;
      if (ww >= hh){ split(arr.slice(0, k), x, y, ww*f, hh); split(arr.slice(k), x + ww*f, y, ww*(1 - f), hh); }
      else { split(arr.slice(0, k), x, y, ww, hh*f); split(arr.slice(k), x, y + hh*f, ww, hh*(1 - f)); }
    };
    split(items, 20, 64, w - 40, h - 84);
    for (const t of tiles){
      const ch = indicators(t.sym).chg24 || 0, k = Math.min(1, Math.abs(ch) / 0.06);
      const base = ch >= 0 ? [31, 157, 85] : [205, 58, 58], dark = [26, 26, 28];
      const col = base.map((v, i) => Math.round(dark[i] + (v - dark[i]) * (0.35 + 0.65*k)));
      c.fillStyle = `rgb(${col.join(',')})`; c.fillRect(t.x + 3, t.y + 3, t.ww - 6, t.hh - 6);
      const big = Math.min(t.ww, t.hh), fs = Math.max(22, Math.min(78, big * 0.3));
      c.fillStyle = '#ffffff'; c.textAlign = 'center';
      c.font = `800 ${fs}px ${FONT}`; c.fillText(t.sym, t.x + t.ww/2, t.y + t.hh/2 - fs*0.28);
      c.font = `600 ${fs*0.46}px ${FONT}`; c.fillStyle = 'rgba(255,255,255,.88)'; c.fillText(`${ch >= 0 ? '+' : '−'}${Math.abs(ch*100).toFixed(1)}%`, t.x + t.ww/2, t.y + t.hh/2 + fs*0.42);
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }
  function drawClockTex(c, w, h){
    c.fillStyle = '#f6efdc'; c.beginPath(); c.arc(w/2,h/2,w/2,0,Math.PI*2); c.fill();
    c.fillStyle = '#2a2230'; for (let k=0;k<12;k++){ const an = k/12*Math.PI*2; c.beginPath(); c.arc(w/2+Math.sin(an)*100, h/2-Math.cos(an)*100, k%3===0?7:4, 0, Math.PI*2); c.fill(); }
    const d = new Date(simNowMs()); const hh = d.getHours()%12 + d.getMinutes()/60, mm = d.getMinutes()/60;
    c.lineCap = 'round'; c.strokeStyle = '#2a2230'; c.lineWidth = 9; c.beginPath(); c.moveTo(w/2,h/2); c.lineTo(w/2+Math.sin(hh/12*Math.PI*2)*58, h/2-Math.cos(hh/12*Math.PI*2)*58); c.stroke();
    c.strokeStyle = '#7a2028'; c.lineWidth = 5; c.beginPath(); c.moveTo(w/2,h/2); c.lineTo(w/2+Math.sin(mm*Math.PI*2)*88, h/2-Math.cos(mm*Math.PI*2)*88); c.stroke();
    c.fillStyle = '#c9a24e'; c.beginPath(); c.arc(w/2,h/2,8,0,Math.PI*2); c.fill();
  }
  function drawScreenTex(c, w, h, a){
    const g = c.createLinearGradient(0,0,0,h); g.addColorStop(0,'#16224a'); g.addColorStop(1,'#0c1330'); c.fillStyle = g; c.fillRect(0,0,w,h);
    if (!S.coins || !COINS.length) return;
    const t = nowS();
    if (a.id==='nika'){
      const fl = flashNews && t < flashNews.until;
      if (fl && Math.sin(t*12)>0){ c.fillStyle = flashNews.tone>0?'#4fd18b':'#ff6b78'; c.fillRect(0,0,w,26); }
      for (let i=0;i<7;i++){ const yy = 44+i*28; const len = 60 + ((Math.floor(t*1.5)+i*7)%9)*24; c.fillStyle = i===0?'#ffb547':'#6f80c8'; c.fillRect(22, yy, len, 12); }
    } else if (a.id==='boris'){
      const ev = (S.evals||[]).slice(0,3);
      if (!ev.length){ c.fillStyle = '#3b4a6b'; c.fillRect(30,h/2,w-60,8); }
      ev.forEach((e,i)=>{ const hh = Math.max(8, e.risk/100*(h-60)); c.fillStyle = e.verdict==='ok'?'#4fd18b':e.verdict==='caution'?'#ffb547':'#ff6b78'; c.fillRect(34+i*92, h-26-hh, 70, hh); c.font = `700 24px ${MONO}`; c.fillStyle = '#dfe3ff'; c.fillText(e.sym, 34+i*92, h-6); });
    } else if (a.id==='timur'){
      const sg = (S.sigLog||[])[0];
      if (sg && sg.type==='open'){
        c.fillStyle = sg.dir>0 ? '#4fd18b' : '#ff6b78'; c.beginPath(); const cx = w/2;
        if (sg.dir>0){ c.moveTo(cx,30); c.lineTo(cx+70,110); c.lineTo(cx+26,110); c.lineTo(cx+26,170); c.lineTo(cx-26,170); c.lineTo(cx-26,110); c.lineTo(cx-70,110); }
        else { c.moveTo(cx,180); c.lineTo(cx+70,100); c.lineTo(cx+26,100); c.lineTo(cx+26,40); c.lineTo(cx-26,40); c.lineTo(cx-26,100); c.lineTo(cx-70,100); }
        c.fill(); c.fillStyle = '#8f9cf2'; c.fillRect(30, h-34, (w-60)*sg.conf/100, 12);
        c.font = `700 26px ${MONO}`; c.fillStyle = '#dfe3ff'; c.fillText(`${sg.sym} ${sg.conf}%`, 30, h-48);
      } else { c.fillStyle = '#5b6aa8'; c.fillRect(w/2-60, h/2, 120, 10); }
    } else {
      const st0 = S.coins[S.selected]; if (!st0 || !st0.cur) return; const cs = st0.candles.slice(-14).concat([st0.cur]);
      let hi=-Infinity, lo=Infinity; for (const k of cs){ hi=Math.max(hi,k.h); lo=Math.min(lo,k.l); }
      cs.forEach((k,i)=>{ const y1 = 30+(hi-Math.max(k.o,k.c))/(hi-lo||1)*(h-60), y2 = 30+(hi-Math.min(k.o,k.c))/(hi-lo||1)*(h-60); c.fillStyle = k.c>=k.o?'#4fd18b':'#ff6b78'; c.fillRect(20+i*19, y1, 12, Math.max(4,y2-y1)); });
    }
  }
  function refreshStaticText(){ for (let i=0;i<4;i++) if (DYN['plate'+i]) redraw(DYN['plate'+i]); }
  function updateDynamic(t){
    const tick = DYN.ticker;
    if (t - (tick.last||0) > 1.5 || tick.last < 0){ tick.last = t; redraw(tick); }
    if (!REDUCED) tick.offset.x = (t*0.012) % 1;
    if (t - (DYN.chart.last||0) > 0.6 || DYN.chart.last < 0){ DYN.chart.last = t; redraw(DYN.chart); }
    const sigKey = (S.sigLog||[])[0] || null, sigN = (S.sigLog||[]).length;
    if (DYN.board.key !== sigKey || DYN.board.n !== sigN || DYN.board.last < 0){ DYN.board.key = sigKey; DYN.board.n = sigN; DYN.board.last = t; redraw(DYN.board); }
    if (t - (DYN.clock.last||0) > 1 || DYN.clock.last < 0){ DYN.clock.last = t; redraw(DYN.clock); }
    if (DYN.heat && (t - (DYN.heat.last||0) > 2 || DYN.heat.last < 0)){ DYN.heat.last = t; redraw(DYN.heat); }
    for (let i=0;i<4;i++){ const sc = DYN['screen'+i]; if (t - (sc.last||0) > 0.3){ sc.last = t; redraw(sc); } }
  }

  // ---------- фигуры ----------
  const LOOKS = {
    nika:  {skin:'#e9b48e', hair:'#4a2e1e', top:'#7c1f2c', topD:'#5a1520', sleeve:'#7c1f2c', shirt:'#f2efe8', pants:'#34312f', shoes:'#2a2420', style:'short', acc:'beard'},
    boris: {skin:'#d9a07a', hair:'#3a2a20', top:'#24252c', topD:'#15161b', sleeve:'#24252c', shirt:'#1c1d22', pants:'#1c1d22', shoes:'#121214', style:'grey', acc:'beard'},
    timur: {skin:'#e3b08c', hair:'#1d1612', top:'#d2a01e', topD:'#a67c10', sleeve:'#d2a01e', shirt:'#1c1d22', pants:'#c99a1c', shoes:'#1a1a1e', style:'short', acc:'glasses'},
    aliya: {skin:'#eab896', hair:'#8a5d3b', top:'#d9cebc', topD:'#b4a68f', sleeve:'#d9cebc', shirt:'#24304f', pants:'#24304f', shoes:'#f2f2f2', style:'crop', acc:''},
  };
  function capsule(r, len, mat){ const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat); m.castShadow = true; return m; }
  function makeFigure(a){
    const L = LOOKS[a.id];
    const mSkin = phys(L.skin, {roughness:0.55, sheen:0.25, sheenColor:new THREE.Color('#ffb0a0')});
    const mTop = phys(L.top, {roughness:0.85, sheen:0.4, sheenColor:new THREE.Color(L.top)});
    const mSleeve = phys(L.sleeve, {roughness:0.85, sheen:0.3, sheenColor:new THREE.Color(L.sleeve)});
    const mShirt = std(L.shirt, {roughness:0.8});
    const mPants = phys(L.pants, {roughness:0.85, sheen:0.3, sheenColor:new THREE.Color('#8890b0')});
    const mShoes = phys(L.shoes, {roughness:0.3, clearcoat:0.8});
    const mHair = phys(L.hair, {roughness:0.6, sheen:0.5, sheenColor:new THREE.Color('#ffffff')});
    const mEye = std('#1a1210', {roughness:0.2});
    const root = new THREE.Group(); root.scale.setScalar(FS); scene.add(root);
    const hips = new THREE.Group(); hips.position.y = 25; root.add(hips);
    const pelvis = new THREE.Mesh(new RoundedBoxGeometry(12.5, 6, 7, 3, 2.6), mPants); pelvis.castShadow = true; hips.add(pelvis);
    const torso = new THREE.Group(); hips.add(torso);
    const chest = capsule(6.1, 7.5, mTop); chest.position.y = 11.6; chest.scale.set(1.04, 1, 0.7); torso.add(chest);
    const shirtV = new THREE.Mesh(new THREE.CircleGeometry(2.8, 3), mShirt); shirtV.position.set(0, 17.2, 4.32); shirtV.rotation.z = Math.PI/2*3; shirtV.scale.set(1.3, 0.75, 1); torso.add(shirtV);
    if (L.tie){ const tie = new THREE.Mesh(new THREE.BoxGeometry(1.2, 8, 0.4), std(L.tie, {roughness:0.5})); tie.position.set(0, 14.4, 4.4); tie.rotation.x = -0.08; torso.add(tie); }
    if (a.id==='timur'){ const zip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.3), M.steel); zip.position.set(0, 16.4, 4.38); torso.add(zip); }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 3.4, 12), mSkin); neck.position.y = 21.2; torso.add(neck);
    const head = new THREE.Group(); head.position.y = 28; torso.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(5.3, 28, 20), mSkin); skull.scale.set(0.95, 1.12, 1.02); skull.castShadow = true; head.add(skull);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 14), mSkin); jaw.position.set(0, -2.6, 0.9); jaw.scale.set(0.95, 0.8, 0.95); head.add(jaw);
    for (const sx of [-1, 1]){
      const ear = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), mSkin); ear.position.set(sx*5.0, -0.2, 0); ear.scale.set(0.5, 1, 0.8); head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), mEye); eye.position.set(sx*1.85, 0.5, 4.75); head.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 4), std('#ffffff', {emissive:new THREE.Color('#ffffff'), emissiveIntensity:0.6})); glint.position.set(sx*1.85-0.2, 0.75, 5.3); head.add(glint);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.45, 0.5), mHair); brow.position.set(sx*1.9, 2.0, 4.85); brow.rotation.z = -sx*0.08; head.add(brow);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), mSkin); nose.position.set(0, -0.8, 5.35); nose.scale.set(0.9, 1.2, 1); head.add(nose);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.32, 0.3), std('#8a3d44', {roughness:0.6})); mouth.position.set(0, -2.7, 5.05); head.add(mouth);
    // причёски
    const cap = (thetaLen, scale, y=0.3, z=-0.25)=>{ const m = new THREE.Mesh(new THREE.SphereGeometry(5.65, 28, 16, 0, Math.PI*2, 0, thetaLen), mHair); m.position.set(0, y, z); m.scale.set(...scale); m.castShadow = true; head.add(m); return m; };
    if (L.style==='crop'){ const c1 = cap(1.25, [0.98, 1.12, 1.06]); c1.rotation.x = -0.32; const fr = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 10), mHair); fr.position.set(1.2, 4.6, 3.4); fr.scale.set(1.6, 0.7, 1); head.add(fr); }
    else if (L.style==='grey'){ const c1 = cap(1.85, [0.99, 1.1, 1.05], -0.2, -0.5); c1.rotation.x = -0.9; }
    else if (L.style==='short'){ const c1 = cap(1.2, [0.97, 1.1, 1.04], 0.4); c1.rotation.x = -0.3; }
    else if (L.style==='long'){ const c1 = cap(1.45, [1.0, 1.13, 1.07], 0.3); c1.rotation.x = -0.25; const back = capsule(4.6, 7, mHair); back.position.set(0, -5, -2.4); back.scale.set(1.15, 1, 0.6); head.add(back); }
    if (L.acc==='glasses'){ const gm = std('#2b2b38', {metalness:0.6, roughness:0.3}); for (const sx of [-1, 1]){ const r = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.17, 6, 18), gm); r.position.set(sx*1.9, 0.5, 5.25); head.add(r); } const br = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.2), gm); br.position.set(0, 0.7, 5.35); head.add(br); }
    if (L.acc==='phones'){ const band = new THREE.Mesh(new THREE.TorusGeometry(5.9, 0.55, 8, 28, Math.PI), std('#2b2c36', {roughness:0.4})); band.position.set(0, 0.6, -0.2); head.add(band); for (const sx of [-1, 1]){ const cup = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1.6, 18), std(a.color, {roughness:0.4})); cup.rotation.z = Math.PI/2; cup.position.set(sx*5.6, -0.3, 0); head.add(cup); } }
    if (L.acc==='beard'){ const bd = new THREE.Mesh(new THREE.SphereGeometry(4.3, 20, 14, 0, Math.PI*2, Math.PI*0.45, Math.PI*0.4), mHair); bd.position.set(0, -1.4, 0.9); bd.scale.set(0.98, 1, 1.02); head.add(bd); }
    if (L.acc==='earrings'){ for (const sx of [-1, 1]){ const e = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), M.brass); e.position.set(sx*5.1, -1.6, 0.2); head.add(e); } }
    // руки
    const arm = (sx)=>{
      const sh = new THREE.Group(); sh.position.set(sx*7.4, 17.4, 0); torso.add(sh);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(2.5, 14, 10), mTop); ball.castShadow = true; sh.add(ball);
      const up = capsule(2.05, 6.6, mSleeve); up.position.y = -5.2; sh.add(up);
      const el = new THREE.Group(); el.position.y = -10.6; sh.add(el);
      const fo = capsule(1.8, 6.2, mSleeve); fo.position.y = -4.6; el.add(fo);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 1, 10), mShirt); cuff.position.y = -8.6; el.add(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(1.85, 12, 10), mSkin); hand.position.y = -10.4; hand.scale.set(0.85, 1.1, 0.8); hand.castShadow = true; el.add(hand);
      return {sh, el, hand};
    };
    const armL = arm(-1), armR = arm(1);
    const leg = (sx)=>{
      const hp = new THREE.Group(); hp.position.set(sx*3.4, -1.2, 0); hips.add(hp);
      const th = capsule(2.7, 8.4, mPants); th.position.y = -6.2; hp.add(th);
      const kn = new THREE.Group(); kn.position.y = -12.2; hp.add(kn);
      const sh2 = capsule(2.25, 7.8, mPants); sh2.position.y = -5.4; kn.add(sh2);
      const shoe = new THREE.Mesh(new RoundedBoxGeometry(3.6, 2.6, 7.2, 3, 1.1), mShoes); shoe.position.set(0, -10.6, 1.4); shoe.castShadow = true; kn.add(shoe);
      return {hp, kn};
    };
    const legL = leg(-1), legR = leg(1);
    const paper = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 6.5), M.paper); paper.position.set(0, -11.6, 2.2); paper.rotation.x = 0.4; paper.visible = false; armR.el.add(paper);
    const cupH = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.5, 3.4, 16), M.ceramic); cupH.position.set(0, -12.4, 1.2); cupH.visible = false; armL.el.add(cupH);
    return {root, hips, torso, head, armL, armR, legL, legR, paper, cupH, yaw:0, targetYaw:0, lastX:a.x, lastY:a.y, sq:1};
  }
  // ---------- персонажи из glTF: автоскелет по пропорциям модели ----------
  const MODEL_FILES = {nika:'leon', boris:'aki', timur:'mark', aliya:'victor'};
  const RIGS = {"aki":{"crotch":0.265,"armpit":0.495,"torsoW":0.12,"armIn":0.13,"handBot":0.265,"neck":0.695,"legX":0.09,"armX":0.23,"gap":{"y0":0.23,"L":[0.125,0.125,0.125,0.125,0.175,0.175,0.173,0.173,0.175,0.16,0.158,0.16,0.162,0.165,0.167,0.167,0.163,0.16,0.158,0.158,0.15,0.148,0.143,0.138,0.133,0.13,0.128,0.128,0.128],"R":[0.125,0.125,0.125,0.125,0.177,0.175,0.173,0.173,0.175,0.16,0.16,0.16,0.162,0.165,0.167,0.167,0.163,0.16,0.158,0.158,0.15,0.148,0.143,0.14,0.135,0.13,0.128,0.128,0.128]}},"leon":{"crotch":0.27,"armpit":0.46,"torsoW":0.17,"armIn":0.18,"handBot":0.27,"neck":0.755,"legX":0.095,"armX":0.255,"gap":{"y0":0.24,"L":[0.175,0.175,0.175,0.203,0.198,0.195,0.198,0.2,0.182,0.18,0.18,0.18,0.182,0.182,0.182,0.185,0.185,0.182,0.18,0.177,0.177,0.177,0.172,0.168,0.163],"R":[0.175,0.175,0.175,0.203,0.195,0.195,0.195,0.188,0.182,0.18,0.18,0.18,0.182,0.182,0.18,0.185,0.185,0.182,0.18,0.177,0.177,0.177,0.172,0.168,0.163]}},"henry":{"crotch":0.25,"armpit":0.47,"torsoW":0.17,"armIn":0.18,"handBot":0.25,"neck":0.735,"legX":0.12,"armX":0.285,"gap":{"y0":0.22,"L":[0.228,0.228,0.223,0.223,0.225,0.228,0.21,0.205,0.205,0.205,0.205,0.21,0.213,0.213,0.21,0.21,0.205,0.203,0.2,0.198,0.195,0.193,0.188,0.18,0.175,0.172,0.172,0.172],"R":[0.233,0.228,0.223,0.225,0.225,0.228,0.21,0.208,0.205,0.205,0.208,0.21,0.213,0.213,0.213,0.21,0.208,0.205,0.203,0.2,0.195,0.193,0.188,0.185,0.18,0.175,0.173,0.173]}},"mark":{"crotch":0.25,"armpit":0.47,"torsoW":0.15,"armIn":0.16,"handBot":0.25,"neck":0.68,"legX":0.1,"armX":0.265,"gap":{"y0":0.22,"L":[0.155,0.155,0.213,0.208,0.203,0.203,0.203,0.208,0.188,0.188,0.188,0.188,0.195,0.195,0.195,0.195,0.19,0.188,0.182,0.18,0.175,0.172,0.165,0.16,0.16,0.152,0.147,0.147],"R":[0.155,0.155,0.213,0.208,0.203,0.203,0.203,0.193,0.188,0.188,0.188,0.19,0.195,0.198,0.195,0.195,0.188,0.185,0.18,0.177,0.175,0.172,0.165,0.16,0.16,0.152,0.15,0.15]}},"victor":{"crotch":0.225,"armpit":0.46,"torsoW":0.17,"armIn":0.18,"handBot":0.23,"neck":0.695,"legX":0.11,"armX":0.285,"gap":{"y0":0.2,"L":[0.175,0.175,0.175,0.175,0.228,0.225,0.223,0.223,0.223,0.225,0.203,0.2,0.208,0.208,0.21,0.213,0.21,0.21,0.205,0.205,0.2,0.198,0.195,0.19,0.185,0.18,0.175,0.173,0.173],"R":[0.175,0.175,0.175,0.175,0.228,0.225,0.223,0.223,0.223,0.225,0.203,0.2,0.208,0.208,0.21,0.213,0.21,0.21,0.208,0.205,0.2,0.198,0.195,0.19,0.185,0.182,0.175,0.175,0.175]}}};
  const HW = 52;            // рост персонажа в единицах сцены
  let modelsSettled = false;
  function sstep(e0, e1, x){ const t = clamp((x-e0)/(e1-e0), 0, 1); return t*t*(3-2*t); }
  async function loadModels(){
    let GLTFLoader = null;
    try { ({GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')); }
    catch(e){ console.warn('[3D] загрузчик моделей недоступен:', e); modelsSettled = true; return; }
    const loader = new GLTFLoader();
    await Promise.all(AG_LIST.map(async a=>{
      const name = MODEL_FILES[a.id], rig = RIGS[name]; if (!rig) return;
      try {
        const g = await fetchModel(loader, name);
        let src = null; g.scene.traverse(o=>{ if (o.isMesh && !src) src = o; });
        if (!src) return;
        const fig = makeModelFigure(a, src, rig), old = FIG[a.id];
        scene.remove(old.root);
        Object.assign(fig, {yaw:old.yaw, targetYaw:old.targetYaw, lastX:old.lastX, lastY:old.lastY});
        FIG[a.id] = fig;
      } catch(e){ console.warn('[3D] модель', name, 'не загрузилась — остаётся простая фигура', e); }
    }));
    modelsSettled = true; avatarsDone = false;
  }
  // модель хранится одним .json: glTF + двоичный буфер в base64; здесь собираем GLB в памяти и отдаём загрузчику
  async function fetchModel(loader, name, dir = './models/'){
    const res = await fetch(`${dir}${name}.json`); if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json(), buf = j.buffers && j.buffers[0], b64 = buf && buf.extras && buf.extras.base64;
    if (!b64) throw new Error('в модели нет буфера');
    delete buf.extras;
    const bin = Uint8Array.from(atob(b64), ch=>ch.charCodeAt(0)), js = new TextEncoder().encode(JSON.stringify(j));
    const jp = (4 - js.length % 4) % 4, bp = (4 - bin.length % 4) % 4, total = 28 + js.length + jp + bin.length + bp;
    const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, js.length + jp, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(js, 20); u8.fill(0x20, 20 + js.length, 20 + js.length + jp);
    const o = 20 + js.length + jp; dv.setUint32(o, bin.length + bp, true); dv.setUint32(o + 4, 0x004E4942, true); u8.set(bin, o + 8);
    return loader.parseAsync(out, dir);
  }
  // ---------- мебель из моделей: заменяет процедурные группы, при ошибке остаётся старая мебель ----------
  // перед модели — +X; w — размер по X сцены, d — по Y сцены, h — высота; uniform — пропорции модели по одному размеру
  const DESK_TOP = 23;
  const PROP_DEFS_CLUB = [
    // столы тумбами к агенту (он сидит у стены), к зрителю — задняя панель с латунной табличкой
    {file:'wooden_desk', mat:'wood', places: DX.map((x, i)=>({hide:['desk'+i], cx:x+31, cy:DESK_Y+12, w:64, d:26, h:DESK_TOP, rot:Math.PI/2, after:()=>{
      GRP['top'+i].position.y = DESK_TOP - DESK_H;
      const pm = PLATES[i]; pm.position.set(x+31, 13.5, DESK_Y + 12 + 13 + 0.45); pm.rotation.set(0, 0, 0); pm.scale.setScalar(1.05);
      boxAt(x+31 - 12.6, DESK_Y + 12 + 13 - 0.1, 13.5 - 4, 25.2, 0.5, 8, M.brass, 0.2);
    }}))},
    {file:'office_chair', mat:'leather', places: AG_LIST.map((a, i)=>({hide:['chair'+i], cx:a.sx, cy:SEAT_Y - 1, h:21.5, uniform:true, rot:-Math.PI/2}))},
    {file:'monitor', mat:'plastic', places: DX.map((x, i)=>({hide:['monitor'+i], cx:x+8.5, cy:DESK_Y+11.5, z:DESK_TOP, h:15.5, uniform:true, rot:0, screen:{i, x:0.099, y:0.468, w:0.92, h:0.56}}))},
    {file:'desk_lamp', mat:'brass', places: DX.map((x, i)=>({hide:['lamp'+i], cx:x+55, cy:DESK_Y+7, z:DESK_TOP, h:13, uniform:true, rot:Math.PI/2}))},
    {file:'snake_plant', mat:'plant', places: PLANTS.map(([x, y, big], k)=>({hide:['plant'+k], cx:x, cy:y, h:big ? 27 : 21, uniform:true, rot:k*1.3}))},
    {file:'wooden_bookshelf', mat:'wood', places:[{hide:['bookcase'], cx:18, cy:9.5, h:68, uniform:true, rot:-Math.PI/2}]},
    {file:'wooden_cabinet', mat:'wood', places:[{hide:['sideboard'], cx:10, cy:102, w:16, d:33, h:21, rot:0, after:()=>{ GRP.sideTop.position.y = -2; }}]},
    {file:'wooden_round_table', mat:'wood', places:[{hide:['table'], cx:TABLE.x, cy:TABLE.y, w:54, d:54, h:24.8, rot:0}]},
    {file:'leather_sofa', mat:'leather', places:[{hide:['sofa'], cx:15.5, cy:174, d:58, uniform:'d', rot:0}]},
    {file:'leather_armchair', mat:'leather', places:[{hide:['armchair'], cx:390, cy:168, h:21, uniform:true, rot:Math.PI}]},
  ];
  // «Манхэттен»: мебель из Tripo3D (копчёный дуб, чёрная кожа, бронза, чёрный мрамор). Перед моделей — +X, у ламп абажур — +Z
  const PROP_DEFS_MH = [
    {file:'mh_desk', pbr:true, clearcoat:0.25, places: DX.map((x, i)=>({hide:['desk'+i], cx:x+31, cy:DESK_Y+12, w:64, d:26, h:DESK_TOP, rot:Math.PI/2, after:()=>{
      GRP['top'+i].position.y = DESK_TOP - DESK_H;
      const pm = PLATES[i]; pm.position.set(x+31, 13.5, DESK_Y + 12 + 13 + 0.45); pm.rotation.set(0, 0, 0); pm.scale.setScalar(1.05);
      boxAt(x+31 - 12.6, DESK_Y + 12 + 13 - 0.1, 13.5 - 4, 25.2, 0.5, 8, M.brass, 0.2);
    }}))},
    {file:'mh_chair', pbr:true, places: AG_LIST.map((a, i)=>({hide:['chair'+i], cx:a.sx, cy:SEAT_Y - 1, h:24, uniform:true, rot:-Math.PI/2}))},
    // монитор: тонкая панель с наклоном 6°, экран-график ложится на её лицевую сторону
    {file:'mh_monitor', pbr:true, places: DX.map((x, i)=>({hide:['monitor'+i], cx:x+9, cy:DESK_Y+11.5, z:DESK_TOP, h:14, uniform:true, rot:0, screen:{i, x:0.0262, y:0.1355, w:0.962, h:0.47, tilt:0.105}}))},
    {file:'mh_lamp', pbr:true, places: DX.map((x, i)=>({hide:['lamp'+i], cx:x+55, cy:DESK_Y+8, z:DESK_TOP, h:14, uniform:true, rot:Math.PI}))},
    // растения в кашпо: четыре прежних места и три новых (углы и передний край, вне маршрутов агентов)
    {file:'mh_plant_fig', pbr:true, places:[{hide:['plant0'], cx:49, cy:28, h:46, uniform:true, rot:0.4}]},
    {file:'mh_plant_olive', pbr:true, places:[{hide:['plant1'], cx:417, cy:126, h:44, uniform:true, rot:1.1}]},
    {file:'mh_plant_snake', pbr:true, places:[{hide:['plant2'], cx:42, cy:192, h:26, uniform:true, rot:0.3}, {hide:[], cx:150, cy:195, h:23, uniform:true, rot:2.2}]},
    {file:'mh_plant_monstera', pbr:true, places:[{hide:['plant3'], cx:342, cy:189, h:26, uniform:true, rot:0.8}, {hide:[], cx:418, cy:191, h:24, uniform:true, rot:2.6}]},
    {file:'mh_plant_palm', pbr:true, places:[{hide:[], cx:419, cy:54, h:40, uniform:true, rot:0.2}]},
    // стеллажи: высокий вдоль левой стены, низкий в углу у окна (на месте старого шкафа)
    {file:'mh_shelf_tall', pbr:true, tint:'#8b7b70', places:[{hide:[], cx:7, cy:40, d:40, uniform:'d', rot:0}]},
    {file:'mh_shelf_low', pbr:true, tint:'#8b7b70', places:[{hide:['bookcase'], cx:19, cy:6, h:22.5, uniform:true, rot:-Math.PI/2}]},
    // кофемашина на комоде (туда агенты ходят за кофе), напольная ваза, бар-тележка у правого окна
    {file:'mh_espresso', pbr:true, places:[{hide:['sideTop'], cx:8.5, cy:96, z:18.1, h:10.5, uniform:true, rot:Math.PI/2}]},
    {file:'mh_vase', pbr:true, places:[{hide:[], cx:9, cy:69, h:34, uniform:true, rot:0.5}]},
    {file:'mh_barcart', pbr:true, places:[{hide:[], cx:411, cy:92, h:22, uniform:true, rot:Math.PI}]},
    {file:'mh_credenza', pbr:true, clearcoat:0.2, places:[{hide:['sideboard'], cx:7.8, cy:102, d:40, uniform:'d', rot:0, after:(i)=>{ if (GRP.sideTop) GRP.sideTop.position.set(-2, i.top - 23, 0); }}]},
    {file:'mh_table', pbr:true, clearcoat:0.6, tint:'#a3a3a3', places:[{hide:['table'], cx:TABLE.x, cy:TABLE.y, w:54, d:54, h:24.8, rot:0}]},
    {file:'mh_sofa', pbr:true, places:[{hide:['sofa'], cx:15.5, cy:174, d:58, uniform:'d', rot:0}]},
    {file:'mh_lounge', pbr:true, places:[{hide:['armchair'], cx:388, cy:166, h:29, uniform:true, rot:Math.PI}]},
    {file:'mh_floorlamp', pbr:true, places:[{hide:['floorlamp', 'globe'], cx:11, cy:136, h:54, uniform:true, rot:Math.PI/2}]},
    // бронзовые бык и медведь на комоде — смотрят друг на друга
    {file:'mh_bull', pbr:true, places:[{hide:[], cx:8, cy:107.5, z:18.1, h:7, uniform:true, rot:-0.55}]},
    {file:'mh_bear', pbr:true, places:[{hide:[], cx:8, cy:117.2, z:18.1, h:7, uniform:true, rot:0.55}]},
    // винный шкаф в правом углу под окном: тёплая подсветка полок, светодиод над дверцей и свет на пол
    {file:'mh_wine', pbr:true, glow:{color:'#ffb36b', day:0.06, night:0.42}, places:[{hide:[], cx:421, cy:5.2, h:36, uniform:true, rot:-Math.PI/2, after:(i)=>{
      const fy = 5.2 + i.size.x * i.kx / 2 + 0.1;
      const led = std('#fff1d6', {emissive:new THREE.Color('#ffc07a'), emissiveIntensity:1.6}); GLOWS.push({m:led, day:0.5, night:1.8}); led.emissiveIntensity = DAY ? 0.5 : 1.8;
      boxAt(414.6, fy, i.top - 4.2, 12.8, 0.25, 0.3, led, 0, null, false);
      const p = new THREE.PointLight('#ffb36b', 900, 36, 2); p.position.set(421, i.top * 0.5, fy + 3.5);
      p.userData.base = p.intensity; p.userData.kind = 'wine'; p.intensity = p.userData.base * (DAY ? 0.35 : 1) * STY.light.mul; LIGHT.lamps.push(p); scene.add(p);
    }}]},
  ];
  const PROP_MAT = {wood:{roughness:0.5, clearcoat:0.45, clearcoatRoughness:0.35}, leather:{roughness:0.55, clearcoat:0.25, clearcoatRoughness:0.5, sheen:0.3}, brass:{roughness:0.35, metalness:0.25, clearcoat:0.6}, plastic:{roughness:0.4}, plant:{roughness:0.75}};
  async function loadProps(){
    let GLTFLoader = null;
    try { ({GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')); } catch(e){ return; }
    const loader = new GLTFLoader();
    const PROP_DEFS = STY.props === 'manhattan' ? PROP_DEFS_MH : PROP_DEFS_CLUB;
    await Promise.all(PROP_DEFS.map(async def=>{
      let g;
      try { g = await fetchModel(loader, def.file, './models/props/'); }
      catch(e){ console.warn('[3D] мебель', def.file, 'не загрузилась — остаётся простая', e); return; }
      // материал: отражения и лак по типу поверхности
      g.scene.traverse(o=>{ if (!o.isMesh) return; const m0 = o.material; const o2 = PROP_MAT[def.mat] || {};
        const m = def.pbr
          // модели Tripo: свои карты нормалей, шероховатости и металла
          ? new THREE.MeshPhysicalMaterial({map:m0.map, normalMap:m0.normalMap || null, roughnessMap:m0.roughnessMap || null, metalnessMap:m0.metalnessMap || null, roughness:m0.roughness ?? 1, metalness:m0.metalness ?? 1, clearcoat:def.clearcoat || 0, clearcoatRoughness:0.35})
          : new THREE.MeshPhysicalMaterial({map:m0.map, roughness:o2.roughness ?? 0.6, metalness:o2.metalness ?? 0, clearcoat:o2.clearcoat || 0, clearcoatRoughness:o2.clearcoatRoughness ?? 0.4, sheen:o2.sheen || 0, sheenColor:new THREE.Color('#ffd9b8')});
        if (def.tint) m.color.set(def.tint);
        // подсветка изнутри: светлые части текстуры (полки, этикетки) мягко светятся, тёмный корпус остаётся тёмным
        if (def.glow){ m.emissive = new THREE.Color(def.glow.color); m.emissiveMap = m.map; GLOWS.push({m, day:def.glow.day, night:def.glow.night}); m.emissiveIntensity = DAY ? def.glow.day : def.glow.night; }
        if (m.normalMap) m.normalScale.set(0.9, 0.9);
        o.material = m; o.castShadow = true; o.receiveShadow = true; });
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      for (const pl of def.places){
        const side = Math.abs(Math.sin(pl.rot)) > 0.5;          // ±90°: локальная Z идёт вдоль X сцены
        let kx, ky, kz;
        if (pl.uniform === 'd'){ const k = pl.d / (side ? size.x : size.z); kx = ky = kz = k; }
        else if (pl.uniform){ const k = pl.h / size.y; kx = ky = kz = k; }
        else { kx = side ? pl.d / size.x : pl.w / size.x; kz = side ? pl.w / size.z : pl.d / size.z; ky = pl.h / size.y; }
        const wrap = new THREE.Group(), sc = new THREE.Group(), inst = g.scene.clone(true);
        inst.position.set(-c.x, -box.min.y, -c.z); sc.scale.set(kx, ky, kz); sc.add(inst); wrap.add(sc);
        wrap.position.set(pl.cx, pl.z || 0, pl.cy); wrap.rotation.y = pl.rot; scene.add(wrap);
        for (const h of pl.hide) if (GRP[h]) GRP[h].visible = false;
        if (pl.screen){ const sm = SCREENS[pl.screen.i]; const sc0 = pl.screen;
          const v = new THREE.Vector3(sc0.x - c.x, sc0.y - box.min.y, -c.z).multiply(new THREE.Vector3(kx, ky, kz)).applyAxisAngle(new THREE.Vector3(0, 1, 0), pl.rot);
          sm.position.set(pl.cx + v.x, (pl.z || 0) + v.y, pl.cy + v.z); if (sc0.tilt) sm.rotation.set(-sc0.tilt, pl.rot + Math.PI/2, 0, 'YXZ'); else sm.rotation.y = pl.rot + Math.PI/2; sm.scale.set(sc0.w * kz / 15.6, sc0.h * ky / 12.2, 1); }
        if (pl.after) pl.after({top: size.y*ky, kx, ky, kz, size});
      }
    }));
  }
  function makeModelFigure(a, src, r){
    const geo = src.geometry.clone(), pos = geo.attributes.position, n = pos.count;
    const c = r.crotch, ap = r.armpit, nk = r.neck, hb = r.handBot;
    const sy = Math.min(ap + 0.12, nk - 0.07), shX = r.torsoW + 0.02, handY = hb + 0.05;
    const e = (sy + hb)/2 + 0.015, kn = c*0.5;
    const elX = shX + (r.armX - shX) * (sy - e)/Math.max(0.05, sy - handY);
    const J = {hips:[0,c+0.04,0], chest:[0,ap,0], head:[0,nk,0], shL:[-shX,sy,0], elL:[-elX,e,0], shR:[shX,sy,0], elR:[elX,e,0], hipL:[-r.legX,c,0], knL:[-r.legX,kn,0], hipR:[r.legX,c,0], knR:[r.legX,kn,0]};
    const ORDER = ['hips','chest','head','shL','elL','shR','elR','hipL','knL','hipR','knR'];
    const PARENT = {chest:'hips', head:'chest', shL:'chest', elL:'shL', shR:'chest', elR:'shR', hipL:'hips', knL:'hipL', hipR:'hips', knR:'hipR'};
    const B = {};
    for (const nm of ORDER){ const b = new THREE.Bone(); b.name = nm; const p = J[nm], pp = PARENT[nm] ? J[PARENT[nm]] : [0,0,0]; b.position.set(p[0]-pp[0], p[1]-pp[1], p[2]-pp[2]); B[nm] = b; if (PARENT[nm]) B[PARENT[nm]].add(b); }
    const gp = r.gap, yTop = gp.y0 + (gp.L.length-1)*0.01;
    const gapAt = (left, y)=>{ const arr = left ? gp.L : gp.R; const f = (y - gp.y0)/0.01; if (f <= 0) return arr[0]; if (f >= arr.length-1) return arr[arr.length-1]; const i0 = Math.floor(f); return arr[i0] + (arr[i0+1]-arr[i0])*(f-i0); };
    const si = new Uint16Array(n*4), sw = new Float32Array(n*4), w = new Float32Array(11), ids = [0,1,2,3,4,5,6,7,8,9,10];
    for (let i=0;i<n;i++){
      const x = pos.getX(i), y = pos.getY(i), ax = Math.abs(x), L = x < 0;
      w.fill(0);
      let arm = 0;
      if (y >= gp.y0 - 0.005) arm = y <= yTop ? (ax > gapAt(L, y) ? 1 : 0) : sstep(r.torsoW - 0.015, r.armIn + 0.03, ax) * sstep(sy + 0.075, sy + 0.005, y);
      const leg = y < c + 0.05 ? (1 - arm) * sstep(c + 0.04, c - 0.015, y) : 0;
      const T = Math.max(0, 1 - arm - leg);
      const hd = sstep(nk - 0.02, nk + 0.03, y), ch = sstep(c + 0.05, ap - 0.03, y) * (1 - hd);
      w[0] = T*(1-hd-ch); w[1] = T*ch; w[2] = T*hd;
      const fo = sstep(e + 0.035, e - 0.035, y); w[L?3:5] = arm*(1-fo); w[L?4:6] = arm*fo;
      const sh = sstep(kn + 0.03, kn - 0.03, y); w[L?7:9] = leg*(1-sh); w[L?8:10] = leg*sh;
      ids.sort((p,q)=>w[q]-w[p]);
      let sum = w[ids[0]] + w[ids[1]] + w[ids[2]] + w[ids[3]];
      for (let k=0;k<4;k++){ si[i*4+k] = sum > 0 ? ids[k] : 0; sw[i*4+k] = sum > 0 ? w[ids[k]]/sum : (k ? 0 : 1); }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const mat = src.material; if (mat.normalScale) mat.normalScale.set(0.8, 0.8);
    const mesh = new THREE.SkinnedMesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const root = new THREE.Group(); root.scale.setScalar(HW); root.add(B.hips); root.add(mesh); scene.add(root);
    root.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(ORDER.map(nm=>B[nm])));
    const prop = (bone, obj, sgn)=>{ const g2 = new THREE.Group(); g2.scale.setScalar(1/HW); g2.position.set(sgn*(r.armX - elX), handY - e - 0.015, 0.035); g2.add(obj); bone.add(g2); obj.visible = false; return obj; };
    const paper = prop(B.elR, new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 7.5), M.paper), 1); paper.rotation.x = 0.35; paper.castShadow = true;
    const cupH = prop(B.elL, new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.6, 3.6, 16), M.ceramic), -1); cupH.castShadow = true;
    return {kind:'model', root, mesh, B, rig:r, hipsY:J.hips[1], top:HW, paper, cupH, yaw:0, targetYaw:0, lastX:a.x, lastY:a.y};
  }
  function armsUpPose(B){ B.shL.rotation.set(-2.75, 0, 0.3); B.shR.rotation.set(-2.75, 0, -0.3); B.elL.rotation.x = B.elR.rotation.x = -0.35; }
  function poseModel(a, f, t){
    const B = f.B, r = f.rig;
    for (const nm in B) B[nm].rotation.set(0, 0, 0);
    B.hips.position.y = f.hipsY;
    let lift = 0, fwd = 0;
    B.chest.rotation.x = REDUCED ? 0 : Math.sin(t*1.6 + a.i)*0.015;
    if (a.seated){
      B.hips.position.y = f.hipsY + (11.6/HW - r.crotch);
      B.hipL.rotation.x = B.hipR.rotation.x = -Math.PI/2 + 0.08;
      B.knL.rotation.x = B.knR.rotation.x = Math.PI/2 - 0.12;
      B.hipL.rotation.z = -0.08; B.hipR.rotation.z = 0.08;
      B.chest.rotation.x += 0.1; fwd = 2.5;
      if (a.armsUp > 0) armsUpPose(B);
      else {
        const tp = a.typing && !SIM.paused ? Math.sin(t*18 + a.i) : 0;
        B.shL.rotation.set(-0.85, 0, 0.3); B.shR.rotation.set(-0.85, 0, -0.3);
        B.elL.rotation.set(-0.8 + tp*0.07, 0, -0.25); B.elR.rotation.set(-0.8 - tp*0.07, 0, 0.25);
      }
      B.head.rotation.x = a.typing ? 0.12 : 0; B.head.rotation.y = a.typing ? 0 : Math.sin(t*0.4 + a.i*2)*0.3;
    } else if (a.walking){
      const ph = a.phase*0.5, s1 = Math.sin(ph);
      B.hips.position.y = f.hipsY + Math.abs(Math.cos(ph))*0.012;
      B.hipL.rotation.x = s1*0.55; B.hipR.rotation.x = -s1*0.55;
      B.knL.rotation.x = Math.max(0, -Math.cos(ph))*0.75; B.knR.rotation.x = Math.max(0, Math.cos(ph))*0.75;
      B.shL.rotation.set(-s1*0.4, 0, 0.1); B.shR.rotation.set(s1*0.4, 0, -0.1);
      B.elL.rotation.x = B.elR.rotation.x = -0.25;
      B.hips.rotation.y = s1*0.07; B.chest.rotation.y = -s1*0.06; B.hips.rotation.z = s1*0.025;
    } else {
      B.shL.rotation.z = 0.06; B.shR.rotation.z = -0.06; B.elL.rotation.x = B.elR.rotation.x = -0.12;
      B.head.rotation.y = Math.sin(t*0.5 + a.i)*0.2;
      if (a.armsUp > 0) armsUpPose(B);
      else if (MEET.active){ B.shR.rotation.set(-0.5, 0, -0.15); B.elR.rotation.x = -1.0 + Math.sin(t*2.4 + a.i)*0.15; }
    }
    if (!a.seated && a.carry){ B.shR.rotation.set(-0.8, 0, -0.18); B.elR.rotation.x = -0.85; }
    if (a.holdCup){ B.shL.rotation.set(-0.45, 0, 0.22); B.elL.rotation.x = -1.55; }
    f.paper.visible = !!a.carry; f.cupH.visible = !!a.holdCup;
    if (a.jumpT > 0){ const k = 1 - a.jumpT/0.7; lift = Math.sin(k*Math.PI)*10; f.root.scale.set(HW*(1-Math.sin(k*Math.PI*2)*0.04), HW*(1+Math.sin(k*Math.PI*2)*0.06), HW); }
    else f.root.scale.setScalar(HW);
    f.root.position.set(a.x + Math.sin(f.yaw)*fwd, lift, a.y + Math.cos(f.yaw)*fwd);
  }
  function lerpAngle(a, b, k){ let d = b - a; while (d > Math.PI) d -= Math.PI*2; while (d < -Math.PI) d += Math.PI*2; return a + d*k; }
  function setRot(g, x=0, y=0, z=0){ g.rotation.set(x, y, z); }
  function poseFigure(a, f, t, dt){
    if (a.walking){ const dx = a.x - f.lastX, dy = a.y - f.lastY; if (Math.hypot(dx, dy) > 0.001) f.targetYaw = Math.atan2(dx, dy); }
    else if (a.seated) f.targetYaw = 0;
    else if (FACE_YAW[a.facing] != null) f.targetYaw = FACE_YAW[a.facing];
    f.lastX = a.x; f.lastY = a.y;
    f.yaw = lerpAngle(f.yaw, f.targetYaw, 1 - Math.exp(-dt*9));
    f.root.rotation.y = f.yaw;
    if (f.kind === 'model') return poseModel(a, f, t);
    let lift = 0;
    const br = REDUCED ? 0 : Math.sin(t*1.6 + a.i)*0.012;
    f.torso.scale.set(1, 1 + br, 1);
    f.head.rotation.set(0, 0, 0);
    if (a.seated){
      f.hips.position.y = 11.4/FS;
      setRot(f.legL.hp, -Math.PI/2 + 0.05); setRot(f.legR.hp, -Math.PI/2 + 0.05);
      setRot(f.legL.kn, Math.PI/2 - 0.05); setRot(f.legR.kn, Math.PI/2 - 0.05);
      f.torso.rotation.x = 0.06;
      const tp = a.typing && !SIM.paused ? Math.sin(t*18 + a.i) : 0;
      if (a.armsUp > 0){ setRot(f.armL.sh, -2.9, 0, 0.2); setRot(f.armR.sh, -2.9, 0, -0.2); setRot(f.armL.el, -0.3); setRot(f.armR.el, -0.3); }
      else { setRot(f.armL.sh, -0.72, 0, 0.1); setRot(f.armR.sh, -0.72, 0, -0.1); setRot(f.armL.el, -0.95 + tp*0.07); setRot(f.armR.el, -0.95 - tp*0.07); }
      f.head.rotation.x = a.typing ? 0.12 : 0; f.head.rotation.y = a.typing ? 0 : Math.sin(t*0.4 + a.i*2)*0.25;
    } else {
      f.torso.rotation.x = 0;
      if (a.walking){
        const ph = a.phase*0.5, s1 = Math.sin(ph);
        f.hips.position.y = 25/1 + Math.abs(Math.cos(ph))*0.8;
        setRot(f.legL.hp, s1*0.55); setRot(f.legR.hp, -s1*0.55);
        setRot(f.legL.kn, Math.max(0, -Math.cos(ph))*0.75 + 0.05); setRot(f.legR.kn, Math.max(0, Math.cos(ph))*0.75 + 0.05);
        setRot(f.armL.sh, -s1*0.45, 0, 0.08); setRot(f.armR.sh, s1*0.45, 0, -0.08); setRot(f.armL.el, -0.3); setRot(f.armR.el, -0.3);
        f.torso.rotation.y = s1*0.06;
      } else {
        f.hips.position.y = 25; f.torso.rotation.y = 0;
        setRot(f.legL.hp, 0, 0, 0.02); setRot(f.legR.hp, 0, 0, -0.02); setRot(f.legL.kn, 0.04); setRot(f.legR.kn, 0.04);
        setRot(f.armL.sh, 0.02, 0, 0.12); setRot(f.armR.sh, 0.02, 0, -0.12); setRot(f.armL.el, -0.15); setRot(f.armR.el, -0.15);
        if (a.armsUp > 0){ setRot(f.armL.sh, -2.9, 0, 0.2); setRot(f.armR.sh, -2.9, 0, -0.2); }
        if (MEET.active && !a.walking){ setRot(f.armR.sh, -0.35, 0, -0.1); setRot(f.armR.el, -1.1 + Math.sin(t*2.4+a.i)*0.15); }
      }
      if (a.carry){ setRot(f.armR.sh, -0.9, 0, -0.05); setRot(f.armR.el, -0.7); }
      if (a.holdCup){ setRot(f.armL.sh, -0.35, 0, 0.12); setRot(f.armL.el, -1.65); }
    }
    f.paper.visible = !!a.carry; f.cupH.visible = !!a.holdCup;
    if (a.jumpT > 0){ const k = 1 - a.jumpT/0.7; lift = Math.sin(k*Math.PI)*10; f.root.scale.set(FS*(1-Math.sin(k*Math.PI*2)*0.04), FS*(1+Math.sin(k*Math.PI*2)*0.06), FS); }
    else f.root.scale.setScalar(FS);
    f.root.position.set(a.x, lift, a.y);
  }

  // ---------- самолётики, кольца выбора ----------
  function buildPlanes(){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0,0,6, -4,0,-5, 0,0.4,-3,  0,0,6, 0,0.4,-3, 4,0,-5,  0,0,6, 0,0.4,-3, 0,-2,-4], 3)); g.computeVertexNormals();
    const pm = std('#ffffff', {roughness:0.9, side:THREE.DoubleSide});
    for (let i=0;i<6;i++){ const m = new THREE.Mesh(g, pm); m.visible = false; m.castShadow = true; scene.add(m); planeMeshes.push(m); }
    selRing = new THREE.Mesh(new THREE.RingGeometry(9, 11.5, 48), new THREE.MeshBasicMaterial({color:'#ffb547', transparent:true, opacity:0.85, toneMapped:false}));
    selRing.rotation.x = -Math.PI/2; scene.add(selRing);
    hovRing = new THREE.Mesh(new THREE.RingGeometry(9, 10.5, 48), new THREE.MeshBasicMaterial({color:'#ffffff', transparent:true, opacity:0.5, toneMapped:false}));
    hovRing.rotation.x = -Math.PI/2; scene.add(hovRing);
  }

  // ---------- камера и вращение ----------
  function placeCamera(){
    const az = (45 + st.az)*deg, el = (31 + st.el)*deg;
    const fit = Math.max(1, 1.47/Math.max(0.6, st.w/Math.max(1, st.h)));
    const D = 745*fit/st.zoom;
    camera.position.set(T.x + D*Math.cos(el)*Math.sin(az), T.y + D*Math.sin(el), T.z + D*Math.cos(el)*Math.cos(az));
    camera.lookAt(T.x, T.y, T.z);
  }
  function attach(canvas, onPick, onHover){
    let down = null;
    canvas.addEventListener('pointerdown', e=>{ down = {x:e.clientX, y:e.clientY, az:st.az, el:st.el, moved:false, id:e.pointerId, touch:e.pointerType==='touch'}; });
    canvas.addEventListener('pointermove', e=>{
      if (down && !down.touch && e.buttons){
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.moved && Math.hypot(dx, dy) > 4){ down.moved = true; canvas.classList.add('grab'); try { canvas.setPointerCapture(down.id); } catch(e2){} }
        if (down.moved){ st.az = clamp(down.az - dx*0.12, -35, 35); st.el = clamp(down.el + dy*0.08, -12, 20); }
      } else if (!down) onHover(e.offsetX, e.offsetY);
    });
    const up = e=>{ if (down && !down.moved && e.type==='pointerup' && (!down.touch || Math.hypot(e.clientX-down.x, e.clientY-down.y) < 10)) onPick(e.offsetX, e.offsetY); down = null; canvas.classList.remove('grab'); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('dblclick', ()=>{ st.az = 0; st.el = 0; st.zoom = 1; });
    canvas.addEventListener('wheel', e=>{ if (!e.ctrlKey && !e.altKey) return; e.preventDefault(); st.zoom = clamp(st.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.85, 2.2); }, {passive:false});
  }

  // ---------- кадр ----------
  const _v = ()=> new THREE.Vector3();
  let vtmp = null;
  function project(X, Y, Z){ vtmp.set(X, Z, Y).project(camera); return [(vtmp.x+1)/2*st.w, (1-vtmp.y)/2*st.h]; }
  function render(cw, ch, dpr){
    if (!ok) return false;
    if (!vtmp) vtmp = _v();
    if (st.w !== cw || st.h !== ch || st.dpr !== dpr){ st.w = cw; st.h = ch; st.dpr = dpr; renderer.setPixelRatio(dpr); renderer.setSize(cw, ch, false); camera.aspect = cw/ch; camera.updateProjectionMatrix(); }
    const t = nowS(), dt = Math.min(0.1, t - (st.lastT || t)); st.lastT = t;
    placeCamera();
    updateDynamic(t);
    for (const a of AG_LIST){ poseFigure(a, FIG[a.id], t, dt); if (mugs[a.id]) mugs[a.id].visible = !!a.cup; }
    if (bell){ bell.rotation.z = bellT > 0 ? Math.sin(t*50)*0.12 : 0; }
    if (DYN.globe && !REDUCED) DYN.globe.rotation.y = t*0.15;
    // самолётики
    planeMeshes.forEach((m, i)=>{
      const p = PLANES[i]; if (!p){ m.visible = false; return; }
      const tt = clamp(p.t, 0, 1); const x = p.x0+(p.x1-p.x0)*tt, y = p.y0+(p.y1-p.y0)*tt, z = p.z0+(p.z1-p.z0)*tt + Math.sin(tt*Math.PI)*30;
      m.visible = true; m.position.set(x, z, y); m.lookAt(p.x1, p.z1, p.y1); m.rotateZ(Math.sin(tt*Math.PI*3)*0.3);
    });
    const sA = AG[selectedAgent]; if (sA){ selRing.visible = true; selRing.position.set(sA.x, 0.35, sA.y + (sA.seated ? 0 : 0)); } else selRing.visible = false;
    const hA = hoverAgent && AG[hoverAgent]; if (hA && hA.id !== selectedAgent){ hovRing.visible = true; hovRing.position.set(hA.x, 0.3, hA.y); } else hovRing.visible = false;
    renderer.render(scene, camera);
    // зоны попадания для кликов
    HITS = [];
    for (const a of AG_LIST){
      const top = project(a.x, a.y, a.seated ? 50 : 56), feet = project(a.x, a.y, a.seated ? 12 : 0), side = project(a.x + 9, a.y - 9, a.seated ? 30 : 28);
      const half = Math.max(14, Math.abs(side[0] - (top[0]+feet[0])/2));
      HITS.push({id:a.id, x0:Math.min(top[0], feet[0]) - half, x1:Math.max(top[0], feet[0]) + half, y0:top[1] - 6, y1:feet[1] + 4});
    }
    for (let i=0;i<4;i++){ const c0 = project(DX[i]+31, DESK_Y+12, DESK_H); HITS.unshift({id:AG_LIST[i].id, x0:c0[0]-st.w*0.05, x1:c0[0]+st.w*0.05, y0:c0[1]-st.h*0.05, y1:c0[1]+st.h*0.04}); }
    if (!avatarsDone && modelsSettled){ avatarsDone = true; setTimeout(makeAvatars, 50); }
    return true;
  }
  function overlay(ctx, cw, ch){
    // эмоции и пузыри поверх 3D
    const prevP = PROJ3, prevS = LY.s; PROJ3 = project;
    const p0 = project(TABLE.x, TABLE.y, 0), p1 = project(TABLE.x, TABLE.y, 20);
    const s = clamp(Math.abs(p0[1]-p1[1])/20*1.12, 0.9, 3);
    LY.s = s;
    const t = nowS();
    for (const a of AG_LIST){ const md = FIG[a.id] && FIG[a.id].kind === 'model'; const [hx2, hy2] = project(a.x, a.y, (md ? 50 : a.seated ? 46 : 54) + (a.jumpT>0 ? 8 : 0)); drawEmote(ctx, a, t, hx2, hy2); }
    renderOverlay(ctx, s, cw, ch);
    PROJ3 = prevP; LY.s = prevS;
  }

  // ---------- портреты для интерфейса ----------
  function makeAvatars(){
    try {
      const cv = document.createElement('canvas'); cv.width = 168; cv.height = 168;
      const r2 = new THREE.WebGLRenderer({canvas:cv, antialias:true, alpha:true, preserveDrawingBuffer:true});
      r2.outputColorSpace = THREE.SRGBColorSpace; r2.toneMapping = THREE.ACESFilmicToneMapping; r2.setSize(168, 168, false);
      const sc2 = new THREE.Scene();
      sc2.add(new THREE.HemisphereLight('#fff2dc', '#3a2a30', 1.4)); const k2 = new THREE.DirectionalLight('#ffffff', 2.2); k2.position.set(30, 60, 80); sc2.add(k2);
      const cam2 = new THREE.PerspectiveCamera(26, 1, 1, 500);
      const out = {};
      for (const a of AG_LIST){
        const f = FIG[a.id];
        if (f.kind === 'model'){
          for (const nm in f.B) f.B[nm].rotation.set(0, 0, 0);
          f.B.hips.position.y = f.hipsY; f.B.shL.rotation.z = 0.06; f.B.shR.rotation.z = -0.06; f.paper.visible = f.cupH.visible = false;
          f.root.position.set(0, 0, 0); f.root.rotation.set(0, 0.32, 0); f.root.scale.setScalar(HW);
          sc2.add(f.root);
          const mid = (f.rig.neck - 0.13 + 1)/2*HW, span = (1.13 - f.rig.neck)*HW;
          const d = (span*0.62)/Math.tan(13*deg);
          cam2.position.set(d*0.2, mid + 3, d); cam2.lookAt(0, mid, 0);
          r2.render(sc2, cam2);
          out[a.id] = cv.toDataURL('image/png');
          scene.add(f.root);
        } else {
          const clone = f.root.clone(true);
          clone.position.set(0, 0, 0); clone.rotation.set(0, 0.35, 0); clone.scale.setScalar(1);
          sc2.add(clone);
          const hy = (f.hips.position.y + 28) - 1;
          cam2.position.set(9, hy + 4, 44); cam2.lookAt(0, hy - 1, 0);
          r2.render(sc2, cam2);
          out[a.id] = cv.toDataURL('image/png');
          sc2.remove(clone);
        }
      }
      r2.dispose(); try { r2.forceContextLoss(); } catch(e2){}
      if (typeof onAvatars3D === 'function') onAvatars3D(out);
    } catch(e){ console.warn('[3D] портреты:', e); }
  }

  return {init, render, overlay, attach, setDay, setStyle, styles:()=>Object.fromEntries(Object.entries(STYLES).map(([k, v])=>[k, v.name])), get style(){ return Object.keys(STYLES).find(k=>STYLES[k]===STY); }, view(az=0, el=0, zoom=1, tx){ st.az = az; st.el = el; st.zoom = zoom; if (tx) Object.assign(T, tx); }, get ok(){ return ok; }, get debug(){ return {modelsSettled, avatarsDone, figs:Object.values(FIG).map(f=>f.kind||'proc'), groups:Object.fromEntries(Object.entries(GRP).map(([k, g])=>[k, g.visible ? g.children.length : -1])), lamps:(LIGHT.lamps||[]).length}; }, get failed(){ return failed; }, project};
})();
