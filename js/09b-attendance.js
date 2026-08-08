// Band Tracker — js/09b-attendance.js — Attendance tab, attendance screen, take-attendance-by-block.
// Plain script sharing global scope; load order is set in index.html.
// Split out of 09-rehearsal.js along the attendance/marks seam; cross-file
// calls (rehearsalStudents, _applyAttendance ↔ setAttendance, reRender) are
// fine because they only run inside functions.

// ── View: Attendance Tab ──────────────────────────────────────────────────────

// Shared sort options for both attendance-tab filter bars
const _ATT_TAB_SORT_OPTS = [
  { value: 'absences',   label: 'Most Absent' },
  { value: 'lates',      label: 'Most Late'   },
  { value: 'name',       label: 'Name'        },
  { value: 'instrument', label: 'Instrument'  },
  { value: 'grade',      label: 'Grade'       },
];

function _buildRecentListHtml() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b) => b.date.localeCompare(a.date));
  if (!rehearsals.length) return '';
  const latest = rehearsals[0];
  if (!latest.attendanceSubmitted) {
    return `<div class="empty-state" style="padding:12px 0 4px"><p>Attendance not submitted yet.</p></div>`;
  }
  const students      = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  const latestEntries = STATE.entries[latest.id] || {};
  const filterSub     = list => filterAndSortStudents(list, { ..._attTabFilter, sortField: 'name', sortDir: 'asc' }, {});
  const absent  = students.filter(s => latestEntries[s.number]?.attendance === 'absent');
  const late    = students.filter(s => latestEntries[s.number]?.attendance === 'late');
  const present = students.filter(s => latestEntries[s.number]?.attendance !== 'absent' && latestEntries[s.number]?.attendance !== 'late');
  const hasF = _attTabFilter.search || _attTabFilter.instruments.length || _attTabFilter.grades.length || _attTabFilter.sections.length;
  const stuMiniRow = s => {
    const meta = [_studentSpotText(s), normInstrument(s.instrument)].filter(Boolean).join(' · ');
    return `<div class="att-summary-stu-row" onclick="navigate('student',{num:'${esc(s.number)}'})" style="cursor:pointer">
      <span class="att-stu-name att-stu-link">${esc(s.name || `#${s.number}`)}</span>
      ${meta ? `<div class="att-stu-meta">${esc(meta)}</div>` : ''}
    </div>`;
  };
  const stuGroup = (label, list, cls) => list.length ? `
    <div class="att-summary-section-hdr ${cls}">${label} — ${list.length} student${list.length !== 1 ? 's' : ''}</div>
    <div class="att-summary-list">${list.map(stuMiniRow).join('')}</div>` : '';
  if (_attTabRecentStatus === 'absent') {
    const f = filterSub(absent);
    return f.length ? stuGroup('Absent', f, 'att-summary-hdr-absent')
      : `<div class="empty-state" style="padding:12px 0 4px"><p>${hasF ? 'No matches.' : 'No absent students.'}</p></div>`;
  }
  if (_attTabRecentStatus === 'late') {
    const f = filterSub(late);
    return f.length ? stuGroup('Late', f, 'att-summary-hdr-late')
      : `<div class="empty-state" style="padding:12px 0 4px"><p>${hasF ? 'No matches.' : 'No late students.'}</p></div>`;
  }
  if (_attTabRecentStatus === 'present') {
    const f = filterSub(present);
    return f.length ? `<div class="att-summary-list">${f.map(stuMiniRow).join('')}</div>`
      : `<div class="empty-state" style="padding:12px 0 4px"><p>${hasF ? 'No matches.' : 'No students were marked present.'}</p></div>`;
  }
  // Default: absent + late
  const fA = filterSub(absent), fL = filterSub(late);
  if (!fA.length && !fL.length) {
    return `<div class="empty-state" style="padding:12px 0 4px"><p>${hasF ? 'No matches for current filter.' : 'Everyone was present!'}</p></div>`;
  }
  return stuGroup('Absent', fA, 'att-summary-hdr-absent') + stuGroup('Late', fL, 'att-summary-hdr-late');
}

function _buildSeasonListHtml() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b) => b.date.localeCompare(a.date));
  const students   = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  const submitted  = rehearsals.filter(r => r.attendanceSubmitted);
  if (!submitted.length) {
    return `<div class="empty-state" style="padding:12px 0"><p>No submitted events yet.</p></div>`;
  }
  const seasonMap = {};
  for (const r of submitted) {
    const entries = STATE.entries[r.id] || {};
    for (const s of students) {
      const att = entries[s.number]?.attendance;
      if (att === 'absent' || att === 'late') {
        if (!seasonMap[s.number]) seasonMap[s.number] = { s, absences: 0, lates: 0 };
        if (att === 'absent') seasonMap[s.number].absences++;
        else                  seasonMap[s.number].lates++;
      }
    }
  }
  const seasonScoreMap = {};
  for (const [num, d] of Object.entries(seasonMap)) seasonScoreMap[num] = { absences: d.absences, lates: d.lates };
  const seasonStudents = Object.values(seasonMap).map(d => d.s);
  const filtered       = filterAndSortStudents(seasonStudents, _attTabFilter, seasonScoreMap);
  if (!filtered.length) {
    return `<div class="empty-state" style="padding:12px 0"><p>${seasonStudents.length ? 'No matches for current filter.' : 'Perfect attendance so far!'}</p></div>`;
  }
  return filtered.map(s => {
    const { absences, lates } = seasonMap[s.number];
    const meta = [_studentSpotText(s), normInstrument(s.instrument)].filter(Boolean).join(' · ');
    return `<div class="att-season-row" onclick="navigate('student',{num:'${esc(s.number)}'})" style="cursor:pointer">
      <div class="att-stu-info">
        <span class="att-stu-name att-stu-link">${esc(s.name || `#${s.number}`)}</span>
        ${meta ? `<div class="att-stu-meta">${esc(meta)}</div>` : ''}
      </div>
      <div class="att-season-chips">
        ${absences ? `<span class="att-summary-chip att-chip-absent">${absences} absent</span>` : ''}
        ${lates    ? `<span class="att-summary-chip att-chip-late">${lates} late</span>`        : ''}
      </div>
    </div>`;
  }).join('');
}

function _attTabFilteredContent() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b) => b.date.localeCompare(a.date));
  const students   = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  if (!rehearsals.length) return '';

  const latest          = rehearsals[0];
  const latestEntries   = STATE.entries[latest.id] || {};
  const latestAbsent    = students.filter(s => latestEntries[s.number]?.attendance === 'absent');
  const latestLate      = students.filter(s => latestEntries[s.number]?.attendance === 'late');
  const latestTotal     = latest.scope ? rehearsalStudents(latest).length : students.length;
  const latestPresent   = latestTotal - latestAbsent.length - latestLate.length;
  const latestSubmitted = !!latest.attendanceSubmitted;
  const openReh         = canRecord() ? getActiveRehearsal() : null;
  const latestIsOpenAndUnsub = openReh && latest.id === openReh.id && !latestSubmitted;

  const tabFilterBar = renderFilterBar('att-tab', _attTabFilter, _ATT_TAB_SORT_OPTS);

  const recentChip = (status, count, label, cls) => {
    const active = _attTabRecentStatus === status;
    return `<button class="att-summary-chip ${cls} att-chip-btn${active ? ' att-chip-btn-active' : ''}"
      onclick="setAttTabRecentStatus('${status}')">${count} ${label}</button>`;
  };

  const recentSection = `
    <div class="sec-card">
    <div id="att-tab-recent-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-recent')">
      <span class="section-title" style="margin:0">Most Recent — ${esc(fmtDate(latest.date))}${latest.label ? ' · ' + esc(latest.label) : ''}</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-recent">
      ${latestSubmitted ? `
        <div class="att-screen-summary-bar" style="padding:8px 0 10px">
          ${recentChip('absent',  latestAbsent.length, 'Absent',  'att-chip-absent')}
          ${recentChip('late',    latestLate.length,   'Late',    'att-chip-late')}
          ${recentChip('present', latestPresent,       'Present', 'att-chip-present')}
        </div>
        ${tabFilterBar}` : ''}
      <div id="att-tab-recent-list">${_buildRecentListHtml()}</div>
      ${!latestIsOpenAndUnsub ? `
      <button class="btn btn-secondary" style="width:100%;margin:12px 0 4px"
              onclick="navigate('attendance',{rid:'${esc(latest.id)}',from:'attendance-tab'})">
        View Full Attendance
      </button>` : ''}
    </div>
    </div>`;

  const seasonSection = `
    <div class="sec-card">
    <div id="att-tab-season-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-season')">
      <span class="section-title" style="margin:0">Season Absences</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-season">
      ${tabFilterBar}
      <div id="att-tab-season-list">${_buildSeasonListHtml()}</div>
    </div>
    </div>`;

  return recentSection + seasonSection;
}

function setAttTabRecentStatus(status) {
  _attTabRecentStatus = _attTabRecentStatus === status ? '' : status;
  const el = document.getElementById('att-tab-filtered');
  if (el) el.innerHTML = _attTabFilteredContent();
  else _rerenderForFilter('att-tab');
}

// The interactive "Attendance Over Time" chart. The last-computed geometry +
// data are stashed here so the scrub handler (attChartScrub) can map a tap to a
// rehearsal and redraw the cursor/readout without recomputing from the DB or
// re-rendering the whole tab. _attChartSel is the point the readout is pinned to;
// _attChartScale is the visible window (week / month / season).
let _attChartModel = null;
let _attChartSel   = null;
let _attChartScale = 'season';

// Submitted rehearsals (with a date) in the active season, oldest → newest. Same
// ordering as everywhere else — by date, then start time, then id — so same-day
// rehearsals plot in the order they actually happened (compareRehearsalsDesc
// reversed gives ascending).
function _attChartRehearsals() {
  return [...DB.getRehearsals()]
    .filter(r => r.attendanceSubmitted && r.date)
    .sort((a, b) => compareRehearsalsDesc(b, a));
}

// Narrow an ascending rehearsal list to the visible time scale. Week/month are
// windows measured back from the most recent rehearsal (not "today"), so the
// chart always shows data even when viewing a season that has wrapped up.
function _attChartWindow(list, scale) {
  if (scale === 'season' || list.length < 2) return list;
  const toDays = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const anchor = toDays(list[list.length - 1].date);
  const cutoff = anchor - (scale === 'week' ? 6 : 30); // inclusive window
  return list.filter(r => toDays(r.date) >= cutoff);
}

function _renderAttendanceChart() {
  const total = Object.keys(DB.getStudents()).length;
  const all   = _attChartRehearsals();
  if (all.length < 2 || total === 0) { _attChartModel = null; return ''; }

  return `
    <div class="sec-card">
    <div id="att-tab-chart-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-chart')">
      <span class="section-title" style="margin:0">Attendance Over Time</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-chart">${_attChartCardHtml()}</div>
    </div>`;
}

// The week/month/season segmented control.
function _attChartScaleToggle() {
  return `<div class="att-scale-group">` +
    [['week', 'Week'], ['month', 'Month'], ['season', 'Season']].map(([v, label]) =>
      `<button class="att-scale-btn${_attChartScale === v ? ' att-scale-btn--on' : ''}" onclick="attChartSetScale('${v}')">${label}</button>`
    ).join('') + `</div>`;
}

// The chart card for the current scale — rebuilt in place when the scale changes,
// so it re-reads the DB and re-fits the axes but leaves the rest of the tab alone.
function _attChartCardHtml() {
  const pts = _attChartWindow(_attChartRehearsals(), _attChartScale).map(r => {
    const entries = STATE.entries[r.id] || {};
    const absent = Object.values(entries).filter(e => e.attendance === 'absent').length;
    const late   = Object.values(entries).filter(e => e.attendance === 'late').length;
    const [, m, d] = r.date.split('-').map(Number);
    // Axis labels must stay short ("8/4") or they collide once a range fills up;
    // fmtDate's long form is kept for the readout.
    return { id: r.id, label: `${m}/${d}`, full: fmtDate(r.date), absent, late };
  });

  const toggle = _attChartScaleToggle();
  if (pts.length < 2) {
    _attChartModel = null;
    return `<div class="att-chart-card card mb-12">${toggle}
      <div class="att-chart-empty">Not enough events in this range yet.</div></div>`;
  }

  const W = 360, H = 160, PL = 32, PR = 10, PT = 12, PB = 32;
  const iW = W - PL - PR, iH = H - PT - PB;
  const maxVal = Math.max(...pts.map(p => p.absent), ...pts.map(p => p.late), 1);
  const tickStep = maxVal <= 5 ? 1 : maxVal <= 10 ? 2 : maxVal <= 25 ? 5 : 10;
  const maxY = Math.ceil(maxVal / tickStep) * tickStep;
  const ticks = [];
  for (let v = 0; v <= maxY; v += tickStep) ticks.push(v);

  const xStep = iW / (pts.length - 1);
  const toX = i => PL + i * xStep;
  const toY = v => PT + iH - (v / maxY) * iH;

  // Stash everything the scrub handler needs to redraw the cursor + readout.
  _attChartModel = { pts, W, H, PL, PR, PT, iW, iH, maxY, xStep, toX, toY };
  // Keep the pinned point valid across re-renders; default to the most recent.
  if (_attChartSel == null || _attChartSel >= pts.length) _attChartSel = pts.length - 1;

  const gridLines = ticks.map(v => {
    const y = toY(v);
    return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--border)" stroke-width="1"/>
            <text x="${PL-4}" y="${y+4}" text-anchor="end" font-size="9" fill="var(--text-muted)">${v}</text>`;
  }).join('');

  // Dots crowd into a solid band once a range fills up — shrink them so the
  // trend line stays readable.
  const dotR = pts.length > 16 ? 2 : pts.length > 10 ? 2.5 : 3;

  const makePolyline = (color, key) => {
    const points = pts.map((p, i) => `${toX(i).toFixed(1)},${toY(p[key]).toFixed(1)}`).join(' ');
    const dots = pts.map((p, i) =>
      `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p[key]).toFixed(1)}" r="${dotR}" fill="${color}"/>`
    ).join('');
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` + dots;
  };

  // Show every Nth date, where N is whatever keeps ~32 viewBox units between
  // labels (about the width of "12/14" at font-size 9, plus a gap). Stepping
  // back from the last point guarantees the most recent rehearsal is labelled.
  const labelStep = Math.max(1, Math.ceil(32 / xStep));
  const last      = pts.length - 1;
  const xLabels = pts.map((p, i) => {
    const stepped = (last - i) % labelStep === 0;
    // The first point is always worth labelling, but skip it when a stepped
    // label lands close enough to overlap it.
    const isFirst = i === 0 && (last % labelStep) * xStep >= 32;
    if (!stepped && !isFirst) return '';
    // Anchor the end labels inward so they don't spill out of the card.
    const anchor = i === 0 ? 'start' : i === last ? 'end' : 'middle';
    return `<text x="${toX(i).toFixed(1)}" y="${H-4}" text-anchor="${anchor}" font-size="9" fill="var(--text-muted)">${p.label}</text>`;
  }).join('');

  // Full-plot pointer target for scrub/tap. touch-action:pan-y lets a vertical
  // swipe still scroll the page while a tap or horizontal drag reads the chart.
  const hit = `<rect x="${PL}" y="${PT}" width="${iW}" height="${iH}" fill="transparent"
      style="cursor:crosshair;touch-action:pan-y"
      onpointerdown="attChartScrub(event)" onpointermove="attChartScrub(event)"></rect>`;

  return `
    <div class="att-chart-card card mb-12">
      ${toggle}
      <div class="att-chart-readout" id="att-chart-readout">${_attChartReadoutInner(_attChartSel)}</div>
      <svg id="att-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
        ${gridLines}
        ${makePolyline('var(--danger)',  'absent')}
        ${makePolyline('var(--warning)', 'late')}
        ${xLabels}
        <g id="att-chart-cursor">${_attChartCursor(_attChartSel)}</g>
        ${hit}
      </svg>
      <div class="att-chart-legend">
        <span class="att-chart-legend-item"><span class="att-chart-dot" style="background:var(--danger)"></span>Absent</span>
        <span class="att-chart-legend-item"><span class="att-chart-dot" style="background:var(--warning)"></span>Late</span>
      </div>
    </div>`;
}

// Switch the visible time scale and rebuild just the chart card (re-anchoring the
// readout to the most recent point in the new range). Collapse state lives on the
// #att-tab-chart wrapper, so replacing its contents leaves it intact.
function attChartSetScale(scale) {
  if (scale === _attChartScale) return;
  _attChartScale = scale;
  _attChartSel   = null;
  const el = document.getElementById('att-tab-chart');
  if (el) el.innerHTML = _attChartCardHtml();
}

// Crosshair + emphasised dots for the pinned point (drawn under the hit rect so
// taps still land). Empty when there's no model or selection.
function _attChartCursor(idx) {
  const m = _attChartModel;
  if (!m || idx == null || idx < 0 || idx >= m.pts.length) return '';
  const p = m.pts[idx];
  const x = m.toX(idx).toFixed(1);
  const ya = m.toY(p.absent).toFixed(1), yl = m.toY(p.late).toFixed(1);
  return `<line x1="${x}" y1="${m.PT}" x2="${x}" y2="${m.PT + m.iH}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>`
    + `<circle cx="${x}" cy="${ya}" r="4.5" fill="var(--danger)" stroke="var(--surface, #fff)" stroke-width="1.5"/>`
    + `<circle cx="${x}" cy="${yl}" r="4.5" fill="var(--warning)" stroke="var(--surface, #fff)" stroke-width="1.5"/>`;
}

