// Band Tracker — js/12-drill.js — Pyware drill picker, field chart, playback, mapping.
// Plain script sharing global scope; load order is set in index.html.


// ── Pyware drill integration ──────────────────────────────────────────────────
// The file PARSER (_parsePywareFile and the .3dj/.3da format readers) is pure
// byte-wrangling with no STATE/DOM, so it lives in js/00-logic.js where it can be
// unit-tested (tests/unit/logic.test.js). Everything below is the picker, field
// chart, playback and roster-mapping UI that consumes { pages, sections }.



// Tracks which drill's heavy position payload is currently in _drillData/_drillPages.
let _activeDrillLoadedId = null;

function _drillFileInput() {
  let inp = document.getElementById('drill-file-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id   = 'drill-file-input';
    inp.accept = '.3dj,.3da';
    inp.style.display = 'none';
    inp.onchange = e => { if (e.target.files[0]) _onDrillFileLoaded(e.target.files[0]); e.target.value = ''; };
    document.body.appendChild(inp);
  }
  return inp;
}

// Import a brand-new drill file into the library (always the file dialog).
function drillAddFile() {
  if (!STATE.isAdmin) return;
  _drillFileInput().click();
}

// Entry from the tab empty-state / tracker button: pick performers from the
// active drill if one is loaded, otherwise import the first file.
function openDrillPicker() {
  if (!canRecord()) return;
  if (_drillData) { showDrillPickModal(); return; }
  drillAddFile();
}

// Reconcile the loaded chart with the school-wide active drill: load the active
// drill's payload when it changes, and keep its live facing in sync. Called by
// the drills + active-pointer listeners.
function _drillSyncActive() {
  const id = STATE.activeDrillId;
  if (!id) {
    if (_activeDrillLoadedId !== null) {
      _activeDrillLoadedId = null;
      _drillData = null; _drillPages = null; _drillFileName = null; _drillFlipV = false;
      _drillCurrentSet = 0; _drillTraceLabel = null; _drillSelLabel = null; _drillSearchQuery = ''; _drillTraceSets = []; _drillSelectMode = false; if (typeof _drillPlayStop === "function") _drillPlayStop();
    }
    return;
  }
  const meta = STATE.drills[id];
  if (!meta) return; // metadata not arrived yet — wait for the drills listener
  _drillFileName = meta.name || meta.fileName || null;
  if (_activeDrillLoadedId === id) {
    _drillFlipV = !!meta.flipV; // facing can change live
    return;
  }
  _drillLoadPayload(id); // different drill became active — fetch its positions
}

function _drillLoadPayload(id) {
  orgCol('drills').doc(id).collection('data').doc('main').get().then(snap => {
    if (STATE.activeDrillId !== id) return; // superseded while loading
    const p = snap.exists ? snap.data() : {};
    const meta = STATE.drills[id] || {};
    _drillData     = p.sections || [];
    _drillPages    = p.pages || [];
    _drillFlipV    = !!meta.flipV;
    _drillFileName = meta.name || meta.fileName || null;
    _drillCurrentSet = 0; _drillTraceLabel = null; _drillSelLabel = null; _drillSearchQuery = ''; _drillTraceSets = []; _drillSelectMode = false; if (typeof _drillPlayStop === "function") _drillPlayStop();
    _activeDrillLoadedId = id;
    render();
  }).catch(e => console.error('drill payload load failed:', e));
}

