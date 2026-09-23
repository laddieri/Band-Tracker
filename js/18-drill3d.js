// ════════════════════════════════════════════════════════════════════════════
// 3D DRILL VIEW
// ════════════════════════════════════════════════════════════════════════════
// Plays the active drill chart on a 3D field, every performer a marcher in the
// band's uniform. Opened from the Drill tab, which only directors and staff
// reach (drill data is director/staff-readable in the rules); uniform colours
// and the marching style (roll step / high step) are director-edited and
// stored on the show (or on an ungrouped drill).
//
// three.js is loaded from the CDN the first time the view opens, so ordinary
// app loads pay nothing for it. The whole band is drawn with instancing: the
// marcher model is built once, its meshes are merged per body part and
// material, and each part becomes one InstancedMesh with an instance per
// performer — a few dozen draw calls however big the band is.
//
// Positions come from the 2D viewer's _drillFrameAt() (linear interpolation
// between the active sets). The pure math — field coordinates, facing, leg
// pose, uniform colours — is drill3d* in js/00-logic.js and is unit tested.

const _D3_SCRIPTS = [
  { src: 'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js',
    integrity: 'sha384-vV17nr/rMaJqmeZkFUzXLpHdQ+ME5QHKdydaqqN+3Ga39RJlNrTatJxHwGV4ml2C' },
  { src: 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js',
    integrity: 'sha384-I0DMsfimAPIqWT8lF+oA997gRgdUi3jhidoTq3fN0zmn35smXZukD01FLnsPRU9i' },
];
let _d3LoadPromise = null;

function _d3LoadThree() {
  if (window.THREE && window.THREE.OrbitControls) return Promise.resolve();
  if (_d3LoadPromise) return _d3LoadPromise;
  const load = ({ src, integrity }) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('3D engine failed to load')); };
    document.head.appendChild(s);
  });
  _d3LoadPromise = load(_D3_SCRIPTS[0]).then(() => load(_D3_SCRIPTS[1]))
    .catch(e => { _d3LoadPromise = null; throw e; }); // allow a retry
  return _d3LoadPromise;
}