// The live readout above the chart: which rehearsal is pinned, its absent/late
// counts, and a jump to that rehearsal.
function _attChartReadoutInner(idx) {
  const m = _attChartModel;
  if (!m || idx == null || idx < 0 || idx >= m.pts.length) return '';
  const p = m.pts[idx];
  return `<span class="att-chart-ro-date">${esc(p.full)}</span>`
    + `<span class="att-chart-ro-stat att-chart-ro-abs">${p.absent} absent</span>`
    + `<span class="att-chart-ro-stat att-chart-ro-late">${p.late} late</span>`
    + `<button class="att-chart-ro-view" onclick="navigate('attendance',{rid:'${esc(p.id)}',from:'attendance-tab'})">View →</button>`;
}

// Map a pointer position to the nearest rehearsal and repaint the cursor +
// readout in place (no full re-render, so the tab doesn't jump or lose scroll).
function attChartScrub(e) {
  const m = _attChartModel;
  if (!m) return;
  const svg = document.getElementById('att-chart-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width) return;
  // Keep a drag scrubbing even after the finger leaves the plot rect.
  if (e.type === 'pointerdown' && e.target.setPointerCapture) {
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  }
  const vx  = (e.clientX - rect.left) / rect.width * m.W; // viewBox x
  let idx   = Math.round((vx - m.PL) / m.xStep);
  idx = Math.max(0, Math.min(m.pts.length - 1, idx));
  if (idx === _attChartSel) return;
  _attChartSel = idx;
  const g = document.getElementById('att-chart-cursor');
  if (g) g.innerHTML = _attChartCursor(idx);
  const r = document.getElementById('att-chart-readout');
  if (r) r.innerHTML = _attChartReadoutInner(idx);
}

function viewAttendanceTab() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b) => b.date.localeCompare(a.date));
  const students   = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));

  if (!rehearsals.length) {
    return `<div class="empty-state"><p>No events yet.</p></div>`;
  }

  // ── Open-rehearsal attendance CTA ─────────────────────────────────────────

  const openReh = canRecord() ? getActiveRehearsal() : null;
  let attendanceCta = '';
  if (openReh) {
    if (!openReh.attendanceSubmitted) {
      attendanceCta = `<button class="start-rehearsal-btn"
        onclick="navigate('attendance',{rid:'${esc(openReh.id)}',from:'attendance-tab'})">
        📋 Take Attendance — ${esc(fmtDate(openReh.date))}${openReh.label ? ' · ' + esc(openReh.label) : ''}
      </button>`;
    } else {
      attendanceCta = `<button class="start-rehearsal-btn att-modify-att-btn"
        onclick="confirmModifyAttendance('${esc(openReh.id)}')">
        ✏️ Modify Current Event Attendance
      </button>`;
    }
  }

  // ── Rehearsal History (not affected by filter) ────────────────────────────

  const historyRows = rehearsals.map(r => {
    const entries = STATE.entries[r.id] || {};
    const total   = r.scope ? rehearsalStudents(r).length : students.length;
    const absent  = Object.values(entries).filter(e => e.attendance === 'absent').length;
    const late    = Object.values(entries).filter(e => e.attendance === 'late').length;
    const present = total - absent - late;
    const attDone = !!r.attendanceSubmitted;
    const summary = total
      ? [absent ? `${absent} absent` : '', late ? `${late} late` : '', `${present} present`].filter(Boolean).join(' · ')
      : 'No students in roster';
    return `
      <div class="card clickable att-tab-row" onclick="navigate('attendance',{rid:'${esc(r.id)}',from:'attendance-tab'})">
        <div class="att-tab-row-top">
          <div>
            <div class="font-bold">${fmtDate(r.date)}</div>
            ${r.label ? `<div class="text-muted text-sm mt-4">${esc(r.label)}</div>` : ''}
            ${r.scope ? `<div class="text-muted text-sm mt-4">👥 ${esc(rehearsalScopeLabel(r.scope))}</div>` : ''}
          </div>
          ${attDone
            ? `<span class="rh-badge rh-badge-att">Submitted ✓</span>`
            : `<span class="rh-badge rh-badge-open">Not submitted</span>`}
        </div>
        <div class="att-tab-row-summary">${summary}</div>
      </div>`;
  }).join('');

  const historySection = `
    <div class="sec-card">
    <div id="att-tab-history-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-history')">
      <span class="section-title" style="margin:0">Event History</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-history">
      ${historyRows}
    </div>
    </div>`;

  return `<div class="att-tab-view">`
    + _renderAttendanceChart()
    + attendanceCta
    + `<div id="att-tab-filtered">${_attTabFilteredContent()}</div>`
    + historySection
    + `</div>`;
}

