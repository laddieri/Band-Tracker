// Band Tracker — js/09-rehearsal.js — Rehearsals list, attendance tab/screen, rehearsal detail, group marks, block nav.
// Plain script sharing global scope; load order is set in index.html.

// In-scope students for a rehearsal (full roster when the rehearsal targets the
// whole band). Accepts a rehearsal object or its id. Use this — not the raw
// roster — anywhere a rehearsal's attendance/feedback candidates are listed, so
// a sectional only shows the students it applies to. The pure membership test
// lives in 00-logic.js (rehearsalIncludesStudent).
function rehearsalStudents(rOrId) {
  const r   = typeof rOrId === 'string' ? STATE.rehearsals.find(x => x.id === rOrId) : rOrId;
  const all = Object.values(DB.getStudents());
  return r?.scope ? all.filter(s => rehearsalIncludesStudent(s, r.scope)) : all;
}

// ── View: Rehearsals List ─────────────────────────────────────────────────────

function viewRehearsals() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b)=>b.date.localeCompare(a.date));
  if (!rehearsals.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>No rehearsals yet.</p>
        <p>Tap <strong>+</strong> above or use the Home tab.</p>
      </div>`;
  }

  const hasOpen = rehearsals.some(r => !r.ended);
  const startBtn = STATE.isAdmin && !hasOpen
    ? `<button class="start-rehearsal-btn" onclick="showNewRehearsalModal()">+ Start a New Rehearsal</button>`
    : '';

  const toggle = `
    <div class="rh-viewmode">
      <button class="rh-viewmode-btn${_rhViewMode === 'calendar' ? '' : ' rh-viewmode-btn--on'}" onclick="setRhViewMode('list')">List</button>
      <button class="rh-viewmode-btn${_rhViewMode === 'calendar' ? ' rh-viewmode-btn--on' : ''}" onclick="setRhViewMode('calendar')">📅 Calendar</button>
    </div>`;

  // In calendar view, surface any open rehearsal's full card above the grid so
  // the in-progress rehearsal is still front-and-center (as it is in list view).
  let openBanner = '';
  if (_rhViewMode === 'calendar') {
    const openRs = rehearsals.filter(r => !r.ended);
    if (openRs.length) {
      openBanner = `
        <div class="section-title">${openRs.length > 1 ? 'Open Rehearsals' : 'Open Rehearsal'}</div>
        <div class="rh-cards-grid rh-cal-open-banner">${openRs.map(_rhCardHtml).join('')}</div>`;
    }
  }

  const body = _rhViewMode === 'calendar' ? `${openBanner}${_rhCalendarHtml()}` : _rhListHtml(rehearsals);
  return `<div class="rh-view">${startBtn}${toggle}${body}</div>`;
}

function setRhViewMode(mode) {
  _rhViewMode = mode;
  try { localStorage.setItem('rhViewMode', mode); } catch {}
  render();
}

const _RH_MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

// The original month-grouped list of rehearsal cards.
function _rhListHtml(rehearsals) {
  const grouped = {};
  for (const r of rehearsals) {
    const key = r.date.slice(0,7);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }
  return Object.entries(grouped).map(([key, group]) => {
    const [y, m] = key.split('-').map(Number);
    return `
      <div class="section-title">${_RH_MONTHS[m-1]} ${y}</div>
      <div class="rh-cards-grid">${group.map(_rhCardHtml).join('')}</div>`;
  }).join('');
}

// One rehearsal card (open or ended) — shared by the list view and the open
// rehearsal banner shown above the calendar in calendar view.
function _rhCardHtml(r) {
        const ents = DB.getRehearsalEntries(r.id);
        const cnt  = Object.values(ents).filter(e => e.mistakes > 0 || e.positives > 0 || e.attendance || e.events?.length).length;
        const errs = Object.values(ents).reduce((s,e)=>s+(e.mistakes||0),0);
        const pos  = Object.values(ents).reduce((s,e)=>s+(e.positives||0),0);
        const ended    = !!r.ended;
        const attDone  = !!r.attendanceSubmitted;
        const stateCls = ended ? 'rh-card-ended' : 'rh-card-open';
        const activeR  = getActiveRehearsal();
        const isActive = !ended && activeR && activeR.id === r.id;
        const menuBtn = STATE.isAdmin ? `
          <div class="rh-card-menu-wrap">
            <button class="rh-card-menu-btn" onclick="event.stopPropagation();toggleRhMenu('${esc(r.id)}')" aria-label="More options">⋯</button>
            <div class="rh-card-menu-list hidden" id="rh-menu-${esc(r.id)}">
              <button class="rh-card-menu-item" onclick="showRehearsalEditModal('${esc(r.id)}')">Edit Rehearsal</button>
              <button class="rh-card-menu-item" onclick="showRehearsalPlanModal('${esc(r.id)}')">Rehearsal Plan</button>
              ${ended ? `<button class="rh-card-menu-item" onclick="reopenRehearsal('${esc(r.id)}')">Reopen Rehearsal</button>` : ''}
              <button class="rh-card-menu-item rh-menu-danger" onclick="confirmDeleteRehearsal('${esc(r.id)}')">Delete Rehearsal</button>
            </div>
          </div>` : '';
        if (!ended) {
          return `
            <div class="card rh-card ${stateCls}">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-bold">${fmtDate(r.date)}</div>
                  ${r.label ? `<div class="text-muted text-sm mt-4">${esc(r.label)}</div>` : ''}
                  <div class="rh-status-row">
                    <span class="rh-badge rh-badge-open">Open</span>
                    ${isActive ? `<span class="rh-badge rh-badge-active">Active</span>` : ''}
                    ${featureOn('attendance') && attDone ? `<span class="rh-badge rh-badge-att">Attendance ✓</span>` : ''}
                    ${r.scope ? `<span class="rh-badge rh-badge-scope">👥 ${esc(rehearsalScopeLabel(r.scope))}</span>` : ''}
                  </div>
                </div>
                <div class="flex gap-6 items-center">
                  ${featureOn('marks') ? `
                  ${cnt > 0 ? `<span class="badge badge-neutral">${cnt} tracked</span>` : ''}
                  ${errs > 0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
                  ${pos  > 0 ? `<span class="badge badge-success">${pos}✓</span>` : ''}` : ''}
                  ${menuBtn}
                </div>
              </div>
              ${STATE.isAdmin ? `
              ${featureOn('attendance') || featureOn('marks') ? `
              <div class="rh-card-actions">
                ${featureOn('attendance') ? `
                <button class="btn btn-sm ${attDone ? 'btn-success' : 'btn-primary'}"
                  onclick="navigate('attendance',{rid:'${esc(r.id)}',from:'rehearsals'})">
                  ${attDone ? '✓ Attendance Done' : '📋 Take Attendance'}
                </button>` : ''}
                ${featureOn('marks') ? `
                <button class="btn btn-sm btn-secondary"
                  onclick="switchToFeedback('${esc(r.id)}')">
                  ✏️ Student Feedback
                </button>` : ''}
              </div>` : ''}
              <button class="btn btn-sm btn-danger btn-full" style="margin-top:8px"
                onclick="confirmEndRehearsal('${esc(r.id)}')">End Rehearsal</button>` : ''}
            </div>`;
        }
        return `
          <div class="card clickable rh-card ${stateCls}" onclick="showEndedRehearsalOptions('${esc(r.id)}')">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-bold">${fmtDate(r.date)}</div>
                ${r.label ? `<div class="text-muted text-sm mt-4">${esc(r.label)}</div>` : ''}
                <div class="rh-status-row">
                  <span class="rh-badge rh-badge-ended">Ended</span>
                  ${featureOn('attendance') && attDone ? `<span class="rh-badge rh-badge-att">Attendance ✓</span>` : ''}
                  ${r.scope ? `<span class="rh-badge rh-badge-scope">👥 ${esc(rehearsalScopeLabel(r.scope))}</span>` : ''}
                </div>
              </div>
              <div class="flex gap-6 items-center">
                ${featureOn('marks') ? `
                ${cnt > 0 ? `<span class="badge badge-neutral">${cnt} tracked</span>` : ''}
                ${errs > 0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
                ${pos  > 0 ? `<span class="badge badge-success">${pos}✓</span>` : ''}` : ''}
                ${menuBtn}
              </div>
            </div>
          </div>`;
}

// ── Rehearsals calendar ───────────────────────────────────────────────────────

const _RH_DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function _rhCalendarHtml() {
  if (!_rhCalMonth) _rhCalMonth = today().slice(0, 7); // default to the current month
  const [y, m] = _rhCalMonth.split('-').map(Number); // m = 1..12
  const firstDow    = new Date(y, m - 1, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayStr    = today();

  // Rehearsals on each date this month.
  const byDate = {};
  DB.getRehearsals().forEach(r => {
    if (r.date.slice(0, 7) === _rhCalMonth) (byDate[r.date] = byDate[r.date] || []).push(r);
  });

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="rh-cal-cell rh-cal-empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds      = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const list    = byDate[ds] || [];
    const isToday = ds === todayStr ? ' rh-cal-today' : '';
    if (list.length) {
      const allEnded = list.every(r => r.ended);
      const dotCls   = allEnded ? 'rh-cal-dot--ended' : 'rh-cal-dot--open';
      cells += `<button class="rh-cal-cell rh-cal-has${isToday}" onclick="rhDateClick(this,'${ds}')" title="${esc(list.map(r => r.label || 'Rehearsal').join(', '))}">
        <span class="rh-cal-num">${d}</span>
        <span class="rh-cal-dot ${dotCls}">${list.length > 1 ? list.length : ''}</span>
      </button>`;
    } else {
      cells += `<div class="rh-cal-cell${isToday}"><span class="rh-cal-num">${d}</span></div>`;
    }
  }

  return `
    <div class="rh-cal">
      <div class="rh-cal-hdr">
        <button class="rh-cal-nav" onclick="rhCalNav(-1)" aria-label="Previous month">‹</button>
        <span class="rh-cal-title">${_RH_MONTHS[m-1]} ${y}</span>
        <button class="rh-cal-nav" onclick="rhCalNav(1)" aria-label="Next month">›</button>
      </div>
      <div class="rh-cal-grid">${_RH_DOW.map(d => `<div class="rh-cal-dowlbl">${d}</div>`).join('')}</div>
      <div class="rh-cal-grid">${cells}</div>
      <div class="rh-cal-legend">
        <span><i class="rh-cal-dot rh-cal-dot--ended"></i> Ended</span>
        <span><i class="rh-cal-dot rh-cal-dot--open"></i> Open</span>
        <span class="rh-cal-legend-hint">Tap a date for its attendance &amp; marks</span>
      </div>
    </div>`;
}

function rhCalNav(delta) {
  if (!_rhCalMonth) _rhCalMonth = today().slice(0, 7);
  let [y, m] = _rhCalMonth.split('-').map(Number);
  m += delta;
  while (m < 1)  { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  _rhCalMonth = `${y}-${String(m).padStart(2,'0')}`;
  render();
}

// Calendar day click → an anchored popover bubble with View Attendance / View
// Marks for that date's rehearsal(s). Respects which features are enabled.
function rhDateClick(anchorEl, dateStr) {
  _closeRhBubble();
  const list = DB.getRehearsals().filter(r => r.date === dateStr);
  if (!list.length) return;
  const multi = list.length > 1;
  const pop = document.createElement('div');
  pop.id = 'rh-cal-pop';
  pop.className = 'rh-cal-pop';
  pop.innerHTML = `
    <div class="rh-pop-date">${esc(fmtDate(dateStr))}</div>
    ${list.map(r => `
      <div class="rh-pop-item">
        ${(multi || r.label) ? `<div class="rh-pop-label">${esc(r.label || 'Rehearsal')}${r.ended ? '' : ' · open'}</div>` : ''}
        <div class="rh-pop-actions">
          ${featureOn('attendance') ? `<button class="rh-pop-btn" onclick="rhPopGo('attendance','${esc(r.id)}')">📋 Attendance</button>` : ''}
          ${featureOn('marks')      ? `<button class="rh-pop-btn" onclick="rhPopGo('marks','${esc(r.id)}')">✏️ Marks</button>` : ''}
        </div>
      </div>`).join('')}`;
  pop.onclick = e => e.stopPropagation();
  document.body.appendChild(pop);
  _positionRhBubble(pop, anchorEl);
  // Dismiss on any outside click or scroll (deferred so this click doesn't close it).
  setTimeout(() => {
    document.addEventListener('click', _closeRhBubble, { once: true });
    document.addEventListener('scroll', _closeRhBubble, { once: true, capture: true });
  }, 0);
}

function _positionRhBubble(pop, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const margin = 8;
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
  let top = r.bottom + 8, above = false;
  if (top + ph > window.innerHeight - margin) { top = r.top - ph - 8; above = true; }
  top = Math.max(margin, top);
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;
  pop.classList.toggle('rh-cal-pop--above', above);
  // Point the arrow at the date cell even when the bubble is clamped to an edge.
  const arrow = Math.max(12, Math.min(r.left + r.width / 2 - left, pw - 12));
  pop.style.setProperty('--rh-arrow', `${arrow}px`);
}

function _closeRhBubble() {
  const p = document.getElementById('rh-cal-pop');
  if (p) p.remove();
  document.removeEventListener('click', _closeRhBubble);
  document.removeEventListener('scroll', _closeRhBubble, { capture: true });
}

function rhPopGo(type, rid) {
  _closeRhBubble();
  if (type === 'attendance') navigate('attendance', { rid, from: 'rehearsals' });
  else viewHistoricalMarks(rid);
}

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

// ── View: Rehearsal Detail ────────────────────────────────────────────────────

function viewRehearsal(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return `<div class="empty-state"><p>Rehearsal not found.</p></div>`;

  const entries    = DB.getRehearsalEntries(rid);
  const students   = DB.getStudents();
  const activeEntry = _activeNum
    ? (entries[_activeNum] || { mistakes:0, positives:0, notes:'', events:[] })
    : null;
  const allEvts   = activeEntry?.events || [];
  const activeStu = _activeNum ? students[_activeNum] : null;


  const entryList = Object.entries(entries)
    .sort(([a],[b]) => (students[a]?.name || '').localeCompare(students[b]?.name || ''));

  // Active student card — shared across block and normal modes
  const activeCard = _activeNum ? `
    <div class="active-card">
      <div class="active-card-header">
        <div class="active-card-name">
          ${activeStu ? esc(activeStu.name || `#${_activeNum}`) : `#${esc(_activeNum)}`}
          ${activeStu
            ? `<span class="sub">${esc([fmtPos(activeStu.column,activeStu.row),normInstrument(activeStu.instrument)].filter(Boolean).join(' · '))}</span>`
            : '<span class="sub" style="color:var(--warning)"> Not in roster</span>'}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${activeStu ? `
          <button class="active-card-close" onclick="navigate('student',{num:'${esc(_activeNum)}'})" aria-label="View student profile" title="View student profile">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>` : ''}
          <button class="active-card-close" onclick="clearActive()" aria-label="Dismiss">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:18px;height:18px">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="active-counters">
        <div class="counter-col">
          <div class="counter-col-label mistakes">Mistakes</div>
          <div class="counter-value mistakes">${activeEntry.mistakes}</div>
          <button class="count-btn add-mistake"
            onclick="adjustCount('${esc(rid)}','${esc(_activeNum)}','mistakes',1)">
            +1 Mistake
          </button>
          ${activeEntry.mistakes > 0 ? `
            <button class="count-btn undo"
              onclick="adjustCount('${esc(rid)}','${esc(_activeNum)}','mistakes',-1)">
              Undo −1
            </button>` : ''}
        </div>
        <div class="counter-col">
          <div class="counter-col-label positives">Positives</div>
          <div class="counter-value positives">${activeEntry.positives}</div>
          <button class="count-btn add-positive"
            onclick="adjustCount('${esc(rid)}','${esc(_activeNum)}','positives',1)">
            +1 Positive
          </button>
          ${activeEntry.positives > 0 ? `
            <button class="count-btn undo"
              onclick="adjustCount('${esc(rid)}','${esc(_activeNum)}','positives',-1)">
              Undo −1
            </button>` : ''}
        </div>
      </div>

      ${allEvts.length > 0 ? `
        <div class="event-notes-section">
          <div class="event-notes-hdr">Notes per mark</div>
          ${allEvts.map((e,i) => {
            const canDelete = STATE.isAdmin || !e.by || e.by === STATE.user?.uid;
            return `
            <div class="event-note-row ${e.sectionMark ? 'is-section-mark' : ''}">
              <span class="event-note-type ${e.type==='mistake'?'is-mistake':'is-positive'}">${e.type==='mistake'?'✗':'✓'}</span>
              ${e.sectionMark ? `<span class="section-mark-badge">§ ${esc(e.section||'Section')}</span>` : ''}
              ${e.segment ? `<span class="event-seg">${esc(e.segment)}</span>` : ''}
              <input type="text" class="event-note-inp"
                     placeholder="what happened…"
                     value="${esc(e.note)}"
                     oninput="saveEventNote('${esc(rid)}','${esc(_activeNum)}',${i},this.value)">
              ${e.ts ? `<span class="event-note-time">${fmtTime(e.ts)}</span>` : ''}
              ${e.by ? `<span class="event-note-by">${esc(dirLabel(e.by))}</span>` : ''}
              ${canDelete ? `<button class="event-note-del" onclick="deleteEvent('${esc(rid)}','${esc(_activeNum)}',${i})" aria-label="Delete mark">×</button>` : ''}
            </div>`;
          }).join('')}
        </div>` : ''}

      <textarea class="active-notes" placeholder="General note for today…"
        oninput="saveNote('${esc(rid)}','${esc(_activeNum)}',this.value)">${esc(activeEntry.notes)}</textarea>

      ${!activeStu && STATE.isAdmin ? `
        <button class="btn btn-secondary btn-sm btn-full mt-8"
          onclick="showAddStudentModal('${esc(_activeNum)}')">
          + Add #${esc(_activeNum)} to Roster
        </button>` : ''}

      <button class="next-btn" onclick="clearActive()">
        ${_blockMode ? '← Back to Block Grid' : 'Submit Feedback'}
      </button>
    </div>` : '';

  // Tracker section — changes based on block mode
  let trackerSection;
  if (_blockMode && !_activeNum) {
    trackerSection = renderBlockNav(rid);
  } else if (_blockMode && _activeNum) {
    trackerSection = `
      <div class="tracker-card">
        <div class="block-active-hdr">
          <span class="block-active-label">Selected from Block Grid</span>
          <button class="block-ctrl-btn" onclick="clearActive()">← Grid</button>
        </div>
        ${activeCard}
      </div>`;
  } else {
    const searchVal    = _trackerFilter.search;
    const isNameSearch = searchVal.trim() && !/^\d+$/.test(searchVal.trim());
    // Tracker candidates are limited to the students this rehearsal applies to.
    const scopePool    = rehearsalStudents(r);
    const suggestions  = isNameSearch ? studentSuggestions(searchVal, _trackerFilter.instruments[0] || '', _trackerFilter.grades[0] || '', scopePool) : [];
    const activeFilterCount = _trackerFilter.instruments.length + _trackerFilter.grades.length + _trackerFilter.sections.length;
    // Only show the full student list when a filter is active — not by default
    const showAllForFilter = !searchVal.trim() && activeFilterCount > 0;
    const allFiltered = showAllForFilter
      ? filterAndSortStudents(scopePool, _trackerFilter)
      : [];
    const activeFilterLabel = [
      ..._trackerFilter.instruments,
      ..._trackerFilter.grades.map(g => g + ' Grade')
    ].filter(Boolean).join(', ');

    trackerSection = `
      <div class="tracker-card">
        ${!_activeNum ? `
          <div class="tracker-label">Track a Student</div>
          ${renderFilterBar('tracker', _trackerFilter, [
            {value:'name',       label:'Name'},
            {value:'number',     label:'Number'},
            {value:'instrument', label:'Instrument'},
            {value:'section',    label:'Section'},
            {value:'grade',      label:'Grade'}
          ], { extra: `<button class="inst-chip tracker-grid-btn" title="Open Block Grid" onclick="toggleBlockMode('${esc(rid)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;display:block">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </button>
            ${featureOn('drill') ? `<button class="inst-chip tracker-drill-btn${_drillSelectedNums.length ? ' tracker-drill-btn--active' : ''}" title="Load Pyware Drill" onclick="openDrillPicker()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;display:block">
                <polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
              </svg>
            </button>` : ''}` })}
          ${_drillSelectedNums.length ? `
            <div class="drill-selection-banner">
              <span class="drill-selection-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;display:inline-block;vertical-align:middle;margin-right:4px"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                ${_drillSelectedNums.length} student${_drillSelectedNums.length !== 1 ? 's' : ''} from drill
              </span>
              <button class="drill-clear-btn" onclick="clearDrillSelection('${esc(rid)}')">Clear</button>
            </div>` : ''}
          <button class="mark-all-btn" onclick="showMarkAllModal('${esc(rid)}')">
            Mark All${activeFilterLabel ? ` (${esc(activeFilterLabel)})` : ''}
          </button>
          <div id="tracker-suggestions" class="student-suggestions">
            ${_drillSelectedNums.length ? _drillSelectedNums.map(num => {
              const s = students[num];
              return `<div class="suggestion-row" onclick="pickStudent('${esc(num)}','${esc(rid)}')">
                <span class="suggestion-name">${esc(s?.name || `#${num}`)}</span>
                <span class="suggestion-detail">${esc([fmtPos(s?.column,s?.row),normInstrument(s?.instrument)].filter(Boolean).join(' · '))}</span>
              </div>`;
            }).join('') : ''}
            ${!_drillSelectedNums.length && isNameSearch ? suggestions.map(s => `
              <div class="suggestion-row" onclick="pickStudent('${esc(s.number)}','${esc(rid)}')">
                <span class="suggestion-name">${esc(s.name || `#${s.number}`)}</span>
                <span class="suggestion-detail">${esc([fmtPos(s.column,s.row),normInstrument(s.instrument)].filter(Boolean).join(' · '))}</span>
              </div>`).join('') : ''}
            ${!_drillSelectedNums.length && showAllForFilter ? allFiltered.map(s => `
              <div class="suggestion-row" onclick="pickStudent('${esc(s.number)}','${esc(rid)}')">
                <span class="suggestion-name">${esc(s.name || `#${s.number}`)}</span>
                <span class="suggestion-detail">${esc(fmtPos(s.column,s.row))}</span>
              </div>`).join('') : ''}
          </div>
        ` : ''}
        ${activeCard}
      </div>`;
  }

  // Attendance summary for the button
  const allEntries  = STATE.entries[rid] || {};
  const attAbsent   = Object.values(allEntries).filter(e => e.attendance === 'absent').length;
  const attLate     = Object.values(allEntries).filter(e => e.attendance === 'late').length;
  const totalRoster = rehearsalStudents(r).length;
  const attSummary  = (attAbsent || attLate) ? [
    attAbsent ? `${attAbsent} absent` : '',
    attLate   ? `${attLate} late`     : '',
    `${totalRoster - attAbsent - attLate} present`
  ].filter(Boolean).join(' · ') : '';

  const attSubmitted = r?.attendanceSubmitted;
  const showAttBtn   = featureOn('attendance');
  return `
    ${showAttBtn ? `
    <div class="rehearsal-action-row">
      <button class="att-screen-btn ${attSubmitted ? 'att-screen-btn-done' : ''}" style="flex:1;margin-bottom:0" onclick="navigate('attendance',{rid:'${esc(rid)}'})">
        <div class="att-screen-btn-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          ${attSubmitted ? 'Attendance ✓' : 'Take Attendance'}
        </div>
        ${attSummary ? `<div class="att-screen-btn-summary">${attSummary}</div>` : ''}
      </button>
    </div>` : ''}

    ${trackerSection}

    ${entryList.length ? `
      <div class="section-title">Tracked This Rehearsal (${entryList.length})</div>
      ${entryList.map(([num, entry]) => {
        const stu = students[num];
        return `
          <div class="entry-row ${_activeNum===num?'is-active':''}"
               onclick="pickStudent('${esc(num)}','${esc(rid)}')">
            <div class="entry-header">
              <div class="entry-student">
                ${stu ? esc(stu.name || `#${num}`) : `#${esc(num)}`}
                ${stu ? `<span class="sub">${esc([fmtPos(stu.column,stu.row),normInstrument(stu.instrument)].filter(Boolean).join(' · '))}</span>` : '<span class="sub" style="color:var(--warning)">Not in roster</span>'}
              </div>
              <div class="entry-badges">
                ${entry.attendance==='absent' ? `<span class="badge att-badge-absent">Absent</span>` : ''}
                ${entry.attendance==='late'   ? `<span class="badge att-badge-late">Late</span>`   : ''}
                <span class="badge ${entry.mistakes>0?'badge-danger':'badge-neutral'}">${entry.mistakes}✗</span>
                <span class="badge ${entry.positives>0?'badge-success':'badge-neutral'}">${entry.positives}✓</span>
              </div>
            </div>
            ${entry.notes ? `<div class="entry-notes">${esc(entry.notes)}</div>` : ''}
          </div>`;
      }).join('')}
    ` : `
      <div class="empty-state" style="padding:24px">
        <p>No students tracked yet.</p>
        <p>Enter a student number above to begin.</p>
      </div>`}

    ${r.ended ? `
      <div class="ended-banner">
        ✓ Rehearsal ended — auto marks applied
      </div>` : ''}
  `;
}

function pickStudent(num, rid) {
  _activeNum = num;
  _trackerFilter.search = '';
  document.getElementById('main-content').scrollTop = 0;
  reRender(rid);
}

function clearActive() {
  _activeNum = null;
  _trackerFilter.search = '';
  reRender(_params.rid);
}

function adjustCount(rid, num, field, delta) {
  if (delta > 0) {
    showMarkModal(rid, num, field === 'mistakes' ? 'mistake' : 'positive');
    return;
  }
  // Undo — instant, no modal
  const ents    = DB.getRehearsalEntries(rid);
  const cur     = ents[num] || { mistakes:0, positives:0, notes:'', events:[] };
  const newVal  = Math.max(0, (cur[field]||0) - 1);
  if (newVal === (cur[field]||0)) return;
  const events  = [...(cur.events || [])];
  const evtType = field === 'mistakes' ? 'mistake' : 'positive';
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === evtType) { events.splice(i, 1); break; }
  }
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  STATE.entries[rid][num] = { ...cur, [field]: newVal, events };
  fsUpsertEntry(rid, num, { mistakes: STATE.entries[rid][num].mistakes, positives: STATE.entries[rid][num].positives, notes: STATE.entries[rid][num].notes || '', events });
  reRender(rid);
}

function showMarkModal(rid, num, type) {
  const isMistake = type === 'mistake';
  const presets   = isMistake ? STATE.mistakePresets : STATE.positivePresets;
  const btnCls    = isMistake ? 'is-mistake' : 'is-positive';
  const r         = DB.getRehearsals().find(r => r.id === rid);
  const segments  = r?.segments || [];

  const segHtml = segments.length ? `
    <div class="form-label" style="margin-bottom:7px">Which part of rehearsal?</div>
    <div class="seg-chip-row">
      ${segments.map(s => `
        <button class="seg-chip${_pendingSegment === s ? ' seg-selected' : ''}"
                data-seg="${esc(s)}"
                onclick="selectSegment('${esc(s)}')">
          ${esc(s)}
        </button>`).join('')}
    </div>
    <div class="form-label" style="margin:14px 0 7px">${isMistake ? 'What was the mistake?' : 'What went well?'}</div>
  ` : '';

  openModal(`
    <div class="modal-title">${isMistake ? '✗ Log Mistake' : '✓ Log Positive'}</div>
    ${segHtml}
    <div class="quick-note-grid">
      ${presets.map(p => `
        <button class="quick-note-btn ${btnCls}"
          onclick="confirmMark('${esc(rid)}','${esc(num)}','${esc(type)}','${esc(p)}')">
          ${esc(p)}
        </button>`).join('')}
    </div>
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">Custom note</label>
      <input class="form-input" id="mark-note-input" type="text"
             placeholder="or type your own…" autocomplete="off"
             onkeydown="if(event.key==='Enter')confirmMarkCustom('${esc(rid)}','${esc(num)}','${esc(type)}')">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="confirmMark('${esc(rid)}','${esc(num)}','${esc(type)}','')">No Note</button>
      <button class="btn btn-primary" onclick="confirmMarkCustom('${esc(rid)}','${esc(num)}','${esc(type)}')">Add Custom</button>
    </div>
  `);
}

function confirmMark(rid, num, type, note) {
  const segment = _pendingSegment;
  closeModal();
  const field  = type === 'mistake' ? 'mistakes' : 'positives';
  const ents   = DB.getRehearsalEntries(rid);
  const cur    = ents[num] || { mistakes:0, positives:0, notes:'', events:[] };
  const newVal = (cur[field]||0) + 1;
  const events = [...(cur.events || [])];
  events.push({ type, note: note || '', segment, ts: Date.now(), by: STATE.user?.uid || '' });
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  STATE.entries[rid][num] = { ...cur, [field]: newVal, events };
  fsUpsertEntry(rid, num, { mistakes: STATE.entries[rid][num].mistakes, positives: STATE.entries[rid][num].positives, notes: STATE.entries[rid][num].notes || '', events });
  _recalcAutoBonuses(rid, num);
  reRender(rid);
}

function confirmMarkCustom(rid, num, type) {
  const note = document.getElementById('mark-note-input')?.value.trim() || '';
  confirmMark(rid, num, type, note);
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

function _getAutoMarks() {
  return STATE.autoMarks ?? DEFAULT_AUTO_MARKS;
}

function _checkAutoMarkCondition(mark, att, mistakes) {
  return checkAutoMarkCondition(mark, att, mistakes); // pure core in 00-logic.js
}

function _computeAutoMarkEvents(entry, r) {
  return computeAutoMarkEvents(entry, r, _getAutoMarks());
}

function _recalcAutoBonuses(rid, num) {
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r?.attendanceSubmitted && !r?.ended) return;
  const entry = STATE.entries[rid]?.[num];
  if (!entry) return;

  const events    = _computeAutoMarkEvents(entry, r);
  const positives = events.filter(e => e.type === 'positive').length;
  STATE.entries[rid][num] = { ...entry, events, positives };
  fsUpsertEntry(rid, num, {
    mistakes:  entry.mistakes || 0,
    positives,
    notes:     entry.notes   || '',
    events,
    ...(entry.attendance ? { attendance: entry.attendance } : {})
  });
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

// ── Group Marks ───────────────────────────────────────────────────────────────

function showMarkAllModal(rid) {
  const instParts  = _trackerFilter.instruments;
  const gradeParts = _trackerFilter.grades;
  const hasFilter  = instParts.length || gradeParts.length;
  // Store filter snapshot so _groupMatches can apply OR-within/AND-across logic
  _pendingMarkAllFilter = hasFilter ? { instruments: [...instParts], grades: [...gradeParts] } : null;
  const groupName  = hasFilter ? '__filtered__' : '__all__';
  const filterLabel = [
    instParts.join(', '),
    gradeParts.map(g => g + ' Grade').join(', ')
  ].filter(Boolean).join(', ') || 'entire band';
  const count = rehearsalStudents(rid).filter(s =>
    (!instParts.length  || instParts.includes(normInstrument(s.instrument))) &&
    (!gradeParts.length || gradeParts.includes(s.grade || ''))
  ).length;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Mark All
      <div style="font-size:0.78rem;font-weight:400;color:var(--text-muted);margin-top:2px">${esc(filterLabel)} · ${count} student${count!==1?'s':''}</div>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-mistake" onclick="closeModal();showGroupMarkModal('${esc(rid)}','${esc(groupName)}','mistake')">✗ Mistake</button>
      <button class="btn btn-success" onclick="closeModal();showGroupMarkModal('${esc(rid)}','${esc(groupName)}','positive')">✓ Positive</button>
    </div>
  `);
}