// Per-viewer preferences (tempo, camera, facing) — conveniences only.
const _D3_PREFS_KEY = 'bt.drill3d';
function _d3Prefs() {
  try { return JSON.parse(localStorage.getItem(_D3_PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function _d3SavePref(k, v) {
  try { const p = _d3Prefs(); p[k] = v; localStorage.setItem(_D3_PREFS_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ }
}

const _D3_TEMPOS = [72, 84, 96, 108, 112, 120, 126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200];
// Camera presets look at the band from a fixed direction and back off until
// the whole band fits the screen (see _d3FitView), so a phone in portrait gets
// the same framing as a laptop.
const _D3_CAMS = {
  box:      { label: 'Press box', dir: [0, 0.36, 0.93] },
  sideline: { label: 'Sideline',  dir: [0, 0.07, 1] },
  endzone:  { label: 'End zone',  dir: [-0.95, 0.3, 0] },
  overhead: { label: 'Overhead',  dir: [0, 1, 0.02] },
  follow:   { label: 'Follow selected' },
};
const _D3_FACING = { auto: 'Auto', travel: 'Direction of travel', front: 'Always front' };
const _D3_UNIFORM_PARTS = [
  ['jacket', 'Jacket & tails'], ['pants', 'Pants'], ['facing', 'Red triangle'],
  ['gold', 'Buttons & epaulettes'], ['white', 'Lapels, cuffs, gloves, spats'], ['black', 'Hat & shoes'],
];
const _D3_SKIN = ['#f2c9a5', '#e2af88', '#c98f66', '#a8744e', '#7d5236', '#5e3c25'];
const _D3_HAIR = ['#1c1510', '#2e1f14', '#4a3020', '#6b4a2b', '#a57b45', '#c9a36a', '#231a17'];

let _d3 = null;        // live view state while open
let _d3OpenSeq = 0;    // bumps on open/close so a slow script load can't start a closed view

// ── Open / close ─────────────────────────────────────────────────────────────

function drill3dOpen() {
  if (!canRecord()) return;
  if (!_drillPages || !_drillPages.length) { showToast('No set position data in this chart.'); return; }
  const el = document.getElementById('drill3d');
  if (!el) return;
  const seq = ++_d3OpenSeq;
  _d3Dispose(); // never two frame loops on one view
  el.innerHTML = _d3ShellHtml();
  el.classList.remove('hidden');
  document.addEventListener('keydown', _d3Keydown);
  const close = el.querySelector('.d3-top button');
  if (close) close.focus({ preventScroll: true });
  _d3LoadThree().then(() => {
    if (seq !== _d3OpenSeq) return; // closed (or reopened) while loading
    _d3Start();
  }).catch(() => {
    if (seq !== _d3OpenSeq) return;
    _d3Msg('The 3D engine couldn’t load. Check your connection and try again.', true);
  });
}

function drill3dClose() {
  _d3OpenSeq++;
  _d3Dispose();
  const el = document.getElementById('drill3d');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
  document.removeEventListener('keydown', _d3Keydown);
}

function drill3dRetry() {
  drill3dClose();
  drill3dOpen();
}

function _d3Msg(text, retry) {
  const m = document.getElementById('d3-msg');
  if (!m) return;
  m.hidden = !text;
  m.innerHTML = text ? `<span>${esc(text)}</span>${retry ? '<button class="btn btn-sm btn-primary" onclick="drill3dRetry()">Try again</button>' : ''}` : '';
}

// Count range: the active sets (the "choose sets to animate" selection, else all).
function _d3Range() {
  const idx = _drillActiveIdx();
  const first = _drillPages[idx[0]], last = _drillPages[idx[idx.length - 1]];
  return { start: first ? first.count : 0, end: last ? last.count : 0 };
}

function _d3ShellHtml() {
  const prefs = _d3Prefs();
  const bpm = _D3_TEMPOS.includes(+prefs.bpm) ? +prefs.bpm : 144;
  const cam = _D3_CAMS[prefs.cam] && prefs.cam !== 'follow' ? prefs.cam : 'box';
  const facing = _D3_FACING[prefs.facing] ? prefs.facing : 'auto';
  const name = (STATE.drills[STATE.activeDrillId] || {}).name || _drillFileName || 'Chart';
  const { start, end } = _d3Range();
  const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
  return `
    <div class="d3-top">
      <div class="d3-title">
        <span class="d3-name">${esc(name)}</span>
        <span class="d3-where" id="d3-where">Set 1</span>
      </div>
      <button class="btn btn-sm btn-secondary" onclick="drill3dClose()" aria-label="Close 3D view">✕</button>
    </div>
    <div class="d3-stage" id="d3-stage">
      <canvas id="d3-canvas" aria-label="3D view of the drill"></canvas>
      <div class="d3-msg" id="d3-msg"><span>Loading 3D view…</span></div>
      <div class="d3-pick" id="d3-pick" hidden></div>
      <div class="d3-uniform" id="d3-uniform" hidden></div>
    </div>
    <div class="d3-controls">
      <div class="d3-scrub-row">
        <button class="btn btn-sm btn-primary d3-play" id="d3-play" onclick="drill3dTogglePlay()" aria-label="Play">▶</button>
        <input type="range" class="d3-scrub" id="d3-scrub" min="${start}" max="${end}" step="0.05" value="${start}"
               oninput="drill3dScrub(this.value)" aria-label="Count">
      </div>
      <div class="d3-opts">
        <label class="d3-opt">Tempo
          <select class="form-input d3-select" id="d3-bpm" onchange="drill3dSetBpm(this.value)">
            ${_D3_TEMPOS.map(t => opt(String(t), `${t} bpm`, String(bpm))).join('')}
          </select></label>
        <label class="d3-opt">View
          <select class="form-input d3-select" id="d3-cam" onchange="drill3dSetCam(this.value)">
            ${Object.entries(_D3_CAMS).map(([k, c]) => opt(k, c.label, cam)).join('')}
          </select></label>
        <label class="d3-opt" title="Drill files don't record which way people face. Auto marches backfield when a move heads upfield and faces the direction of travel otherwise.">Facing
          <select class="form-input d3-select" id="d3-facing" onchange="drill3dSetFacing(this.value)">
            ${Object.entries(_D3_FACING).map(([k, l]) => opt(k, l, facing)).join('')}
          </select></label>
        ${STATE.isAdmin ? '<button class="btn btn-sm btn-secondary" id="d3-uniform-btn" onclick="drill3dToggleUniform()" aria-expanded="false">Uniform</button>' : ''}
      </div>
    </div>`;
}

// ── Uniform colours (stored on the show, or the drill if it isn't in one) ────

function _d3UniformOwner() {
  const drill = STATE.drills[STATE.activeDrillId];
  if (!drill) return null;
  const show = drill.showId ? STATE.shows[drill.showId] : null;
  return show ? { kind: 'show', id: show.id, doc: show, name: show.name || 'this show' }
              : { kind: 'drill', id: STATE.activeDrillId, doc: drill, name: drill.name || 'this chart' };
}

function _d3CurrentUniform() {
  const o = _d3UniformOwner();
  return drill3dUniform(o && o.doc.uniform);
}

function _d3ApplyUniform(u) {
  if (!_d3) return;
  const m = _d3.mats;
  m.jacket.color.set(u.jacket); m.jacketDS.color.set(u.jacket);
  m.seam.color.set(u.jacket).multiplyScalar(0.35);
  m.pants.color.set(u.pants);
  m.facing.color.set(u.facing);
  m.gold.color.set(u.gold);
  m.white.color.set(u.white);
  m.fold.color.set(u.white).multiplyScalar(0.6);
  m.black.color.set(u.black); m.blackDS.color.set(u.black);
}

function drill3dToggleUniform() {
  const p = document.getElementById('d3-uniform'), btn = document.getElementById('d3-uniform-btn');
  if (!p || !_d3) return;
  const open = p.hidden;
  if (open) {
    _d3.uniformDraft = { ..._d3.uniform };
    const o = _d3UniformOwner();
    p.innerHTML = `
      <div class="d3-uniform-head">Uniform &amp; step <span class="label-hint">for ${esc(o ? o.name : 'this chart')}</span></div>
      <label class="d3-step-row">Marching style
        <select class="form-input d3-select" id="d3-u-step" onchange="drill3dUniformInput('step', this.value)">
          <option value="roll"${_d3.uniformDraft.step === 'roll' ? ' selected' : ''}>Roll step (glide)</option>
          <option value="high"${_d3.uniformDraft.step === 'high' ? ' selected' : ''}>High step</option>
        </select></label>
      <div class="d3-uniform-grid">
        ${_D3_UNIFORM_PARTS.map(([k, label]) => `
          <label class="d3-swatch">
            <input type="color" id="d3-u-${k}" value="${esc(_d3.uniformDraft[k])}" oninput="drill3dUniformInput('${k}', this.value)">
            <span>${esc(label)}</span>
          </label>`).join('')}
      </div>
      <div class="d3-uniform-actions">
        <button class="btn btn-sm btn-secondary" onclick="drill3dUniformReset()">Defaults</button>
        <button class="btn btn-sm btn-secondary" onclick="drill3dToggleUniform()">Cancel</button>
        <button class="btn btn-sm btn-primary" onclick="drill3dUniformSave()">Save</button>
      </div>`;
  } else {
    _d3ApplyUniform(_d3.uniform); // cancel: drop the unsaved preview
    _d3.uniformDraft = null;
  }
  p.hidden = !open;
  if (btn) btn.setAttribute('aria-expanded', String(open));
}

function drill3dUniformInput(key, value) {
  if (!_d3 || !_d3.uniformDraft) return;
  _d3.uniformDraft = drill3dUniform({ ..._d3.uniformDraft, [key]: value });
  _d3ApplyUniform(_d3.uniformDraft);
}

function drill3dUniformReset() {
  if (!_d3) return;
  _d3.uniformDraft = { ...DRILL3D_UNIFORM_DEFAULT };
  [..._D3_UNIFORM_PARTS.map(([k]) => k), 'step'].forEach(k => { const i = document.getElementById('d3-u-' + k); if (i) i.value = _d3.uniformDraft[k]; });
  _d3ApplyUniform(_d3.uniformDraft);
}

function drill3dUniformSave() {
  if (!_d3 || !STATE.isAdmin) return;
  const o = _d3UniformOwner();
  if (!o) return;
  const uniform = drill3dUniform(_d3.uniformDraft);
  o.doc.uniform = uniform; // optimistic; the listener confirms
  orgCol(o.kind === 'show' ? 'shows' : 'drills').doc(o.id).update({ uniform });
  _d3.uniform = uniform;
  _d3.uniformDraft = null;
  const p = document.getElementById('d3-uniform'), btn = document.getElementById('d3-uniform-btn');
  if (p) p.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
  showToast(`Uniform saved for ${o.name}`);
}

// ── Controls ─────────────────────────────────────────────────────────────────

function drill3dTogglePlay() {
  if (!_d3) return;
  if (!_d3.playing && _d3.count >= _d3.range.end - 0.01) _d3.count = _d3.range.start; // replay from the top
  _d3.playing = !_d3.playing;
  _d3SyncPlayBtn();
}

function _d3SyncPlayBtn() {
  const b = document.getElementById('d3-play');
  if (!b || !_d3) return;
  b.textContent = _d3.playing ? '⏸' : '▶';
  b.setAttribute('aria-label', _d3.playing ? 'Pause' : 'Play');
}

function drill3dScrub(v) {
  if (!_d3) return;
  _d3.count = Math.max(_d3.range.start, Math.min(_d3.range.end, parseFloat(v) || 0));
  _d3.scrubAt = performance.now();
}

function drill3dSetBpm(v) {
  if (!_d3) return;
  _d3.bpm = +v || 144;
  _d3SavePref('bpm', _d3.bpm);
}

function drill3dSetFacing(v) {
  if (!_d3 || !_D3_FACING[v]) return;
  _d3.facing = v;
  _d3SavePref('facing', v);
}

function drill3dSetCam(v) {
  if (!_d3 || !_D3_CAMS[v]) return;
  if (v === 'follow' && !_d3.selected) {
    showToast('Tap a marcher first, then choose Follow.');
    const sel = document.getElementById('d3-cam');
    if (sel) sel.value = _d3.cam;
    return;
  }
  _d3.cam = v;
  if (v !== 'follow') _d3SavePref('cam', v);
  _d3.controls.enabled = v !== 'follow';
  if (v !== 'follow') { const fit = _d3FitView(v); _d3TweenTo(fit.pos, fit.target); }
}

function drill3dFollow() {
  const sel = document.getElementById('d3-cam');
  if (sel) sel.value = 'follow';
  drill3dSetCam('follow');
}

function drill3dDeselect() {
  if (!_d3) return;
  _d3Select(null);
}

function _d3Keydown(e) {
  if (!_d3) { if (e.key === 'Escape') drill3dClose(); return; }
  const tag = (e.target && e.target.tagName) || '';
  if (e.key === 'Escape') { drill3dClose(); return; }
  if (tag === 'SELECT' || tag === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); drill3dTogglePlay(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); drill3dScrub(Math.floor(_d3.count + 1e-6) + 1); }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); drill3dScrub(Math.ceil(_d3.count - 1e-6) - 1); }
}

function _d3Select(label) {
  _d3.selected = label;
  const chip = document.getElementById('d3-pick');
  if (chip) {
    chip.hidden = !label;
    chip.innerHTML = label ? `
      <span class="d3-pick-name">${esc(_drillTraceDisplay(label))}</span>
      <button class="btn btn-sm btn-secondary" onclick="drill3dFollow()">Follow</button>
      <button class="btn btn-sm btn-secondary" onclick="drill3dDeselect()" aria-label="Clear selection">✕</button>` : '';
  }
  if (!label && _d3.cam === 'follow') {
    const sel = document.getElementById('d3-cam');
    const back = _d3Prefs().cam && _D3_CAMS[_d3Prefs().cam] ? _d3Prefs().cam : 'box';
    if (sel) sel.value = back;
    drill3dSetCam(back);
  }
}

// ── Scene ────────────────────────────────────────────────────────────────────

function _d3Start() {
  const T = window.THREE;
  const canvas = document.getElementById('d3-canvas');
  const stage = document.getElementById('d3-stage');
  if (!canvas || !stage) return;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false; // colours are sRGB hex

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    _d3Msg('3D view needs WebGL, which is turned off in this browser.');
    return;
  }
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f0f4f8';
  scene.background = new T.Color(bg);
  scene.fog = new T.Fog(scene.background, 140, 320);

  scene.add(new T.HemisphereLight(0xe4ecff, 0x2c4a25, 0.75));
  const sun = new T.DirectionalLight(0xfff3df, 1.55);
  sun.position.set(-30, 60, 42);
  sun.castShadow = true;
  const big = renderer.capabilities.maxTextureSize >= 4096;
  sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 34, bottom: -34, near: 10, far: 160 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  scene.add(sun);

  scene.add(_d3Field(T, renderer));

  // The band: one marcher model, instanced per body part.
  const labels = _drillPages[0].performers.map(p => p.label);
  const uniform = _d3CurrentUniform();
  const band = _d3BuildBand(T, uniform, labels.length);
  band.meshes.forEach(m => scene.add(m));
  scene.add(band.pick);
  // A skin tone and hair colour per performer, stable for their label.
  const tint = new T.Color();
  const hashes = labels.map(lbl => { let h = 0; for (const ch of lbl) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; });
  band.tinted.forEach(({ im, mat }) => {
    const pal = mat === 'hair' ? _D3_HAIR : _D3_SKIN;
    hashes.forEach((h, i) => im.setColorAt(i, tint.set(pal[(mat === 'hair' ? h >>> 3 : h) % pal.length])));
    im.instanceColor.needsUpdate = true;
  });

  // Marker over the selected marcher: a ring on the turf and a floating chevron.
  const marker = new T.Group();
  const markMat = new T.MeshBasicMaterial({ color: 0xffc233 });
  const ring = new T.Mesh(new T.RingGeometry(0.42, 0.56, 32), markMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
  const cone = new T.Mesh(new T.ConeGeometry(0.16, 0.34, 16), markMat);
  cone.rotation.x = Math.PI; cone.position.y = 2.35;
  marker.add(ring, cone); marker.visible = false;
  scene.add(marker);

  const camera = new T.PerspectiveCamera(40, 1, 0.1, 400);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 1.5; controls.maxDistance = 180;
  controls.addEventListener('start', () => { if (_d3) _d3.tween = null; });

  const prefs = _d3Prefs();
  const range = _d3Range();
  const startCount = _drillPlaying ? _drillPlayCount : (_drillPages[_drillCurrentSet] || _drillPages[0]).count;
  _d3 = {
    renderer, scene, camera, controls, canvas, band, marker, labels,
    mats: band.mats, uniform, uniformDraft: null,
    range, count: Math.max(range.start, Math.min(range.end, startCount)),
    playing: false,
    bpm: _D3_TEMPOS.includes(+prefs.bpm) ? +prefs.bpm : 144,
    facing: _D3_FACING[prefs.facing] ? prefs.facing : 'auto',
    cam: _D3_CAMS[prefs.cam] && prefs.cam !== 'follow' ? prefs.cam : 'box',
    yaw: new Float32Array(labels.length),
    selected: null, tween: null, scrubAt: 0, last: performance.now(), raf: 0, ro: null, shownWhere: '', shownCount: NaN,
  };
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  _d3.ro = new ResizeObserver(resize); _d3.ro.observe(stage); resize();
  const fit = _d3FitView(_d3.cam);
  camera.position.set(...fit.pos); controls.target.set(...fit.target); controls.update();

  // Tap a marcher to select them (a drag orbits the camera instead).
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', e => {
    if (!down || !_d3) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 8 || !quick) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new T.Raycaster(); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(band.pick, false)[0];
    _d3Select(hit && hit.instanceId != null ? labels[hit.instanceId] : null);
  });

  const pre = _drillSelLabel || _drillTraceLabel;
  if (pre && labels.includes(pre)) _d3Select(pre);
  _d3Msg('');
  _d3.raf = requestAnimationFrame(_d3Frame);
}

