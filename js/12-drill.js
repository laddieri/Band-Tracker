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


function openDrillPicker() {
  if (!STATE.isAdmin) return;
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
  // If we already have parsed drill data, show the pick modal directly
  if (_drillData) { showDrillPickModal(); return; }
  inp.click();
}

function _onDrillFileLoaded(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed   = _parsePywareFile(e.target.result);
      _drillPages    = parsed.pages;
      _drillData     = parsed.sections;
      _drillFileName = file.name;
      _drillFlipV    = false;
      orgCol('settings').doc('drill').set({
        drillFileName: file.name,
        drillSections: parsed.sections,
        drillPages:    parsed.pages,
        drillFlipV:    false,
      });
      showDrillPickModal();
    } catch (err) {
      showToast(err.message || 'Failed to read drill file.');
    }
  };
  reader.readAsArrayBuffer(file);
}

let _drillActiveSection = 0;
let _drillChecked = new Set(); // selected performer indices

// One performer row in the picker / mapping grid, keyed by drill label ("A1").
function _drillPerfRowHtml(perfLabel) {
  const mapping    = STATE.pywareMapping || {};
  const studentNum = mapping[perfLabel];
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
  const mapping  = STATE.pywareMapping || {};
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
        <button class="drill-reload-btn" onclick="drillLoadNewFile()">Replace file</button>
        ${_drillPages && _drillPages.length ? `<button class="drill-reload-btn" onclick="showDrillChartModal()">View field chart →</button>` : ''}
      </div>
    </div>
    <div class="modal-actions" style="margin-top:4px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="drill-apply-btn" onclick="applyDrillSelection()">Apply to Tracker</button>
    </div>
  `);
}

function drillLoadNewFile() {
  _drillData     = null;
  _drillPages    = null;
  _drillFileName = null;
  orgCol('settings').doc('drill').delete().catch(() => {});
  closeModal();
  setTimeout(() => {
    const inp = document.getElementById('drill-file-input');
    if (inp) inp.click();
    else openDrillPicker();
  }, 150);
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
  const mapping = STATE.pywareMapping || {};
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
  _drillCurrentSet = 0;
  openModal(`<div id="drill-chart-root">${_drillChartHtml()}</div>`);
}

function _drillChartHtml(fs = false) {
  const idx       = _drillCurrentSet;
  const positions = _drillPages[idx].performers;
  const total     = _drillPages.length;

  const navLabel     = `Set ${idx + 1} <span style="font-weight:400;color:var(--text-muted)">of ${total} · count ${_drillPages[idx].count}</span>`;
  const prevDisabled = idx <= 0;
  const nextDisabled = idx >= total - 1;

  // Field SVG: 100 yards = 160 steps wide × 84 steps deep.
  // Performer coords are already in steps: stepsX from the west goal line,
  // stepsY off the front sideline (top of the chart).
  const SCALE = 3.5; // px per step
  const FW = Math.round(160 * SCALE), FH = Math.round(84 * SCALE);
  const ML = 30, MR = 8, MT = 20, MB = 22;
  const SW = FW + ML + MR, SH = FH + MT + MB;
  const fx = s => (ML + s * SCALE).toFixed(1);
  // Front sideline at the bottom (stepsY = 0). The flip swaps front/back to
  // match Pyware's "facing" setting if a file was built the other way.
  const fy = s => (_drillFlipV ? (MT + s * SCALE) : (MT + FH - s * SCALE)).toFixed(1);

  // One color per section letter (consistent with the legend).
  const secColor = {};
  (_drillData || []).forEach((sec, i) => { secColor[sec.letter] = _DRILL_COLORS[i % _DRILL_COLORS.length]; });

  // Yard lines + numbers (top and bottom)
  let lines = '';
  for (let yd = 0; yd <= 100; yd += 5) {
    const sx = fx(yd * 1.6);
    const major = yd % 10 === 0;
    lines += `<line x1="${sx}" y1="${MT}" x2="${sx}" y2="${MT+FH}" stroke="${major?'#fff':'#5a5'}" stroke-width="${major?'0.8':'0.4'}"/>`;
    // Bottom tick mark on the sideline
    lines += `<line x1="${sx}" y1="${MT+FH}" x2="${sx}" y2="${(MT+FH+4).toFixed(1)}" stroke="${major?'#aaa':'#666'}" stroke-width="${major?'0.8':'0.5'}"/>`;
    if (major && yd > 0 && yd < 100) {
      const lbl = yd > 50 ? 100 - yd : yd;
      lines += `<text x="${sx}" y="${MT-4}" text-anchor="middle" fill="#aaa" font-size="8" font-family="sans-serif">${lbl}</text>`;
      lines += `<text x="${sx}" y="${(MT+FH+14).toFixed(1)}" text-anchor="middle" fill="#aaa" font-size="8" font-family="sans-serif">${lbl}</text>`;
    }
  }
  // Hash marks (high-school positions: 28 and 56 steps off the front sideline)
  for (const hs of [28, 56]) {
    const hy = fy(hs);
    for (let yd = 0; yd <= 100; yd += 5) {
      const sx = parseFloat(fx(yd * 1.6));
      lines += `<line x1="${(sx-3).toFixed(1)}" y1="${hy}" x2="${(sx+3).toFixed(1)}" y2="${hy}" stroke="#fff" stroke-width="0.5"/>`;
    }
  }

  // Performers
  let dots = '';
  for (const p of positions) {
    if (p.stepsX < -10 || p.stepsX > 170 || p.stepsY < -5 || p.stepsY > 90) continue; // safety
    const sx = fx(p.stepsX), sy = fy(p.stepsY);
    const col = secColor[p.section] || '#888';
    const sel = _drillChecked.has(p.label);
    dots += `<circle cx="${sx}" cy="${sy}" r="7" fill="transparent" onclick="drillChartToggle('${esc(p.label)}')" style="cursor:pointer"/>`;
    if (sel) dots += `<circle cx="${sx}" cy="${sy}" r="6" fill="none" stroke="#fff" stroke-width="1.5"/>`;
    dots += `<circle cx="${sx}" cy="${sy}" r="${sel?'4.5':'3'}" fill="${col}" pointer-events="none"/>`;
  }

  const legend = (_drillData || []).map((sec, i) => {
    const c = _DRILL_COLORS[i % _DRILL_COLORS.length];
    return `<span class="drill-chart-leg-item"><svg width="10" height="10" style="flex-shrink:0"><circle cx="5" cy="5" r="4" fill="${c}"/></svg>${esc(sec.letter)}</span>`;
  }).join('');

  const svgField = `
    <svg viewBox="0 0 ${SW} ${SH}" xmlns="http://www.w3.org/2000/svg" style="display:block;${fs ? 'width:100%;height:auto' : `width:${SW}px;max-width:100%`}">
      <rect x="${ML}" y="${MT}" width="${FW}" height="${FH}" fill="#1f5c1f"/>
      <rect x="${ML}" y="${MT}" width="${FW}" height="${FH}" fill="none" stroke="#fff" stroke-width="1.2"/>
      ${lines}${dots}
      <text x="${(ML-3)}" y="${fy(0)}" text-anchor="end" fill="#777" font-size="7" font-family="sans-serif" dominant-baseline="middle">F</text>
      <text x="${(ML-3)}" y="${fy(84)}" text-anchor="end" fill="#777" font-size="7" font-family="sans-serif" dominant-baseline="middle">B</text>
    </svg>`;

  const expandIcon = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9"/></svg>`;

  if (fs) {
    return `
      <div class="drill-fs-nav">
        <button class="btn btn-sm btn-secondary" onclick="drillChartNav(-1)"${prevDisabled?' disabled':''}>&#8592;</button>
        <span class="drill-chart-setlabel">${navLabel}</span>
        <button class="btn btn-sm btn-secondary" onclick="drillChartNav(1)"${nextDisabled?' disabled':''}>&#8594;</button>
        <button class="btn btn-sm btn-secondary" onclick="drillChartFlip()" title="Flip facing">⇅</button>
        <button class="btn btn-sm btn-secondary" onclick="drillChartCollapse()" title="Exit fullscreen" style="margin-left:4px">&#x2715;</button>
      </div>
      <div class="drill-fs-svg-wrap">${svgField}</div>
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
      <span style="font-size:.72rem;color:var(--text-muted)">Front sideline at ${_drillFlipV ? 'top' : 'bottom'}</span>
      <button class="btn btn-sm btn-secondary" onclick="drillChartFlip()">⇅ Flip facing</button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary" onclick="showDrillPickModal()">&#8592; List</button>
      <button class="btn btn-primary" onclick="applyDrillSelection()">Apply Selection</button>
    </div>`;
}

function _drillChartRefresh() {
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) {
    _drillZoomReset();
    fs.innerHTML = _drillChartHtml(true);
    _drillZoomSetup();
    return;
  }
  const root = document.getElementById('drill-chart-root');
  if (root) root.innerHTML = _drillChartHtml();
}