function showGroupPickerModal(rid) {
  const instruments = instrumentsInRoster();
  const sections    = sectionsInRoster();

  const chipRow = (items) => items.map(name =>
    `<button class="seg-chip" onclick="selectGroupChip('${esc(name)}')">${esc(name)}</button>`
  ).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Mark a Group</div>
    <div class="form-group" style="margin-bottom:14px">
      <label class="form-label">Group name</label>
      <input class="form-input" id="group-name-input" type="text"
             placeholder="e.g. Flute, Woodwinds…"
             autocomplete="off" autocapitalize="words">
    </div>
    ${instruments.length ? `
      <div class="form-label" style="margin-bottom:6px">By Instrument</div>
      <div class="seg-chip-row" style="flex-wrap:wrap;margin-bottom:${sections.length ? '14px' : '4px'}">${chipRow(instruments)}</div>` : ''}
    ${sections.length ? `
      <div class="form-label" style="margin-bottom:6px">By Section</div>
      <div class="seg-chip-row" style="flex-wrap:wrap;margin-bottom:4px">${chipRow(sections)}</div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-mistake"   onclick="pickGroupMark('${esc(rid)}','mistake')">✗ Mark</button>
      <button class="btn btn-success"   onclick="pickGroupMark('${esc(rid)}','positive')">✓ Positive</button>
    </div>
  `);
}

