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
    const meta = [fmtPos(s.column, s.row), normInstrument(s.instrument)].filter(Boolean).join(' · ');
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
    return `<div class="empty-state" style="padding:12px 0"><p>No submitted rehearsals yet.</p></div>`;
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
    const meta = [fmtPos(s.column, s.row), normInstrument(s.instrument)].filter(Boolean).join(' · ');
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
  const openReh         = STATE.isAdmin ? getActiveRehearsal() : null;
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

function _renderAttendanceChart() {
  const allRehearsals = [...DB.getRehearsals()]
    .filter(r => r.attendanceSubmitted)
    .sort((a, b) => a.date.localeCompare(b.date));

  const total = Object.keys(DB.getStudents()).length;
  if (allRehearsals.length < 2 || total === 0) return '';

  const pts = allRehearsals.slice(-24).map(r => {
    const entries = STATE.entries[r.id] || {};
    const absent = Object.values(entries).filter(e => e.attendance === 'absent').length;
    const late   = Object.values(entries).filter(e => e.attendance === 'late').length;
    return { label: fmtDate(r.date).replace(/\/\d{4}$/, ''), absent, late };
  });

  if (pts.length < 2) return '';

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

  const gridLines = ticks.map(v => {
    const y = toY(v);
    return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--border)" stroke-width="1"/>
            <text x="${PL-4}" y="${y+4}" text-anchor="end" font-size="9" fill="var(--text-muted)">${v}</text>`;
  }).join('');

  const makePolyline = (color, key) => {
    const points = pts.map((p, i) => `${toX(i).toFixed(1)},${toY(p[key]).toFixed(1)}`).join(' ');
    const dots = pts.map((p, i) =>
      `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p[key]).toFixed(1)}" r="3" fill="${color}">
        <title>${p.label}: ${p[key]} ${key}</title>
      </circle>`
    ).join('');
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` + dots;
  };

  const xLabels = pts.map((p, i) => {
    if (pts.length <= 8 || i === 0 || i === pts.length - 1 || i % Math.ceil(pts.length / 6) === 0) {
      return `<text x="${toX(i).toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${p.label}</text>`;
    }
    return '';
  }).join('');

  return `
    <div class="sec-card">
    <div id="att-tab-chart-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-chart')">
      <span class="section-title" style="margin:0">Attendance Over Time</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-chart">
      <div class="att-chart-card card mb-12">
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
          ${gridLines}
          ${makePolyline('var(--danger)',  'absent')}
          ${makePolyline('var(--warning)', 'late')}
          ${xLabels}
        </svg>
        <div class="att-chart-legend">
          <span class="att-chart-legend-item"><span class="att-chart-dot" style="background:var(--danger)"></span>Absent</span>
          <span class="att-chart-legend-item"><span class="att-chart-dot" style="background:var(--warning)"></span>Late</span>
        </div>
      </div>
    </div>
    </div>`;
}

function viewAttendanceTab() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b) => b.date.localeCompare(a.date));
  const students   = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));

  if (!rehearsals.length) {
    return `<div class="empty-state"><p>No rehearsals yet.</p></div>`;
  }

  // ── Open-rehearsal attendance CTA ─────────────────────────────────────────

  const openReh = STATE.isAdmin ? getActiveRehearsal() : null;
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
        ✏️ Modify Current Rehearsal Attendance
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
      <span class="section-title" style="margin:0">Rehearsal History</span>
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