// ── Attendance Screen ─────────────────────────────────────────────────────────

// The submitted-attendance roster, on its own so search/filter changes can swap
// just the list (a full re-render would drop the focused search box — and with
// it the mobile keyboard). See _refreshFilterList in js/03-router.js.
function _buildAttSummaryRows(rid) {
  const students = rehearsalStudents(rid);
  const entries  = STATE.entries[rid] || {};

  const absent   = students.filter(s => entries[s.number]?.attendance === 'absent');
  const late     = students.filter(s => entries[s.number]?.attendance === 'late');
  const present  = students.filter(s => entries[s.number]?.attendance !== 'absent' && entries[s.number]?.attendance !== 'late');

  const displayPool = _attSummaryStatus === 'absent'  ? absent
                    : _attSummaryStatus === 'late'    ? late
                    : _attSummaryStatus === 'present' ? present
                    : [...absent, ...late];

  const attMap = {};
  students.forEach(s => { attMap[s.number] = { att: entries[s.number]?.attendance }; });
  const filtered = filterAndSortStudents(displayPool, _attFilter, attMap);

  const stuRow = s => {
    const att  = entries[s.number]?.attendance;
    const meta = [_studentSpotText(s), normInstrument(s.instrument)].filter(Boolean).join(' · ');
    const chip = att === 'absent'
      ? `<span class="att-summary-chip att-chip-absent" style="flex-shrink:0;font-size:0.7rem;padding:2px 8px">Absent</span>`
      : att === 'late'
      ? `<span class="att-summary-chip att-chip-late"   style="flex-shrink:0;font-size:0.7rem;padding:2px 8px">Late</span>`
      : '';
    return `<div class="att-summary-stu-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div>
        <span class="att-stu-name">${esc(s.name || `#${s.number}`)}</span>
        ${meta ? `<div class="att-stu-meta">${esc(meta)}</div>` : ''}
      </div>
      ${chip}
    </div>`;
  };

  const hasSearch = _attFilter.search || _attFilter.instruments.length || _attFilter.grades.length || _attFilter.sections.length;
  const emptyMsg  = hasSearch ? 'No students match your search.'
    : _attSummaryStatus === 'absent'  ? 'No students were absent.'
    : _attSummaryStatus === 'late'    ? 'No students were late.'
    : _attSummaryStatus === 'present' ? 'No students were marked present.'
    : 'Everyone was present!';

  return filtered.length ? filtered.map(stuRow).join('') : `<div class="empty-state"><p>${emptyMsg}</p></div>`;
}

function viewAttendanceSummary(rid) {
  const students = rehearsalStudents(rid);
  const entries  = STATE.entries[rid] || {};

  const absent   = students.filter(s => entries[s.number]?.attendance === 'absent');
  const late     = students.filter(s => entries[s.number]?.attendance === 'late');
  const present  = students.filter(s => entries[s.number]?.attendance !== 'absent' && entries[s.number]?.attendance !== 'late');

  const listHtml = _buildAttSummaryRows(rid);

  const chip = (status, count, label, cls) => {
    const active = _attSummaryStatus === status;
    return `<button class="att-summary-chip ${cls} att-chip-btn${active ? ' att-chip-btn-active' : ''}"
      onclick="setAttSummaryStatus('${status}')">${count} ${label}</button>`;
  };

  return `
    <div class="att-submitted-banner">✓ Attendance submitted</div>

    <div class="att-screen-summary-bar">
      ${chip('absent',  absent.length,  'Absent',  'att-chip-absent')}
      ${chip('late',    late.length,    'Late',    'att-chip-late')}
      ${chip('present', present.length, 'Present', 'att-chip-present')}
    </div>

    <button class="btn btn-secondary" style="width:100%;margin-bottom:20px"
            onclick="enterAttModifyMode('${esc(rid)}')">Edit Attendance</button>

    ${renderFilterBar('att', _attFilter, [
      {value:'name',       label:'Name'},
      {value:'number',     label:'Number'},
      {value:'instrument', label:'Instrument'},
      {value:'grade',      label:'Grade'},
      {value:'attStatus',  label:'Status'},
    ])}

    <div class="att-summary-list" id="att-summary-list">${listHtml}</div>
  `;
}

function setAttSummaryStatus(status) {
  _attSummaryStatus = _attSummaryStatus === status ? '' : status;
  _rerenderForFilter('att');
}

function enterAttModifyMode(rid) {
  _attModifyMode = true;
  reRender(rid);
}

function confirmModifyAttendance(rid) {
  showConfirmModal(
    'Modify Submitted Attendance',
    'Attendance for this rehearsal has already been submitted. Are you sure you want to make changes?',
    () => {
      _attModifyMode = true;
      navigate('attendance', { rid, from: 'attendance-tab' });
    },
    'Modify',
    'btn-primary'
  );
}

function viewAttendance(rid) {
  const r        = STATE.rehearsals.find(r => r.id === rid);
  const students = rehearsalStudents(r);
  const entries  = STATE.entries[rid] || {};
  if (!students.length) {
    return `<div class="empty-state"><p>${r?.scope ? 'No students match this event’s groups.' : 'No students in the roster yet.'}</p></div>`;
  }

  const submitted = r?.attendanceSubmitted || false;
  if (submitted && !_attModifyMode) return viewAttendanceSummary(rid);
  const absent        = students.filter(s => entries[s.number]?.attendance === 'absent').length;
  const late          = students.filter(s => entries[s.number]?.attendance === 'late').length;
  const markedPresent = students.filter(s => entries[s.number]?.attendance === 'present').length;
  const unmarked      = students.length - absent - late - markedPresent;

  // Build attMap for status-based sorting
  const attMap = {};
  students.forEach(s => {
    attMap[s.number] = { att: entries[s.number]?.attendance || 'present' };
  });

  return `
    ${submitted ? `
      <div class="att-submitted-banner">
        ✓ Attendance submitted — changes require confirmation
      </div>` : ''}

    <div class="att-screen-summary-bar">
      <span class="att-summary-chip att-chip-absent">${absent} Absent</span>
      <span class="att-summary-chip att-chip-late">${late} Late</span>
      <span class="att-summary-chip att-chip-present">${markedPresent} Present</span>
      ${unmarked > 0 ? `<span class="att-summary-chip att-chip-unmarked">${unmarked} Remaining</span>` : ''}
    </div>

    ${_blockAttShows().length ? `
    <button class="btn btn-secondary btn-full" style="margin-bottom:12px" onclick="startBlockAttendance('${esc(rid)}')">
      ▦ Take Attendance by Block
    </button>` : ''}

    ${renderFilterBar('att', _attFilter, [
      {value:'name',      label:'Name'},
      {value:'number',    label:'Number'},
      {value:'instrument',label:'Instrument'},
      {value:'grade',     label:'Grade'},
      {value:'attStatus', label:'Status'}
    ])}

    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn btn-secondary" style="flex:1" onclick="markAllPresent('${esc(rid)}')">
        ✓ Mark All Present
      </button>
      ${!submitted ? `
        <button class="btn btn-primary" style="flex:1" onclick="showSubmitAttendanceModal('${esc(rid)}')">
          Submit Attendance
        </button>` : ''}
    </div>

    <div class="att-student-list" id="att-student-list">
      ${buildAttBodyHtml(rid, students, entries)}
    </div>
  `;
}


function buildAttBodyHtml(rid, students, entries) {
  const attMap = {};
  students.forEach(s => {
    attMap[s.number] = { att: entries[s.number]?.attendance || 'present' };
  });

  // Absent and present students move to their own collapsible sections
  const absentPool   = students.filter(s => entries[s.number]?.attendance === 'absent');
  const presentPool  = students.filter(s => entries[s.number]?.attendance === 'present');
  const mainStudents = students.filter(s => {
    const att = entries[s.number]?.attendance;
    return att !== 'absent' && att !== 'present';
  });
  const mainPool = filterAndSortStudents(mainStudents, _attFilter, attMap);

  const hasFilter = _attFilter.search || _attFilter.instruments.length ||
                    _attFilter.grades.length  || _attFilter.sections.length;

  const collapsibleSection = (pool, collapsed, toggleFn, icon, label, listCls, toggleCls, sectionCls) => {
    if (!pool.length) return '';
    const filtered = filterAndSortStudents(pool, _attFilter, attMap);
    const countLabel = hasFilter && filtered.length !== pool.length
      ? `${filtered.length} of ${pool.length}`
      : String(pool.length);
    return `
      <div class="${sectionCls}">
        <button class="${toggleCls}" onclick="${toggleFn}('${esc(rid)}')">
          <span>${icon} ${label} (${countLabel})</span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="transition:transform .2s;transform:rotate(${collapsed ? '0' : '180'}deg)"><polyline points="2,4 7,10 12,4"/></svg>
        </button>
        ${!collapsed ? `<div class="${listCls}">${filtered.map(s => attStudentRow(rid, s, entries)).join('')}</div>` : ''}
      </div>`;
  };

  let html = '';
  if (mainPool.length) {
    html = mainPool.map(s => attStudentRow(rid, s, entries)).join('');
  } else if (!absentPool.length && !presentPool.length) {
    const msg = hasFilter ? 'No students match the current filter.' : 'No students in this group.';
    html = `<div class="empty-state" style="padding:24px"><p>${msg}</p></div>`;
  } else if (!hasFilter) {
    html = `<div class="att-all-marked">All students have been marked.</div>`;
  }

  html += collapsibleSection(absentPool,  _attAbsentCollapsed,  'toggleAttAbsentSection',  '✗', 'Marked Absent',  'att-absent-list',  'att-absent-toggle',  'att-absent-section');
  html += collapsibleSection(presentPool, _attPresentCollapsed, 'toggleAttPresentSection', '✓', 'Marked Present', 'att-present-list', 'att-present-toggle', 'att-present-section');

  return html;
}

function toggleAttAbsentSection(rid) {
  _attAbsentCollapsed = !_attAbsentCollapsed;
  const el = document.getElementById('att-student-list');
  if (el) el.innerHTML = buildAttBodyHtml(rid, rehearsalStudents(rid), STATE.entries[rid] || {});
}

function toggleAttPresentSection(rid) {
  _attPresentCollapsed = !_attPresentCollapsed;
  const el = document.getElementById('att-student-list');
  if (el) el.innerHTML = buildAttBodyHtml(rid, rehearsalStudents(rid), STATE.entries[rid] || {});
}

// filterAttendanceList replaced by updateFilter / unified filter bar

function attStudentRow(rid, s, entries) {
  const att  = entries[s.number]?.attendance || null;
  const meta = [_studentSpotText(s), normInstrument(s.instrument)].filter(Boolean).join(' · ');
  const rowClass = att === 'absent' ? 'att-stu-absent' : att === 'late' ? 'att-stu-late' : att === 'present' ? 'att-stu-present' : '';
  return `
    <div class="att-stu-row ${rowClass}">
      <div class="att-stu-info">
        <span class="att-stu-name">${esc(s.name || `#${s.number}`)}</span>
        ${meta ? `<div class="att-stu-meta">${esc(meta)}</div>` : ''}
      </div>
      <div class="att-stu-btns">
        <button class="att-btn att-present ${att==='present'?'att-on-present':''}"
                onclick="setAttendance('${esc(rid)}','${esc(s.number)}','present')" title="Mark present">✓</button>
        <button class="att-btn att-late    ${att==='late'   ?'att-on-late':''}"
                onclick="setAttendance('${esc(rid)}','${esc(s.number)}','late')">◷ Late</button>
        <button class="att-btn att-absent  ${att==='absent' ?'att-on-absent':''}"
                onclick="setAttendance('${esc(rid)}','${esc(s.number)}','absent')">✗ Absent</button>
      </div>
    </div>`;
}

// setAttendanceFilter replaced by updateFilter / unified filter bar

async function markAllPresent(rid) {
  const entries  = STATE.entries[rid] || {};
  const students = rehearsalStudents(rid);
  // Mark only unchecked students (attendance === null/undefined) as 'present'.
  // Leave absent/late entries untouched.
  const unchecked = students.filter(s => !entries[s.number]?.attendance);
  if (!unchecked.length) { showToast('All students already marked.'); return; }
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  const batch = db.batch();
  for (const s of unchecked) {
    const num   = s.number;
    const cur   = entries[num] || { mistakes: 0, positives: 0, notes: '', events: [] };
    STATE.entries[rid][num] = { ...cur, attendance: 'present' };
    batch.set(orgCol('entries').doc(`${rid}_${String(num)}`), {
      rehearsalId:   rid,
      studentNumber: String(num),
      ..._seasonStampFor(rid),
      mistakes:      cur.mistakes  || 0,
      positives:     cur.positives || 0,
      notes:         cur.notes     || '',
      events:        cur.events    || [],
      attendance:    'present',
      updatedAt:     firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy:     STATE.user?.uid || '',
    }, { merge: true });
  }
  await batch.commit();
  showToast(`${unchecked.length} student${unchecked.length !== 1 ? 's' : ''} marked present.`);
  reRender(rid);
}

function setAttendance(rid, num, status) {
  const ents = DB.getRehearsalEntries(rid);
  const cur  = ents[num] || { mistakes:0, positives:0, notes:'', events:[] };
  const prev = cur.attendance || null;
  const next = prev === status ? null : status; // tap active = clear

  const apply = () => _applyAttendance(rid, num, cur, next);

  const r = STATE.rehearsals.find(r => r.id === rid);
  if (r?.attendanceSubmitted) {
    const s = STATE.students[String(num)];
    const name = s?.name || `#${num}`;
    const fromLabel = prev === 'absent' ? 'Absent' : prev === 'late' ? 'Late' : 'Present';
    const toLabel   = next === 'absent' ? 'Absent' : next === 'late' ? 'Late' : 'Present';
    showConfirmModal(
      'Attendance Already Submitted',
      `Change ${name} from <strong>${fromLabel}</strong> to <strong>${toLabel}</strong>?`,
      apply,
      'Change',
      'btn-primary'
    );
    return;
  }

  apply();
}

