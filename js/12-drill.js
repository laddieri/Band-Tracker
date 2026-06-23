// Band Tracker — js/12-drill.js — Pyware drill parser, picker, field chart, mapping.
// Plain script sharing global scope; load order is set in index.html.

// ── Pyware 3D Drill Integration ───────────────────────────────────────────────
//
// .3dj performer record (20 bytes), reverse-engineered and verified exactly
// against two known drills (every set's yard lines and step depths matched):
//   byte 1      = stable performer id (follows a performer across all frames)
//   byte 6      = per-frame ordinal (re-assigned each frame — NOT an identity)
//   byte 8      = section/symbol letter, ASCII
//   bytes 13-14 = X, big-endian
//   bytes 15-16 = Y, big-endian
// The marching field occupies a FIXED rectangle in Pyware's internal grid,
// identical across files: 120 units = 1 step (192 = 1 yard); the west goal line
// is at X 23168, and the two sidelines are at Y 27728 and 37808 (84 steps
// apart). Pyware's "facing" setting decides which sideline is the front; we
// default to the high-Y sideline and offer a flip in the chart.
const _PY_WESTGOAL = 23168; // grid X at the west goal line
const _PY_FRONT_Y  = 37808; // grid Y at the (default) front sideline
const _PY_UNIT     = 120;   // grid units per marching step
const _PY_DEPTH    = 84;    // field depth in steps (front sideline to back)

function _parsePywareFile(buffer) {
  const u8   = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (u8[0]!==0x33||u8[1]!==0x44||u8[2]!==0x4A||u8[3]!==0x56)
    throw new Error('This does not look like a Pyware .3dj file.');

  // Determine the band's performer count. Each PAGE block tags its performer
  // count at byte 8 (big-endian u16); bands vary (we've seen 144 and 148), so
  // take the most common value across all PAGE tags — robust against any
  // coincidental 'PAGE' bytes in the data.
  let N = 0;
  {
    const tally = {};
    for (let i = 0; i < u8.length - 10; i++) {
      if (u8[i]!==0x50||u8[i+1]!==0x41||u8[i+2]!==0x47||u8[i+3]!==0x45) continue;
      const c = view.getUint16(i + 8, false);
      if (c >= 1 && c <= 2000) tally[c] = (tally[c] || 0) + 1;
    }
    let bestCount = 0;
    for (const k in tally) if (tally[k] > bestCount) { bestCount = tally[k]; N = +k; }
  }
  if (!N) throw new Error('No performer position data found in this file.');

  // Read every PAGE block (one frame of N records), keyed by the stable id.
  const rawFrames = [];
  let firstPage = -1;
  for (let i = 0; i < u8.length - 10; i++) {
    if (u8[i]!==0x50||u8[i+1]!==0x41||u8[i+2]!==0x47||u8[i+3]!==0x45) continue; // 'PAGE'
    if (view.getUint16(i + 8, false) !== N) continue;
    if (firstPage < 0) firstPage = i;
    const base0 = i + 10;
    if (base0 + N * 20 > u8.length) break;
    const frame = [];
    for (let e = 0; e < N; e++) {
      const b = base0 + e * 20;
      const xRaw = (u8[b + 13] << 8) | u8[b + 14];
      const yRaw = (u8[b + 15] << 8) | u8[b + 16];
      frame.push({
        pid:     u8[b + 1],
        section: String.fromCharCode(u8[b + 8]),
        stepsX: (xRaw - _PY_WESTGOAL) / _PY_UNIT, // steps from west goal (0..160)
        stepsY: (_PY_FRONT_Y - yRaw)  / _PY_UNIT, // steps off the front sideline (0..84)
      });
    }
    rawFrames.push(frame);
    i += 9 + N * 20; // skip past this block's records to the next tag
  }
  if (!rawFrames.length) throw new Error('No performer position data found in this file.');

  // Assign each performer a fixed drill label from the FIRST frame — section
  // letter + front-to-back rank within that section (so "A1" is the front-most
  // of column A, matching Pyware) — and bind it to the stable id so a label
  // always means the same physical performer across every set.
  const labelOf = {}, sectionOf = {};
  const bySec = {};
  rawFrames[0].forEach(p => { (bySec[p.section] = bySec[p.section] || []).push(p); });
  Object.values(bySec).forEach(arr => {
    arr.sort((a, b) => a.stepsY - b.stepsY).forEach((p, idx) => {
      labelOf[p.pid] = p.section + (idx + 1);
      sectionOf[p.pid] = p.section;
    });
  });

  const allFrames = rawFrames.map(f => f.map(p => ({
    label:   labelOf[p.pid]   || p.section,
    section: sectionOf[p.pid] || p.section,
    stepsX:  p.stepsX,
    stepsY:  p.stepsY,
  })));

  // Collapse consecutive identical formations (holds / duplicate layers) so the
  // Read Pyware's marked-set table, which sits immediately before the PAGE
  // blocks: a run of 18-byte records (count as big-endian u16 at bytes 0-1,
  // byte 14 = 0x01), set 1 (count 0) first. We walk backward from the first
  // PAGE block, which is exactly where the table ends.
  let setCounts = [];
  {
    let off = firstPage - 18, prev = Infinity;
    while (off >= 0) {
      const c = view.getUint16(off, false);
      if (c >= prev || u8[off + 14] !== 0x01) break;
      setCounts.unshift(c);
      prev = c;
      if (c === 0) break;
      off -= 18;
    }
  }
  // Fallback: if the table isn't found, detect sets geometrically — Pyware
  // moves performers in straight lines between sets, so a set is a count where
  // many performers' motion bends. (Misses sets the form marches straight
  // through, so it's only a fallback.)
  if (setCounts.length < 2 || setCounts[0] !== 0) {
    const maps = allFrames.map(f => { const m = {}; f.forEach(p => m[p.label] = p); return m; });
    setCounts = [0];
    for (let i = 1; i < allFrames.length - 1; i++) {
      let bends = 0;
      for (const lbl in maps[i]) {
        const a = maps[i-1][lbl], b = maps[i][lbl], c = maps[i+1][lbl];
        if (!a || !c) continue;
        if (Math.abs(b.stepsX - (a.stepsX + c.stepsX)/2) > 0.02 ||
            Math.abs(b.stepsY - (a.stepsY + c.stepsY)/2) > 0.02) bends++;
      }
      if (bends >= Math.max(8, Math.round(N * 0.1)) && i - setCounts[setCounts.length-1] > 2) setCounts.push(i);
    }
  }

  // Each page = a marked set (its count + the formation at that count).
  const pages = setCounts.filter(c => allFrames[c]).map(c => ({ count: c, performers: allFrames[c] }));
  if (!pages.length) pages.push({ count: 0, performers: allFrames[0] });

  // Sections (A,B,…) with their performer labels (A1,A2,…A10 in order).
  const labelNum = lbl => parseInt(lbl.replace(/^\D+/, ''), 10) || 0;
  const secMap = {};
  pages[0].performers.forEach(p => { (secMap[p.section] = secMap[p.section] || []).push(p.label); });
  const sections = Object.keys(secMap).sort().map(letter => ({
    letter,
    performers: secMap[letter].sort((a, b) => labelNum(a) - labelNum(b)),
  }));

  return { pages, sections };
}