function viewAttendanceSummary(rid) {
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
    const meta = [fmtPos(s.column, s.row), normInstrument(s.instrument)].filter(Boolean).join(' · ');
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

  const listHtml = filtered.length ? filtered.map(stuRow).join('') : `<div class="empty-state"><p>${emptyMsg}</p></div>`;

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

    <div class="att-summary-list">${listHtml}</div>
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
    return `<div class="empty-state"><p>${r?.scope ? 'No students match this rehearsal’s groups.' : 'No students in the roster yet.'}</p></div>`;
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

    <button class="btn btn-secondary btn-full" style="margin-bottom:12px" onclick="startBlockAttendance('${esc(rid)}')">
      ▦ Take Attendance by Block
    </button>

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
  const meta = [fmtPos(s.column, s.row), normInstrument(s.instrument)].filter(Boolean).join(' · ');
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
  r.attendanceSubmitted = true;
  orgCol('rehearsals').doc(rid).set({ attendanceSubmitted: true }, { merge: true });
  if (_getAutoMarks().some(m => m.when === 'start')) {
    rehearsalStudents(r).forEach(s => _recalcAutoBonuses(rid, String(s.number ?? s._id)));
  }
  showToast('Attendance submitted.');
  _attModifyMode = false;
  reRender(rid);
}

// ── Take Attendance by Block ──────────────────────────────────────────────────
// Column-by-column attendance: one column on screen at a time, each student a
// big tappable name that toggles absent (red). Marking only records absences —
// everyone else is present by default on submit, like the standard flow.

// Ordered column groups for the rehearsal's in-scope roster. Columns follow the
// A–L order; students with no column fall into a trailing "No Column" group.
function _blockAttGroups(rid) {
  const byCol = {};
  for (const s of rehearsalStudents(rid)) {
    const col = String(s.column || '').toUpperCase().trim();
    (byCol[col] = byCol[col] || []).push(s);
  }
  // Rows are ordered high → low so row 1 sits at the BOTTOM of the screen; the
  // column screen opens scrolled to the bottom and the director scrolls up to
  // reach higher row numbers (mirrors looking down a file from the front).
  const byRow = list => list.slice().sort((a, b) =>
    (+b.row || 0) - (+a.row || 0) || (a.name || '').localeCompare(b.name || ''));
  const groups = [];
  for (const c of COLUMNS) if (byCol[c]?.length) groups.push({ key: c, label: `Column ${c}`, students: byRow(byCol[c]) });
  // Any non-standard column letters, then the unassigned group.
  Object.keys(byCol).filter(c => c && !COLUMNS.includes(c)).sort()
    .forEach(c => groups.push({ key: c, label: `Column ${c}`, students: byRow(byCol[c]) }));
  if (byCol['']?.length)
    groups.push({ key: '', label: 'No Column', students: byCol[''].slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')) });
  return groups;
}

function startBlockAttendance(rid) {
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

  const isAbsent = s => entries[s.number]?.attendance === 'absent';
  const allAbsent = () => groups.flatMap(g => g.students).filter(isAbsent);

  // ── Review screen ──────────────────────────────────────────────────────────
  if (_blockAttReview) {
    const absentees = allAbsent().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const rows = absentees.length
      ? absentees.map(s => {
          const pos = fmtPos(s.column, s.row);
          const meta = [pos, normInstrument(s.instrument)].filter(Boolean).join(' · ');
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
        <p class="blk-att-hint">Tap a name to remove them from the absent list.</p>
        <div class="blk-att-review-list">${rows}</div>
        <div class="blk-att-footer">
          <button class="btn btn-secondary blk-att-back" onclick="blockAttBack('${esc(rid)}')">← Back</button>
          <button class="btn btn-primary blk-att-next" onclick="blockAttSubmit('${esc(rid)}')">Submit Attendance</button>
        </div>
      </div>`;
  }

  // ── Column screen ──────────────────────────────────────────────────────────
  const idx     = Math.min(_blockAttIdx, groups.length - 1);
  const group   = groups[idx];
  const isLast  = idx >= groups.length - 1;
  const colAbsent = group.students.filter(isAbsent).length;

  const nextLabel = isLast
    ? (colAbsent ? `${colAbsent} absent. Review` : `Everybody's here. Review`)
    : (colAbsent ? `${colAbsent} absent. Next column` : `Everybody's here. Next column`);

  const stuBtns = group.students.map(s => {
    const pos = fmtPos(s.column, s.row);
    return `
      <button class="blk-att-stu ${isAbsent(s) ? 'blk-att-absent' : ''}" id="blkstu-${esc(s.number)}"
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
      <p class="blk-att-hint">Tap a student to mark them absent.</p>
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