function _onDrillFileLoaded(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = _parsePywareFile(e.target.result);
      const ref    = orgCol('drills').doc();
      const meta   = {
        name:           file.name.replace(/\.3d[ja]$/i, ''),
        fileName:       file.name,
        setCount:       parsed.pages.length,
        performerCount: parsed.pages[0]?.performers?.length || 0,
        flipV:          false,
        createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
        by:             STATE.user?.uid || null,
      };
      ref.set(meta)
        .then(() => ref.collection('data').doc('main').set({ sections: parsed.sections, pages: parsed.pages }))
        .then(() => orgCol('settings').doc('drill').set({ activeId: ref.id }, { merge: true }))
        .catch(err => { console.error(err); showToast('Could not save the drill.'); });

      // Optimistic local update so the new drill is active immediately.
      STATE.drills[ref.id] = { id: ref.id, ...meta };
      STATE.activeDrillId  = ref.id;
      _activeDrillLoadedId = ref.id;
      _drillData = parsed.sections; _drillPages = parsed.pages;
      _drillFileName = meta.name; _drillFlipV = false;
      _drillTraceLabel = null; _drillSelLabel = null; _drillSearchQuery = ''; _drillTraceSets = []; _drillSelectMode = false; if (typeof _drillPlayStop === "function") _drillPlayStop(); _drillCurrentSet = 0;

      if (_view === 'drill')                                  render();
      else if (document.getElementById('drill-library-modal')) showDrillLibraryModal();
      else                                                     showDrillPickModal();
    } catch (err) {
      _showDrillImportError(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Drill import failed. Known, self-inflicted cases (a .3dz package, or the
// newer encrypted Pyware format) get a titled modal explaining what to do;
// anything else falls back to a toast. Messages are tagged 'E_DRILL_*:' by
// _parsePywareFile.
function _showDrillImportError(err) {
  const msg = err?.message || 'Failed to read drill file.';
  const [tag, rest] = msg.includes(':') ? [msg.slice(0, msg.indexOf(':')), msg.slice(msg.indexOf(':') + 1)] : ['', msg];
  const bodies = {
    E_DRILL_ZIP: `
      <p>${esc(rest)}</p>
      <p>Unzip it first and upload the <strong>.3dj</strong> file inside. If that
      .3dj still won’t load, it’s the newer encrypted Pyware format — see below.</p>`,
    E_DRILL_ENCRYPTED: `
      <p>${esc(rest)}</p>
      <p>In Pyware 3D, export this show as a <strong>.3da</strong> file
      (File → Export, the plaintext “analog” format) and upload that instead —
      the app reads <strong>.3da</strong> and <strong>.3dj</strong>. The encrypted
      <strong>.3dj</strong>/<strong>.3dz</strong> package can’t be read without
      Pyware’s key.</p>`,
  };
  const body = bodies[tag];
  if (!body) { showToast(rest); return; }
  openModal(`
    <div class="modal-title">Can’t read this drill file</div>
    ${body}
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="closeModal()">OK</button>
    </div>`);
}

// One-time migration: the old single drill lived in settings/drill itself. Move
// it into the library under a fixed id (idempotent across racing directors).
function _migrateLegacyDrill(d) {
  const ref = orgCol('drills').doc('legacy');
  ref.set({
    name:           (d.drillFileName || 'Imported drill').replace(/\.3dj$/i, ''),
    fileName:       d.drillFileName || null,
    setCount:       d.drillPages.length,
    performerCount: d.drillPages[0]?.performers?.length || 0,
    flipV:          !!d.drillFlipV,
    createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
    by:             STATE.user?.uid || null,
  })
    .then(() => ref.collection('data').doc('main').set({ sections: d.drillSections, pages: d.drillPages }))
    .then(() => {
      const del = firebase.firestore.FieldValue.delete();
      return orgCol('settings').doc('drill').set(
        { activeId: 'legacy', drillFileName: del, drillSections: del, drillPages: del, drillFlipV: del },
        { merge: true }
      );
    })
    .catch(e => console.error('legacy drill migration failed:', e));
}

let _drillActiveSection = 0;
let _drillChecked = new Set(); // selected performer indices

// Drill labels are "section letter + front-to-back rank" (e.g. "A1"), which
// matches the block-grid spot students already carry (column letter + row
// number). So a performer labelled "A1" maps to the student at column A, row 1
// with no manual setup. An explicit pywareMapping entry (mapping modal) still
// overrides the position match.
function _drillPosIndex() {
  const idx = {};
  Object.values(STATE.students || {}).forEach(s => {
    const pos = fmtPos(s.column, s.row);
    if (pos) idx[pos.toUpperCase()] = s.number;
  });
  return idx;
}

// The active drill's own label → student map (its per-show spot assignments,
// stored on the drill doc). Each show maps independently, so a student can be
// "M1" pregame and "X5" at halftime without collisions.
function _activeDrillMapping() {
  const d = (STATE.drills && STATE.activeDrillId) ? STATE.drills[STATE.activeDrillId] : null;
  return (d && d.mapping) || {};
}

// All students at a spot (a spot may be shared by more than one student).
// Resolution: the drill's own assignment, then the legacy band-wide mapping,
// then the column/row block-spot match.
function drillStudentNumsByLabel(label) {
  const perDrill = drillSpotNums(_activeDrillMapping()[label]);
  if (perDrill.length) return perDrill;
  const g = drillSpotNums((STATE.pywareMapping || {})[label]);
  if (g.length) return g;
  const pos = _drillPosIndex()[(label || '').toUpperCase()];
  return pos ? [String(pos)] : [];
}

// The first student at a spot (single-value callers: trace, profile, etc.).
function drillStudentByLabel(label) {
  const nums = drillStudentNumsByLabel(label);
  return nums.length ? nums[0] : null;
}

// Comma-joined first names of everyone at a spot (for dot labels).
function _drillSpotNames(label) {
  return drillStudentNumsByLabel(label).map(n => {
    const s = STATE.students[n];
    return s ? (s.name ? s.name.split(/\s+/)[0] : `#${n}`) : `#${n}`;
  }).join(' / ');
}

// One performer row in the picker / mapping grid, keyed by drill label ("A1").
function _drillPerfRowHtml(perfLabel) {
  const studentNum = drillStudentByLabel(perfLabel);
  const student    = studentNum ? STATE.students[studentNum] : null;
  const checked    = _drillChecked.has(perfLabel);
  const name       = student ? (student.name || `#${studentNum}`) : perfLabel;
  const sub        = student ? (normInstrument(student.instrument) || '') : '<em>Not mapped</em>';
  return `
    <label class="drill-perf-row${checked ? ' drill-perf-row--checked' : ''}${!studentNum ? ' drill-perf-row--unmapped' : ''}">
      <input type="checkbox" style="display:none" ${checked ? 'checked' : ''}
        onchange="drillTogglePerformer('${esc(perfLabel)}', this.checked)">
      <div class="drill-perf-check">${checked ? '✓' : ''}</div>
      <div class="drill-perf-info">
        <div class="drill-perf-name">${esc(name)}</div>
        <div class="drill-perf-sub">${sub}</div>
      </div>
    </label>`;
}

function showDrillPickModal() {
  if (!_drillData) return;
  _drillChecked = new Set();

  const sections = _drillData;
  const unmappedCount = sections.flatMap(s => s.performers).filter(lbl => !drillStudentNumsByLabel(lbl).length).length;

  const renderSectionTabs = () => sections.map((s, i) =>
    `<button class="drill-tab${i === _drillActiveSection ? ' drill-tab--active' : ''}" onclick="drillSetSection(${i})">${esc(s.letter)}</button>`
  ).join('');

  const renderPerformerGrid = () =>
    sections[_drillActiveSection].performers.map(_drillPerfRowHtml).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Select from Drill</div>
    ${unmappedCount > 0 ? `
      <div class="drill-map-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ${unmappedCount} position${unmappedCount !== 1 ? 's' : ''} not yet linked to students.
        <button class="link-btn" onclick="showDrillMappingModal()">Set up mapping</button>
      </div>` : ''}
    <div class="drill-tabs" id="drill-tabs">${renderSectionTabs()}</div>
    <div class="drill-perf-list" id="drill-perf-list">${renderPerformerGrid()}</div>
    <div style="display:flex;gap:8px;padding:4px 0;margin-top:4px">
      <button class="btn btn-sm btn-secondary" style="flex:1" onclick="drillSelectAll()">Select All</button>
      <button class="btn btn-sm btn-secondary" style="flex:1" onclick="drillClearAll()">Clear</button>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 2px">
      <span style="font-size:0.72rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%">${_drillFileName ? esc(_drillFileName) : 'Drill file'}</span>
      <div style="display:flex;gap:10px;flex-shrink:0">
        ${Object.keys(STATE.drills || {}).length > 1 ? `<button class="drill-reload-btn" onclick="showDrillLibraryModal()">Switch drill</button>` : ''}
        ${_drillPages && _drillPages.length ? `<button class="drill-reload-btn" onclick="showDrillChartModal()">View field chart →</button>` : ''}
      </div>
    </div>
    <div class="modal-actions" style="margin-top:4px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="drill-apply-btn" onclick="applyDrillSelection()">Apply to Tracker</button>
    </div>
  `);
}

function drillSetSection(idx) {
  _drillActiveSection = idx;
  const tabsEl = document.getElementById('drill-tabs');
  const listEl = document.getElementById('drill-perf-list');
  if (!tabsEl || !listEl) return;
  tabsEl.querySelectorAll('.drill-tab').forEach((t, i) =>
    t.classList.toggle('drill-tab--active', i === idx));
  listEl.innerHTML = _drillData[idx].performers.map(_drillPerfRowHtml).join('');
}

function drillTogglePerformer(label, checked) {
  if (checked) _drillChecked.add(label); else _drillChecked.delete(label);
  // Update the row's visual state without a full re-render
  const listEl = document.getElementById('drill-perf-list');
  if (listEl) {
    const performers = _drillData[_drillActiveSection].performers;
    const rowIdx = performers.indexOf(label);
    const rows = listEl.querySelectorAll('.drill-perf-row');
    if (rowIdx >= 0 && rows[rowIdx]) {
      rows[rowIdx].classList.toggle('drill-perf-row--checked', checked);
      rows[rowIdx].querySelector('.drill-perf-check').textContent = checked ? '✓' : '';
    }
  }
  const applyBtn = document.getElementById('drill-apply-btn');
  if (applyBtn) applyBtn.disabled = _drillChecked.size === 0;
}

function drillSelectAll() {
  if (!_drillData) return;
  _drillData[_drillActiveSection].performers.forEach(idx => _drillChecked.add(idx));
  drillSetSection(_drillActiveSection);
}

function drillClearAll() {
  if (!_drillData) return;
  _drillData[_drillActiveSection].performers.forEach(idx => _drillChecked.delete(idx));
  drillSetSection(_drillActiveSection);
}

function applyDrillSelection() {
  const unmapped = [];
  const studentNums = [];
  for (const label of _drillChecked) {
    const nums = drillStudentNumsByLabel(label).filter(n => STATE.students[n]);
    if (nums.length) studentNums.push(...nums); // shared spots add everyone
    else unmapped.push(label);
  }
  if (!studentNums.length && !unmapped.length) {
    showToast('Select at least one position.');
    return;
  }
  if (unmapped.length && !studentNums.length) {
    showToast('Selected positions are not mapped to students yet. Set up the mapping first.');
    return;
  }
  if (unmapped.length) {
    showToast(`${unmapped.length} unmapped position${unmapped.length !== 1 ? 's' : ''} skipped.`);
  }
  _drillSelectedNums = studentNums;
  closeModal();
  const rid = _params.rid;
  if (rid) reRender(rid);
}

function clearDrillSelection(rid) {
  _drillSelectedNums = [];
  if (rid) reRender(rid);
}

// ── Pyware Field Chart ────────────────────────────────────────────────────────

const _DRILL_COLORS = [
  '#e74c3c','#e67e22','#f39c12','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e63','#795548','#607d8b',
];

function showDrillChartModal() {
  if (!_drillPages || !_drillPages.length) {
    showToast('No set position data found in this file.');
    return;
  }
  _drillCurrentSet  = 0;
  _drillChartSelect = true; // opened from the tracker to pick performers
  openModal(`<div id="drill-chart-root">${_drillChartHtml()}</div>`);
}

// Field geometry, shared by the SVG builder and the sticky fullscreen axis so
// the two never drift. 100 yards = 160 steps wide × 84 steps deep.
const _DRILL_GEOM = (() => {
  const SCALE = 3.5; // px per step
  const FW = Math.round(160 * SCALE), FH = Math.round(84 * SCALE);
  const ML = 30, MR = 8, MT = 20, MB = 22;
  return { SCALE, FW, FH, ML, MR, MT, MB, SW: FW + ML + MR, SH: FH + MT + MB };
})();

// Shared field SVG. `positions` is one set's performers. Options:
//   fs         — fullscreen sizing (width:100%) vs fixed width
//   labelMode  — 0 none · 1 drill labels (A1) · 2 mapped student names
//   traceLabel — draw this performer's path across every set + highlight them
//   selectMode — tap toggles selection (tracker) vs opens an info popup (viewer)
function _drillFieldSvg(positions, opts = {}) {
  const { fs = false, labelMode = 0, traceLabel = null, selectMode = false, fsView = false, focusLabel = null, traceIdx = null } = opts;

  // 100 yards = 160 steps wide × 84 steps deep; coords are already in steps
  // (stepsX from the west goal, stepsY off the front sideline).
  const { SCALE, FW, FH, ML, MR, MT, MB, SW, SH } = _DRILL_GEOM;
  const fx = s => (ML + s * SCALE).toFixed(1);
  // Front sideline at the bottom (stepsY = 0); flip swaps front/back to match
  // Pyware's "facing" setting if a file was built the other way.
  const fy = s => (_drillFlipV ? (MT + s * SCALE) : (MT + FH - s * SCALE)).toFixed(1);

  const secColor = {};
  (_drillData || []).forEach((sec, i) => { secColor[sec.letter] = _DRILL_COLORS[i % _DRILL_COLORS.length]; });

  // Field palette — green (default) or white. On a white field the lines/labels
  // flip to dark so they stay legible. Independent of the app's light/dark mode.
  const P = _drillFieldWhite
    ? { field:'#ffffff', border:'#2e7d32', major:'#555', minor:'#cfcfcf', tickMaj:'#888', tickMin:'#ccc', num:'#666', hash:'#8a8a8a', lblFill:'#111', lblStroke:'#fff', focusLine:'#333' }
    : { field:'#1f5c1f', border:'#ffffff', major:'#ffffff', minor:'#5a5', tickMaj:'#aaa', tickMin:'#666', num:'#aaa', hash:'#ffffff', lblFill:'#ffffff', lblStroke:'#000', focusLine:'#ffffff' };

  // Yard lines + numbers (top and bottom)
  let lines = '';
  for (let yd = 0; yd <= 100; yd += 5) {
    const sx = fx(yd * 1.6);
    const major = yd % 10 === 0;
    lines += `<line x1="${sx}" y1="${MT}" x2="${sx}" y2="${MT+FH}" stroke="${major?P.major:P.minor}" stroke-width="${major?'0.8':'0.4'}"/>`;
    lines += `<line x1="${sx}" y1="${MT+FH}" x2="${sx}" y2="${(MT+FH+4).toFixed(1)}" stroke="${major?P.tickMaj:P.tickMin}" stroke-width="${major?'0.8':'0.5'}"/>`;
    if (major && yd > 0 && yd < 100) {
      const lbl = yd > 50 ? 100 - yd : yd;
      lines += `<text x="${sx}" y="${MT-4}" text-anchor="middle" fill="${P.num}" font-size="8" font-family="sans-serif">${lbl}</text>`;
      lines += `<text x="${sx}" y="${(MT+FH+14).toFixed(1)}" text-anchor="middle" fill="${P.num}" font-size="8" font-family="sans-serif">${lbl}</text>`;
    }
  }
  // Hash marks (HS: 28 and 56 steps off the front sideline)
  for (const hs of [28, 56]) {
    const hy = fy(hs);
    for (let yd = 0; yd <= 100; yd += 5) {
      const sx = parseFloat(fx(yd * 1.6));
      lines += `<line x1="${(sx-3).toFixed(1)}" y1="${hy}" x2="${(sx+3).toFixed(1)}" y2="${hy}" stroke="${P.hash}" stroke-width="0.5"/>`;
    }
  }

  // Trace path of one performer across the active sets (a selected subset, or
  // every set by default).
  let trace = '';
  if (traceLabel && _drillPages) {
    const idxs = traceIdx || _drillPages.map((_, i) => i);
    const pts = [];
    idxs.forEach(i => {
      const tp = _drillPages[i] && _drillPages[i].performers.find(p => p.label === traceLabel);
      if (tp) pts.push({ i, x: fx(tp.stepsX), y: fy(tp.stepsY) });
    });
    if (pts.length > 1) {
      trace += `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#ffd23f" stroke-width="1.4" stroke-dasharray="3 2" opacity="0.9" pointer-events="none"/>`;
    }
    pts.forEach(p => {
      const cur = p.i === _drillCurrentSet && !_drillPlaying;
      trace += `<circle cx="${p.x}" cy="${p.y}" r="${cur ? 2.6 : 1.8}" fill="#ffd23f" opacity="${cur ? 1 : 0.65}" pointer-events="none"/>`;
    });
  }

  // Performers (+ optional labels)
  let dots = '', labels = '', focus = '';
  for (const p of positions) {
    if (p.stepsX < -10 || p.stepsX > 170 || p.stepsY < -5 || p.stepsY > 90) continue; // safety
    const sx = fx(p.stepsX), sy = fy(p.stepsY);
    const col     = secColor[p.section] || '#888';
    const sel     = selectMode && _drillChecked.has(p.label);
    const isTrace = traceLabel && p.label === traceLabel;
    const isFocus = focusLabel && p.label === focusLabel;
    const tap     = selectMode ? `drillChartToggle('${esc(p.label)}')`
                  : fsView     ? `drillFsTapPerf('${esc(p.label)}')`
                  :              `drillShowPerfInfo('${esc(p.label)}')`;
    dots += `<circle cx="${sx}" cy="${sy}" r="7" fill="transparent" onclick="${tap}" style="cursor:pointer"/>`;
    if (sel || isTrace) dots += `<circle cx="${sx}" cy="${sy}" r="6.5" fill="none" stroke="${isTrace ? '#ffd23f' : '#fff'}" stroke-width="1.8"/>`;
    dots += `<circle cx="${sx}" cy="${sy}" r="${(sel||isTrace||isFocus)?'4.5':'3'}" fill="${isFocus ? '#ffd23f' : col}" pointer-events="none"/>`;
    if (isFocus) {
      // A tall, unmistakable callout drawn on top so you can always tell which
      // dot was tapped — even when an info panel overlaps the field.
      const y  = parseFloat(sy);
      const ty = (y - 13).toFixed(1);
      focus += `<line x1="${sx}" y1="${(y-4).toFixed(1)}" x2="${sx}" y2="${ty}" stroke="${P.focusLine}" stroke-width="1.1"/>`
            +  `<circle cx="${sx}" cy="${sy}" r="8.5" fill="none" stroke="#ffd23f" stroke-width="2.2"/>`
            +  `<circle cx="${sx}" cy="${sy}" r="8.5" fill="none" stroke="#000" stroke-width="0.7"/>`
            +  `<text x="${sx}" y="${ty}" text-anchor="middle" fill="#111" font-size="6.5" font-weight="700" font-family="sans-serif" pointer-events="none" style="paint-order:stroke;stroke:#ffd23f;stroke-width:6px;stroke-linejoin:round">${esc(p.label)}</text>`;
    }
    if (labelMode) {
      let txt = p.label;
      if (labelMode === 2) txt = _drillSpotNames(p.label) || p.label; // one or more names

      labels += `<text x="${sx}" y="${(parseFloat(sy)-5).toFixed(1)}" text-anchor="middle" fill="${P.lblFill}" font-size="4.6" font-family="sans-serif" pointer-events="none" style="paint-order:stroke;stroke:${P.lblStroke};stroke-width:0.7px;stroke-linejoin:round">${esc(txt)}</text>`;
    }
  }

  return `
    <svg viewBox="0 0 ${SW} ${SH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="display:block;${fs ? 'width:100%;height:100%' : `width:${SW}px;max-width:100%`}">
      <rect x="${ML}" y="${MT}" width="${FW}" height="${FH}" fill="${P.field}"/>
      <rect x="${ML}" y="${MT}" width="${FW}" height="${FH}" fill="none" stroke="${P.border}" stroke-width="1.2"/>
      ${lines}${trace}${dots}${labels}${focus}
      <text x="${(ML-3)}" y="${fy(0)}" text-anchor="end" fill="#777" font-size="7" font-family="sans-serif" dominant-baseline="middle">F</text>
      <text x="${(ML-3)}" y="${fy(84)}" text-anchor="end" fill="#777" font-size="7" font-family="sans-serif" dominant-baseline="middle">B</text>
    </svg>`;
}

function _drillLegendHtml() {
  return (_drillData || []).map((sec, i) => {
    const c = _DRILL_COLORS[i % _DRILL_COLORS.length];
    return `<span class="drill-chart-leg-item"><svg width="10" height="10" style="flex-shrink:0"><circle cx="5" cy="5" r="4" fill="${c}"/></svg>${esc(sec.letter)}</span>`;
  }).join('');
}

// Cycle text for the labels toggle button.
const _DRILL_LABEL_TEXT = ['Labels: off', 'Labels: drill #', 'Labels: names'];

function _drillChartHtml(fs = false) {
  const idx       = _drillCurrentSet;
  const positions = _drillPages[idx].performers;
  const total     = _drillPages.length;

  const navLabel     = `Set ${idx + 1} <span style="font-weight:400;color:var(--text-muted)">of ${total} · count ${_drillPages[idx].count}</span>`;
  const prevDisabled = idx <= 0;
  const nextDisabled = idx >= total - 1;

  const legend   = _drillLegendHtml();
  const svgField = _drillFieldSvg(positions, { fs, labelMode: _drillLabelMode, traceLabel: null, selectMode: true });

  const expandIcon = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9"/></svg>`;

  if (fs) {
    return `
      <div class="drill-fs-nav">
        <button class="btn btn-sm btn-secondary" onclick="drillChartNav(-1)"${prevDisabled?' disabled':''}>&#8592;</button>
        <span class="drill-chart-setlabel">${navLabel}</span>
        <button class="btn btn-sm btn-secondary" onclick="drillChartNav(1)"${nextDisabled?' disabled':''}>&#8594;</button>
        <button class="btn btn-sm btn-secondary" onclick="drillChartCycleLabels()" title="Toggle labels">${_drillLabelMode ? '🏷' : '🏷'}</button>
        <button class="btn btn-sm btn-secondary" onclick="drillChartFlip()" title="Flip facing">⇅</button>
        <button class="btn btn-sm btn-secondary" onclick="drillChartCollapse()" title="Exit fullscreen" style="margin-left:4px">&#x2715;</button>
      </div>
      <div class="drill-fs-svg-wrap">${svgField}<div class="drill-fs-axis"></div></div>
      <div class="drill-fs-bottom">
        ${legend ? `<div class="drill-chart-legend" style="flex:1">${legend}</div>` : '<div></div>'}
        <button class="btn btn-primary btn-sm" onclick="applyDrillSelection()">Apply Selection</button>
      </div>`;
  }

  return `
    <div class="modal-title" style="margin-bottom:6px">Field Chart</div>
    <div class="drill-chart-nav">
      <button class="btn btn-sm btn-secondary" onclick="drillChartNav(-1)"${prevDisabled?' disabled':''}>&#8592;</button>
      <span class="drill-chart-setlabel">${navLabel}</span>
      <button class="btn btn-sm btn-secondary" onclick="drillChartNav(1)"${nextDisabled?' disabled':''}>&#8594;</button>
      <button class="btn btn-sm btn-secondary" onclick="drillChartExpand()" title="Fullscreen" style="margin-left:4px">${expandIcon}</button>
    </div>
    <div class="drill-chart-wrap">
      ${svgField}
    </div>
    ${legend ? `<div class="drill-chart-legend">${legend}</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:6px">
      <button class="btn btn-sm btn-secondary" onclick="drillChartCycleLabels()">${esc(_DRILL_LABEL_TEXT[_drillLabelMode])}</button>
      <button class="btn btn-sm btn-secondary" onclick="drillChartFlip()">⇅ Flip facing</button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary" onclick="showDrillPickModal()">&#8592; List</button>
      <button class="btn btn-primary" onclick="applyDrillSelection()">Apply Selection</button>
    </div>`;
}

function drillChartCycleLabels() {
  _drillLabelMode = (_drillLabelMode + 1) % 3;
  _drillChartRefresh();
}

function _drillChartRefresh() {
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) {
    fs.innerHTML = _drillChartSelect ? _drillChartHtml(true) : _drillViewFsHtml();
    _drillZoomSetup(fs.querySelector('.drill-fs-svg-wrap')); // keeps current pan/zoom
    return;
  }
  const root = document.getElementById('drill-chart-root');
  if (root) root.innerHTML = _drillChartHtml();
}

function drillChartExpand() {
  const fs = document.getElementById('drill-chart-fs');
  if (!fs) return;
  _drillZoomReset();
  fs.innerHTML = _drillChartSelect ? _drillChartHtml(true) : _drillViewFsHtml();
  fs.classList.remove('hidden');
  document.addEventListener('keydown', _drillChartFsKeydown);
  _drillZoomSetup(fs.querySelector('.drill-fs-svg-wrap'));
}

function drillChartCollapse() {
  const fs = document.getElementById('drill-chart-fs');
  if (!fs || fs.classList.contains('hidden')) return;
  _drillZoomReset();
  fs.classList.add('hidden');
  fs.innerHTML = '';
  document.removeEventListener('keydown', _drillChartFsKeydown);
  // Returning to the Drill tab: rebuild its inline stage (and re-bind zoom to
  // it) so set/flip/trace changes made in the overlay carry over.
  if (!_drillChartSelect && document.getElementById('drill-view-root')) {
    _drillZoomReset();
    _drillViewRerender();
  }
}

// Pinch-to-zoom + single-finger pan for the fullscreen chart.
// touch-action:none gives JS full control; we handle both gestures manually.
let _drillPanX = 0;
let _drillPanY = 0;
let _drillGestureStartScale = 1.0;
let _drillGestureStartPanX  = 0;
let _drillGestureStartPanY  = 0;
let _drillPinchInitDist = 0;
let _drillPinchCX = 0; // pinch center relative to wrap (fixed during gesture)
let _drillPinchCY = 0;
let _drillPanTouchX = 0; // single-finger start
let _drillPanTouchY = 0;
let _drillTapStartX = 0, _drillTapStartY = 0; // for tap-vs-pan discrimination
let _drillTapMoved  = false;
let _drillWasPinch  = false;

function _drillZoomReset() {
  _drillZoomScale = 1.0;
  _drillPanX = 0;
  _drillPanY = 0;
}

// The chart container (overlay or inline Drill-tab stage) currently being
// pinch-zoomed/panned. Lets the same gesture + axis code drive either one.
let _drillZoomWrap = null;

function _drillZoomSetup(wrap) {
  wrap = wrap || document.querySelector('.drill-fs-svg-wrap');
  if (!wrap) return;
  _drillZoomWrap = wrap;
  wrap.addEventListener('touchstart', _drillOnTouchStart, { passive: false });
  wrap.addEventListener('touchmove',  _drillOnTouchMove,  { passive: false });
  wrap.addEventListener('touchend',   _drillOnTouchEnd,   { passive: false });
  _drillApplyZoom(wrap);
}

function _drillApplyZoom(wrap) {
  wrap = wrap || _drillZoomWrap;
  const svg = wrap?.querySelector('svg');
  if (!svg) return;
  const wW = wrap.clientWidth, wH = wrap.clientHeight;
  const sW = (svg.clientWidth  || wW) * _drillZoomScale;
  const sH = (svg.clientHeight || wH) * _drillZoomScale;
  // Centre on any axis with slack (content smaller than the viewport); clamp to
  // the edges on any axis that overflows so panning can't expose dead space.
  _drillPanX = (wW - sW) > 0 ? (wW - sW) / 2 : Math.max(wW - sW, Math.min(0, _drillPanX));
  _drillPanY = (wH - sH) > 0 ? (wH - sH) / 2 : Math.max(wH - sH, Math.min(0, _drillPanY));
  svg.style.transformOrigin = '0 0';
  svg.style.transform = `translate(${_drillPanX}px,${_drillPanY}px) scale(${_drillZoomScale})`;
  _drillRenderFsAxis(wrap);
}

// Sticky yard-number ruler for the zoomed chart: pins a row to both the top and
// bottom edges and tracks the visible yard lines, so a yard reference stays on
// screen no matter how far you pan/zoom.
function _drillRenderFsAxis(wrap) {
  wrap = wrap || _drillZoomWrap;
  const axis = wrap?.querySelector('.drill-fs-axis');
  if (!axis) return;
  const svg = wrap.querySelector('svg');
  if (!svg) { axis.innerHTML = ''; return; }
  const wW = wrap.clientWidth, wH = wrap.clientHeight;
  // Only needed when the field is taller than the viewport (its own top/bottom
  // numbers have scrolled off); otherwise both rows are already on screen.
  if ((svg.clientHeight || wH) * _drillZoomScale <= wH + 1) {
    axis.style.display = 'none'; axis.innerHTML = ''; return;
  }
  axis.style.display = '';

  const { SCALE, ML, SW } = _DRILL_GEOM;
  const k  = wW / SW;                 // px per svg-unit at scale 1 (svg is width:100%)
  const s  = _drillZoomScale;
  const toScreenX = v => _drillPanX + v * k * s;

  let html = '';
  for (let yd = 10; yd <= 90; yd += 10) {
    const xs = toScreenX(ML + yd * 1.6 * SCALE);
    if (xs < 10 || xs > wW - 10) continue; // off-screen horizontally
    const lbl  = yd > 50 ? 100 - yd : yd;
    const left = `left:${xs.toFixed(1)}px`;
    html += `<span class="drill-fs-axis-num drill-fs-axis-num--top" style="${left}">${lbl}</span>`;
    html += `<span class="drill-fs-axis-num drill-fs-axis-num--bottom" style="${left}">${lbl}</span>`;
  }
  axis.innerHTML = html;
}

let _drillTouchIgnore = false; // touch started on the info panel — let it click through

function _drillOnTouchStart(e) {
  if (e.target.closest && e.target.closest('.drill-info-pop')) { _drillTouchIgnore = true; return; }
  _drillTouchIgnore = false;
  e.preventDefault();
  const wrap = e.currentTarget;
  const rect = wrap.getBoundingClientRect();
  if (e.touches.length >= 2) {
    _drillWasPinch = true;
    const t0 = e.touches[0], t1 = e.touches[1];
    _drillPinchInitDist     = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    _drillGestureStartScale = _drillZoomScale;
    _drillGestureStartPanX  = _drillPanX;
    _drillGestureStartPanY  = _drillPanY;
    _drillPinchCX = (t0.clientX + t1.clientX) / 2 - rect.left;
    _drillPinchCY = (t0.clientY + t1.clientY) / 2 - rect.top;
  } else {
    _drillWasPinch         = false; // first finger down: assume a tap until proven a pan/pinch
    _drillTapMoved         = false;
    _drillTapStartX        = e.touches[0].clientX;
    _drillTapStartY        = e.touches[0].clientY;
    _drillPinchInitDist    = 0;
    _drillPanTouchX        = e.touches[0].clientX;
    _drillPanTouchY        = e.touches[0].clientY;
    _drillGestureStartPanX = _drillPanX;
    _drillGestureStartPanY = _drillPanY;
  }
}

function _drillOnTouchMove(e) {
  if (_drillTouchIgnore) return;
  e.preventDefault();
  const wrap = e.currentTarget;
  if (e.touches.length >= 2 && _drillPinchInitDist) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist     = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const newScale = Math.max(1.0, Math.min(6.0, _drillGestureStartScale * dist / _drillPinchInitDist));
    // Zoom around the pinch center: keep the SVG point under _drillPinchCX/CY fixed.
    const r = newScale / _drillGestureStartScale;
    _drillZoomScale = newScale;
    _drillPanX = _drillPinchCX + (_drillGestureStartPanX - _drillPinchCX) * r;
    _drillPanY = _drillPinchCY + (_drillGestureStartPanY - _drillPinchCY) * r;
    _drillApplyZoom(wrap);
  } else if (e.touches.length === 1 && !_drillPinchInitDist) {
    if (Math.hypot(e.touches[0].clientX - _drillTapStartX, e.touches[0].clientY - _drillTapStartY) > 8) _drillTapMoved = true;
    _drillPanX = _drillGestureStartPanX + (e.touches[0].clientX - _drillPanTouchX);
    _drillPanY = _drillGestureStartPanY + (e.touches[0].clientY - _drillPanTouchY);
    _drillApplyZoom(wrap);
  }
}

function _drillOnTouchEnd(e) {
  if (_drillTouchIgnore) { if (e.touches.length === 0) _drillTouchIgnore = false; return; }
  if (e.touches.length === 0) {
    // All fingers up. A clean single-finger touch with no real movement is a
    // tap — forward it to the dot underneath (preventDefault suppressed the
    // browser's own click), so selecting/inspecting marchers works zoomed too.
    if (!_drillWasPinch && !_drillTapMoved) _drillFsTapAt(e.changedTouches[0]);
    _drillWasPinch      = false;
    _drillPinchInitDist = 0;
    return;
  }
  if (e.touches.length < 2) _drillPinchInitDist = 0;
  if (e.touches.length === 1) {
    // Finger lifted during/after pinch — restart single-touch from new position
    _drillTapMoved         = true; // tail of a multi-finger gesture, never a tap
    _drillPanTouchX        = e.touches[0].clientX;
    _drillPanTouchY        = e.touches[0].clientY;
    _drillGestureStartPanX = _drillPanX;
    _drillGestureStartPanY = _drillPanY;
  }
}

// Translate a tap in the fullscreen chart into a click on the dot under it.
function _drillFsTapAt(touch) {
  if (!touch) return;
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  if (el && el.closest && el.closest('.drill-fs-svg-wrap')) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
}

function _drillChartFsKeydown(e) {
  if (e.key === 'Escape')     { drillChartCollapse(); return; }
  if (e.key === 'ArrowLeft')  drillChartNav(-1);
  if (e.key === 'ArrowRight') drillChartNav(1);
}

function drillChartNav(delta) {
  const total = _drillPages ? _drillPages.length : 0;
  _drillCurrentSet = Math.max(0, Math.min(total - 1, _drillCurrentSet + delta));
  _drillChartRefresh();
}

function drillChartToggle(label) {
  if (_drillChecked.has(label)) _drillChecked.delete(label);
  else _drillChecked.add(label);
  _drillChartRefresh();
}

function drillChartFlip() {
  _drillFlipV = !_drillFlipV;
  _drillPersistFlip();
  _drillChartRefresh();
}

// ── Pyware Mapping Modal ──────────────────────────────────────────────────────

let _drillMappingSection = 0;

function showDrillMappingModal() {
  if (!STATE.isAdmin || !_drillData) return; // assigning spots is director-only
  _drillMappingSection = 0;
  _renderDrillMappingModal();
}

function _renderDrillMappingModal() {
  if (!STATE.isAdmin) return;
  const sections = _drillData;
  const mapping  = _activeDrillMapping();
  const drillName = STATE.drills[STATE.activeDrillId]?.name || _drillFileName || 'this drill';
  const students = Object.values(STATE.students).sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''));

  const studentOptions = `<option value="">— Not mapped —</option>` +
    students.map(s => `<option value="${esc(s.number)}">${esc(s.name || `#${s.number}`)}${s.instrument ? ` (${esc(normInstrument(s.instrument))})` : ''}</option>`).join('');

  const renderSectionTabs = () => sections.map((s, i) =>
    `<button class="drill-tab${i === _drillMappingSection ? ' drill-tab--active' : ''}"
       onclick="drillMappingSetSection(${i})">${esc(s.letter)}</button>`).join('');

  const posIdx = _drillPosIndex();
  const sec = sections[_drillMappingSection];
  const rows = sec.performers.map(label => {
    const explicit = drillSpotNums(mapping[label]);
    // A shared spot (2+ students) is shown read-only here — edit it by tapping
    // the dot on the chart or via CSV, so the dropdown can't silently drop a
    // partner.
    if (explicit.length > 1) {
      const names = explicit.map(n => STATE.students[n]?.name || `#${n}`).join(', ');
      return `
        <div class="drill-map-row">
          <div class="drill-map-pos">${esc(label)}<span class="drill-map-auto">shared</span></div>
          <div class="drill-map-shared">${esc(names)} <span style="color:var(--text-muted)">· tap the dot to edit</span></div>
        </div>`;
    }
    // Pre-select the effective student: explicit override, else block-spot match.
    const currentNum = explicit[0] || posIdx[label.toUpperCase()] || '';
    const auto = !explicit.length && posIdx[label.toUpperCase()];
    return `
      <div class="drill-map-row">
        <div class="drill-map-pos">${esc(label)}${auto ? `<span class="drill-map-auto" title="Matched to block spot ${esc(label)}">auto</span>` : ''}</div>
        <select class="drill-map-select form-input" data-label="${esc(label)}"
          onchange="drillMappingChange('${esc(label)}', this.value)">
          ${studentOptions.replace(`value="${esc(currentNum)}"`, `value="${esc(currentNum)}" selected`)}
        </select>
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Spots for ${esc(drillName)}</div>
    <p class="modal-sub" style="margin:0 0 10px">Assign this show's spots to students — each drill has its own map, so students can have different spots per show. Unset "auto" rows fall back to a student's block spot (column&nbsp;+&nbsp;row). Saved automatically.</p>
    <button class="btn btn-secondary btn-full" style="margin-bottom:10px" onclick="showDrillSpotImportModal()">⬆︎ Import / export spots (CSV)</button>
    <div class="drill-tabs">${renderSectionTabs()}</div>
    <div class="drill-map-list" id="drill-map-list">${rows}</div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function drillMappingSetSection(idx) {
  _drillMappingSection = idx;
  _renderDrillMappingModal();
}

// Persist the active drill's spot map. Uses update() (not set-merge) so
// clearing a spot actually removes it — set with merge deep-merges maps and
// would keep cleared keys. A small write that never touches the roster.
function _saveDrillMapping(id, mapping) {
  const drill = id ? STATE.drills[id] : null;
  if (!drill) return;
  drill.mapping = mapping; // optimistic; the drills listener will confirm
  orgCol('drills').doc(id).update({ mapping })
    .catch(e => _toastSaveError(e, 'The spot assignment'));
}

// Set a spot to a single student (or clear it) — the mapping modal's dropdown.
function drillMappingChange(label, studentNum) {
  const id = STATE.activeDrillId, drill = id ? STATE.drills[id] : null;
  if (!drill) return;
  const mapping = { ...(drill.mapping || {}) };
  if (studentNum) mapping[label] = String(studentNum);
  else delete mapping[label];
  _saveDrillMapping(id, mapping);
}

// Add a student to a spot (making it a shared spot if it already has one).
function drillSpotAddStudent(label, num) {
  if (!num) return;
  const id = STATE.activeDrillId, drill = id ? STATE.drills[id] : null;
  if (!drill) return;
  const mapping = { ...(drill.mapping || {}) };
  const cur = drillSpotNums(mapping[label]);
  if (!cur.includes(String(num))) cur.push(String(num));
  mapping[label] = cur.length === 1 ? cur[0] : cur;
  _saveDrillMapping(id, mapping);
  _drillRefreshCurrent();
}

// Remove one student from a spot.
function drillSpotRemoveStudent(label, num) {
  const id = STATE.activeDrillId, drill = id ? STATE.drills[id] : null;
  if (!drill) return;
  const mapping = { ...(drill.mapping || {}) };
  const cur = drillSpotNums(mapping[label]).filter(n => n !== String(num));
  if (cur.length) mapping[label] = cur.length === 1 ? cur[0] : cur;
  else delete mapping[label];
  _saveDrillMapping(id, mapping);
  _drillRefreshCurrent();
}

function _drillRefreshCurrent() {
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
  else if (document.getElementById('drill-view-root')) _drillViewRenderSvg();
}

// ── Per-drill spot import / export (CSV) ──────────────────────────────────────

// A CSV cell, quoted if it contains a comma, quote or newline.
function _csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// A roster-oriented template you fill in by hand: one row per student (number +
// name, which you recognise), with a Spot column to write each student's label
// for THIS show. Pre-filled with their current spot. A student sharing a spot
// just gets the same label as their partner. Sorted by name.
function _drillSpotTemplateCsv() {
  // Reverse the current map (label → students) into student → label.
  const spotOf = {};
  const map = _activeDrillMapping();
  Object.keys(map).forEach(lbl => drillSpotNums(map[lbl]).forEach(n => { spotOf[n] = lbl; }));
  const students = Object.values(STATE.students)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '') || String(a.number).localeCompare(String(b.number)));
  const lines = ['Student Number,Name,Spot'];
  students.forEach(s => lines.push([s.number, _csvCell(s.name || ''), spotOf[s.number] || ''].join(',')));
  return lines.join('\n');
}

function _downloadCsv(filename, text) {
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { console.error('CSV download failed:', e); showToast('Could not download the file.'); }
}

function downloadDrillSpotTemplate() {
  if (!_drillData) return;
  const name = (STATE.drills[STATE.activeDrillId]?.name || 'drill').replace(/[^\w-]+/g, '_');
  _downloadCsv(`${name}-spots.csv`, _drillSpotTemplateCsv());
}

function showDrillSpotImportModal() {
  if (!STATE.isAdmin || !_drillData) return;
  const drillName = STATE.drills[STATE.activeDrillId]?.name || _drillFileName || 'this drill';
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Import spots — ${esc(drillName)}</div>
    <p class="modal-sub" style="margin:0 0 12px">
      Download the template — a row per student (number + name) — write each student's
      <strong>Spot</strong> for this show next to their name, then re-import. It updates only the
      students in your sheet (blank spot = unassigned); two students can share a spot by giving them
      the same label. Nothing else on the roster is touched.
    </p>
    <button class="btn btn-secondary btn-full" onclick="downloadDrillSpotTemplate()">⬇︎ Download roster template (fill in spots)</button>
    <label class="btn btn-primary btn-full" style="cursor:pointer;margin-top:10px">
      ⬆︎ Choose CSV to import
      <input type="file" accept=".csv,text/csv" style="display:none" onchange="drillSpotImportFile(event)">
    </label>
    <div id="drill-spot-import-msg" style="margin-top:12px"></div>
  `);
}