// Tracks which drill's heavy position payload is currently in _drillData/_drillPages.
let _activeDrillLoadedId = null;

function _drillFileInput() {
  let inp = document.getElementById('drill-file-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id   = 'drill-file-input';
    inp.accept = '.3dj';
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
  if (!STATE.isAdmin) return;
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
        name:           file.name.replace(/\.3dj$/i, ''),
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
      showToast(err.message || 'Failed to read drill file.');
    }
  };
  reader.readAsArrayBuffer(file);
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

// Effective label → student-number map (position match + explicit overrides).
function drillLabelMap() {
  return { ..._drillPosIndex(), ...(STATE.pywareMapping || {}) };
}

function drillStudentByLabel(label) {
  const m = STATE.pywareMapping || {};
  if (m[label]) return m[label];
  return _drillPosIndex()[(label || '').toUpperCase()] || null;
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
  const mapping  = drillLabelMap();
  const unmappedCount = sections.flatMap(s => s.performers).filter(lbl => !mapping[lbl]).length;

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
  const mapping = drillLabelMap();
  const unmapped = [];
  const studentNums = [];
  for (const label of _drillChecked) {
    const num = mapping[label];
    if (num && STATE.students[num]) studentNums.push(num);
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
  const mapping = labelMode === 2 ? drillLabelMap() : {};
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
      if (labelMode === 2) {
        const num = mapping[p.label];
        const st  = num ? STATE.students[num] : null;
        txt = st ? (st.name ? st.name.split(/\s+/)[0] : `#${num}`) : p.label;
      }
      labels += `<text x="${sx}" y="${(parseFloat(sy)-5).toFixed(1)}" text-anchor="middle" fill="${P.lblFill}" font-size="4.6" font-family="sans-serif" pointer-events="none" style="paint-order:stroke;stroke:${P.lblStroke};stroke-width:0.7px;stroke-linejoin:round">${esc(txt)}</text>`;
    }
  }

  return `
    <svg viewBox="0 0 ${SW} ${SH}" xmlns="http://www.w3.org/2000/svg" style="display:block;${fs ? 'width:100%;height:auto' : `width:${SW}px;max-width:100%`}">
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
  if (!_drillData) return;
  _drillMappingSection = 0;
  _renderDrillMappingModal();
}

function _renderDrillMappingModal() {
  if (!STATE.isAdmin) return;
  const sections = _drillData;
  const mapping  = STATE.pywareMapping || {};
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
    // Pre-select the effective student: explicit override, else block-spot match.
    const currentNum = mapping[label] || posIdx[label.toUpperCase()] || '';
    const auto = !mapping[label] && posIdx[label.toUpperCase()];
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
    <div class="modal-title">Drill Position Mapping</div>
    <p class="modal-sub" style="margin:0 0 10px">Positions are matched to students by their block spot (column&nbsp;+&nbsp;row) automatically — "auto" rows need no setup. Override any that differ. Saved automatically.</p>
    <div class="drill-tabs">${renderSectionTabs()}</div>
    <div class="drill-map-list" id="drill-map-list">${rows}</div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="showDrillPickModal()">← Back to Selection</button>
    </div>
  `);
}

