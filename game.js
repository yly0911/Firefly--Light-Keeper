(() => {
  'use strict';

  const W = 1280, H = 720;
  const app = document.getElementById('app');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let sx = 1, sy = 1;
  function resize(){
    const rect = app.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    sx = canvas.width / W;
    sy = canvas.height / H;
  }
  new ResizeObserver(resize).observe(app);
  resize();

  /* ---------- helpers ---------- */
  let seed = 20261116;
  function rnd(){ seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function rr(a, b){ return a + rnd() * (b - a); }
  function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }
  function dist(ax, ay, bx, by){ return Math.hypot(ax - bx, ay - by); }
  function roundRect(x, y, w, h, r){
    const q = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + q, y);
    ctx.arcTo(x + w, y, x + w, y + h, q);
    ctx.arcTo(x + w, y + h, x, y + h, q);
    ctx.arcTo(x, y + h, x, y, q);
    ctx.arcTo(x, y, x + w, y, q);
    ctx.closePath();
  }
  function radial(x, y, r, rgb, a){
    if(r <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------- decorative background (static) ---------- */
  const canopies = [];
  for(let i = 0; i < 30; i++){
    const edge = Math.floor(rnd() * 4);
    let x, y;
    if(edge === 0){ x = rr(0, W); y = rr(-90, 30); }
    else if(edge === 1){ x = rr(0, W); y = rr(H - 20, H + 90); }
    else if(edge === 2){ x = rr(-90, 34); y = rr(0, H); }
    else { x = rr(W - 34, W + 90); y = rr(0, H); }
    canopies.push({ x, y, r: rr(80, 200), a: rr(.45, .9) });
  }
  const moss = [];
  for(let i = 0; i < 30; i++){
    moss.push({ x: rr(60, W - 60), y: rr(80, H - 48), r: rr(14, 46), a: rr(.008, .026), rot: rr(0, Math.PI) });
  }
  const ambient = [];
  for(let i = 0; i < 52; i++){
    ambient.push({ x: rr(20, W - 20), y: rr(40, H - 30), r: rr(.8, 2.6), ph: rr(0, 6.28), sp: rr(.15, .7) });
  }

  /* ---------- audio ---------- */
  let actx = null, master = null, ambientAudio = null;
  let muted = false;
  try { muted = localStorage.getItem('fy_muted') === '1'; } catch(e){}

  function initAudio(){
    if(!actx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC){
        actx = new AC();
        master = actx.createGain();
        master.gain.value = muted ? 0 : .9;
        master.connect(actx.destination);
      }
    }
    if(actx && actx.state === 'suspended') actx.resume();
  }
  function tone(freq, dur, type = 'sine', vol = .1, slideTo = null, delay = 0){
    if(!actx || !master) return;
    const t0 = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + .012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + .03);
  }

  function startAmbient(){
    if(!actx || !master || ambientAudio) return;
    const g = actx.createGain();
    g.gain.value = 0.0001;
    g.connect(master);
    const f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 460;
    f.Q.value = .7;
    f.connect(g);
    const oscs = [];
    [55, 82.41, 110, 164.81].forEach((hz, i) => {
      const o = actx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      o.detune.value = (i % 2 ? 4 : -4);
      const og = actx.createGain();
      og.gain.value = i === 3 ? .18 : .55;
      o.connect(og);
      og.connect(f);
      o.start();
      oscs.push(o);
    });
    g.gain.linearRampToValueAtTime(.05, actx.currentTime + 2.2);
    ambientAudio = { g, oscs };
  }

  function stopAmbient(){
    if(!ambientAudio || !actx) return;
    const { g, oscs } = ambientAudio;
    ambientAudio = null;
    const t = actx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0.0001, t + .5);
    oscs.forEach(o => { try { o.stop(t + .6); } catch(e){} });
  }

  const sfx = {
    pickup(n){ tone(520 + n * 58, .16, 'sine', .11, 760 + n * 58); },
    deposit(){ tone(523, .22, 'triangle', .09); tone(659, .26, 'triangle', .08, null, .05); },
    lit(){ [523, 659, 784, 1046].forEach((f, i) => tone(f, .34, 'sine', .1, null, i * .09)); },
    hit(){ tone(190, .3, 'sawtooth', .13, 62); tone(96, .34, 'square', .06, 50); },
    dash(){ tone(320, .13, 'sine', .06, 700); },
    level(){ [392, 523, 659].forEach((f, i) => tone(f, .4, 'sine', .08, null, i * .1)); },
    moth(){ tone(150, .26, 'triangle', .035, 90); },
    tick(){ tone(880, .06, 'square', .03); },
    clear(){ [523, 659, 784, 1046].forEach((f, i) => tone(f, .42, 'triangle', .09, null, i * .11)); },
    win(){ [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, .55, 'sine', .09, null, i * .1)); },
    lose(){ [392, 330, 262, 196].forEach((f, i) => tone(f, .55, 'sine', .09, null, i * .16)); }
  };
  function applyMute(){
    if(master) master.gain.value = muted ? 0 : .9;
    const b = document.getElementById('btnMute');
    b.classList.toggle('off', muted);
    b.textContent = muted ? '×' : '♪';
    b.title = muted ? '声音已关闭' : '声音已开启';
    try { localStorage.setItem('fy_muted', muted ? '1' : '0'); } catch(e){}
  }

  /* ---------- game state ---------- */
  const NIGHTS = [
    {
      name: '第一夜', sub: '初见', need: 3, count: 3, time: 80,
      mothFrom: 3, mothMax: 1, mothSpeed: 9, drift: 0,
      thorns: [], fogs: 0,
      intro: '三盏萤灯，每盏 3 份星露'
    },
    {
      name: '第二夜', sub: '蛾影', need: 4, count: 3, time: 80,
      mothFrom: 2, mothMax: 2, mothSpeed: 11, drift: 0,
      thorns: [{ x: 430, y: 330, r: 50 }], fogs: 0,
      intro: '荆棘出现，夜蛾更早被光吸引'
    },
    {
      name: '第三夜', sub: '风起', need: 4, count: 4, time: 80,
      mothFrom: 2, mothMax: 2, mothSpeed: 12, drift: 10,
      thorns: [{ x: 430, y: 330, r: 50 }, { x: 850, y: 520, r: 55 }], fogs: 0,
      intro: '第四盏灯亮起，星露开始随风漂移'
    },
    {
      name: '第四夜', sub: '暗潮', need: 4, count: 4, time: 78,
      mothFrom: 2, mothMax: 2, mothSpeed: 13, drift: 10,
      thorns: [{ x: 350, y: 300, r: 48 }, { x: 820, y: 560, r: 52 }], fogs: 1,
      intro: '暗潮游走进森林，踩进去脚步会变慢'
    },
    {
      name: '第五夜', sub: '五灯', need: 4, count: 5, time: 82,
      mothFrom: 2, mothMax: 2, mothSpeed: 14, drift: 12,
      thorns: [{ x: 430, y: 330, r: 52 }, { x: 850, y: 330, r: 52 }], fogs: 1,
      intro: '第五盏萤灯出现，照亮整片林间空地'
    },
    {
      name: '第六夜', sub: '长夜', need: 5, count: 4, time: 72,
      mothFrom: 1, mothMax: 3, mothSpeed: 16, drift: 14,
      thorns: [{ x: 360, y: 300, r: 46 }, { x: 920, y: 300, r: 50 }, { x: 640, y: 480, r: 54 }], fogs: 2,
      intro: '星露需求变多，两只暗潮同时出现'
    },
    {
      name: '第七夜', sub: '逆风', need: 5, count: 5, time: 76,
      mothFrom: 1, mothMax: 3, mothSpeed: 17, drift: 18,
      thorns: [{ x: 350, y: 300, r: 48 }, { x: 930, y: 300, r: 50 }, { x: 420, y: 570, r: 46 }, { x: 880, y: 570, r: 48 }], fogs: 2,
      intro: '五灯再亮，风向更急，夜蛾成群'
    },
    {
      name: '第八夜', sub: '灯熄', need: 6, count: 4, time: 74,
      mothFrom: 1, mothMax: 3, mothSpeed: 18, drift: 20,
      thorns: [{ x: 360, y: 300, r: 46 }, { x: 920, y: 300, r: 50 }, { x: 480, y: 530, r: 46 }, { x: 800, y: 530, r: 46 }], fogs: 2,
      intro: '每盏灯要 6 份星露，夜蛾紧追不舍'
    },
    {
      name: '第九夜', sub: '天明', need: 6, count: 5, time: 90,
      mothFrom: 1, mothMax: 4, mothSpeed: 21, drift: 22,
      thorns: [{ x: 350, y: 300, r: 48 }, { x: 930, y: 300, r: 50 }, { x: 420, y: 570, r: 46 }, { x: 880, y: 570, r: 48 }, { x: 640, y: 450, r: 46 }], fogs: 3,
      intro: '最后一夜：五灯、三重暗潮、四只夜蛾'
    }
  ];

  const G = {
    mode: 'menu',
    t: 0,
    night: 0,
    time: 90,
    maxTime: 90,
    caught: 0,
    banked: 0,
    totalCaught: 0,
    totalBanked: 0,
    totalTime: 0,
    cleared: 0,
    lastTick: -1,
    shake: 0,
    flash: 0,
    nearLantern: null,
    ending: 0,
    endTimer: 0
  };

  const player = {
    x: 640, y: 560, r: 15,
    baseSpeed: 252,
    carried: 0,
    faceX: 0, faceY: -1,
    dashTime: 0, dashCd: 0, dashVX: 0, dashVY: 0,
    invuln: 0, stun: 0,
    trail: [], trailTimer: 0
  };

  let lanterns = [];
  let thorns = [];
  let fogs = [];
  let dew = [];
  let moths = [];
  let particles = [];
  let texts = [];
  let spawnTimer = 0;
  let mothTimer = 0;
  let chips = [];

  const isTouch = window.matchMedia('(hover: none)').matches;
  const promptWord = isTouch ? '点「注入」' : '按 E 注入';

  const LANTERN_LAYOUTS = {
    3: [[188, 340], [1092, 340], [640, 232]],
    4: [[180, 250], [1100, 250], [330, 620], [950, 620]],
    5: [[180, 250], [1100, 250], [220, 590], [1060, 590], [640, 250]]
  };

  function makeLanterns(need, count){
    const spots = LANTERN_LAYOUTS[count] || LANTERN_LAYOUTS[3];
    return spots.map(([x, y]) => ({ x, y, fill: 0, pulse: 0, need }));
  }

  function spawnDew(px, py){
    let x = px, y = py;
    if(x === undefined){
      let tries = 0;
      do {
        x = rr(80, W - 80);
        y = rr(100, H - 90);
        tries++;
      } while(tries < 40 && (
        dist(x, y, player.x, player.y) < 135 ||
        lanterns.some(l => dist(x, y, l.x, l.y) < 105) ||
        thorns.some(t => dist(x, y, t.x, t.y) < t.r + 48) ||
        dew.some(d => dist(x, y, d.bx, d.by) < 55)
      ));
    }
    const drift = NIGHTS[G.night].drift;
    const ang = rr(0, Math.PI * 2);
    dew.push({
      x, y, bx: x, by: y,
      phase: rr(0, 6.28),
      wob: rr(5, 11),
      size: rr(6.5, 9),
      dvx: Math.cos(ang) * drift * rr(.6, 1),
      dvy: Math.sin(ang) * drift * rr(.6, 1),
      born: G.t
    });
  }

  function addText(x, y, str, color){
    texts.push({ x, y, str, color, life: 0, max: 1.1 });
  }

  function burst(x, y, rgb, n, spd, sizeBase = 2){
    for(let i = 0; i < n; i++){
      const a = rr(0, Math.PI * 2), s = rr(spd * .3, spd);
      particles.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0, max: rr(.4, .9),
        size: rr(sizeBase * .6, sizeBase * 1.6),
        color: rgb, grav: 30
      });
    }
  }

  let toastTimer = 0;
  function showNightToast(){
    const cfg = NIGHTS[G.night];
    const el = document.getElementById('nightToast');
    el.querySelector('b').textContent = cfg.name;
    el.querySelector('span').textContent = `${cfg.sub} · ${cfg.intro}`;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function loadNight(index){
    G.night = clamp(index, 0, NIGHTS.length - 1);
    const cfg = NIGHTS[G.night];
    G.mode = 'playing';
    G.time = cfg.time;
    G.maxTime = cfg.time;
    G.caught = 0;
    G.banked = 0;
    G.lastTick = -1;
    G.shake = 0;
    G.flash = 0;
    G.ending = 0;
    G.nearLantern = null;
    player.x = 640;
    player.y = 560;
    player.carried = 0;
    player.faceX = 0; player.faceY = -1;
    player.dashTime = 0; player.dashCd = 0;
    player.invuln = .8; player.stun = 0;
    player.trail.length = 0;
    player.trailTimer = 0;
    lanterns = makeLanterns(cfg.need, cfg.count);
    thorns = cfg.thorns.map(t => ({ ...t }));
    fogs = [];
    for(let i = 0; i < cfg.fogs; i++){
      const f = {
        baseX: rr(280, W - 280), baseY: rr(220, H - 220),
        r: rr(84, 112), ax: rr(110, 200), ay: rr(50, 100),
        sp: rr(.13, .22), ph: rr(0, 6.28), x: 0, y: 0
      };
      f.x = f.baseX + Math.cos(f.ph) * f.ax;
      f.y = f.baseY + Math.sin(f.ph) * f.ay;
      fogs.push(f);
    }
    dew = []; moths = []; particles = []; texts = [];
    spawnTimer = .8;
    mothTimer = 3.5;
    buildChips(cfg.count);
    for(let i = 0; i < 8; i++) spawnDew();
    app.classList.add('playing');
    document.getElementById('startScreen').classList.remove('show');
    document.getElementById('endScreen').classList.remove('show');
    document.getElementById('finalScreen').classList.remove('show');
    document.getElementById('nightLabel').textContent = cfg.name;
    initAudio();
    startAmbient();
    sfx.level();
    showNightToast();
  }

  function startRun(){
    initAudio();
    G.totalBanked = 0;
    G.totalCaught = 0;
    G.totalTime = 0;
    G.cleared = 0;
    loadNight(0);
  }

  function goHome(){
    if(G.mode === 'playing') return;
    clearTimeout(G.endTimer);
    G.mode = 'menu';
    G.ending = 0;
    stopAmbient();
    app.classList.remove('playing');
    document.getElementById('endScreen').classList.remove('show');
    document.getElementById('finalScreen').classList.remove('show');
    document.getElementById('startScreen').classList.add('show');
    document.getElementById('nightToast').classList.remove('show');
    initMenuScene();
    sfx.tick();
  }

  function initMenuScene(){
    thorns = []; fogs = [];
    lanterns = makeLanterns(4, 3);
    buildChips(3);
    lanterns[0].x = 900; lanterns[0].y = 350; lanterns[0].fill = 4;
    lanterns[1].x = 150; lanterns[1].y = 430; lanterns[1].fill = 0;
    lanterns[2].x = 1120; lanterns[2].y = 430; lanterns[2].fill = 0;
    dew = []; moths = []; particles = []; texts = [];
    player.x = 400;
    player.y = 365;
    player.carried = 2;
    player.trail.length = 0;
    player.stun = 0;
    player.dashTime = 0;
    player.dashCd = 0;
    player.invuln = 0;
    player.faceX = 0;
    player.faceY = -1;
    for(let i = 0; i < 8; i++){
      const a = 2.74 + i * .25;
      const rad = 104 + (i % 2) * 20;
      const x = player.x + Math.cos(a) * rad;
      const y = player.y + Math.sin(a) * rad * .92;
      dew.push({
        x, y, bx: x, by: y,
        phase: rr(0, 6.28), wob: rr(4, 8), size: rr(5.5, 8),
        dvx: 0, dvy: 0, born: G.t
      });
    }
  }
  initMenuScene();

  /* ---------- input ---------- */
  const keys = Object.create(null);
  const joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0, r: 70 };

  function toWorld(e){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * W,
      y: (e.clientY - rect.top) / rect.height * H
    };
  }

  window.addEventListener('keydown', e => {
    const k = e.code;
    if(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE'].includes(k)) e.preventDefault();
    keys[k] = true;
    if(k === 'KeyE') tryDeposit();
    if(k === 'Space' && G.mode === 'playing') doDash();
    if(k === 'Enter') handleAdvance();
    if(k === 'KeyR' && G.mode !== 'playing') startRun();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for(const k in keys) keys[k] = false; joy.active = false; });

  canvas.addEventListener('pointerdown', e => {
    if(G.mode !== 'playing' || e.pointerType === 'mouse') return;
    const p = toWorld(e);
    joy.active = true;
    joy.id = e.pointerId;
    joy.ox = p.x; joy.oy = p.y; joy.dx = 0; joy.dy = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if(!joy.active || e.pointerId !== joy.id) return;
    const p = toWorld(e);
    let dx = p.x - joy.ox, dy = p.y - joy.oy;
    const len = Math.hypot(dx, dy);
    const max = 78;
    if(len > max){ dx = dx / len * max; dy = dy / len * max; }
    joy.dx = dx; joy.dy = dy;
  });
  function endJoy(e){
    if(!joy.active || (e && e.pointerId !== joy.id)) return;
    joy.active = false; joy.dx = 0; joy.dy = 0; joy.id = null;
  }
  canvas.addEventListener('pointerup', endJoy);
  canvas.addEventListener('pointercancel', endJoy);

  function inputVector(){
    let x = 0, y = 0;
    if(keys.KeyA || keys.ArrowLeft) x -= 1;
    if(keys.KeyD || keys.ArrowRight) x += 1;
    if(keys.KeyW || keys.ArrowUp) y -= 1;
    if(keys.KeyS || keys.ArrowDown) y += 1;
    if(joy.active && (Math.abs(joy.dx) + Math.abs(joy.dy) > 10)){
      x = joy.dx / 78;
      y = joy.dy / 78;
    }
    const len = Math.hypot(x, y);
    if(len > 1){ x /= len; y /= len; }
    return { x, y };
  }

  /* ---------- actions ---------- */
  function doDash(){
    if(player.dashCd > 0 || player.stun > 0 || G.mode !== 'playing') return;
    const v = inputVector();
    let ax = v.x, ay = v.y;
    if(Math.hypot(ax, ay) < .1){ ax = player.faceX; ay = player.faceY; }
    const l = Math.hypot(ax, ay) || 1;
    player.dashVX = ax / l * 780;
    player.dashVY = ay / l * 780;
    player.dashTime = .16;
    player.dashCd = 2.2;
    player.invuln = Math.max(player.invuln, .34);
    sfx.dash();
    for(let i = 0; i < 8; i++){
      particles.push({
        x: player.x, y: player.y,
        vx: rr(-90, 90), vy: rr(-90, 90),
        life: 0, max: .45, size: rr(1.4, 3),
        color: [150, 250, 225], grav: 0
      });
    }
  }

  function tryDeposit(){
    if(G.mode !== 'playing') return;
    const l = lanterns.find(l => l.fill < l.need && dist(player.x, player.y, l.x, l.y) < 100);
    if(!l){
      if(player.carried > 0) addText(player.x, player.y - 42, '靠近萤灯才能注入', '#ffd39a');
      return;
    }
    if(player.carried <= 0){
      addText(l.x, l.y - 104, '身上还没有星露', '#cfe9ff');
      return;
    }
    const amount = Math.min(player.carried, l.need - l.fill);
    l.fill += amount;
    l.pulse = 1;
    player.carried -= amount;
    G.banked += amount;
    sfx.deposit();
    addText(l.x, l.y - 108, `+${amount} 星露`, '#ffe1a8');
    burst(l.x, l.y - 54, [255, 205, 130], 22, 150, 2.4);
    for(let i = 0; i < 10; i++){
      particles.push({
        x: l.x + rr(-18, 18), y: l.y - 40,
        vx: rr(-16, 16), vy: rr(-90, -40),
        life: 0, max: rr(.7, 1.5), size: rr(1.2, 2.6),
        color: [255, 210, 150], grav: 8
      });
    }
    if(l.fill >= l.need){
      sfx.lit();
      addText(l.x, l.y - 138, '萤灯亮了', '#ffe9c2');
      burst(l.x, l.y - 54, [255, 225, 170], 34, 210, 3);
      G.shake = Math.max(G.shake, 5);
    }
    if(lanterns.every(lantern => lantern.fill >= lantern.need)){
      clearNight();
    }
  }

  function hitPlayer(m){
    const lost = player.carried;
    player.carried = 0;
    for(let i = 0; i < lost; i++){
      const a = rr(0, Math.PI * 2), r = rr(58, 132);
      spawnDew(
        clamp(player.x + Math.cos(a) * r, 70, W - 70),
        clamp(player.y + Math.sin(a) * r, 92, H - 70)
      );
    }
    G.caught++;
    G.shake = 15;
    G.flash = .7;
    player.invuln = 1.6;
    player.stun = .5;
    const a = Math.atan2(player.y - m.y, player.x - m.x);
    player.x = clamp(player.x + Math.cos(a) * 34, 40, W - 40);
    player.y = clamp(player.y + Math.sin(a) * 34, 70, H - 50);
    burst(player.x, player.y, [255, 120, 100], 18, 180, 2.6);
    addText(player.x, player.y - 44, lost > 0 ? `星露散落 ×${lost}` : '被夜蛾撞到了', '#ffb3a6');
    m.dead = true;
    m.alpha = 1;
    sfx.hit();
  }

  function nightScore(){
    return Math.round(G.banked * 10 + Math.max(0, G.time) * 2 + (G.caught === 0 ? 30 : 0));
  }

  function clearNight(){
    if(G.mode !== 'playing') return;
    const last = G.night === NIGHTS.length - 1;
    G.mode = last ? 'won' : 'nightclear';
    G.ending = 0;
    app.classList.remove('playing');
    stopAmbient();
    G.totalBanked += G.banked;
    G.totalCaught += G.caught;
    G.totalTime += (G.maxTime - G.time);
    G.cleared = G.night + 1;
    if(last) sfx.win(); else sfx.clear();
    G.endTimer = setTimeout(() => { if(last) showFinal(); else showEnd('clear'); }, 850);
  }

  function lose(){
    if(G.mode !== 'playing') return;
    G.mode = 'lost';
    G.ending = 0;
    app.classList.remove('playing');
    stopAmbient();
    sfx.lose();
    G.endTimer = setTimeout(() => showEnd('lost'), 700);
  }

  function fmtTime(sec){
    sec = Math.max(0, Math.ceil(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }

  function showEnd(kind){
    if(G.mode === 'menu') return;
    const cfg = NIGHTS[G.night];
    const kicker = document.getElementById('endKicker');
    const title = document.getElementById('endTitle');
    const text = document.getElementById('endText');
    const primary = document.getElementById('btnAgain');
    const secondary = document.getElementById('btnRestartAll');
    let used = G.maxTime - G.time;
    let bank = G.banked;
    let hit = G.caught;
    let score = nightScore();

    secondary.hidden = false;
    if(kind === 'clear'){
      const next = NIGHTS[G.night + 1];
      kicker.textContent = `${cfg.name} · ${cfg.sub}`;
      title.textContent = '这一夜，撑过去了';
      title.classList.remove('lose');
      text.textContent = `下一夜「${next.sub}」：${next.intro}。`;
      primary.textContent = `进入${next.name}`;
    } else {
      kicker.textContent = `${cfg.name} · ${cfg.sub}`;
      title.textContent = '这一夜没撑住';
      title.classList.add('lose');
      text.textContent = '少带一点，早一点交出去，也许就能等到下一缕天光。';
      primary.textContent = '重试本夜';
    }

    document.getElementById('sTime').textContent = fmtTime(used);
    document.getElementById('sBank').textContent = bank;
    document.getElementById('sHit').textContent = hit;
    document.getElementById('sScore').textContent = score;
    document.getElementById('endScreen').classList.add('show');
  }

  function showFinal(){
    if(G.mode === 'menu') return;
    const dots = document.getElementById('finalLanterns');
    const finalCount = NIGHTS[NIGHTS.length - 1].count;
    if(!dots.children.length){
      for(let i = 0; i < finalCount; i++) dots.appendChild(document.createElement('i'));
    }
    let rank = '拾光者', note = '跌跌撞撞，也走到了天亮';
    if(G.totalCaught === 0){ rank = '无瑕之光'; note = '九夜之中，没有让一只夜蛾碰到你'; }
    else if(G.totalCaught <= 3){ rank = '守灯人'; note = '偶有失误，但光没有熄灭'; }
    else if(G.totalCaught <= 9){ rank = '夜行者'; note = '带着伤，也把整片森林点亮了'; }

    document.getElementById('finalRank').textContent = rank;
    document.getElementById('finalRankNote').textContent = note;
    document.getElementById('fTime').textContent = fmtTime(G.totalTime);
    document.getElementById('fBank').textContent = G.totalBanked;
    document.getElementById('fHit').textContent = G.totalCaught;
    document.getElementById('fScore').textContent =
      Math.round(G.totalBanked * 10 + G.cleared * 100 + (G.totalCaught === 0 ? 150 : 0));
    document.getElementById('finalScreen').classList.add('show');
  }

  function handleAdvance(){
    if(G.mode === 'playing') return;
    if(G.mode === 'nightclear') loadNight(G.night + 1);
    else if(G.mode === 'lost') loadNight(G.night);
    else startRun();
  }

  document.getElementById('btnStart').addEventListener('click', startRun);
  document.getElementById('btnAgain').addEventListener('click', handleAdvance);
  document.getElementById('btnRestartAll').addEventListener('click', startRun);
  document.getElementById('btnFinalAgain').addEventListener('click', startRun);
  document.getElementById('btnHome').addEventListener('click', goHome);
  document.getElementById('btnHomeFinal').addEventListener('click', goHome);
  document.getElementById('btnMute').addEventListener('click', e => {
    e.stopPropagation();
    initAudio();
    muted = !muted;
    applyMute();
    if(!muted) sfx.tick();
  });
  applyMute();
  document.getElementById('btnDash').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); doDash(); });
  document.getElementById('btnLamp').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); tryDeposit(); });

  /* ---------- update ---------- */
  function resolveThorns(){
    for(const t of thorns){
      const dx = player.x - t.x, dy = player.y - t.y;
      const d = Math.hypot(dx, dy);
      const min = t.r + player.r - 3;
      if(d < min && d > .001){
        player.x = t.x + dx / d * min;
        player.y = t.y + dy / d * min;
      }
    }
  }

  function updatePlayer(dt){
    if(player.stun > 0){
      player.stun -= dt;
    }
    if(player.dashTime > 0){
      player.dashTime -= dt;
      player.x += player.dashVX * dt;
      player.y += player.dashVY * dt;
    } else if(player.stun <= 0){
      const v = inputVector();
      const inFog = fogs.some(f => dist(player.x, player.y, f.x, f.y) < f.r);
      const slow = (1 - player.carried * .032) * (inFog ? .55 : 1);
      const sp = player.baseSpeed * slow;
      if(Math.hypot(v.x, v.y) > .05){
        player.x += v.x * sp * dt;
        player.y += v.y * sp * dt;
        player.faceX = v.x;
        player.faceY = v.y;
      }
    }
    player.x = clamp(player.x, 34, W - 34);
    player.y = clamp(player.y, 64, H - 44);
    resolveThorns();
    if(player.dashCd > 0) player.dashCd -= dt;
    if(player.invuln > 0) player.invuln -= dt;

    player.trailTimer -= dt;
    if(player.trailTimer <= 0){
      player.trailTimer = .045;
      player.trail.push({ x: player.x, y: player.y, life: 0, max: .5 });
      if(player.trail.length > 22) player.trail.shift();
    }
    for(let i = player.trail.length - 1; i >= 0; i--){
      player.trail[i].life += dt;
      if(player.trail[i].life >= player.trail[i].max) player.trail.splice(i, 1);
    }
  }

  function updateDew(dt){
    const drift = NIGHTS[G.night].drift;
    for(const d of dew){
      if(drift > 0){
        d.bx += d.dvx * dt;
        d.by += d.dvy * dt;
        if(d.bx < 80){ d.bx = 80; d.dvx = Math.abs(d.dvx); }
        if(d.bx > W - 80){ d.bx = W - 80; d.dvx = -Math.abs(d.dvx); }
        if(d.by < 100){ d.by = 100; d.dvy = Math.abs(d.dvy); }
        if(d.by > H - 80){ d.by = H - 80; d.dvy = -Math.abs(d.dvy); }
        for(const t of thorns){
          const dx = d.bx - t.x, dy = d.by - t.y;
          const dd = Math.hypot(dx, dy);
          const lim = t.r + 16;
          if(dd < lim && dd > .001){
            const nx = dx / dd, ny = dy / dd;
            d.bx = t.x + nx * lim;
            d.by = t.y + ny * lim;
            const dot = d.dvx * nx + d.dvy * ny;
            if(dot < 0){ d.dvx -= 2 * dot * nx; d.dvy -= 2 * dot * ny; }
          }
        }
      }
      d.x = d.bx + Math.sin(G.t * .75 + d.phase) * d.wob;
      d.y = d.by + Math.cos(G.t * .65 + d.phase) * d.wob * .72;
    }
    spawnTimer -= dt;
    if(dew.length < 9 && spawnTimer <= 0){
      spawnDew();
      spawnTimer = .75;
    }
    for(let i = dew.length - 1; i >= 0; i--){
      const d = dew[i];
      if(player.carried < 6 && dist(d.x, d.y, player.x, player.y) < player.r + d.size + 8){
        dew.splice(i, 1);
        player.carried++;
        sfx.pickup(player.carried);
        burst(d.x, d.y, [255, 214, 140], 12, 110, 2);
        addText(d.x, d.y - 20, '+1', '#ffe6b0');
        if(player.carried === 6) addText(player.x, player.y - 52, '携满 6 份，去萤灯注入', '#ffd08a');
      }
    }
  }

  function updateMoths(dt){
    const cfg = NIGHTS[G.night];
    const desired = player.carried >= cfg.mothFrom
      ? Math.min(cfg.mothMax, 1 + Math.floor((player.carried - cfg.mothFrom) / 1.5))
      : 0;
    let alive = moths.filter(m => !m.dead).length;
    mothTimer -= dt;
    if(alive < desired && mothTimer <= 0){
      const edge = Math.floor(rnd() * 4);
      let x, y;
      if(edge === 0){ x = rr(70, W - 70); y = -40; }
      else if(edge === 1){ x = rr(70, W - 70); y = H + 40; }
      else if(edge === 2){ x = -40; y = rr(80, H - 90); }
      else { x = W + 40; y = rr(80, H - 90); }
      moths.push({ x, y, vx: 0, vy: 0, phase: rr(0, 6.28), alpha: 0, wing: rr(0, 6.28), dead: false });
      mothTimer = 1.5;
      sfx.moth();
    }
    for(const m of moths){
      const leave = m.dead || player.carried < cfg.mothFrom;
      if(leave) m.alpha -= dt * 1.6;
      else m.alpha = Math.min(1, m.alpha + dt * 1.3);

      if(m.alpha > .02){
        const dx = player.x - m.x, dy = player.y - m.y;
        const d = Math.hypot(dx, dy) || 1;
        const tx = dx / d, ty = dy / d;
        const wob = Math.sin(G.t * 2.3 + m.phase) * .55;
        const speed = 56 + player.carried * cfg.mothSpeed;
        const dvx = (tx * .86 - ty * wob) * speed;
        const dvy = (ty * .86 + tx * wob) * speed;
        const k = Math.min(1, dt * 2.4);
        m.vx += (dvx - m.vx) * k;
        m.vy += (dvy - m.vy) * k;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.wing += dt * 15;
        if(!m.dead && player.invuln <= 0 && player.stun <= 0 && G.mode === 'playing' &&
           dist(m.x, m.y, player.x, player.y) < player.r + 14){
          hitPlayer(m);
        }
      }
    }
    moths = moths.filter(m => m.alpha > .02);
  }

  function updateLanterns(dt){
    for(const l of lanterns){
      l.pulse = Math.max(0, l.pulse - dt * 2);
      if(l.fill >= l.need && Math.random() < dt * 7){
        particles.push({
          x: l.x + rr(-16, 16), y: l.y - 48,
          vx: rr(-10, 10), vy: rr(-66, -34),
          life: 0, max: rr(1.1, 2), size: rr(1, 2.4),
          color: [255, 206, 140], grav: -4
        });
      }
    }
  }

  function updateParticles(dt){
    for(let i = particles.length - 1; i >= 0; i--){
      const p = particles[i];
      p.life += dt;
      if(p.life >= p.max){ particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.vx *= (1 - dt * 1.4);
      p.vy *= (1 - dt * .8);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function updateTexts(dt){
    for(let i = texts.length - 1; i >= 0; i--){
      const t = texts[i];
      t.life += dt;
      t.y -= dt * 26;
      if(t.life >= t.max) texts.splice(i, 1);
    }
  }

  function update(dt){
    G.t += dt;
    G.shake = Math.max(0, G.shake - dt * 34);
    G.flash = Math.max(0, G.flash - dt * 2.2);

    for(const f of fogs){
      f.x = f.baseX + Math.cos(G.t * f.sp + f.ph) * f.ax;
      f.y = f.baseY + Math.sin(G.t * f.sp * .8 + f.ph) * f.ay;
    }

    if(G.mode === 'playing'){
      G.time -= dt;
      const sec = Math.ceil(G.time);
      if(G.time <= 10 && G.time > 0 && sec !== G.lastTick){
        G.lastTick = sec;
        sfx.tick();
      }
      if(G.time <= 0){ G.time = 0; lose(); }
      updatePlayer(dt);
      updateDew(dt);
      updateMoths(dt);
      updateLanterns(dt);
    } else if(G.mode === 'menu'){
      for(const d of dew){
        d.x = d.bx + Math.sin(G.t * .75 + d.phase) * d.wob;
        d.y = d.by + Math.cos(G.t * .65 + d.phase) * d.wob * .72;
      }
    }

    updateParticles(dt);
    updateTexts(dt);

    G.nearLantern = null;
    if(G.mode === 'playing'){
      let best = null, bd = 1e9;
      for(const l of lanterns){
        if(l.fill >= l.need) continue;
        const d = dist(player.x, player.y, l.x, l.y);
        if(d < 105 && d < bd){ bd = d; best = l; }
      }
      G.nearLantern = best;
    }

    updateHUD();
  }

  /* ---------- HUD ---------- */
  const timeVal = document.getElementById('timeVal');
  const timerPanel = document.getElementById('timerPanel');
  const carryVal = document.getElementById('carryVal');
  const carryPanel = document.getElementById('carryPanel');
  const hintEl = document.getElementById('hintEl');

  function buildChips(n){
    const wrap = document.getElementById('lanternHud');
    wrap.innerHTML = '';
    for(let i = 0; i < n; i++){
      const d = document.createElement('div');
      d.className = 'chip';
      d.dataset.i = i;
      d.innerHTML = '<i></i><b>0</b><em>/0</em>';
      wrap.appendChild(d);
    }
    chips = Array.from(wrap.querySelectorAll('.chip'));
  }

  function updateHUD(){
    timeVal.textContent = fmtTime(G.time);
    timerPanel.classList.toggle('low', G.mode === 'playing' && G.time <= 12);
    carryVal.textContent = player.carried;
    carryPanel.classList.toggle('full', player.carried >= 6);
    chips.forEach((c, i) => {
      const l = lanterns[i];
      c.querySelector('b').textContent = l.fill;
      c.querySelector('em').textContent = `/${l.need}`;
      c.classList.toggle('done', l.fill >= l.need);
    });
    let hint;
    if(G.nearLantern && player.carried > 0) hint = `<b>${promptWord}</b>，把星露交给萤灯`;
    else if(G.nearLantern) hint = '萤灯在等光：先去找散落的星露';
    else if(fogs.some(f => dist(player.x, player.y, f.x, f.y) < f.r)) hint = '暗潮缠住了脚步：移动变慢，绕开它';
    else if(player.carried >= 6) hint = '星露携满了，回到萤灯旁注入';
    else if(player.carried > 0) hint = '光越亮，夜蛾越快 · 找个合适的时机交出去';
    else hint = '<b>WASD</b> 移动 · <b>空格</b> 冲刺 · <b>E</b> 注入萤灯';
    if(hintEl.dataset.h !== hint){ hintEl.innerHTML = hint; hintEl.dataset.h = hint; }
  }

  /* ---------- draw ---------- */
  function drawBackground(){
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1f29');
    g.addColorStop(.5, '#071620');
    g.addColorStop(1, '#030b10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    radial(1010, 136, 300, [120, 215, 205], .055);
    radial(1010, 136, 130, [180, 238, 230], .10);
    radial(1010, 136, 54, [215, 245, 240], .3);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(1010, 136, 30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(202, 236, 230, .16)';
    ctx.fill();

    for(const m of moss){
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, m.r, m.r * .42, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(90, 190, 160, ${m.a})`;
      ctx.fill();
      ctx.restore();
    }

    for(const c of canopies){
      const gr = ctx.createRadialGradient(c.x, c.y, c.r * .2, c.x, c.y, c.r);
      gr.addColorStop(0, `rgba(3, 13, 17, ${c.a})`);
      gr.addColorStop(.72, `rgba(3, 13, 17, ${c.a * .8})`);
      gr.addColorStop(1, 'rgba(3, 13, 17, 0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(const f of ambient){
      const a = .18 + Math.sin(G.t * f.sp * 2 + f.ph) * .18;
      radial(f.x + Math.sin(G.t * f.sp + f.ph) * 8, f.y + Math.cos(G.t * f.sp * .8 + f.ph) * 6, f.r * 7, [150, 250, 210], Math.max(0, a));
    }
    ctx.restore();
  }

  function drawLantern(l, index){
    const ratio = l.fill / l.need;
    const lit = l.fill >= l.need;
    const pulse = Math.sin(G.t * 2 + index) * .5 + .5;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowR = 96 + ratio * 140 + l.pulse * 46;
    radial(l.x, l.y - 52, glowR, [255, 178, 92], .09 + ratio * .23 + (lit ? .06 * pulse : 0));
    ctx.beginPath();
    ctx.ellipse(l.x, l.y + 4, 74 + ratio * 46, 24 + ratio * 14, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 178, 92, ${.03 + ratio * .07})`;
    ctx.fill();
    if(lit){
      radial(l.x, l.y - 52, 250 + pulse * 14, [255, 190, 110], .12);
      const bg = ctx.createLinearGradient(0, l.y - 70, 0, l.y - 330);
      bg.addColorStop(0, 'rgba(255,195,120,0.16)');
      bg.addColorStop(1, 'rgba(255,195,120,0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(l.x - 30, l.y - 62);
      ctx.lineTo(l.x - 74, l.y - 330);
      ctx.lineTo(l.x + 74, l.y - 330);
      ctx.lineTo(l.x + 30, l.y - 62);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // pedestal shadow
    const sh = ctx.createRadialGradient(l.x, l.y + 16, 2, l.x, l.y + 16, 40);
    sh.addColorStop(0, 'rgba(0, 0, 0, .42)');
    sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(l.x, l.y + 16, 40, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // stone base
    const cg = ctx.createLinearGradient(l.x - 18, 0, l.x + 18, 0);
    cg.addColorStop(0, '#0a1a20');
    cg.addColorStop(.45, '#22424a');
    cg.addColorStop(1, '#071318');
    ctx.fillStyle = cg;
    roundRect(l.x - 16, l.y - 40, 32, 54, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 220, 205, .14)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // glass orb
    ctx.beginPath();
    ctx.arc(l.x, l.y - 55, 19, 0, Math.PI * 2);
    ctx.fillStyle = lit
      ? 'rgba(255, 238, 200, .96)'
      : `rgba(255, 200, 130, ${.1 + ratio * .5})`;
    ctx.fill();
    ctx.strokeStyle = lit ? 'rgba(255, 230, 180, .9)' : 'rgba(255, 220, 170, .34)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if(ratio > 0){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      radial(l.x, l.y - 55, 12 + ratio * 16, [255, 225, 170], .5 + ratio * .35);
      ctx.restore();
    }

    // pips
    if(G.mode !== 'menu'){
      const n = l.need;
      for(let i = 0; i < n; i++){
        const px = l.x - (n - 1) * 6 + i * 12, py = l.y - 96;
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = i < l.fill ? 'rgba(255, 205, 130, .95)' : 'rgba(255, 255, 255, .15)';
        ctx.fill();
      }
    }

    // interact ring
    if(G.nearLantern === l){
      const pulseR = 58 + Math.sin(G.t * 4) * 4;
      ctx.beginPath();
      ctx.arc(l.x, l.y - 20, pulseR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 214, 150, .5)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 14px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 226, 178, .92)';
      ctx.fillText(player.carried > 0 ? promptWord : '寻找星露', l.x, l.y - 130);
    }
  }

  function drawDew(){
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(const d of dew){
      const bob = Math.sin(G.t * 2.2 + d.phase) * .35 + .65;
      const appear = Math.min(1, (G.t - d.born) * 2.5);
      radial(d.x, d.y, d.size * 5.2, [255, 208, 130], .18 * bob * appear);
      radial(d.x, d.y, d.size * 1.9, [255, 245, 215], .38 * appear);
    }
    ctx.restore();

    for(const d of dew){
      const appear = Math.min(1, (G.t - d.born) * 2.5);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.globalAlpha = appear;
      ctx.beginPath();
      ctx.arc(0, 0, d.size, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe3a4';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-d.size * .2, -d.size * .22, d.size * .42, 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf2';
      ctx.fill();
      const tw = (Math.sin(G.t * 3 + d.phase) * .5 + .5) * d.size * 1.7;
      ctx.strokeStyle = 'rgba(255, 244, 210, .55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-tw, 0); ctx.lineTo(tw, 0);
      ctx.moveTo(0, -tw); ctx.lineTo(0, tw);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawMoths(){
    for(const m of moths){
      const a = clamp(m.alpha, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = 'lighter';
      radial(m.x, m.y, 60, [168, 96, 255], .18);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(m.x, m.y);
      const ang = Math.atan2(m.vy, m.vx) + Math.PI / 2;
      ctx.rotate(ang);
      const flap = Math.sin(m.wing) * .55;

      ctx.fillStyle = 'rgba(30, 16, 46, .92)';
      ctx.strokeStyle = 'rgba(178, 120, 255, .5)';
      ctx.lineWidth = 1.2;
      // wings
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.quadraticCurveTo(-20 - flap * 10, -18, -25 - flap * 12, 4);
      ctx.quadraticCurveTo(-16, 4, -4, 6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.quadraticCurveTo(20 + flap * 10, -18, 25 + flap * 12, 4);
      ctx.quadraticCurveTo(16, 4, 4, 6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // body
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 11, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#170b24';
      ctx.fill();
      // antennae
      ctx.strokeStyle = 'rgba(200, 150, 255, .55)';
      ctx.beginPath();
      ctx.moveTo(-2, -9); ctx.quadraticCurveTo(-7, -17, -11, -19);
      ctx.moveTo(2, -9); ctx.quadraticCurveTo(7, -17, 11, -19);
      ctx.stroke();
      // eyes
      ctx.fillStyle = 'rgba(255, 108, 108, .95)';
      ctx.beginPath(); ctx.arc(-2.6, -7.2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(2.6, -7.2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawPlayer(){
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(const t of player.trail){
      const k = 1 - t.life / t.max;
      radial(t.x, t.y, 22 * k + 5, [120, 240, 208], .09 * k);
    }
    ctx.restore();

    const carried = player.carried;
    const blink = player.invuln > 0 && Math.floor(G.t * 18) % 2 === 0;

    ctx.save();
    if(blink) ctx.globalAlpha = .45;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    radial(player.x, player.y, 78 + carried * 24, [120, 240, 208], .1 + carried * .022);
    radial(player.x, player.y, 34, [190, 255, 240], .26);
    ctx.restore();

    // wings
    const flap = Math.sin(G.t * 17) * .5 + .5;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(Math.atan2(player.faceY, player.faceX) + Math.PI / 2);
    ctx.fillStyle = 'rgba(157, 251, 224, .22)';
    ctx.beginPath();
    ctx.ellipse(-8 - flap * 2, -12, 5.4, 13.5, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(8 + flap * 2, -12, 5.4, 13.5, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // body
    ctx.beginPath();
    ctx.arc(player.x, player.y, 8.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f2fffb';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x, player.y, 12.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(157, 251, 224, .6)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // carried star-dew, orbiting
    for(let i = 0; i < carried; i++){
      const a = -G.t * 1.5 + i * Math.PI * 2 / 6;
      const ox = player.x + Math.cos(a) * 33;
      const oy = player.y + Math.sin(a) * 20 - 8;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      radial(ox, oy, 15, [255, 210, 130], .45);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(ox, oy, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe6b2';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ox - .8, oy - .9, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf4';
      ctx.fill();
    }

    // dash cooldown arc
    if(player.dashCd > 0){
      const p = 1 - player.dashCd / 2.2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 21, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.strokeStyle = 'rgba(157, 251, 224, .4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawParticles(){
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(const p of particles){
      const k = 1 - p.life / p.max;
      radial(p.x, p.y, p.size * 6, p.color, .3 * k);
    }
    ctx.restore();
    for(const p of particles){
      const k = 1 - p.life / p.max;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(.4, p.size * k), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${.7 * k})`;
      ctx.fill();
    }
  }

  function drawTexts(){
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 17px "Microsoft YaHei", sans-serif';
    for(const t of texts){
      const k = 1 - t.life / t.max;
      ctx.globalAlpha = Math.max(0, k * 1.4);
      ctx.fillStyle = t.color;
      ctx.shadowColor = 'rgba(0,0,0,.7)';
      ctx.shadowBlur = 6;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
  }

  function drawFogs(){
    for(const f of fogs){
      const g = ctx.createRadialGradient(f.x, f.y, f.r * .08, f.x, f.y, f.r);
      g.addColorStop(0, 'rgba(104, 74, 150, .34)');
      g.addColorStop(.55, 'rgba(76, 52, 118, .21)');
      g.addColorStop(1, 'rgba(58, 38, 96, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      radial(
        f.x + Math.cos(f.ph + G.t * .3) * f.r * .24,
        f.y + Math.sin(f.ph * 1.4 + G.t * .24) * f.r * .2,
        f.r * .56, [122, 84, 186], .07
      );
      ctx.restore();

      ctx.setLineDash([7, 11]);
      ctx.lineDashOffset = -G.t * 10;
      ctx.strokeStyle = 'rgba(178, 138, 235, .17)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * .94, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawThorns(){
    for(const t of thorns){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      radial(t.x, t.y, t.r * 1.25, [104, 58, 168], .05);
      ctx.restore();

      // jagged bramble mass
      ctx.beginPath();
      const spikes = 16;
      for(let i = 0; i < spikes; i++){
        const a = i / spikes * Math.PI * 2;
        const rad = t.r * (i % 2 ? .78 : 1) * (.94 + .08 * Math.sin(i * 3.1 + t.x));
        const px = t.x + Math.cos(a) * rad, py = t.y + Math.sin(a) * rad;
        if(i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(8, 4, 13, .94)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(128, 86, 178, .2)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // tangled branches
      for(let i = 0; i < 6; i++){
        const a = i / 6 * Math.PI * 2 + .4;
        ctx.beginPath();
        ctx.moveTo(t.x + Math.cos(a + .9) * t.r * .18, t.y + Math.sin(a + .9) * t.r * .18);
        ctx.quadraticCurveTo(
          t.x + Math.cos(a + 1.5) * t.r * .52, t.y + Math.sin(a + 1.5) * t.r * .52,
          t.x + Math.cos(a) * t.r * .74, t.y + Math.sin(a) * t.r * .74
        );
        ctx.strokeStyle = 'rgba(30, 15, 42, .98)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // small hooked thorns
      for(let i = 0; i < 7; i++){
        const a = i / 7 * Math.PI * 2 + .2;
        const bx = t.x + Math.cos(a) * t.r * .82;
        const by = t.y + Math.sin(a) * t.r * .82;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a + .85) * 7, by + Math.sin(a + .85) * 7);
        ctx.lineTo(bx + Math.cos(a - .2) * 6, by + Math.sin(a - .2) * 6);
        ctx.closePath();
        ctx.fillStyle = 'rgba(96, 56, 132, .62)';
        ctx.fill();
      }
    }
  }

  function drawJoystick(){
    if(!joy.active) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(190, 245, 230, .22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(joy.ox, joy.oy, 62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(joy.ox + joy.dx, joy.oy + joy.dy, 26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(157, 251, 224, .16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(190, 245, 230, .4)';
    ctx.stroke();
    ctx.restore();
  }

  function drawMenuAtmosphere(){
    if(G.mode !== 'menu') return;
    const horizon = 402;

    const g = ctx.createLinearGradient(0, horizon - 80, 0, horizon + 40);
    g.addColorStop(0, 'rgba(10, 40, 40, 0)');
    g.addColorStop(.65, 'rgba(8, 30, 30, .18)');
    g.addColorStop(1, 'rgba(2, 8, 9, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon - 80, W, 120);

    ctx.fillStyle = 'rgba(2, 8, 9, .82)';
    for(let i = 0; i < 17; i++){
      const x = i * (W / 16) + ((i * 29) % 30) - 15;
      const h = 38 + ((i * 47) % 52);
      const w = 16 + ((i * 13) % 12);
      ctx.beginPath();
      ctx.moveTo(x, horizon - h);
      ctx.lineTo(x - w, horizon + 8);
      ctx.lineTo(x + w, horizon + 8);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, horizon - h * .68);
      ctx.lineTo(x - w * 1.3, horizon + 8);
      ctx.lineTo(x + w * 1.3, horizon + 8);
      ctx.closePath();
      ctx.fill();
    }

    const l = lanterns[0];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bg = ctx.createLinearGradient(l.x, l.y - 70, l.x, l.y - 230);
    bg.addColorStop(0, 'rgba(255, 214, 150, .16)');
    bg.addColorStop(1, 'rgba(255, 214, 150, 0)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(l.x - 14, l.y - 62);
    ctx.lineTo(l.x - 54, l.y - 230);
    ctx.lineTo(l.x + 54, l.y - 230);
    ctx.lineTo(l.x + 14, l.y - 62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 224, 168, .2)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([1, 9]);
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - 8);
    ctx.quadraticCurveTo((player.x + l.x) / 2, Math.min(player.y, l.y) - 75, l.x, l.y - 58);
    ctx.stroke();
    ctx.restore();
  }

  function drawMenuMoths(){
    if(G.mode !== 'menu') return;
    const list = [
      { x: 255, y: 292, s: 1.05, ph: 0 },
      { x: 1030, y: 318, s: .82, ph: 2.2 }
    ];
    for(const m of list){
      const flap = Math.sin(G.t * 1.7 + m.ph) * .5 + .5;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.scale(m.s, m.s);
      ctx.globalAlpha = .7;
      for(const side of [-1, 1]){
        ctx.beginPath();
        ctx.ellipse(side * 9, -2, 11, 6 + flap * 4, side * .55, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(96, 62, 132, .55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(180, 140, 225, .5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(24, 12, 36, .95)';
      ctx.beginPath();
      ctx.ellipse(0, 1, 2.6, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180, 140, 225, .42)';
      ctx.beginPath();
      ctx.moveTo(-1, -7);
      ctx.quadraticCurveTo(-5, -14, -8, -12);
      ctx.moveTo(1, -7);
      ctx.quadraticCurveTo(5, -14, 8, -12);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw(){
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if(G.shake > 0){
      ctx.translate(rr(-G.shake, G.shake) * .45, rr(-G.shake, G.shake) * .45);
    }

    drawBackground();
    drawMenuAtmosphere();
    drawFogs();
    drawThorns();

    for(let i = 0; i < lanterns.length; i++) drawLantern(lanterns[i], i);
    drawDew();
    drawMoths();
    drawMenuMoths();
    drawPlayer();
    drawParticles();
    drawTexts();
    drawJoystick();

    ctx.restore();

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * .32, W / 2, H / 2, H * .92);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,4,7,.72)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if(G.flash > 0){
      ctx.fillStyle = `rgba(255, 90, 80, ${G.flash * .22})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- loop ---------- */
  let last = performance.now();
  function frame(now){
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  if(location.search.indexOf('debug') >= 0){
    window.__FY = {
      G, player, NIGHTS,
      get lanterns(){ return lanterns; },
      get thorns(){ return thorns; },
      get fogs(){ return fogs; },
      get dew(){ return dew; },
      get moths(){ return moths; },
      tryDeposit, doDash, startRun, loadNight, handleAdvance, showFinal,
      audio(){ return { state: actx && actx.state, muted, master: master && master.gain.value, ambient: !!ambientAudio }; }
    };
  }
})();