let _drillSpotPendingResult = null;

function drillSpotImportFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const drillName = STATE.drills[STATE.activeDrillId]?.name || _drillFileName || 'this drill';
  const reader = new FileReader();
  reader.onload = e => {
    const validNums = new Set(Object.keys(STATE.students));
    const current   = _activeDrillMapping();
    let res;
    try { res = applyDrillSpotCsv(current, String(e.target.result || ''), validNums); }
    catch (err) { console.error('spot CSV parse failed:', err); _drillSpotMsg(`<div class="auth-error">Could not read that CSV.</div>`); return; }
    if (res.error === 'columns') {
      _drillSpotMsg(`<div class="auth-error">Couldn't find both a <strong>Spot</strong> (or Label) and a <strong>Student Number</strong> column. Check the header row.</div>`);
      return;
    }
    if (!res.rows) { _drillSpotMsg(`<div class="auth-error">No spot rows found in that file.</div>`); return; }
    _drillSpotPendingResult = res;
    const unknownNote = res.unknown.length
      ? `<div style="color:var(--danger);font-size:.8rem;margin-top:6px">${res.unknown.length} row${res.unknown.length!==1?'s':''} reference a student number not on your roster and were skipped (e.g. ${esc(res.unknown.slice(0,3).map(u=>`${u.label}→#${u.number}`).join(', '))}).</div>`
      : '';
    _drillSpotMsg(`
      <div class="card" style="padding:12px">
        <div style="font-weight:600;margin-bottom:4px">Ready to apply</div>
        <div style="font-size:.85rem;color:var(--text-muted)">
          Assign <strong>${res.assigned}</strong> student${res.assigned!==1?'s':''}${res.cleared?`, unassign <strong>${res.cleared}</strong>`:''}${res.shared?`, <strong>${res.shared}</strong> shared spot${res.shared!==1?'s':''}`:''}.
        </div>
        ${unknownNote}
        <button class="btn btn-primary btn-full" style="margin-top:10px" onclick="drillSpotApplyImport()">Apply to ${esc(drillName)}</button>
      </div>`);
  };
  reader.readAsText(file);
}