function drillMappingSetSection(idx) {
  _drillMappingSection = idx;
  _renderDrillMappingModal();
}

function drillMappingChange(label, studentNum) {
  const mapping = { ...STATE.pywareMapping };
  if (studentNum) mapping[label] = studentNum;
  else delete mapping[label];
  STATE.pywareMapping = mapping;
  orgCol('settings').doc('presets').set({ pywareMapping: mapping }, { merge: true });
}

// ── Standalone Field Chart viewer (Drill tab) ─────────────────────────────────
// A top-level, read-only chart: step through sets, jump to any set, toggle dot
// labels, tap a performer for their Pyware-style coordinate, and search to trace
// one performer's path across every set.

function viewDrill() {
  if (!STATE.isAdmin) return `<div class="empty-state"><p>Directors only.</p></div>`;
  if (!_drillData || !_drillPages || !_drillPages.length) {
    return `
      <div class="empty-state" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px">
        <div class="empty-icon">🚩</div>
        <p>${Object.keys(STATE.drills || {}).length ? 'No drill selected.' : 'No drill loaded yet.'}</p>
        <p style="color:var(--text-muted);max-width:300px;margin:6px auto 0">
          Upload a Pyware <strong>.3dj</strong> file to view your field chart, step through sets,
          label dots, and trace a performer's path.
        </p>
        ${Object.keys(STATE.drills || {}).length
          ? `<button class="btn btn-primary" style="margin-top:14px" onclick="showDrillLibraryModal()">Open Drill Library</button>`
          : `<button class="btn btn-primary" style="margin-top:14px" onclick="drillAddFile()">Load Drill File</button>`}
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
      <button class="btn btn-sm btn-secondary" onclick="drillViewExpand()" title="Hide header &amp; tabs">⤢</button>
    </div>

    ${_drillSelStatusHtml()}

    <div class="drill-view-strip">
      <button class="drill-nav-arrow" onclick="drillViewNav(-1)"${idx<=0?' disabled':''} aria-label="Previous set">&#8592;</button>
      <div class="drill-set-strip" id="drill-set-strip">${_drillSetStripHtml()}</div>
      <button class="drill-nav-arrow" onclick="drillViewNav(1)"${idx>=total-1?' disabled':''} aria-label="Next set">&#8594;</button>
    </div>

    <div class="drill-fs-svg-wrap drill-view-stage" id="drill-stage">${_drillStageInner()}</div>

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
  const num = drillStudentByLabel(label);
  const st  = num ? STATE.students[num] : null;
  const co  = _drillCoord(p.stepsX, p.stepsY);
  const meta = [`Section ${esc(p.section)}`, st && st.instrument ? esc(normInstrument(st.instrument)) : '']
    .filter(Boolean).join(' · ') + (st ? '' : ' · <em>not mapped</em>');

  // Quick positive/mistake marks for the mapped student in the open rehearsal.
  let marks = '';
  const reh = (typeof getActiveRehearsal === 'function') ? getActiveRehearsal() : null;
  if (st && num && reh) {
    const ent = (STATE.entries[reh.id] || {})[num] || {};
    const pos = ent.positives || 0, mis = ent.mistakes || 0;
    const rehName = reh.label || (typeof fmtDate === 'function' ? fmtDate(reh.date) : '') || 'rehearsal';
    marks = `
      <div class="drill-info-marks-label">Add to ${esc(rehName)}:</div>
      <div class="drill-info-marks">
        <button class="btn drill-mark-btn drill-mark-pos" onclick="drillQuickMark('${esc(num)}','positive')">✓ Positive${pos ? ` <span class="drill-mark-ct">${pos}</span>` : ''}</button>
        <button class="btn drill-mark-btn drill-mark-neg" onclick="drillQuickMark('${esc(num)}','mistake')">✗ Mistake${mis ? ` <span class="drill-mark-ct">${mis}</span>` : ''}</button>
      </div>`;
  }

  return `
    <div class="drill-info-pop">
      <button class="drill-info-pop-x" onclick="drillCloseInfo()" aria-label="Close">✕</button>
      <div class="drill-info-pop-name">${esc(label)}${st ? ` · ${esc(st.name || `#${num}`)}` : ''}</div>
      <div class="drill-info-pop-meta">${meta}</div>
      <div class="drill-info-pop-coord">${esc(co.lr)}<br>${esc(co.fb)}</div>
      ${marks}
      <div class="drill-info-pop-actions">
        <button class="btn btn-sm ${_drillTraceLabel === label ? 'btn-secondary' : 'btn-primary'}" onclick="drillTracePerformer('${esc(label)}')">${_drillTraceLabel === label ? 'Tracing ✓' : 'Trace path'}</button>
        ${st ? `<button class="btn btn-sm btn-secondary" onclick="navigate('student',{num:'${esc(num)}'})">Profile</button>` : ''}
      </div>
    </div>`;
}

// Add a quick mark to the selected performer's student in the open rehearsal.
function drillQuickMark(num, type) {
  if (!STATE.isAdmin) return;
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
      <button class="btn btn-sm btn-secondary" onclick="drillChartCollapse()" title="Exit fullscreen" style="margin-left:4px">&#x2715;</button>
    </div>
    <div class="drill-fs-svg-wrap">${svgField}<div class="drill-fs-axis"></div></div>
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
  _drillViewRenderSvg();
}

function drillCloseInfo() {
  _drillSelLabel = null;
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
  const mapping = drillLabelMap();
  for (const p of perfs) {
    const num = mapping[p.label];
    if (!num) continue;
    if (String(num) === q) return p.label;
    const st = STATE.students[num];
    if (st && (st.name || '').toLowerCase().includes(q)) return p.label;
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
  if (!STATE.isAdmin) return;
  const has   = !!(_drillData && _drillPages && _drillPages.length);
  const count = Object.keys(STATE.drills || {}).length;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Field Chart Options</div>
    <div class="options-menu">
      <button class="options-menu-item" onclick="closeModal();showDrillLibraryModal()">
        <div class="options-menu-icon">📚</div>
        <div><div class="options-menu-label">Drill Library</div><div class="options-menu-sub">${count ? `${count} drill${count!==1?'s':''} · switch, add or remove` : 'Add your first drill file'}</div></div>
      </button>
      ${has ? `
      <button class="options-menu-item" onclick="closeModal();showDrillMappingModal()">
        <div class="options-menu-icon">🔗</div>
        <div><div class="options-menu-label">Position Mapping</div><div class="options-menu-sub">Link drill spots to students</div></div>
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
  if (!STATE.isAdmin) return;
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
        <button class="drill-lib-act" onclick="drillRenamePrompt('${esc(id)}')" title="Rename" aria-label="Rename">✎</button>
        <button class="drill-lib-act drill-lib-act--danger" onclick="drillDeletePrompt('${esc(id)}')" title="Delete" aria-label="Delete">🗑</button>
      </div>`;
  }).join('');
  openModal(`
    <div id="drill-library-modal">
      <div class="modal-handle"></div>
      <div class="modal-title">Drill Library</div>
      <p class="modal-sub" style="margin:0 0 10px">Tap a drill to make it the active field chart for your whole director team.</p>
      ${ids.length ? `<div class="drill-lib-list">${rows}</div>` : `<p style="color:var(--text-muted);text-align:center;padding:20px 0">No drills saved yet.</p>`}
      <button class="btn btn-secondary btn-full" style="margin-top:12px" onclick="drillAddFile()">＋ Add drill file</button>
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