// Turf texture: yard lines, hashes, numbers and end zones drawn once on a canvas.
function _d3Field(T, renderer) {
  const STEP = DRILL3D_STEP_M, LEN = 192, DEP = 84; // steps, incl. both end zones
  const big = renderer.capabilities.maxTextureSize >= 4096;
  const k = big ? 21 : 10.5;                         // px per step
  const cv = document.createElement('canvas');
  cv.width = Math.round(LEN * k); cv.height = Math.round(DEP * k);
  const g = cv.getContext('2d');
  const X = s => (s + 16) * k, Y = f => (DEP - f) * k; // steps from west goal / off the front
  for (let i = 0; i < 20; i++) {                      // mowing stripes every 5 yards
    g.fillStyle = i % 2 ? '#3d8537' : '#377b32';
    g.fillRect(X(i * 8), 0, 8 * k + 1, cv.height);
  }
  g.fillStyle = '#2e6a2a';                            // end zones
  g.fillRect(0, 0, 16 * k, cv.height); g.fillRect(X(160), 0, 16 * k, cv.height);
  g.fillStyle = '#f4f4ef';
  const line = (x0, y0, x1, y1, w) => { g.lineWidth = w * k; g.strokeStyle = '#f4f4ef'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  for (let yd = 0; yd <= 100; yd += 5) line(X(yd * 1.6), Y(0), X(yd * 1.6), Y(DEP), yd % 100 === 0 ? 0.35 : 0.18);
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const x = X(yd * 1.6);
    line(x, Y(0.4), x, Y(1.3), 0.12); line(x, Y(DEP - 0.4), x, Y(DEP - 1.3), 0.12); // sideline ticks
  }
  for (let yd = 0; yd <= 100; yd++) for (const hs of [28, 56]) line(X(yd * 1.6), Y(hs - 0.6), X(yd * 1.6), Y(hs + 0.6), 0.12);
  g.lineWidth = 0.35 * k; g.strokeStyle = '#f4f4ef';
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, cv.width - g.lineWidth, cv.height - g.lineWidth);
  // Numbers: tops toward their own sideline (so the far side reads upright from the box).
  g.font = `700 ${Math.round(3.2 * k)}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let yd = 10; yd <= 90; yd += 10) {
    const n = String(yd > 50 ? 100 - yd : yd), x = X(yd * 1.6);
    g.fillText(n, x, Y(DEP - 12.8));
    g.save(); g.translate(x, Y(12.8)); g.rotate(Math.PI); g.fillText(n, 0, 0); g.restore();
  }
  const tex = new T.CanvasTexture(cv);
  tex.encoding = T.sRGBEncoding;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const field = new T.Mesh(new T.PlaneGeometry(LEN * STEP, DEP * STEP), new T.MeshStandardMaterial({ map: tex, roughness: 1 }));
  field.rotation.x = -Math.PI / 2;
  field.position.x = 0; // 192 steps centred: the 50 sits at x = 0
  field.receiveShadow = true;
  const apron = new T.Mesh(new T.PlaneGeometry(600, 600), new T.MeshStandardMaterial({ color: 0x2b5a28, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; apron.receiveShadow = true;
  const grp = new T.Group(); grp.add(apron, field);
  return grp;
}

// Build the marcher once, merge its meshes per (body part, material) and turn
// each merge into an InstancedMesh with one instance per performer. The model
// keeps only its joint groups afterwards: posing it and reading each part's
// world matrix gives that performer's instance matrices.
function _d3BuildBand(T, uniform, n) {
  const rig = _d3BuildMarcher(T, uniform, 0.4);
  rig.root.updateMatrixWorld(true);
  const keyOf = new Map(Object.entries(rig.mats).map(([k, m]) => [m, k]));
  const buckets = new Map(), inv = new T.Matrix4(), rel = new T.Matrix4();
  const meshes = [];
  rig.root.traverse(o => { if (o.isMesh) meshes.push(o); });
  meshes.forEach(o => {
    let p = o.parent; while (p && !p.userData.part) p = p.parent;
    rel.copy(inv.copy(p.matrixWorld).invert()).multiply(o.matrixWorld);
    const key = p.userData.part + '|' + keyOf.get(o.material);
    if (!buckets.has(key)) buckets.set(key, { part: p.userData.part, mat: keyOf.get(o.material), geos: [] });
    buckets.get(key).geos.push(o.geometry.clone().applyMatrix4(rel));
    o.parent.remove(o);
  });
  const out = [], byPart = {}, tinted = [];
  for (const b of buckets.values()) {
    let mat = rig.mats[b.mat];
    const perInstance = b.mat === 'skin' || b.mat === 'hair';
    if (perInstance) { mat = mat.clone(); mat.color.set(0xffffff); } // tinted per instance
    const im = new T.InstancedMesh(_d3Merge(T, b.geos), mat, n);
    b.geos.forEach(g => g.dispose());
    im.instanceMatrix.setUsage(T.DynamicDrawUsage);
    im.castShadow = true; im.receiveShadow = true;
    im.frustumCulled = false; // instances span the whole field
    out.push(im);
    (byPart[b.part] = byPart[b.part] || []).push(im);
    if (perInstance) tinted.push({ im, mat: b.mat });
  }
  // Invisible stand-in per marcher for tap picking (cheaper than the real parts).
  const pickGeo = new T.BoxGeometry(0.6, 1.9, 0.5); pickGeo.translate(0, 0.95, 0);
  const pick = new T.InstancedMesh(pickGeo, new T.MeshBasicMaterial({ visible: false }), n);
  pick.frustumCulled = false;
  return { rig, meshes: out, byPart, tinted, pick, mats: rig.mats };
}

// Merge geometries (position + normal) into one indexed geometry.
function _d3Merge(T, geos) {
  let vCount = 0, iCount = 0;
  geos.forEach(g => {
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!g.attributes.normal) g.computeVertexNormals();
    vCount += g.attributes.position.count; iCount += g.index.count;
  });
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  geos.forEach(g => {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), vo * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += c; io += gi.length;
  });
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setIndex(new T.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ── Frame loop ───────────────────────────────────────────────────────────────

function _d3Frame(now) {
  if (!_d3) return;
  if (!_d3.canvas.isConnected) { _d3Dispose(); return; }
  _d3.raf = requestAnimationFrame(_d3Frame);
  const dt = Math.min(0.1, (now - _d3.last) / 1000);
  _d3.last = now;

  if (_d3.playing) {
    _d3.count += dt * _d3.bpm / 60;
    if (_d3.count >= _d3.range.end) { _d3.count = _d3.range.end; _d3.playing = false; _d3SyncPlayBtn(); }
  }
  _d3PoseBand(dt);
  _d3UpdateCamera(dt, now);
  _d3.controls.update();
  _d3.renderer.render(_d3.scene, _d3.camera);
  _d3SyncReadout();
}

function _d3PoseBand(dt) {
  const { band, labels, count: c } = _d3;
  const byLabel = arr => { const m = {}; arr.forEach(p => { m[p.label] = p; }); return m; };
  const cur = byLabel(_drillFrameAt(c)), before = byLabel(_drillFrameAt(c - 0.25)), after = byLabel(_drillFrameAt(c + 0.25));
  const rig = band.rig, parts = rig.parts, flip = _drillFlipV;
  const turn = dt * 7; // rad per frame budget for turning
  const step = (_d3.uniformDraft || _d3.uniform).step; // previews an unsaved change
  const holding = c > _d3.range.start + 1e-6 && c < _d3.range.end - 1e-6;
  let selPos = null;
  for (let i = 0; i < labels.length; i++) {
    const lbl = labels[i], p = cur[lbl];
    if (!p) continue;
    const at = drill3dFieldXZ(p.stepsX, p.stepsY, flip);
    const pa = before[lbl] || p, pb = after[lbl] || p;
    const a = drill3dFieldXZ(pa.stepsX, pa.stepsY, flip), b = drill3dFieldXZ(pb.stepsX, pb.stepsY, flip);
    const vx = (b.x - a.x) / 0.5, vz = (b.z - a.z) / 0.5;      // metres per count
    const f = drill3dFacing(vx, vz, _d3.facing);
    if (f.yaw != null) _d3.yaw[i] = drill3dTurnToward(_d3.yaw[i], f.yaw, turn);
    const stride = f.moving ? drill3dStride(Math.hypot(vx, vz) / DRILL3D_STEP_M) * f.dir : 0;
    // A hold mid-drill is marked time (high knees for a high-step band); before
    // the step-off and at the final set everyone stands still.
    rig.applyPose(stride || !holding ? drill3dLegPose(c, stride, step) : drill3dMarkTime(c, step));
    rig.root.position.set(at.x, rig.root.position.y, at.z);
    rig.root.rotation.y = _d3.yaw[i];
    rig.root.updateMatrixWorld(true);
    for (const name in band.byPart) {
      const mw = parts[name].matrixWorld;
      band.byPart[name].forEach(im => im.setMatrixAt(i, mw));
    }
    band.pick.setMatrixAt(i, rig.root.matrixWorld);
    if (lbl === _d3.selected) selPos = { x: at.x, z: at.z, yaw: _d3.yaw[i] };
  }
  band.meshes.forEach(im => { im.instanceMatrix.needsUpdate = true; });
  band.pick.instanceMatrix.needsUpdate = true;
  _d3.marker.visible = !!selPos;
  if (selPos) _d3.marker.position.set(selPos.x, 0, selPos.z);
  _d3.selPos = selPos;
}

// Where a preset camera goes: along its direction from the band's centre, far
// enough back that the band (at the current count) fills the view.
function _d3FitView(name) {
  const dir = _D3_CAMS[name].dir;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  _drillFrameAt(_d3.count).forEach(p => {
    const w = drill3dFieldXZ(p.stepsX, p.stepsY, _drillFlipV);
    minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
    minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
  });
  if (!isFinite(minX)) { minX = maxX = minZ = maxZ = 0; }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const radius = Math.hypot((maxX - minX) / 2 + 2, (maxZ - minZ) / 2 + 2, 1.2);
  const cam = _d3.camera, vf = cam.fov * Math.PI / 180;
  const hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect);
  const dist = Math.max(6, 0.85 * radius / Math.sin(Math.min(vf, hf) / 2));
  const len = Math.hypot(...dir), target = [cx, 0.9, cz];
  return { target, pos: [cx + dir[0] / len * dist, 0.9 + dir[1] / len * dist, cz + dir[2] / len * dist] };
}

function _d3TweenTo(pos, target) {
  if (!_d3) return;
  const T = window.THREE;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const to = { p: new T.Vector3(...pos), t: new T.Vector3(...target) };
  if (reduce) { _d3.camera.position.copy(to.p); _d3.controls.target.copy(to.t); _d3.tween = null; return; }
  _d3.tween = { from: { p: _d3.camera.position.clone(), t: _d3.controls.target.clone() }, to, start: performance.now() };
}

function _d3UpdateCamera(dt, now) {
  const { camera, controls } = _d3;
  if (_d3.cam === 'follow' && _d3.selPos) {
    const s = _d3.selPos, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const k = 1 - Math.exp(-dt * 4);
    camera.position.lerp(new window.THREE.Vector3(s.x - fx * 5, 2.6, s.z - fz * 5), k);
    controls.target.lerp(new window.THREE.Vector3(s.x + fx * 2, 1.3, s.z + fz * 2), k);
    return;
  }
  const tw = _d3.tween;
  if (tw) {
    const t = Math.min(1, (now - tw.start) / 800), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(tw.from.p, tw.to.p, e);
    controls.target.lerpVectors(tw.from.t, tw.to.t, e);
    if (t >= 1) _d3.tween = null;
  }
}

// Set / count readout and scrubber, touched only when they change.
function _d3SyncReadout() {
  const c = _d3.count;
  let si = 0;
  for (let i = 0; i < _drillPages.length; i++) if (_drillPages[i].count <= c + 1e-6) si = i;
  const where = `Set ${si + 1} of ${_drillPages.length} · count ${Math.floor(c + 1e-6)}`;
  if (where !== _d3.shownWhere) {
    const w = document.getElementById('d3-where');
    if (w) w.textContent = where;
    _d3.shownWhere = where;
  }
  if (!(Math.abs(c - _d3.shownCount) <= 0.01)) {
    const s = document.getElementById('d3-scrub');
    if (s && performance.now() - _d3.scrubAt > 300) s.value = c; // not while being dragged
    _d3.shownCount = c;
  }
}

function _d3Dispose() {
  if (!_d3) return;
  const d = _d3;
  _d3 = null;
  cancelAnimationFrame(d.raf);
  if (d.ro) d.ro.disconnect();
  d.controls.dispose();
  d.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
  });
  Object.values(d.mats).forEach(m => m.dispose());
  d.renderer.dispose();
  if (d.renderer.forceContextLoss) d.renderer.forceContextLoss();
}

// ── Marcher model ────────────────────────────────────────────────────────────
// Revolutionary-War general's uniform: double-breasted tailcoat lapped left
// over right with small white lapels, gold buttons and epaulettes, a cutaway
// front with a red triangle, white ascot, cuffs, gloves and spats, tricorn.
// Metres, feet on y = 0, facing +Z. `detail` scales the mesh resolution (the
// band uses a light build). Joint groups carry userData.part for instancing.
function _d3BuildMarcher(T, c, detail = 1) {
  const q = n => Math.max(6, Math.round(n * detail));
  const std = (hex, o = {}) => new T.MeshStandardMaterial({ color: hex, roughness: 0.75, metalness: 0, ...o });
  const mats = {
    jacket: std(c.jacket, { roughness: 0.8 }),
    pants:  std(c.pants,  { roughness: 0.8 }),
    facing: std(c.facing, { roughness: 0.7 }),
    gold:   std(c.gold,   { roughness: 0.35, metalness: 0.45 }),
    white:  std(c.white,  { roughness: 0.85 }),
    black:  std(c.black,  { roughness: 0.55 }),
    skin:   std('#d9a982', { roughness: 0.7 }),
    hair:   std('#3a2a1e', { roughness: 0.9 }),
    seam:   std(c.jacket, { roughness: 0.9 }),
    fold:   std(c.white,  { roughness: 0.9 }),
  };
  mats.jacketDS = mats.jacket.clone(); mats.jacketDS.side = T.DoubleSide;
  mats.blackDS = mats.black.clone(); mats.blackDS.side = T.DoubleSide;
  mats.seam.color.multiplyScalar(0.35);
  mats.fold.color.multiplyScalar(0.6);
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  const cyl = (rt, rb, h, seg = 24) => new T.CylinderGeometry(rt, rb, h, q(seg));
  const sph = (r, ws = 20, hs = 14) => new T.SphereGeometry(r, q(ws), Math.max(4, Math.round(hs * detail)));
  const part = (g, name) => { g.userData.part = name; return g; };

  const root = part(new T.Group(), 'body');

  // Torso: an elliptical tapered cylinder to the shoulders (1.45), its hem cut
  // away in front — highest at the centre, curving down and back to the sides.
  const TORSO_DEPTH = 0.62;
  const torsoR = y => 0.16 + (y - 0.95) * 0.08;
  const frontZ = (x, y) => TORSO_DEPTH * Math.sqrt(Math.max(0, torsoR(y) ** 2 - x * x));
  const HEM_SIDE = 0.9, HEM_APEX = 1.04, HEM_SWEEP = 1.22;
  const hemAt = theta => {
    const u = Math.min(1, Math.abs(theta) / HEM_SWEEP);
    return HEM_SIDE + (HEM_APEX - HEM_SIDE) * (1 - u) ** 2;
  };
  {
    const TOP = 1.45, BOT = 0.88;
    const g = new T.CylinderGeometry(torsoR(TOP), torsoR(BOT), TOP - BOT, q(72), Math.max(8, Math.round(57 * detail)), true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i) + (TOP + BOT) / 2;
      const hem = hemAt(Math.atan2(x, z));
      if (y < hem) {
        const k = torsoR(hem) / Math.hypot(x, z);
        p.setXYZ(i, x * k, hem - (TOP + BOT) / 2, z * k);
      }
    }
    g.computeVertexNormals();
    const torso = mesh(g, mats.jacketDS, 0, (TOP + BOT) / 2, 0);
    torso.scale.z = TORSO_DEPTH;
    root.add(torso);
    // Rounded top over the shoulders; its front, between the lapels, is the ascot.
    const NECK_OPEN = 0.35;
    const dome = (phiStart, phiLen, mat) => {
      const m = mesh(new T.SphereGeometry(torsoR(TOP), q(56), Math.max(5, Math.round(14 * detail)), phiStart, phiLen, 0, Math.PI / 2), mat, 0, TOP, 0);
      m.scale.set(1, 0.28, TORSO_DEPTH);
      root.add(m);
    };
    dome(Math.PI / 2 + NECK_OPEN, Math.PI * 2 - 2 * NECK_OPEN, mats.jacket);
    dome(Math.PI / 2 - NECK_OPEN, 2 * NECK_OPEN, mats.white);
  }
  { // darker edge along the cutaway hem
    const pts = [];
    for (let k = 0; k <= 30; k++) {
      const th = -1.75 + 3.5 * k / 30, y = hemAt(th), r = torsoR(y) + 0.002;
      pts.push(new T.Vector3(r * Math.sin(th), y, TORSO_DEPTH * r * Math.cos(th)));
    }
    root.add(mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), q(90), 0.0035, 4), mats.seam));
  }
  const pelvis = mesh(cyl(0.162, 0.158, 0.12, 32), mats.pants, 0, 0.89, 0);
  pelvis.scale.z = TORSO_DEPTH;
  root.add(pelvis);

  // A flat panel wrapped onto the jacket front between xL(y) and xR(y).
  function frontPanel(yTop, yBot, xL, xR, mat, lift = 0.003) {
    const R = Math.max(4, Math.round(16 * detail)), C = Math.max(3, Math.round(8 * detail)), pos = [], idx = [];
    for (let i = 0; i <= R; i++) {
      const y = yTop - (yTop - yBot) * i / R, l = xL(y), r = xR(y);
      for (let j = 0; j <= C; j++) {
        const x = l + (r - l) * j / C;
        pos.push(x, y, frontZ(x, y) + lift);
      }
    }
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const a = i * (C + 1) + j, b = a + 1, d = a + C + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    root.add(mesh(g, mat));
  }

  // Double-breasted, lapped left over right (the wearer's left is +X).
  const lerpX = (x0, y0, x1, y1) => y => x0 + (x1 - x0) * (y - y0) / (y1 - y0);
  const EDGE_X = -0.085, ROLL_Y = 1.27;
  const LAP_TOP = 1.449, LAP_TIP = 1.335, TIP_X = 0.014;
  frontPanel(LAP_TOP, LAP_TIP, lerpX(-0.1, LAP_TOP, TIP_X, LAP_TIP), lerpX(-0.045, LAP_TOP, TIP_X, LAP_TIP), mats.white, 0.003);
  frontPanel(LAP_TOP, LAP_TIP, lerpX(0.045, LAP_TOP, -TIP_X, LAP_TIP), lerpX(0.1, LAP_TOP, -TIP_X, LAP_TIP), mats.white, 0.007);
  const lapInnerL = lerpX(0.045, LAP_TOP, -TIP_X, LAP_TIP), lapInnerR = lerpX(-0.045, LAP_TOP, TIP_X, LAP_TIP);
  frontPanel(LAP_TOP, LAP_TIP, y => lapInnerL(y) - 0.0015, y => lapInnerL(y) + 0.0025, mats.fold, 0.008);
  frontPanel(LAP_TOP, LAP_TIP, y => lapInnerR(y) - 0.0025, y => lapInnerR(y) + 0.0015, mats.fold, 0.004);
  frontPanel(LAP_TOP, 1.36, y => lapInnerR(y) - 0.012, y => lapInnerL(y) + 0.012, mats.white, 0.001); // ascot in the V

  const redHalf = y => {
    const u = 1 - Math.sqrt(Math.max(0, (y - HEM_SIDE) / (HEM_APEX - HEM_SIDE)));
    return torsoR(y) * Math.sin(u * HEM_SWEEP);
  };
  frontPanel(HEM_APEX, 0.95, y => -redHalf(y), redHalf, mats.facing, -0.001);
  const edgeAt = y => {
    if (y > ROLL_Y) return lerpX(EDGE_X, ROLL_Y, -TIP_X, LAP_TIP)(y);
    const t = Math.max(0, Math.min(1, (y - HEM_APEX) / 0.09));
    return EDGE_X * t * t * (3 - 2 * t);
  };
  frontPanel(LAP_TIP, HEM_APEX, y => edgeAt(y) - 0.002, y => edgeAt(y) + 0.003, mats.seam, 0.006);

  const btnGeo = sph(0.013, 10, 6);
  [1.25, 1.19, 1.13].forEach(y => [-1, 1].forEach(s => {
    const x = s * 0.052;
    const b = mesh(btnGeo, mats.gold, x, y, frontZ(x, y) + 0.008);
    b.scale.z = 0.55; root.add(b);
  }));

  // Shoulders, neck, ascot, head.
  [-1, 1].forEach(s => root.add(mesh(sph(0.075), mats.jacket, s * 0.19, 1.41, 0)));
  root.add(mesh(cyl(0.045, 0.048, 0.12), mats.skin, 0, 1.51, 0));
  root.add(mesh(cyl(0.053, 0.058, 0.08), mats.white, 0, 1.505, 0));
  const knot = mesh(sph(1, 16, 12), mats.white, 0, 1.49, 0.088);
  knot.scale.set(0.045, 0.028, 0.02); root.add(knot);
  const head = mesh(sph(0.095, 28, 20), mats.skin, 0, 1.64, 0.005);
  head.scale.set(1, 1.12, 1.03); root.add(head);
  // Hair over the back and sides of the head (the face stays clear), so you can
  // tell which way a marcher faces even from the stands.
  const hair = mesh(new T.SphereGeometry(0.1, q(24), Math.max(5, Math.round(12 * detail)), Math.PI - 0.35, Math.PI + 0.7, 0, Math.PI * 0.64),
    mats.hair, 0, 1.645, 0.0);
  hair.scale.set(1.01, 1.12, 1.04); root.add(hair);

  { // tricorn: a crown inside three up-turned walls, one corner forward
    const hat = new T.Group(); hat.position.set(0, 1.715, 0.005); hat.rotation.x = 0.06;
    const R = 0.2, H = 0.09, TILT = 0.45;
    const v = [0, 1, 2].map(i => {
      const a = Math.PI / 2 + i * 2 * Math.PI / 3;
      return new T.Vector2(R * Math.cos(a), R * Math.sin(a));
    });
    const base = mesh(new T.ShapeGeometry(new T.Shape(v.map(p => new T.Vector2(p.x, -p.y)))), mats.blackDS);
    base.rotation.x = -Math.PI / 2;
    hat.add(base);
    for (let i = 0; i < 3; i++) {
      const p = v[i], qv = v[(i + 1) % 3], N = Math.max(10, Math.round(16 * detail)), pos = [], idx = [];
      const out = new T.Vector2((p.x + qv.x) / 2, (p.y + qv.y) / 2).normalize();
      for (let k = 0; k <= N; k++) {
        const t = k / N, bow = Math.sin(Math.PI * t);
        const bx = p.x + (qv.x - p.x) * t - out.x * 0.035 * bow, bz = p.y + (qv.y - p.y) * t - out.y * 0.035 * bow;
        const h = H * (1 - 0.3 * bow);
        pos.push(bx, 0, bz, bx + out.x * h * TILT, h, bz + out.y * h * TILT);
        if (k < N) { const a = 2 * k; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      hat.add(mesh(g, mats.blackDS));
    }
    hat.add(mesh(cyl(0.1, 0.106, 0.09, 28), mats.black, 0, 0.045, 0));
    const top = mesh(new T.SphereGeometry(0.1, q(28), 5, 0, Math.PI * 2, 0, Math.PI / 2), mats.black, 0, 0.09, 0);
    top.scale.y = 0.35; hat.add(top);
    root.add(hat);
  }

  // Epaulettes with a hanging fringe (fewer strands in the light build).
  [-1, 1].forEach(s => {
    const ep = new T.Group(); ep.position.set(s * 0.195, 1.478, 0); ep.rotation.z = -s * 0.3;
    const board = mesh(cyl(0.072, 0.072, 0.016, 28), mats.gold); board.scale.z = 0.8; ep.add(board);
    ep.add(mesh(new T.BoxGeometry(0.1, 0.012, 0.05), mats.gold, -s * 0.07, 0.002, 0));
    const strands = detail < 1 ? 6 : 12, fr = new T.CylinderGeometry(0.0065, 0.0065, 0.075, detail < 1 ? 4 : 6);
    for (let k = 0; k <= strands; k++) {
      const a = (-85 + 170 * k / strands) * Math.PI / 180;
      ep.add(mesh(fr, mats.gold, s * 0.068 * Math.cos(a), -0.04, 0.068 * 0.8 * Math.sin(a)));
    }
    root.add(ep);
  });

  const tails = [-1, 1].map((s, i) => {
    const shape = new T.Shape([
      new T.Vector2(-0.065, 0), new T.Vector2(0.065, 0),
      new T.Vector2(0.045, -0.47), new T.Vector2(-0.035, -0.47),
    ].map(p => new T.Vector2(p.x * s, p.y)));
    const pivot = part(new T.Group(), 'tail' + i);
    pivot.position.set(s * 0.068, 0.99, -frontZ(0, 0.99) - 0.004);
    pivot.add(mesh(new T.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }), mats.jacket, 0, 0, -0.006));
    const b = mesh(btnGeo, mats.gold, 0, -0.02, -0.01); b.scale.z = 0.55; pivot.add(b);
    root.add(pivot);
    return pivot;
  });

  // Legs: hip → knee → ankle; index 0 is the wearer's right (-X).
  const legs = [-1, 1].map((s, i) => {
    const hip = part(new T.Group(), 'hip' + i); hip.position.set(s * 0.09, 0.92, 0);
    hip.add(mesh(cyl(0.085, 0.07, 0.42), mats.pants, 0, -0.21, 0));
    const knee = part(new T.Group(), 'knee' + i); knee.position.y = -0.42; hip.add(knee);
    knee.add(mesh(sph(0.068), mats.pants));
    knee.add(mesh(cyl(0.066, 0.055, 0.42), mats.pants, 0, -0.21, 0));
    knee.add(mesh(cyl(0.077, 0.066, 0.36, 28), mats.white, 0, -0.24, 0));      // spat
    knee.add(mesh(cyl(0.066, 0.078, 0.05, 28), mats.white, 0, -0.405, 0.006)); // spat foot
    const bGeo = sph(0.0085, 8, 6);
    for (let k = 0; k < 6; k++) {
      const y = -0.1 - k * 0.055, r = 0.077 - (0.011 * (-0.06 - y) / 0.36);
      knee.add(mesh(bGeo, mats.black, s * (r + 0.001), y, 0));
    }
    const ankle = part(new T.Group(), 'ankle' + i); ankle.position.y = -0.42; knee.add(ankle);
    const shoe = mesh(new T.CapsuleGeometry(0.046, 0.17, 4, q(16)), mats.black, 0, -0.046, 0.045);
    shoe.rotation.x = Math.PI / 2; shoe.scale.set(1, 1, 0.74); ankle.add(shoe);
    root.add(hip);
    return { hip, knee, ankle };
  });

  const arms = [-1, 1].map((s, i) => {
    const sh = part(new T.Group(), 'arm' + i); sh.position.set(s * 0.225, 1.4, 0); sh.rotation.z = s * 0.12;
    sh.add(mesh(cyl(0.053, 0.046, 0.3), mats.jacket, 0, -0.15, 0));
    const el = new T.Group(); el.position.y = -0.3; el.rotation.x = -0.25; sh.add(el); // rigid with the arm
    el.add(mesh(sph(0.046), mats.jacket));
    el.add(mesh(cyl(0.046, 0.042, 0.2), mats.jacket, 0, -0.1, 0));
    el.add(mesh(cyl(0.059, 0.053, 0.095, 24), mats.white, 0, -0.215, 0));        // cuff
    const hand = mesh(sph(1, 16, 12), mats.white, 0, -0.305, 0.004);
    hand.scale.set(0.04, 0.062, 0.032); el.add(hand);
    const thumb = mesh(sph(1, 10, 8), mats.white, -s * 0.03, -0.29, 0.02);
    thumb.scale.set(0.013, 0.03, 0.013); el.add(thumb);
    root.add(sh);
    return sh;
  });

  const parts = {};
  root.traverse(o => { if (o.userData.part) parts[o.userData.part] = o; });

  // Apply a drill3dLegPose() result.
  function applyPose(p) {
    legs.forEach((l, i) => { l.hip.rotation.x = p.hip[i]; l.knee.rotation.x = p.knee[i]; l.ankle.rotation.x = p.ankle[i]; });
    arms.forEach((a, i) => { a.rotation.x = p.arm[i]; });
    root.position.y = -0.006 + p.bob;
    tails.forEach(t => { t.rotation.x = 0.13 + p.tail; });
  }
  applyPose(drill3dLegPose(0, 0));
  return { root, mats, parts, applyPose };
}