function _drillSpotMsg(html) {
  const el = document.getElementById('drill-spot-import-msg');
  if (el) el.innerHTML = html;
}

function drillSpotApplyImport() {
  const res = _drillSpotPendingResult;
  const id = STATE.activeDrillId, drill = id ? STATE.drills[id] : null;
  if (!res || !drill) return;
  _saveDrillMapping(id, res.mapping);
  _drillSpotPendingResult = null;
  closeModal();
  showToast(`Spots updated — ${res.assigned} assigned${res.cleared ? `, ${res.cleared} unassigned` : ''}.`);
  if (_view === 'drill') _drillViewRerender();
}

// ── Standalone Field Chart viewer (Drill tab) ─────────────────────────────────
// A top-level, read-only chart: step through sets, jump to any set, toggle dot
// labels, tap a performer for their Pyware-style coordinate, and search to trace
// one performer's path across every set.

function viewDrill() {
  if (!canRecord()) return `<div class="empty-state"><p>Directors only.</p></div>`;
  if (!_drillData || !_drillPages || !_drillPages.length) {
    const hasDrills = Object.keys(STATE.drills || {}).length > 0;
    return `
      <div class="empty-state" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px">
        <div class="empty-icon">🚩</div>
        <p>${hasDrills ? 'No drill selected.' : 'No drill loaded yet.'}</p>
        <p style="color:var(--text-muted);max-width:300px;margin:6px auto 0">
          ${STATE.isAdmin
            ? `Upload a Pyware <strong>.3dj</strong> or <strong>.3da</strong> file to view your field chart, step through sets, label dots, and trace a performer's path.`
            : hasDrills ? `Open the library to pick the field chart to view.` : `A director hasn't added a field chart yet.`}
        </p>
        ${hasDrills
          ? `<button class="btn btn-primary" style="margin-top:14px" onclick="showDrillLibraryModal()">Open Drill Library</button>`
          : (STATE.isAdmin ? `<button class="btn btn-primary" style="margin-top:14px" onclick="drillAddFile()">Load Drill File</button>` : '')}
      </div>`;
  }
  return `<div id="drill-view-root" class="drill-view">${_drillViewInner()}</div>`;
}

function _drillViewInner() {
  const idx   = _drillCurrentSet;
  const total = _drillPages.length;
  const count = Object.keys(STATE.drills || {}).length;
  const name  = STATE.drills[STATE.activeDrillId]?.name || _drillFileName || 'Drill';

  return `
    <button class="drill-switcher" onclick="showDrillLibraryModal()">
      <span class="drill-switcher-ico">📚</span>
      <span class="drill-switcher-text">
        <span class="drill-switcher-name">${esc(name)}</span>
        <span class="drill-switcher-meta">${count > 1 ? `${count} drills · tap to switch` : 'Tap to manage library'}</span>
      </span>
      <span class="drill-switcher-caret">▾</span>
    </button>

    <div class="drill-view-bar">
      <div class="drill-search-wrap${_drillSearchQuery.trim() ? ' has-q' : ''}" id="drill-search-wrap">
        <input class="drill-search form-input" type="search" placeholder="Find a performer or student…"
               value="${esc(_drillSearchQuery)}" autocomplete="off"
               oninput="drillViewSearch(this.value)">
        <button class="drill-search-clear" onclick="drillViewClearSearch()" aria-label="Clear">✕</button>
      </div>
      <button class="btn btn-sm ${_drillPlaying ? 'btn-primary' : 'btn-secondary'}" onclick="drillPlayToggle()" title="Play / pause">${_drillPlaying ? '⏸' : '▶'}</button>
      <button class="btn btn-sm ${_drillSelectMode ? 'btn-primary' : 'btn-secondary'}" onclick="drillToggleSelectMode()" title="Select sets to trace/play">⛶</button>
      <button class="btn btn-sm btn-secondary" onclick="drillViewFlip()" title="Flip facing">⇅</button>
      ${_drillHasNotes() ? `<button class="btn btn-sm ${_drillShowNotes ? 'btn-primary' : 'btn-secondary'}" onclick="drillToggleNotes()" title="Show set instructions">📝</button>` : ''}
      <button class="btn btn-sm btn-secondary" onclick="drillViewExpand()" title="Hide header &amp; tabs">⤢</button>
    </div>

    ${_drillSelStatusHtml()}

    <div class="drill-view-strip">
      <button class="drill-nav-arrow" onclick="drillViewNav(-1)"${idx<=0?' disabled':''} aria-label="Previous set">&#8592;</button>
      <div class="drill-set-strip" id="drill-set-strip">${_drillSetStripHtml()}</div>
      <button class="drill-nav-arrow" onclick="drillViewNav(1)"${idx>=total-1?' disabled':''} aria-label="Next set">&#8594;</button>
    </div>

    <div class="drill-fs-svg-wrap drill-view-stage" id="drill-stage">${_drillStageInner()}</div>

    ${_drillNotePanelHtml()}

    <div class="drill-view-foot">
      <span class="drill-foot-main" id="drill-foot-main">${esc(_drillFootText())}</span>
    </div>`;
}

// The selected-sets / playback status line (only when relevant).
function _drillSelStatusHtml() {
  if (_drillPlaying) {
    return `<div class="drill-sel-status drill-sel-status--play">
      ▶ Playing · <span id="drill-play-count">count ${_drillPlayCount}</span> of ${_drillPlayEnd}</div>`;
  }
  if (_drillSelectMode || _drillTraceSets.length) {
    const n = _drillTraceSets.length;
    return `<div class="drill-sel-status">
      ${_drillSelectMode ? 'Tap sets to include · ' : ''}${n ? `${n} set${n!==1?'s':''} selected` : 'no sets selected (uses all)'}
      ${n ? `<button class="link-btn" onclick="drillClearSets()">clear</button>` : ''}</div>`;
  }
  return '';
}

// SVG + sticky-axis overlay (+ the tapped-performer info panel) for the zoomable
// stage. Rebuilt on its own so the search box above it keeps focus while typing.
function _drillStageInner() {
  return _drillFieldSvg(_drillCurrentPositions(),
    { fs: true, labelMode: _drillLabelMode, traceLabel: _drillTraceLabel, focusLabel: _drillSelLabel,
      selectMode: false, traceIdx: _drillActiveIdx() })
    + `<div class="drill-fs-axis"></div>`
    + (_drillPlaying ? '' : _drillInfoPanelHtml());
}

// The active set indices for tracing/playback: a selected subset (≥2), else all.
function _drillActiveIdx() {
  if (_drillTraceSets && _drillTraceSets.length >= 2) return [..._drillTraceSets].sort((a, b) => a - b);
  return _drillPages ? _drillPages.map((_, i) => i) : [];
}

// Performer positions to render right now: an interpolated frame while playing,
// otherwise the current set's formation.
function _drillCurrentPositions() {
  return _drillPlaying ? _drillFrameAt(_drillPlayCount) : _drillPages[_drillCurrentSet].performers;
}

// Linearly interpolate every performer's position at a given count, using the
// active sets as keyframes (each keyframe sits at its real count).
function _drillFrameAt(count) {
  const pages = _drillActiveIdx().map(i => _drillPages[i]);
  if (!pages.length) return [];
  let seg = 0;
  while (seg < pages.length - 1 && pages[seg + 1].count <= count) seg++;
  const a = pages[seg], b = pages[Math.min(seg + 1, pages.length - 1)];
  const span = b.count - a.count;
  const t = span > 0 ? Math.max(0, Math.min(1, (count - a.count) / span)) : (count >= b.count ? 1 : 0);
  const bMap = {}; b.performers.forEach(p => { bMap[p.label] = p; });
  return a.performers.map(pa => {
    const pb = bMap[pa.label] || pa;
    return {
      label: pa.label, section: pa.section,
      stepsX: pa.stepsX + (pb.stepsX - pa.stepsX) * t,
      stepsY: pa.stepsY + (pb.stepsY - pa.stepsY) * t,
    };
  });
}

// Compact info panel docked to the top of the chart (so it doesn't cover the
// tapped dot the way a bottom-sheet did). Empty when nothing is selected.
function _drillInfoPanelHtml() {
  const label = _drillSelLabel;
  if (!label || !_drillPages) return '';
  const p = _drillPages[_drillCurrentSet].performers.find(x => x.label === label);
  if (!p) return '';
  const nums = drillStudentNumsByLabel(label);           // 0, 1, or more (shared)
  const co   = _drillCoord(p.stepsX, p.stepsY);
  const meta = `Section ${esc(p.section)}` + (nums.length ? '' : ' · <em>not mapped</em>');
  const reh  = (typeof getActiveRehearsal === 'function') ? getActiveRehearsal() : null;
  const rehName = reh ? (reh.label || (typeof fmtDate === 'function' ? fmtDate(reh.date) : '') || 'rehearsal') : '';

  // Assigning is a one-time setup, marking is frequent — so the assign/remove
  // controls stay tucked behind the ⋯ (edit) toggle, and the default view is
  // just names + quick marks. (Admins only; edit is a no-op otherwise.)
  const editing = STATE.isAdmin && _drillInfoEdit;

  // One row per assigned student: name, quick marks (if a rehearsal is open),
  // plus a remove ✕ while editing. Shared spots list everyone here.
  const studentRows = nums.map(num => {
    const st = STATE.students[num];
    const name = st ? (st.name || `#${num}`) : `#${num}`;
    let marks = '';
    if (reh) {
      const ent = (STATE.entries[reh.id] || {})[num] || {};
      const pos = ent.positives || 0, mis = ent.mistakes || 0;
      marks = `
        <button class="btn drill-mark-btn drill-mark-pos" onclick="drillQuickMark('${esc(num)}','positive')" title="Positive">✓${pos ? ` <span class="drill-mark-ct">${pos}</span>` : ''}</button>
        <button class="btn drill-mark-btn drill-mark-neg" onclick="drillQuickMark('${esc(num)}','mistake')" title="Mistake">✗${mis ? ` <span class="drill-mark-ct">${mis}</span>` : ''}</button>`;
    }
    return `
      <div class="drill-info-stu">
        <span class="drill-info-stu-name" onclick="navigate('student',{num:'${esc(num)}'})">${esc(name)}</span>
        <span class="drill-info-stu-actions">${marks}${editing ? `<button class="drill-info-stu-x" onclick="drillSpotRemoveStudent('${esc(label)}','${esc(num)}')" title="Remove from spot" aria-label="Remove from spot">✕</button>` : ''}</span>
      </div>`;
  }).join('');

  return `
    <div class="drill-info-pop">
      <div class="drill-info-pop-top">
        ${STATE.isAdmin ? `<button class="drill-info-pop-edit${editing ? ' is-on' : ''}" onclick="drillInfoToggleEdit()" title="Edit who's on this spot" aria-label="Edit spot assignment">⋯</button>` : ''}
        <button class="drill-info-pop-x" onclick="drillCloseInfo()" aria-label="Close">✕</button>
      </div>
      <div class="drill-info-pop-name">${esc(label)}${nums.length > 1 ? ` · <span class="drill-info-shared">shared</span>` : ''}</div>
      <div class="drill-info-pop-meta">${meta}</div>
      <div class="drill-info-pop-coord">${esc(co.lr)}<br>${esc(co.fb)}</div>
      ${reh ? `<div class="drill-info-marks-label">Add to ${esc(rehName)}:</div>` : ''}
      ${studentRows}
      ${editing ? `
      <div class="drill-info-pop-assign">
        <select class="form-input drill-info-assign-sel" onchange="drillSpotAddStudent('${esc(label)}', this.value); this.value=''">
          <option value="">＋ ${nums.length ? 'Add another student…' : 'Assign a student…'}</option>
          ${Object.values(STATE.students).sort((a,b)=>(a.name||'').localeCompare(b.name||''))
            .filter(s => !nums.includes(String(s.number)))
            .map(s => `<option value="${esc(s.number)}">${esc(s.name || `#${s.number}`)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="drill-info-pop-actions">
        <button class="btn btn-sm ${_drillTraceLabel === label ? 'btn-secondary' : 'btn-primary'}" onclick="drillTracePerformer('${esc(label)}')">${_drillTraceLabel === label ? 'Tracing ✓' : 'Trace path'}</button>
      </div>
    </div>`;
}

// Toggle the tapped-dot panel between marking (default) and editing who's on
// the spot (the assign/remove controls).
function drillInfoToggleEdit() {
  _drillInfoEdit = !_drillInfoEdit;
  _drillRefreshCurrent();
}

// Add a quick mark to the selected performer's student in the open rehearsal.
function drillQuickMark(num, type) {
  if (!canRecord()) return;
  const reh = getActiveRehearsal();
  if (!reh) { showToast('No open rehearsal.'); return; }
  showMarkModal(reh.id, num, type);
}

function _drillFootText() {
  const pg = _drillPages[_drillCurrentSet];
  const base = `Set ${_drillCurrentSet + 1}/${_drillPages.length} · count ${pg.count}`;
  return _drillTraceLabel
    ? `${base} · tracing ${_drillTraceDisplay(_drillTraceLabel)}`
    : `${base} · tap a performer for details`;
}

// True if any set carries the drill writer's Pyware instruction text.
function _drillHasNotes() {
  return !!(_drillPages && _drillPages.some(p => p.note));
}

// The instruction panel for the current set (its Pyware text box). Hidden while
// playing, when the toggle is off, or when this set has no text. Shared by the
// Drill tab and the fullscreen viewer, so the toggle behaves the same in both.
function _drillNotePanelHtml() {
  if (!_drillShowNotes || _drillPlaying || !_drillHasNotes()) return '';
  const note = _drillPages[_drillCurrentSet]?.note;
  if (!note) return '';
  return `<div class="drill-view-note">${esc(note).replace(/\n/g, '<br>')}</div>`;
}

function drillToggleNotes() {
  _drillShowNotes = !_drillShowNotes;
  try { localStorage.setItem('drillShowNotes', _drillShowNotes ? '1' : '0'); } catch {}
  // Refresh whichever surface is showing — the fullscreen overlay or the tab.
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
  else _drillViewRerender();
}

function _drillSetStripHtml() {
  return _drillPages.map((pg, i) => {
    const cls = (i === _drillCurrentSet ? ' drill-set-chip--active' : '')
              + (_drillTraceSets.includes(i) ? ' drill-set-chip--sel' : '');
    return `<button class="drill-set-chip${cls}" onclick="drillViewGoToSet(${i})">${i + 1}<span class="drill-set-chip-ct">${pg.count}</span></button>`;
  }).join('');
}

// Called by render() after the Drill tab's HTML is in the DOM: wire up
// pinch-zoom/pan on the stage (re-applying the current zoom, so data-driven
// re-renders don't reset the view).
function _drillViewSetup() {
  const stage = document.getElementById('drill-stage');
  if (!stage) return;
  _drillZoomSetup(stage);
  _drillScrollSetChipIntoView();
}

function _drillViewRerender() {
  const root = document.getElementById('drill-view-root');
  if (!root) return;
  root.innerHTML = _drillViewInner();
  _drillViewSetup();
}

// Rebuild only the stage (keeps the search box focused) and re-apply zoom.
function _drillViewRenderSvg() {
  const stage = document.getElementById('drill-stage');
  if (!stage) return;
  stage.innerHTML = _drillStageInner();
  _drillZoomWrap = stage;
  _drillApplyZoom(stage);
}

function _drillScrollSetChipIntoView() {
  const chip = document.querySelector('.drill-set-chip--active');
  if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function drillViewNav(delta) {
  _drillCurrentSet = Math.max(0, Math.min(_drillPages.length - 1, _drillCurrentSet + delta));
  _drillViewRerender();
}

function drillViewGoToSet(i) {
  if (_drillSelectMode) {
    // Toggle this set in the trace/playback selection.
    const at = _drillTraceSets.indexOf(i);
    if (at >= 0) _drillTraceSets.splice(at, 1); else _drillTraceSets.push(i);
    _drillViewRerender();
    return;
  }
  _drillCurrentSet = Math.max(0, Math.min(_drillPages.length - 1, i));
  _drillViewRerender();
}

function drillToggleSelectMode() {
  _drillSelectMode = !_drillSelectMode;
  if (_drillPlaying) _drillPlayStop();
  _drillViewRerender();
}

function drillClearSets() {
  _drillTraceSets = [];
  _drillViewRerender();
}

// ── Playback: animate the formation count-by-count through the active sets ─────
const _DRILL_PLAY_MS = 450; // one count per tick

function drillPlayToggle() {
  if (_drillPlaying) { _drillPlayStop(); _drillViewRerender(); return; }
  const idxs = _drillActiveIdx();
  if (idxs.length < 2) { showToast('Select at least 2 sets, or this drill needs more sets.'); return; }
  _drillSelectMode = false;
  _drillPlayStart  = _drillPages[idxs[0]].count;
  _drillPlayEnd    = _drillPages[idxs[idxs.length - 1]].count;
  _drillPlayCount  = _drillPlayStart;
  _drillPlaying    = true;
  _drillSelLabel   = null; // hide the info panel while playing
  _drillViewRerender();
  _drillPlayTimer = setInterval(_drillPlayTick, _DRILL_PLAY_MS);
}

function _drillPlayTick() {
  if (_drillPlayCount >= _drillPlayEnd) {
    const idxs = _drillActiveIdx();
    _drillCurrentSet = idxs[idxs.length - 1]; // land on the final formation
    _drillPlayStop();
    _drillViewRerender();
    return;
  }
  _drillPlayCount += 1;
  _drillViewRenderSvg(); // cheap: just the field
  const el = document.getElementById('drill-play-count');
  if (el) el.textContent = `count ${_drillPlayCount}`;
}

function _drillPlayStop() {
  _drillPlaying = false;
  if (_drillPlayTimer) clearInterval(_drillPlayTimer);
  _drillPlayTimer = null;
}

function drillViewFlip() {
  _drillFlipV = !_drillFlipV;
  _drillPersistFlip();
  _drillViewRerender();
}

// Facing is per-drill, stored on its library metadata doc (live for everyone).
function _drillPersistFlip() {
  const id = STATE.activeDrillId;
  if (!id) return;
  if (STATE.drills[id]) STATE.drills[id].flipV = _drillFlipV;
  orgCol('drills').doc(id).set({ flipV: _drillFlipV }, { merge: true }).catch(e => console.error(e));
}

function drillViewSearch(q) {
  _drillSearchQuery = q;
  _drillTraceLabel = _drillResolveLabel(q);
  _drillViewRenderSvg();
  const wrap = document.getElementById('drill-search-wrap');
  if (wrap) wrap.classList.toggle('has-q', !!q.trim());
  const foot = document.getElementById('drill-foot-main');
  if (foot) {
    foot.textContent = (q.trim() && !_drillTraceLabel) ? `No performer matches "${q.trim()}"` : _drillFootText();
  }
}

function drillViewClearSearch() {
  _drillSearchQuery = '';
  _drillTraceLabel = null;
  _drillViewRenderSvg();
  const wrap = document.getElementById('drill-search-wrap');
  if (wrap) wrap.classList.remove('has-q');
  const input = wrap && wrap.querySelector('.drill-search');
  if (input) input.value = '';
  const foot = document.getElementById('drill-foot-main');
  if (foot) foot.textContent = _drillFootText();
}

function drillViewExpand() {
  _drillChartSelect = false;
  drillChartExpand();
}

// Fullscreen content for the viewer (read-only; taps show a coordinate readout
// in the bottom bar since a modal would sit behind the fullscreen layer).
function _drillViewFsHtml() {
  const idx = _drillCurrentSet, total = _drillPages.length;
  const navLabel = `Set ${idx + 1} <span style="font-weight:400;color:var(--text-muted)">of ${total} · count ${_drillPages[idx].count}</span>`;
  const legend   = _drillLegendHtml();
  const svgField = _drillFieldSvg(_drillPages[idx].performers,
    { fs: true, labelMode: _drillLabelMode, traceLabel: _drillTraceLabel, focusLabel: _drillTraceLabel, selectMode: false, fsView: true, traceIdx: _drillActiveIdx() });

  let readout = '';
  if (_drillTraceLabel) {
    const tp = _drillPages[idx].performers.find(p => p.label === _drillTraceLabel);
    if (tp) {
      const co = _drillCoord(tp.stepsX, tp.stepsY);
      readout = `<span class="drill-fs-trace">${esc(_drillTraceDisplay(_drillTraceLabel))} — ${esc(co.lr)} · ${esc(co.fb)}</span>`;
    }
  }

  return `
    <div class="drill-fs-nav">
      <button class="btn btn-sm btn-secondary" onclick="drillChartNav(-1)"${idx<=0?' disabled':''}>&#8592;</button>
      <span class="drill-chart-setlabel">${navLabel}</span>
      <button class="btn btn-sm btn-secondary" onclick="drillChartNav(1)"${idx>=total-1?' disabled':''}>&#8594;</button>
      <button class="btn btn-sm btn-secondary" onclick="drillChartCycleLabels()" title="Toggle labels">🏷</button>
      <button class="btn btn-sm btn-secondary" onclick="drillChartFlip()" title="Flip facing">⇅</button>
      ${_drillHasNotes() ? `<button class="btn btn-sm ${_drillShowNotes ? 'btn-primary' : 'btn-secondary'}" onclick="drillToggleNotes()" title="Show set instructions">📝</button>` : ''}
      <button class="btn btn-sm btn-secondary" onclick="drillChartCollapse()" title="Exit fullscreen" style="margin-left:4px">&#x2715;</button>
    </div>
    <div class="drill-fs-svg-wrap">${svgField}<div class="drill-fs-axis"></div></div>
    ${_drillNotePanelHtml()}
    <div class="drill-fs-bottom">
      ${readout || (legend ? `<div class="drill-chart-legend" style="flex:1">${legend}</div>` : '<div></div>')}
    </div>`;
}

function drillFsTapPerf(label) {
  _drillTraceLabel  = label;
  _drillSearchQuery = _drillTraceDisplay(label);
  _drillChartRefresh();
}

// Tap a dot in the inline viewer: mark it with a bold on-chart callout and show
// a compact, non-covering info panel at the top of the chart.
function drillShowPerfInfo(label) {
  if (!_drillPages) return;
  if (!_drillPages[_drillCurrentSet].performers.some(x => x.label === label)) return;
  _drillSelLabel = (_drillSelLabel === label) ? null : label; // tap again to dismiss
  _drillInfoEdit = false; // each new tap opens in marking mode
  _drillViewRenderSvg();
}

function drillCloseInfo() {
  _drillSelLabel = null;
  _drillInfoEdit = false;
  _drillViewRenderSvg();
}

function drillTracePerformer(label) {
  _drillTraceLabel  = label;
  _drillSearchQuery = _drillTraceDisplay(label);
  _drillViewRerender();
}

// "A1" or "A1 · Jane" when mapped — used for the search box + hints.
function _drillTraceDisplay(label) {
  const num = drillStudentByLabel(label);
  const st  = num ? STATE.students[num] : null;
  return st && st.name ? `${label} · ${st.name}` : label;
}

// Resolve a search string to a performer label in the current set: match the
// drill label, else a mapped student's number or name.
function _drillResolveLabel(q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return null;
  const perfs = _drillPages[_drillCurrentSet].performers;
  const byLabel = perfs.find(p => p.label.toLowerCase() === q)
              || perfs.find(p => p.label.toLowerCase().startsWith(q));
  if (byLabel) return byLabel.label;
  for (const p of perfs) {
    for (const num of drillStudentNumsByLabel(p.label)) {
      if (String(num) === q) return p.label;
      const st = STATE.students[num];
      if (st && (st.name || '').toLowerCase().includes(q)) return p.label;
    }
  }
  return null;
}

// Pyware-style coordinate from step offsets. Returns { lr, fb } strings.
function _drillCoord(stepsX, stepsY) {
  // Left–right: nearest 5-yard line + steps inside/outside, Side 1 (west) / 2 (east).
  const yardFromWest = stepsX / 1.6;             // 0..100 from the west endzone
  const n5 = Math.round(yardFromWest / 5) * 5;   // nearest 5-yard line
  const yardLbl = n5 <= 50 ? n5 : 100 - n5;
  const side = n5 === 50 ? '' : (n5 < 50 ? 'Side 1' : 'Side 2');
  const dSteps = Math.round(Math.abs(yardFromWest - n5) * 1.6 * 4) / 4;
  let lr;
  if (n5 === 0 || n5 === 100) {
    lr = `${dSteps ? `${dSteps} steps from ` : 'On '}the ${n5 < 50 ? 'Side 1' : 'Side 2'} goal line`;
  } else if (dSteps < 0.1) {
    lr = `On the ${yardLbl}${side ? ` (${side})` : ''}`;
  } else {
    const inside = (yardFromWest > n5) === (n5 < 50); // toward the 50
    lr = `${dSteps} steps ${inside ? 'inside' : 'outside'} the ${yardLbl}${side ? ` (${side})` : ''}`;
  }

  // Front–back: nearest of front sideline / front hash / back hash / back sideline.
  const refs = [
    { y: 0,  name: 'front sideline' }, { y: 28, name: 'front hash' },
    { y: 56, name: 'back hash' },      { y: 84, name: 'back sideline' },
  ];
  let best = refs[0];
  for (const r of refs) if (Math.abs(stepsY - r.y) < Math.abs(stepsY - best.y)) best = r;
  const dY = Math.round((stepsY - best.y) * 4) / 4;
  const fb = Math.abs(dY) < 0.1
    ? `On the ${best.name}`
    : `${Math.abs(dY)} steps ${dY > 0 ? 'behind' : 'in front of'} the ${best.name}`;
  return { lr, fb };
}

function showDrillOptionsModal() {
  if (!canRecord()) return;
  const has   = !!(_drillData && _drillPages && _drillPages.length);
  const count = Object.keys(STATE.drills || {}).length;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Field Chart Options</div>
    <div class="options-menu">
      <button class="options-menu-item" onclick="closeModal();showDrillLibraryModal()">
        <div class="options-menu-icon">📚</div>
        <div><div class="options-menu-label">Drill Library</div><div class="options-menu-sub">${count ? `${count} drill${count!==1?'s':''} · ${STATE.isAdmin ? 'switch, add or remove' : 'switch drills'}` : (STATE.isAdmin ? 'Add your first drill file' : 'No drills yet')}</div></div>
      </button>
      ${(has && STATE.isAdmin) ? `
      <button class="options-menu-item" onclick="closeModal();showDrillMappingModal()">
        <div class="options-menu-icon">🔗</div>
        <div><div class="options-menu-label">Assign Spots</div><div class="options-menu-sub">This show's spots → students · tap or CSV</div></div>
      </button>` : ''}
    </div>
    ${has ? `
    <div class="drill-opt-section">
      <div class="drill-opt-label">Dot labels</div>
      <div class="drill-lblseg-group" id="drill-lblseg-group">
        ${['Off', 'Drill #', 'Names'].map((t, i) =>
          `<button class="drill-lblseg${_drillLabelMode === i ? ' drill-lblseg--on' : ''}" onclick="drillSetLabelMode(${i})">${t}</button>`
        ).join('')}
      </div>
    </div>
    <div class="drill-opt-section">
      <div class="drill-opt-label">Field color</div>
      <div class="drill-lblseg-group" id="drill-fieldseg-group">
        <button class="drill-lblseg${!_drillFieldWhite ? ' drill-lblseg--on' : ''}" onclick="drillSetFieldWhite(false)">Green</button>
        <button class="drill-lblseg${_drillFieldWhite ? ' drill-lblseg--on' : ''}" onclick="drillSetFieldWhite(true)">White</button>
      </div>
    </div>` : ''}
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

// Field fill: green vs white (independent of the app's light/dark mode). Updates
// the segmented control in place and re-renders the chart everywhere it shows.
function drillSetFieldWhite(white) {
  _drillFieldWhite = !!white;
  try { localStorage.setItem('drillFieldWhite', white ? '1' : '0'); } catch {}
  document.querySelectorAll('#drill-fieldseg-group .drill-lblseg')
    .forEach((b, i) => b.classList.toggle('drill-lblseg--on', i === (white ? 1 : 0)));
  if (_view === 'drill' && document.getElementById('drill-view-root')) _drillViewRerender();
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
}

// Set the dot-label mode from the options menu: update the segmented control in
// place (no modal re-open → no extra history entry) and re-render the chart.
function drillSetLabelMode(n) {
  _drillLabelMode = n;
  document.querySelectorAll('#drill-lblseg-group .drill-lblseg')
    .forEach((b, i) => b.classList.toggle('drill-lblseg--on', i === n));
  if (_view === 'drill' && document.getElementById('drill-view-root')) _drillViewRerender();
}

// ── Drill library (multiple stored drills) ────────────────────────────────────

function _drillSortedIds() {
  return Object.keys(STATE.drills || {}).sort((a, b) => {
    const ta = STATE.drills[a].createdAt?.seconds || 0;
    const tb = STATE.drills[b].createdAt?.seconds || 0;
    if (tb !== ta) return tb - ta; // newest first
    return (STATE.drills[a].name || '').localeCompare(STATE.drills[b].name || '');
  });
}

function showDrillLibraryModal() {
  if (!canRecord()) return;
  const ids = _drillSortedIds();
  const rows = ids.map(id => {
    const d = STATE.drills[id];
    const active = id === STATE.activeDrillId;
    const sets = d.setCount || 0;
    const sub  = `${sets} set${sets !== 1 ? 's' : ''}${d.performerCount ? ` · ${d.performerCount} performers` : ''}`;
    return `
      <div class="drill-lib-row${active ? ' drill-lib-row--active' : ''}">
        <button class="drill-lib-main" onclick="drillActivate('${esc(id)}')">
          <div class="drill-lib-name">${esc(d.name || d.fileName || 'Drill')}${active ? '<span class="drill-lib-badge">active</span>' : ''}</div>
          <div class="drill-lib-sub">${esc(sub)}</div>
        </button>
        ${STATE.isAdmin ? `
        <button class="drill-lib-act" onclick="drillRenamePrompt('${esc(id)}')" title="Rename" aria-label="Rename">✎</button>
        <button class="drill-lib-act drill-lib-act--danger" onclick="drillDeletePrompt('${esc(id)}')" title="Delete" aria-label="Delete">🗑</button>` : ''}
      </div>`;
  }).join('');
  openModal(`
    <div id="drill-library-modal">
      <div class="modal-handle"></div>
      <div class="modal-title">Drill Library</div>
      <p class="modal-sub" style="margin:0 0 10px">Tap a drill to make it the active field chart for everyone.</p>
      ${ids.length ? `<div class="drill-lib-list">${rows}</div>` : `<p style="color:var(--text-muted);text-align:center;padding:20px 0">No drills saved yet.</p>`}
      ${STATE.isAdmin ? `<button class="btn btn-secondary btn-full" style="margin-top:12px" onclick="drillAddFile()">＋ Add drill file</button>` : ''}
      <div class="modal-actions" style="margin-top:8px">
        <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
      </div>
    </div>
  `);
}

function drillActivate(id) {
  if (!STATE.drills[id] || id === STATE.activeDrillId) { closeModal(); if (_view !== 'drill') navigate('drill'); return; }
  STATE.activeDrillId = id;
  orgCol('settings').doc('drill').set({ activeId: id }, { merge: true }).catch(e => console.error(e));
  _drillSyncActive(); // loads the new payload, then re-renders
  closeModal();
  if (_view !== 'drill') navigate('drill'); else render();
}

function drillRenamePrompt(id) {
  const d = STATE.drills[id];
  if (!d) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Rename Drill</div>
    <input class="form-input" id="drill-rename-input" type="text" maxlength="80"
           value="${esc(d.name || d.fileName || '')}" placeholder="Drill name" autocomplete="off">
    <div class="modal-actions" style="margin-top:14px">
      <button class="btn btn-secondary" onclick="showDrillLibraryModal()">Cancel</button>
      <button class="btn btn-primary" onclick="drillRenameSave('${esc(id)}')">Save</button>
    </div>
  `);
  setTimeout(() => { const el = document.getElementById('drill-rename-input'); if (el) { el.focus(); el.select(); } }, 50);
}