function selectGroupChip(name) {
  const inp = document.getElementById('group-name-input');
  if (inp) inp.value = name;
}

function pickGroupMark(rid, type) {
  const groupName = document.getElementById('group-name-input')?.value.trim();
  if (!groupName) { showToast('Enter or select a group name.'); return; }
  showGroupMarkModal(rid, groupName, type);
}

function _groupMatches(s, groupName) {
  if (groupName === '__all__') return true;
  // Multi-select mark-all: uses stored filter snapshot (OR within category, AND across)
  if (groupName === '__filtered__') {
    const f = _pendingMarkAllFilter;
    if (!f) return true;
    return (!f.instruments.length || f.instruments.includes(normInstrument(s.instrument))) &&
           (!f.grades.length      || f.grades.includes(s.grade || ''));
  }
  // Custom group name (from showGroupPickerModal) — pipe-separated, ALL parts must match
  const parts = groupName.split('|');
  return parts.every(part => {
    const p = part.trim().toLowerCase();
    return normInstrument(s.instrument).toLowerCase() === p ||
           (s.section || '').toLowerCase() === p ||
           (s.grade   || '').toLowerCase() === p;
  });
}

function showGroupMarkModal(rid, groupName, type) {
  const isMistake   = type === 'mistake';
  const presets     = isMistake ? STATE.mistakePresets : STATE.positivePresets;
  const btnCls      = isMistake ? 'is-mistake' : 'is-positive';
  const r           = DB.getRehearsals().find(r => r.id === rid);
  const segments    = r?.segments || [];
  const isAll       = groupName === '__all__';
  const displayName = isAll ? 'All Students' : groupName;
  // Group marks are confined to the rehearsal's in-scope students.
  const scopePool   = rehearsalStudents(rid);
  const students    = isAll
    ? scopePool
    : scopePool.filter(s => _groupMatches(s, groupName));

  const segHtml = segments.length ? `
    <div class="form-label" style="margin-bottom:7px">Which part of rehearsal?</div>
    <div class="seg-chip-row">
      ${segments.map(s => `
        <button class="seg-chip${_pendingSegment === s ? ' seg-selected' : ''}"
                data-seg="${esc(s)}"
                onclick="selectSegment('${esc(s)}')">
          ${esc(s)}
        </button>`).join('')}
    </div>
    <div class="form-label" style="margin:14px 0 7px">${isMistake ? 'What was the mistake?' : 'What went well?'}</div>
  ` : '';

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${isMistake ? '✗' : '✓'} ${esc(displayName)}
      <div style="font-size:0.78rem;font-weight:400;color:var(--text-muted);margin-top:2px">${students.length} student${students.length!==1?'s':''}</div>
    </div>
    ${segHtml}
    <div class="quick-note-grid">
      ${presets.map(p => `
        <button class="quick-note-btn ${btnCls}"
          onclick="confirmGroupMark('${esc(rid)}','${esc(groupName)}','${esc(type)}','${esc(p)}')">
          ${esc(p)}
        </button>`).join('')}
    </div>
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">Custom note</label>
      <input class="form-input" id="mark-note-input" type="text"
             placeholder="or type your own…" autocomplete="off"
             onkeydown="if(event.key==='Enter')confirmGroupMarkCustom('${esc(rid)}','${esc(groupName)}','${esc(type)}')">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="confirmGroupMark('${esc(rid)}','${esc(groupName)}','${esc(type)}','')">No Note</button>
      <button class="btn btn-primary" onclick="confirmGroupMarkCustom('${esc(rid)}','${esc(groupName)}','${esc(type)}')">Add Custom</button>
    </div>
  `);
}

function confirmGroupMarkCustom(rid, groupName, type) {
  const note = document.getElementById('mark-note-input')?.value.trim() || '';
  confirmGroupMark(rid, groupName, type, note);
}

async function confirmGroupMark(rid, groupName, type, note) {
  const segment = _pendingSegment;
  closeModal();
  const isAll    = groupName === '__all__';
  const scopePool = rehearsalStudents(rid);
  const stuList  = isAll
    ? scopePool
    : scopePool.filter(s => _groupMatches(s, groupName));
  if (!stuList.length) { showToast('No students found.'); return; }
  const field   = type === 'mistake' ? 'mistakes' : 'positives';
  const batch   = db.batch();
  const sectionLabel = isAll ? 'All Students' : groupName;
  const evt     = { type, note: note || '', segment, ts: Date.now(), by: STATE.user?.uid || '', sectionMark: true, section: sectionLabel };

  for (const stu of stuList) {
    const num    = String(stu.number || stu._id);
    const cur    = STATE.entries[rid]?.[num] || { mistakes: 0, positives: 0, notes: '', events: [] };
    const events = [...(cur.events || []), evt];
    const newVal = (cur[field] || 0) + 1;
    if (!STATE.entries[rid]) STATE.entries[rid] = {};
    STATE.entries[rid][num] = { ...cur, [field]: newVal, events };
    const att = cur.attendance || null;
    batch.set(orgCol('entries').doc(`${rid}_${num}`), {
      rehearsalId: rid, studentNumber: num,
      ..._seasonStampFor(rid),
      mistakes:  STATE.entries[rid][num].mistakes,
      positives: STATE.entries[rid][num].positives,
      notes: cur.notes || '', events,
      ...(att ? { attendance: att } : {}),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: STATE.user?.uid || ''
    }, { merge: true });
  }

  try {
    await batch.commit();
  } catch (e) {
    showToast('Write failed — check your connection.');
    return;
  }
  showToast(`${type === 'positive' ? 'Positive' : 'Mark'} applied to ${stuList.length} ${esc(sectionLabel)} student${stuList.length!==1?'s':''}.`);
  reRender(rid);
}

function saveNote(rid, num, notes) {
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  const cur = STATE.entries[rid][num] || { mistakes:0, positives:0, notes:'', events:[] };
  STATE.entries[rid][num] = { ...cur, notes };
  debounced(`note_${rid}_${num}`, () => fsUpsertEntry(rid, num, { notes }));
}

function saveEventNote(rid, num, idx, note) {
  if (!STATE.entries[rid]?.[num]) return;
  const events = [...(STATE.entries[rid][num].events || [])];
  if (!events[idx]) return;
  events[idx] = { ...events[idx], note };
  STATE.entries[rid][num] = { ...STATE.entries[rid][num], events };
  debounced(`evtnote_${rid}_${num}_${idx}`, () => fsUpsertEntry(rid, num, { events }));
}

function deleteEvent(rid, num, idx) {
  const cur = STATE.entries[rid]?.[num];
  if (!cur) return;
  const evt = (cur.events || [])[idx];
  if (!evt) return;
  // Enforce ownership — non-admins can only delete their own marks
  if (!STATE.isAdmin && evt.by && evt.by !== STATE.user?.uid) return;
  const events   = (cur.events || []).filter((_, i) => i !== idx);
  const mistakes  = events.filter(e => e.type === 'mistake').length;
  const positives = events.filter(e => e.type === 'positive').length;
  STATE.entries[rid][num] = { ...cur, events, mistakes, positives };
  fsUpsertEntry(rid, num, { events, mistakes, positives, notes: cur.notes || '' });
  _recalcAutoBonuses(rid, num);
  reRender(rid);
}

// ── Block Navigator ───────────────────────────────────────────────────────────

function findStudentAtPos(col, row, students) {
  for (const [num, s] of Object.entries(students)) {
    if (s.column === col && String(s.row) === String(row)) return num;
  }
  return null;
}

function toggleBlockMode(rid) {
  _blockMode = !_blockMode;
  _blockPath = [];
  if (_blockMode) { _activeNum = null; _trackerFilter.search = ''; }
  reRender(rid);
}

function blockDrillIn(rid, c0, c1, r0, r1) {
  _blockPath.push({ c0, c1, r0, r1 });
  reRender(rid);
}

function blockZoomOut(rid) {
  if (_blockPath.length > 0) { _blockPath.pop(); reRender(rid); }
}

function blockSelect(num, rid) {
  pickStudent(String(num), rid);
}

function blockSelectEmpty(pos) {
  showToast(`No student assigned to ${pos}`);
}

function initBlockPinch(rid) {
  const el = document.getElementById('block-nav');
  if (!el || _blockPath.length === 0) return;
  let startDist = 0, armed = false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length >= 2) {
      armed = true;
      startDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!armed || e.touches.length < 2) return;
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (d < startDist * 0.65) { armed = false; blockZoomOut(rid); }
  }, { passive: true });
  el.addEventListener('touchend', () => { armed = false; }, { passive: true });
}

function blockMiniGrid(rid, c0, c1, r0, r1) {
  const entries  = DB.getRehearsalEntries(rid);
  const students = DB.getStudents();
  const cols = c1 - c0 + 1;
  let dots = '';
  for (let r = r1; r >= r0; r--) {
    for (let c = c1; c >= c0; c--) {
      const num   = findStudentAtPos(COLUMNS[c], String(r), students);
      const entry = num ? entries[num] : null;
      const cls   = !num ? 'bd-empty'
        : (entry?.mistakes  > 0 ? 'bd-mistake'
        : (entry?.positives > 0 ? 'bd-positive' : 'bd-filled'));
      dots += `<span class="bd-dot ${cls}"></span>`;
    }
  }
  return `<div class="bd-mini" style="--bd-cols:${cols}">${dots}</div>`;
}

function renderBlockNav(rid) {
  const level = _blockPath.length;
  let c0 = 0, c1 = 11, r0 = 1, r1 = 12;
  if (level > 0) ({ c0, c1, r0, r1 } = _blockPath[level - 1]);
  const colCount = c1 - c0 + 1;
  const rowCount = r1 - r0 + 1;

  const crumb = level === 0 ? 'Full Block'
    : `${COLUMNS[c0]}–${COLUMNS[c1]} · Rows ${r0}–${r1}`;

  let gridHtml = '', gridCols = 2;

  if (level < 2) {
    const midC = c0 + Math.floor(colCount / 2) - 1;
    const midR = r0 + Math.floor(rowCount / 2) - 1;
    const regions = [
      [midC+1, c1,  midR+1, r1  ],
      [c0,    midC, midR+1, r1  ],
      [midC+1, c1,  r0,     midR],
      [c0,    midC, r0,     midR],
    ];
    gridHtml = regions.map(([rc0,rc1,rr0,rr1]) => `
      <div class="block-region" onclick="blockDrillIn('${esc(rid)}',${rc0},${rc1},${rr0},${rr1})">
        ${blockMiniGrid(rid, rc0, rc1, rr0, rr1)}
        <div class="block-region-label">${COLUMNS[rc0]}–${COLUMNS[rc1]}<br><span>Rows ${rr0}–${rr1}</span></div>
      </div>`).join('');
  } else {
    const entries  = DB.getRehearsalEntries(rid);
    const students = DB.getStudents();
    gridCols = colCount;
    for (let r = r1; r >= r0; r--) {
      for (let c = c1; c >= c0; c--) {
        const col  = COLUMNS[c];
        const pos  = `${col}${r}`;
        const num  = findStudentAtPos(col, String(r), students);
        const entry = num ? (entries[num] || null) : null;
        const cls  = !num ? 'bc-empty'
          : (entry?.mistakes  > 0 ? 'bc-mistake'
          : (entry?.positives > 0 ? 'bc-positive' : 'bc-assigned'));
        const fn   = num
          ? `blockSelect('${esc(num)}','${esc(rid)}')`
          : `blockSelectEmpty('${esc(pos)}')`;
        const bcName = num ? (students[num]?.name || `#${num}`) : '';
        gridHtml += `
          <div class="block-cell ${cls}" onclick="${fn}">
            <div class="bc-pos">${esc(pos)}</div>
            ${bcName ? `<div class="bc-num">${esc(bcName)}</div>` : ''}
            ${(entry?.mistakes||0)+(entry?.positives||0) > 0 ? `
              <div class="bc-marks">
                ${entry.mistakes  > 0 ? `<span class="bc-m">${entry.mistakes}✗</span>`  : ''}
                ${entry.positives > 0 ? `<span class="bc-p">${entry.positives}✓</span>` : ''}
              </div>` : ''}
          </div>`;
      }
    }
  }

  return `
    <div class="block-nav" id="block-nav">
      <div class="block-nav-hdr">
        <div class="block-crumb">${esc(crumb)}</div>
        <div style="display:flex;gap:6px;align-items:center">
          ${level > 0 ? `<button class="block-ctrl-btn" onclick="blockZoomOut('${esc(rid)}')">← Back</button>` : ''}
          <button class="block-ctrl-btn" onclick="toggleBlockMode('${esc(rid)}')">✕ Close</button>
        </div>
      </div>
      <div class="block-grid" style="grid-template-columns:repeat(${gridCols},1fr)">
        ${gridHtml}
      </div>
      <div class="block-footer">
        <span>Col ${COLUMNS[c1 > 11 ? 11 : c1]}</span>
        <span>↑ Back &nbsp;·&nbsp; Front ↓</span>
        <span>Col ${COLUMNS[c0]}</span>
      </div>
    </div>`;
}

function reRender(rid) {
  const mc = document.getElementById('main-content');
  const st = mc.scrollTop;
  if (_view === 'student') {
    mc.innerHTML = viewStudent(_params.num);
  } else if (_view === 'attendance') {
    mc.innerHTML = viewAttendance(rid);
  } else if (_view === 'rehearsal') {
    mc.innerHTML = viewRehearsal(rid);
    if (_blockMode && !_activeNum) initBlockPinch(rid);
  } else if (_view === 'drill' && typeof _drillViewRenderSvg === 'function') {
    // Quick-marks added from the drill viewer: refresh its info panel tally.
    _drillViewRenderSvg();
    return;
  }
  mc.scrollTop = st;
}