function _applyAttendance(rid, num, cur, next) {
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  STATE.entries[rid][num] = { ...cur, attendance: next };
  const docId = `${rid}_${String(num)}`;
  if (!next) {
    orgCol('entries').doc(docId).update({
      attendance: firebase.firestore.FieldValue.delete()
    }).catch(() => {});
  } else {
    fsUpsertEntry(rid, num, {
      mistakes:  cur.mistakes  || 0,
      positives: cur.positives || 0,
      notes:     cur.notes     || '',
      events:    cur.events    || [],
      attendance: next
    });
  }
  _recalcAutoBonuses(rid, num);
  reRender(rid);
}

function showSubmitAttendanceModal(rid) {
  const stuMap  = DB.getStudents();
  const entries = STATE.entries[rid] || {};
  const nameOf  = num => stuMap[num]?.name || `#${num}`;

  const absentList = Object.entries(entries)
    .filter(([, e]) => e.attendance === 'absent')
    .map(([num]) => nameOf(num));
  const lateList = Object.entries(entries)
    .filter(([, e]) => e.attendance === 'late')
    .map(([num]) => nameOf(num));

  const noMarks = !absentList.length && !lateList.length;

  _pendingConfirm = () => submitAttendance(rid);
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Submit Attendance</div>
    ${noMarks ? `
      <p style="font-size:.9rem;color:var(--text-muted);margin-bottom:16px;line-height:1.5">
        No absences or late arrivals recorded — everyone is marked present.
      </p>` : ''}
    ${absentList.length ? `
      <div class="att-review-section">
        <div class="att-review-hdr att-chip-absent">✗ Absent (${absentList.length})</div>
        ${absentList.map(n => `<div class="att-review-name">${esc(n)}</div>`).join('')}
      </div>` : ''}
    ${lateList.length ? `
      <div class="att-review-section">
        <div class="att-review-hdr att-chip-late">◷ Late (${lateList.length})</div>
        ${lateList.map(n => `<div class="att-review-name">${esc(n)}</div>`).join('')}
      </div>` : ''}
    <p style="font-size:.8rem;color:var(--text-muted);margin-top:12px">
      After submitting, any changes will require confirmation.
    </p>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="runPendingConfirm()">Submit</button>
    </div>
  `);
}

function submitAttendance(rid) {
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  // Co-directors often submit within moments of each other; once the flag is
  // set there's nothing left to write (the recalc below already skips
  // students whose auto marks come out unchanged).
  const already = !!r.attendanceSubmitted;
  r.attendanceSubmitted = true;
  if (!already) orgCol('rehearsals').doc(rid).set({ attendanceSubmitted: true }, { merge: true });
  if (_getAutoMarks().some(m => m.when === 'start')) {
    rehearsalStudents(r).forEach(s => _recalcAutoBonuses(rid, String(s.number ?? s._id)));
  }
  showToast('Attendance submitted.');
  _attModifyMode = false;
  reRender(rid);
}

// ── Take Attendance by Block ──────────────────────────────────────────────────
// Section-by-section attendance driven by a show's field spots: one section on
// screen at a time, each student a big tappable name that toggles absent (red).
// Marking only records absences — everyone else is present by default on submit,
// like the standard flow.

// Attendance-by-block groups: one group per show section (see _blockAttShowGroups).
// Each entry is { s, pos, shared }: the student, their field-spot label (M1), and
// whether that spot is shared by more than one student.
function _blockAttGroups(rid) {
  return _blockAttShowGroups(rid, _blockAttShowId);
}

// Groups by a show's field-spot assignments: one group per section letter, each
// listing that section's spots (rank high → low, so spot 1 sits at the bottom of
// the screen). A spot shared by two students yields one entry per student (each
// toggled on its own). In-scope students with no spot in the show fall into a
// trailing group so attendance still covers everyone. If the show is missing
// (edge case), everyone lands in a single "All Students" group.
function _blockAttShowGroups(rid, showId) {
  const show    = STATE.shows && STATE.shows[showId];
  const mapping = (show && show.mapping) || {};
  const scope   = rehearsalStudents(rid);
  const byNum   = {};
  scope.forEach(s => { byNum[String(s.number)] = s; });

  const assigned  = new Set();
  const bySection = {}; // letter → [{ rank, name, entry }]
  Object.keys(mapping).forEach(label => {
    const nums = drillSpotNums(mapping[label]).filter(n => byNum[n]);
    if (!nums.length) return;
    const { section, rank } = drillSpotLabelParts(label);
    const shared = nums.length > 1;
    nums.forEach(n => {
      assigned.add(n);
      (bySection[section] = bySection[section] || []).push({
        rank, name: byNum[n].name || '',
        entry: { s: byNum[n], pos: label, shared },
      });
    });
  });

  const groups = Object.keys(bySection).sort().map(letter => ({
    key: 'S:' + letter,
    label: `Section ${letter}`,
    students: bySection[letter]
      .sort((a, b) => (b.rank - a.rank) || a.name.localeCompare(b.name))
      .map(i => i.entry),
  }));

  const leftovers = scope.filter(s => !assigned.has(String(s.number)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (leftovers.length) {
    groups.push({
      key: 'NOSPOT', label: show ? 'No spot in this show' : 'All Students',
      students: leftovers.map(s => ({ s, pos: '', shared: false })),
    });
  }
  return groups;
}

// Shows offered by "Take Attendance by Block": only shows that still have a
// drill file. A show doc can outlive its drills (deleted drills, old
// migrations); listing such a leftover here just offers a block flow with no
// usable spots — directors can delete it from the Drill Library.
function _blockAttShows() {
  return Object.values(STATE.shows || {})
    .filter(s => Object.values(STATE.drills || {}).some(d => d.showId === s.id))
    .sort((a, b) =>
      (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0) || (a.name || '').localeCompare(b.name || ''));
}

// Entry point: attendance by block steps through a show's field spots. With one
// show, jump straight in; with several, pick which show; with none, nothing to
// do (the button that calls this is hidden unless a show exists).
function startBlockAttendance(rid) {
  const shows = _blockAttShows();
  if (!shows.length) { showToast('Add a show with spot assignments first.'); return; }
  if (shows.length === 1) { _beginBlockAttendance(rid, shows[0].id); return; }
  const showRows = shows.map(s => `
    <button class="options-menu-item" onclick="closeModal();_beginBlockAttendance('${esc(rid)}','${esc(s.id)}')">
      <div class="options-menu-icon">🎬</div>
      <div><div class="options-menu-label">${esc(s.name || 'Show')}</div><div class="options-menu-sub">By this show's field spots (letters &amp; numbers)</div></div>
    </button>`).join('');
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Take Attendance by Block</div>
    <p class="modal-sub" style="margin:0 0 10px">Step through students a section at a time, by a show's field-spot assignments. Pick a show:</p>
    <div class="options-menu">${showRows}</div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function _beginBlockAttendance(rid, showId) {
  _blockAttShowId = showId || null;
  _blockAttIdx    = 0;
  _blockAttReview = false;
  navigate('attendance-block', { rid, from: _params.from });
  // navigate() scrolls to the top; jump to the bottom so row 1 is in view.
  requestAnimationFrame(() => _scrollBlockAttBottom());
}

// Column screens open at the bottom (row 1) since rows are ordered high → low.
function _scrollBlockAttBottom() {
  const mc = document.getElementById('main-content');
  if (mc) mc.scrollTop = mc.scrollHeight;
}

function viewAttendanceBlock(rid) {
  const groups  = _blockAttGroups(rid);
  const entries = STATE.entries[rid] || {};
  if (!groups.length) {
    return `<div class="empty-state"><p>No students to take attendance for.</p></div>`;
  }

  const isAbsent = e => entries[e.s.number]?.attendance === 'absent';
  const allAbsent = () => groups.flatMap(g => g.students).filter(isAbsent);
  const showName = _blockAttShowId ? (STATE.shows?.[_blockAttShowId]?.name || 'Show') : '';

  // ── Review screen ──────────────────────────────────────────────────────────
  if (_blockAttReview) {
    const absentees = allAbsent().sort((a, b) => (a.s.name || '').localeCompare(b.s.name || ''));
    const rows = absentees.length
      ? absentees.map(e => {
          const s = e.s;
          const meta = [e.pos, normInstrument(s.instrument)].filter(Boolean).join(' · ');
          return `
            <button class="blk-att-review-row" onclick="blockToggleAbsent('${esc(rid)}','${esc(s.number)}')">
              <span class="blk-att-review-name">${esc(s.name || `#${s.number}`)}</span>
              ${meta ? `<span class="blk-att-review-meta">${esc(meta)}</span>` : ''}
              <span class="blk-att-review-x">✕</span>
            </button>`;
        }).join('')
      : `<div class="empty-state" style="padding:24px"><p>Everybody's here — no absences recorded.</p></div>`;
    return `
      <div class="blk-att-screen">
        <div class="blk-att-hdr">
          <div class="blk-att-title">Review Absences</div>
          <div class="blk-att-progress">${absentees.length} absent</div>
        </div>
        <p class="blk-att-hint">${showName ? `${esc(showName)} · ` : ''}Tap a name to remove them from the absent list.</p>
        <div class="blk-att-review-list">${rows}</div>
        <div class="blk-att-footer">
          <button class="btn btn-secondary blk-att-back" onclick="blockAttBack('${esc(rid)}')">← Back</button>
          <button class="btn btn-primary blk-att-next" onclick="blockAttSubmit('${esc(rid)}')">Submit Attendance</button>
        </div>
      </div>`;
  }

  // ── Block screen (one column or one show section) ────────────────────────────
  const idx     = Math.min(_blockAttIdx, groups.length - 1);
  const group   = groups[idx];
  const isLast  = idx >= groups.length - 1;
  const colAbsent = group.students.filter(isAbsent).length;
  const unit    = 'section';

  const nextLabel = isLast
    ? (colAbsent ? `${colAbsent} absent. Review` : `Everybody's here. Review`)
    : (colAbsent ? `${colAbsent} absent. Next ${unit}` : `Everybody's here. Next ${unit}`);

  const stuBtns = group.students.map(e => {
    const s = e.s;
    const pos = [e.pos, e.shared ? 'shared' : ''].filter(Boolean).join(' · ');
    return `
      <button class="blk-att-stu ${isAbsent(e) ? 'blk-att-absent' : ''}" id="blkstu-${esc(s.number)}"
              onclick="blockToggleAbsent('${esc(rid)}','${esc(s.number)}')">
        <span class="blk-att-stu-name">${esc(s.name || `#${s.number}`)}</span>
        ${pos ? `<span class="blk-att-stu-pos">${esc(pos)}</span>` : ''}
      </button>`;
  }).join('');

  return `
    <div class="blk-att-screen">
      <div class="blk-att-hdr">
        <div class="blk-att-title">${esc(group.label)}</div>
        <div class="blk-att-progress">${idx + 1} of ${groups.length}</div>
      </div>
      <p class="blk-att-hint">${showName ? `${esc(showName)} · ` : ''}Tap a student to mark them absent.</p>
      <div class="blk-att-list">${stuBtns}</div>
      <div class="blk-att-footer">
        ${idx > 0 ? `<button class="btn btn-secondary blk-att-back" onclick="blockAttBack('${esc(rid)}')">←</button>` : ''}
        <button class="btn ${colAbsent ? 'btn-danger' : 'btn-primary'} blk-att-next" onclick="blockAttNext('${esc(rid)}')">${nextLabel}</button>
      </div>
    </div>`;
}

function _reRenderBlockAtt(rid) {
  const mc = document.getElementById('main-content');
  if (!mc) return;
  const st = mc.scrollTop;
  mc.innerHTML = viewAttendanceBlock(rid);
  mc.scrollTop = st;
}

function blockToggleAbsent(rid, num) {
  const ents = DB.getRehearsalEntries(rid);
  const cur  = ents[num] || { mistakes: 0, positives: 0, notes: '', events: [] };
  const next = cur.attendance === 'absent' ? null : 'absent';
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  STATE.entries[rid][num] = { ...cur, attendance: next };
  const docId = `${rid}_${String(num)}`;
  if (!next) {
    orgCol('entries').doc(docId).update({
      attendance: firebase.firestore.FieldValue.delete()
    }).catch(() => {});
  } else {
    fsUpsertEntry(rid, num, {
      mistakes:  cur.mistakes  || 0,
      positives: cur.positives || 0,
      notes:     cur.notes     || '',
      events:    cur.events    || [],
      attendance: next
    });
  }
  _recalcAutoBonuses(rid, num);
  _reRenderBlockAtt(rid);
}

function blockAttNext(rid) {
  const groups = _blockAttGroups(rid);
  if (_blockAttIdx >= groups.length - 1) _blockAttReview = true;
  else _blockAttIdx++;
  _reRenderBlockAtt(rid);
  // The review screen reads top-down; column screens open at the bottom (row 1).
  const mc = document.getElementById('main-content');
  if (mc) mc.scrollTop = _blockAttReview ? 0 : mc.scrollHeight;
}

function blockAttBack(rid) {
  if (_blockAttReview) _blockAttReview = false;
  else if (_blockAttIdx > 0) _blockAttIdx--;
  else { navigate('attendance', { rid, from: _params.from }); return; }
  _reRenderBlockAtt(rid);
  // Back always lands on a column screen → open it at the bottom (row 1).
  _scrollBlockAttBottom();
}

function blockAttSubmit(rid) {
  submitAttendance(rid);
  navigate('attendance', { rid, from: _params.from || 'attendance-tab' });
}