function drillRenameSave(id) {
  const el = document.getElementById('drill-rename-input');
  const name = (el?.value || '').trim();
  if (!name) { showToast('Enter a name.'); return; }
  if (STATE.drills[id]) STATE.drills[id].name = name;
  if (id === STATE.activeDrillId) _drillFileName = name;
  orgCol('drills').doc(id).set({ name }, { merge: true }).catch(e => console.error(e));
  showDrillLibraryModal();
  if (_view === 'drill') { const r = document.getElementById('drill-view-root'); if (r) _drillViewRerender(); }
}

function drillDeletePrompt(id) {
  const d = STATE.drills[id];
  if (!d) return;
  showConfirmModal(
    'Delete drill?',
    `Remove “${esc(d.name || d.fileName || 'this drill')}” from the library? This can’t be undone. Position mapping is kept.`,
    () => drillDelete(id),
    'Delete', 'btn-danger'
  );
}

function drillDelete(id) {
  const wasActive = STATE.activeDrillId === id;
  orgCol('drills').doc(id).collection('data').doc('main').delete().catch(() => {});
  orgCol('drills').doc(id).delete().catch(() => {});
  delete STATE.drills[id];
  if (wasActive) {
    const next = _drillSortedIds()[0] || null;
    STATE.activeDrillId = next;
    orgCol('settings').doc('drill').set(
      { activeId: next || firebase.firestore.FieldValue.delete() }, { merge: true }
    ).catch(() => {});
    _drillSyncActive();
  }
  showDrillLibraryModal();
  if (_view === 'drill') render();
}