function drillChartExpand() {
  const fs = document.getElementById('drill-chart-fs');
  if (!fs) return;
  _drillZoomReset();
  fs.innerHTML = _drillChartHtml(true);
  fs.classList.remove('hidden');
  document.addEventListener('keydown', _drillChartFsKeydown);
  _drillZoomSetup();
}

function drillChartCollapse() {
  const fs = document.getElementById('drill-chart-fs');
  if (!fs || fs.classList.contains('hidden')) return;
  _drillZoomReset();
  fs.classList.add('hidden');
  document.removeEventListener('keydown', _drillChartFsKeydown);
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

function _drillZoomReset() {
  _drillZoomScale = 1.0;
  _drillPanX = 0;
  _drillPanY = 0;
}

function _drillZoomSetup() {
  const wrap = document.querySelector('.drill-fs-svg-wrap');
  if (!wrap) return;
  wrap.addEventListener('touchstart', _drillOnTouchStart, { passive: false });
  wrap.addEventListener('touchmove',  _drillOnTouchMove,  { passive: false });
  wrap.addEventListener('touchend',   _drillOnTouchEnd,   { passive: false });
}

function _drillApplyZoom(wrap) {
  const svg = (wrap || document.querySelector('.drill-fs-svg-wrap'))?.querySelector('svg');
  if (!svg) return;
  // Clamp pan so SVG always covers the wrap viewport.
  const wW = svg.parentElement.clientWidth;
  const wH = svg.parentElement.clientHeight;
  const sW = svg.clientWidth || wW;   // natural width at scale=1 ≈ wrap width
  const sH = svg.clientHeight || wH;
  const maxX = 0;
  const minX = Math.min(0, wW - sW * _drillZoomScale);
  const maxY = 0;
  const minY = Math.min(0, wH - sH * _drillZoomScale);
  _drillPanX = Math.max(minX, Math.min(maxX, _drillPanX));
  _drillPanY = Math.max(minY, Math.min(maxY, _drillPanY));
  svg.style.transformOrigin = '0 0';
  svg.style.transform = `translate(${_drillPanX}px,${_drillPanY}px) scale(${_drillZoomScale})`;
}

function _drillOnTouchStart(e) {
  e.preventDefault();
  const wrap = e.currentTarget;
  const rect = wrap.getBoundingClientRect();
  if (e.touches.length >= 2) {
    const t0 = e.touches[0], t1 = e.touches[1];
    _drillPinchInitDist     = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    _drillGestureStartScale = _drillZoomScale;
    _drillGestureStartPanX  = _drillPanX;
    _drillGestureStartPanY  = _drillPanY;
    _drillPinchCX = (t0.clientX + t1.clientX) / 2 - rect.left;
    _drillPinchCY = (t0.clientY + t1.clientY) / 2 - rect.top;
  } else {
    _drillPinchInitDist    = 0;
    _drillPanTouchX        = e.touches[0].clientX;
    _drillPanTouchY        = e.touches[0].clientY;
    _drillGestureStartPanX = _drillPanX;
    _drillGestureStartPanY = _drillPanY;
  }
}

function _drillOnTouchMove(e) {
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
    _drillPanX = _drillGestureStartPanX + (e.touches[0].clientX - _drillPanTouchX);
    _drillPanY = _drillGestureStartPanY + (e.touches[0].clientY - _drillPanTouchY);
    _drillApplyZoom(wrap);
  }
}

function _drillOnTouchEnd(e) {
  if (e.touches.length < 2) _drillPinchInitDist = 0;
  if (e.touches.length === 1) {
    // Finger lifted during/after pinch — restart single-touch from new position
    _drillPanTouchX        = e.touches[0].clientX;
    _drillPanTouchY        = e.touches[0].clientY;
    _drillGestureStartPanX = _drillPanX;
    _drillGestureStartPanY = _drillPanY;
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
  orgCol('settings').doc('drill').set({ drillFlipV: _drillFlipV }, { merge: true });
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

  const sec = sections[_drillMappingSection];
  const rows = sec.performers.map(label => {
    const currentNum = mapping[label] || '';
    return `
      <div class="drill-map-row">
        <div class="drill-map-pos">${esc(label)}</div>
        <select class="drill-map-select form-input" data-label="${esc(label)}"
          onchange="drillMappingChange('${esc(label)}', this.value)">
          ${studentOptions.replace(`value="${esc(currentNum)}"`, `value="${esc(currentNum)}" selected`)}
        </select>
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Drill Position Mapping</div>
    <p class="modal-sub" style="margin:0 0 10px">Link each drill position to a student in your roster. Saved automatically.</p>
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
