// Band Tracker — js/06-roster.js — Home + roster views, roster options, student codes.
// Plain script sharing global scope; load order is set in index.html.

// ── View: Home ────────────────────────────────────────────────────────────────

function viewHome() {
  const students   = DB.getStudents();
  const rehearsals = DB.getRehearsals();
  const todayStr   = today();
  const todayR     = rehearsals.find(r => r.date === todayStr);
  const sc         = Object.keys(students).length;
  const recent     = [...rehearsals].sort((a,b) => b.date.localeCompare(a.date)).slice(0,5);

  return `
    <div class="hero">
      <div class="hero-date">${fmtDate(todayStr)}</div>
      <div class="hero-title">🎺 Band Marks</div>
      <div class="hero-sub">${sc} student${sc!==1?'s':''} · ${rehearsals.length} rehearsal${rehearsals.length!==1?'s':''}</div>
      ${todayR
        ? `<button class="btn btn-full btn-lg" style="background:white;color:var(--primary);margin-bottom:10px"
               onclick="navigate('rehearsal',{rid:'${esc(todayR.id)}'})">
               Continue Today's Rehearsal →
             </button>`
        : STATE.isAdmin
        ? `<button class="btn btn-full btn-lg" style="background:white;color:var(--primary);margin-bottom:10px"
               onclick="startToday()">
               Start Today's Rehearsal
             </button>`
        : ''
      }
      ${STATE.isAdmin ? `
      <button class="btn btn-full btn-lg"
        style="background:rgba(255,255,255,.15);color:white;border:2px solid rgba(255,255,255,.4);"
        onclick="showNewRehearsalModal()">
        New Rehearsal for Another Date
      </button>` : ''}
    </div>

    ${recent.length ? `
      <div class="section-title">Recent Rehearsals</div>
      ${recent.map(r => {
        const ents = DB.getRehearsalEntries(r.id);
        const cnt  = Object.values(ents).filter(e => e.mistakes > 0 || e.positives > 0 || e.attendance || e.events?.length).length;
        const errs = Object.values(ents).reduce((s,e)=>s+(e.mistakes||0),0);
        const pos  = Object.values(ents).reduce((s,e)=>s+(e.positives||0),0);
        return `
          <div class="card clickable" onclick="navigate('rehearsal',{rid:'${esc(r.id)}'})">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-bold">${fmtDate(r.date)}</div>
                ${r.label ? `<div class="text-muted text-sm mt-4">${esc(r.label)}</div>` : ''}
              </div>
              <div class="text-right">
                ${featureOn('marks') ? `
                <div class="text-sm text-muted">${cnt} tracked</div>
                <div class="flex gap-6 mt-4" style="justify-content:flex-end">
                  ${errs>0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
                  ${pos>0  ? `<span class="badge badge-success">${pos}✓</span>` : ''}
                </div>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')}
    ` : `
      <div class="empty-state">
        <div class="empty-icon">🎺</div>
        <p>No rehearsals yet.</p>
        <p>Tap <strong>Start Today's Rehearsal</strong> to begin!</p>
      </div>
    `}
  `;
}

function startToday() {
  if (!STATE.isAdmin) { showToast('Only directors can start a rehearsal.'); return; }
  const id = genId();
  const r  = { id, date: today(), label: '', ...(STATE.activeSeason ? { season: STATE.activeSeason } : {}) };
  STATE.rehearsals.unshift(r);
  orgCol('rehearsals').doc(id).set(r);
  navigate('attendance-tab');
}

// ── View: Roster ──────────────────────────────────────────────────────────────

function instrumentsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.instrument) seen.add(normInstrument(s.instrument)); });
  return [...seen].sort((a, b) => instrOrder(a) - instrOrder(b));
}

function sectionsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.section) seen.add(s.section); });
  return [...seen].sort();
}

function gradesInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.grade) seen.add(s.grade); });
  return GRADE_LEVELS.filter(g => seen.has(g));
}

function instrumentFilterChips(activeFilter, fnName, fnFirstArg) {
  const instruments = instrumentsInRoster();
  if (!instruments.length) return '';
  const call = (inst) => fnFirstArg !== undefined
    ? `${fnName}('${esc(fnFirstArg)}','${inst}')`
    : `${fnName}('${inst}')`;
  return `
    <div class="inst-filter-row">
      <button class="inst-chip ${!activeFilter ? 'inst-active' : ''}"
              onclick="${call('')}">All</button>
      ${instruments.map(inst => `
        <button class="inst-chip ${activeFilter === inst ? 'inst-active' : ''}"
                onclick="${call(esc(inst))}">${esc(inst)}</button>
      `).join('')}
    </div>`;
}

function viewRoster() {
  const students = DB.getStudents();
  const allStudents = Object.values(students);
  const scoreMap = _rosterScoreMap();
  const filtered = filterAndSortStudents(allStudents, _rosterFilter, scoreMap);

  const rosterSortOpts = [
    {value:'name',   label:'Name'},
    {value:'number', label:'Number'},
    ...(hasField('instrument') ? [{value:'instrument', label:'Instrument'}] : []),
    ...(hasField('section')    ? [{value:'section',    label:'Section'}]    : []),
    ...(hasField('grade')      ? [{value:'grade',      label:'Grade'}]      : []),
    ...(featureOn('marks') ? [
      {value:'positives', label:'Positive Marks'},
      {value:'mistakes',  label:'Negative Marks'},
    ] : []),
    ...(featureOn('songs') && STATE.songs.length ? [{value:'passed', label:'Songs Completed'}] : []),
  ];
  if (STATE.isAdmin && allStudents.length === 0) {
    return viewRosterOnboarding();
  }

  return `
    ${renderFilterBar('roster', _rosterFilter, rosterSortOpts)}
    <div id="roster-list">${rosterRows(filtered, scoreMap)}</div>
  `;
}

function viewRosterOnboarding() {
  const bandName = STATE.bandName || 'your band';
  return `
    <div class="onboard-card">
      <div class="onboard-card-title">👋 Welcome to ${esc(bandName)}!</div>
      <div class="onboard-card-sub">Let's get your roster set up. Follow these two steps to get started.</div>
      <div class="onboard-steps">

        <div class="onboard-step">
          <div class="onboard-step-num">1</div>
          <div>
            <div class="onboard-step-title">Configure your fields</div>
            <div class="onboard-step-desc">Choose which details to track for each student — marching position, instrument, grade, and more. You can also add your own custom fields like locker number or bus route.</div>
            <div class="onboard-step-btns">
              <button class="btn btn-secondary" onclick="showManageFieldsModal()">Manage Fields</button>
            </div>
          </div>
        </div>

        <div class="onboard-step">
          <div class="onboard-step-num">2</div>
          <div>
            <div class="onboard-step-title">Add your students</div>
            <div class="onboard-step-desc">Import your entire roster from a CSV file in seconds, or add students one at a time.</div>
            <div class="onboard-step-btns">
              <button class="btn btn-primary" onclick="showImportModal()">Import CSV</button>
              <button class="btn btn-secondary" onclick="showAddStudentModal()">Add Manually</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

// A student's field-spot assignments across shows, as [{ show, label, shared }]
// sorted by show name. Director/staff clients read them live from the loaded
// show maps (STATE.shows); students — who can't read the shows collection — read
// the mirror the director publishes onto their own student doc (s.spots).
function studentSpots(s) {
  if (!s) return [];
  const num = String(s.number);
  if (STATE.shows && Object.keys(STATE.shows).length) {
    const out = [];
    Object.values(STATE.shows).forEach(show => {
      const mapping = show.mapping || {};
      for (const label of Object.keys(mapping)) {
        const nums = drillSpotNums(mapping[label]);
        if (nums.includes(num)) { out.push({ show: show.name || 'Show', label, shared: nums.length > 1 }); break; }
      }
    });
    return out.sort((a, b) => (a.show || '').localeCompare(b.show || ''));
  }
  const m = s.spots || {};
  return Object.keys(m)
    .map(sid => ({ show: m[sid].show || 'Show', label: m[sid].label, shared: !!m[sid].shared }))
    .sort((a, b) => (a.show || '').localeCompare(b.show || ''));
}

// Compact "M1 · X5" (labels only) for tight rows.
function _studentSpotText(s) {
  return studentSpots(s).map(sp => sp.label).join(' · ');
}

// A student's full spot history across shows — every spot they've held and for
// how long. Directors only: built from the director-only spotHistory docs
// (STATE.spotHistory) merged with the live show maps, so current assignments
// show up even if they predate history tracking. Shows whose docs were deleted
// keep their history under the name stored on the history doc. Returns
// [{ show, showId, label, start, end, current }] with current spans first.
function studentSpotHistory(num) {
  if (!STATE.isAdmin) return [];
  const n = String(num);
  const out = [];
  const ids = new Set([...Object.keys(STATE.spotHistory || {}), ...Object.keys(STATE.shows || {})]);
  ids.forEach(sid => {
    const hist = (STATE.spotHistory || {})[sid];
    const show = (STATE.shows || {})[sid];
    spotHistorySpans(hist?.events || [], show?.mapping || {})
      .filter(sp => sp.num === n)
      .forEach(sp => out.push({ ...sp, showId: sid, show: show?.name || hist?.name || 'Show' }));
  });
  return out.sort((a, b) =>
    (b.current - a.current)
    || ((b.end ?? Infinity) - (a.end ?? Infinity))
    || ((b.start || 0) - (a.start || 0)));
}

// Compact duration for a spot span, e.g. "9 days", "6 wks", "3 mo".
function _spotSpanDur(start, end) {
  if (!start) return '';
  const days = Math.max(1, Math.round(((end || Date.now()) - start) / 86400000));
  if (days < 14) return `${days} day${days !== 1 ? 's' : ''}`;
  if (days < 75) { const w = Math.round(days / 7); return `${w} wk${w !== 1 ? 's' : ''}`; }
  const mo = Math.round(days / 30.4);
  return `${mo} mo`;
}

// One span's date line: "Sep 2, 2026 – Oct 14, 2026 · 6 wks", "since Sep 2,
// 2026 · 3 wks" for a current spot, with pre-tracking gaps spelled out.
function _spotSpanText(sp) {
  const dur = _spotSpanDur(sp.start, sp.current ? null : sp.end);
  if (sp.current) {
    if (!sp.start) return 'current · assigned before spot tracking began';
    return `since ${fmtDateFromTs(sp.start)}${dur ? ` · ${dur}` : ''}`;
  }
  if (!sp.start && sp.end) return `until ${fmtDateFromTs(sp.end)} · assigned before spot tracking began`;
  if (sp.start && !sp.end)  return `from ${fmtDateFromTs(sp.start)}`;
  return `${fmtDateFromTs(sp.start)} – ${fmtDateFromTs(sp.end)}${dur ? ` · ${dur}` : ''}`;
}

// Rows shared by the student-page card and the chart's spot-history modal.
// Each span: an optional spot badge, a title line, and the date range.
function _spotHistRowsHtml(spans, { title, badge = true }) {
  return spans.map(sp => `
    <div class="spot-hist-row">
      ${badge ? `<span class="spot-hist-label">${esc(sp.label)}</span>` : ''}
      <div class="spot-hist-info">
        <div class="spot-hist-title">${title(sp)}${sp.current ? ` <span class="spot-hist-current">current</span>` : ''}</div>
        <div class="spot-hist-dates">${esc(_spotSpanText(sp))}</div>
      </div>
    </div>`).join('');
}

// Badges (label · show) for the profile card.
function _studentSpotBadges(s) {
  return studentSpots(s).map(sp =>
    `<span class="badge badge-primary" style="font-weight:800" title="${esc(sp.show)}${sp.shared ? ' · shared spot' : ''}">${esc(sp.label)}<span style="font-weight:600;opacity:.82"> · ${esc(sp.show)}</span>${sp.shared ? ' 👥' : ''}</span>`
  ).join('');
}

// Per-student totals behind the roster's marks/songs ticks AND the score-based
// sort options (positives, mistakes, passed). Built once per render and shared
// by both the sorter and the row renderer so each student's history is scanned
// only once. `passed` is 0 for memorization-excluded students (they get no
// song tick).
function _rosterScoreMap() {
  const map = {};
  const rehearsals = DB.getRehearsals();
  const attendanceOn = featureOn('attendance');
  for (const s of Object.values(DB.getStudents())) {
    const hist = DB.getStudentHistory(s.number);
    const mistakes  = hist.reduce((sum,e)=>sum+(e.entry.mistakes||0),0);
    const positives = hist.reduce((sum,e)=>sum+(e.entry.positives||0),0);
    const passed = (featureOn('songs') && !memExcluded(s))
      ? STATE.songs.filter(song => song.statuses?.[String(s.number)]?.status === 'passed').length
      : 0;
    const streak = attendanceOn ? rehearsalStreak(rehearsals, STATE.entries, s) : 0;
    map[s.number] = { mistakes, positives, passed, streak };
  }
  return map;
}

function rosterRows(list, scoreMap = _rosterScoreMap()) {
  if (!list.length) {
    return `<div class="empty-state" style="padding:24px"><p>No students match the current filter.</p></div>`;
  }

  // Total songs assigned to memorizing students — computed once for the whole
  // list rather than per row.
  const songsTotal = STATE.songs.length;
  return list.map(s => {
    const sc   = scoreMap[s.number] || { mistakes: 0, positives: 0, passed: 0, streak: 0 };
    const errs = sc.mistakes;
    const pos  = sc.positives;
    const streak = sc.streak || 0;
    // Songs passed off out of the total assigned. Excluded groups (e.g.
    // majorettes) don't memorize music, so they get no song tick.
    const showSongs   = featureOn('songs') && songsTotal > 0 && !memExcluded(s);
    const songsPassed = showSongs ? sc.passed : 0;
    return `
      <div class="roster-row" onclick="navigate('student',{num:'${esc(s.number)}'})">
        <div class="student-info">
          ${s.name ? `<div class="student-name">${esc(s.name)}</div>` : `<div class="student-name text-muted">#${esc(s.number)}</div>`}
          <div class="student-detail">${esc([
            _studentSpotText(s),
            hasField('instrument') ? normInstrument(s.instrument) : '',
            hasField('section')    ? s.section : '',
            ...(STATE.customStudentFields||[]).map(cf => s[cf.key] ? `${cf.label}: ${s[cf.key]}` : '')
          ].filter(Boolean).join(' · ')) || '<em style="color:var(--text-muted)">No details set</em>'}</div>
        </div>
        <div class="student-badges">
          ${streak > 1 ? `<span class="badge badge-streak" title="${streak} rehearsals in a row without an absence">🔥 ${streak}</span>` : ''}
          ${featureOn('marks') ? `
          ${errs > 0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
          ${pos > 0  ? `<span class="badge badge-success">${pos}✓</span>` : ''}` : ''}
          ${showSongs ? `<span class="badge badge-song" title="Songs passed off">${songsPassed}/${songsTotal} 🎵</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// filterRoster, filterRosterInstrument, filterRosterGrade replaced by updateFilter / unified filter bar

function showRosterOptionsModal() {
  const students = Object.values(DB.getStudents());
  const missingCodes = students.filter(s => !s.studentCode).length;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Roster Options</div>
    <div class="options-menu">
      <button class="options-menu-item" onclick="closeModal();showManageFieldsModal()">
        <div class="options-menu-icon">🗃️</div>
        <div>
          <div class="options-menu-label">Manage Fields</div>
          <div class="options-menu-sub">Toggle built-in fields and add custom ones</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showAutoGenerateCodesModal()">
        <div class="options-menu-icon">🔑</div>
        <div>
          <div class="options-menu-label">Auto-generate Student Codes</div>
          <div class="options-menu-sub">${missingCodes === 0 ? 'All students have codes' : `${missingCodes} student${missingCodes !== 1 ? 's' : ''} missing a code`}</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showExportCodesModal()">
        <div class="options-menu-icon">📤</div>
        <div>
          <div class="options-menu-label">Export Student Codes</div>
          <div class="options-menu-sub">Printable slips or a CSV to share codes with students</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showImportModal()">
        <div class="options-menu-icon">📥</div>
        <div>
          <div class="options-menu-label">Import from CSV</div>
          <div class="options-menu-sub">Add or update students in bulk</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showManageInstrumentsModal()">
        <div class="options-menu-icon">🎺</div>
        <div>
          <div class="options-menu-label">Manage Instruments</div>
          <div class="options-menu-sub">Add, edit, or remove available instruments</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showManageSectionsModal()">
        <div class="options-menu-icon">🗂️</div>
        <div>
          <div class="options-menu-label">Manage Sections</div>
          <div class="options-menu-sub">Add, edit, or remove band sections</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();randomizePseudonyms()">
        <div class="options-menu-icon">🎲</div>
        <div>
          <div class="options-menu-label">Randomize Leaderboard Names</div>
          <div class="options-menu-sub">Reassign all animal pseudonyms</div>
        </div>
      </button>
      <button class="options-menu-item options-menu-item-danger" onclick="closeModal();showDeleteRosterModal()">
        <div class="options-menu-icon">🗑</div>
        <div>
          <div class="options-menu-label">Delete Entire Roster</div>
          <div class="options-menu-sub">Permanently remove all students</div>
        </div>
      </button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function showManageFieldsModal() {
  if (!STATE.isAdmin) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Manage Fields</div>
    <div class="section-title" style="margin-top:0">Built-in Fields</div>
    <div class="form-hint" style="margin:0 0 10px">Toggle which fields appear in forms, roster cards, and CSV import.</div>
    ${STUDENT_FIELD_DEFS.map(f => `
      <label style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" id="sf-${f.key}" ${hasField(f.key)?'checked':''}
               onchange="toggleBuiltinField('${f.key}')"
               style="width:18px;height:18px;flex-shrink:0;cursor:pointer">
        <div>
          <div style="font-weight:600">${f.label}</div>
          <div class="form-hint" style="margin:2px 0 0">${f.description}</div>
        </div>
      </label>`).join('')}
    <div class="section-title" style="margin-top:18px">Custom Fields</div>
    <div class="form-hint" style="margin:0 0 10px">Add your own fields to student profiles.</div>
    <div class="preset-section">
      <div id="custom-field-list">${_renderCustomFieldList()}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-cf-input" type="text"
               placeholder="New field name…" maxlength="40"
               onkeydown="if(event.key==='Enter')addCustomField()">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addCustomField()">Add</button>
      </div>
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function toggleBuiltinField(key) {
  const current = STATE.activeStudentFields ?? STUDENT_FIELD_DEFS.map(f => f.key);
  const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
  STATE.activeStudentFields = next.length === STUDENT_FIELD_DEFS.length ? null : next;
  orgCol('settings').doc('presets').set({ activeStudentFields: next }, { merge: true });
  if (_view === 'roster') render();
}

function _renderCustomFieldList() {
  const fields = STATE.customStudentFields || [];
  if (!fields.length) return `<div class="preset-empty">No custom fields yet — add one below.</div>`;
  return fields.map(cf => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(cf.label)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editCustomField('${esc(cf.key)}')">Edit</button>
        <button class="preset-btn-del"  onclick="deleteCustomField('${esc(cf.key)}')">×</button>
      </div>
    </div>`).join('');
}

function addCustomField() {
  const input = document.getElementById('add-cf-input');
  const label = input?.value.trim();
  if (!label) return;
  const key = 'cf_' + Date.now();
  STATE.customStudentFields = [...(STATE.customStudentFields || []), { key, label }];
  _saveCustomFields();
  input.value = '';
  document.getElementById('custom-field-list').innerHTML = _renderCustomFieldList();
}

function deleteCustomField(key) {
  STATE.customStudentFields = (STATE.customStudentFields || []).filter(cf => cf.key !== key);
  _saveCustomFields();
  document.getElementById('custom-field-list').innerHTML = _renderCustomFieldList();
}

function editCustomField(key) {
  const cf = (STATE.customStudentFields || []).find(f => f.key === key);
  if (!cf) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Field</div>
    <input class="form-input" id="edit-cf-input" type="text"
           value="${esc(cf.label)}" maxlength="40"
           onkeydown="if(event.key==='Enter')saveEditCustomField('${esc(key)}')">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManageFieldsModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditCustomField('${esc(key)}')">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-cf-input')?.focus(), 60);
}

function saveEditCustomField(key) {
  const label = document.getElementById('edit-cf-input')?.value.trim();
  if (!label) return;
  STATE.customStudentFields = (STATE.customStudentFields || []).map(cf =>
    cf.key === key ? { key, label } : cf
  );
  _saveCustomFields();
  showManageFieldsModal();
}

async function _saveCustomFields() {
  try {
    await orgCol('settings').doc('presets').set(
      { customStudentFields: STATE.customStudentFields }, { merge: true }
    );
  } catch(e) {
    showToast('Failed to save custom fields.');
  }
}

function showMarksOptionsModal() {
  if (!STATE.isAdmin) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Marks Settings</div>
    <div class="options-menu">
      <button class="options-menu-item" onclick="closeModal();showManagePresetsModal()">
        <div class="options-menu-icon">✏️</div>
        <div>
          <div class="options-menu-label">Manage Mark Presets</div>
          <div class="options-menu-sub">Edit preset comments for marks</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showAutoMarksModal()">
        <div class="options-menu-icon">⚡</div>
        <div>
          <div class="options-menu-label">Auto Marks</div>
          <div class="options-menu-sub">Marks awarded automatically at rehearsal start or end</div>
        </div>
      </button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function showAutoGenerateCodesModal() {
  const students = Object.values(DB.getStudents());
  const missing = students.filter(s => !s.studentCode);
  if (!missing.length) {
    showToast('All students already have a code.');
    return;
  }
  showConfirmModal(
    'Auto-generate Student Codes',
    `Generate codes for <strong>${missing.length} student${missing.length !== 1 ? 's' : ''}</strong> who ${missing.length !== 1 ? 'are' : 'is'} missing one.<br><br>Existing codes will not be changed.`,
    autoGenerateStudentCodes,
    'Generate',
    'btn-primary'
  );
}

// A random student code. 8 chars from an unambiguous 32-symbol alphabet
// (≈1.1 trillion combinations) so collisions stay negligible across many orgs.
// `existing` de-dupes within the caller's batch; use generateUniqueStudentCode
// to also guarantee global uniqueness against the studentCodes collection.
function genStudentCode(existing = new Set()) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (existing.has(code));
  existing.add(code);
  return code;
}

// Generate a code that's unique BOTH within the caller's batch (`existing`) and
// globally in studentCodes — student codes share one namespace across all orgs,
// so a duplicate would either fail to register (rules block cross-org overwrite)
// or shadow another org's student. Falls back to a plain code if the check can't
// run (8-char codes already make a real collision astronomically unlikely).
async function generateUniqueStudentCode(existing = new Set()) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genStudentCode(existing);
    try {
      const snap = await db.collection('studentCodes').doc(code).get();
      if (!snap.exists) return code;
    } catch (e) {
      console.error('code uniqueness check failed:', e);
      return code;
    }
  }
  return genStudentCode(existing);
}

async function autoGenerateStudentCodes() {
  if (!STATE.isAdmin) return;
  const students = Object.values(STATE.students);
  const usedCodes = new Set(students.map(s => s.studentCode).filter(Boolean).map(c => c.toUpperCase()));
  const toUpdate = students.filter(s => !s.studentCode);
  if (!toUpdate.length) { showToast('All students already have a code.'); return; }

  const CHUNK = 500;
  // Generate locally-unique candidates, then confirm global uniqueness in
  // parallel (one round; 8-char codes make a real collision astronomically rare).
  const updates = toUpdate.map(s => ({ s, code: genStudentCode(usedCodes) }));
  await Promise.all(updates.map(async u => {
    for (let attempt = 0; attempt < 5; attempt++) {
      let exists;
      try { exists = (await db.collection('studentCodes').doc(u.code).get()).exists; }
      catch { return; } // can't check — keep the (long, low-collision) code
      if (!exists) return;
      u.code = genStudentCode(usedCodes); // collided: pick another and re-check
    }
  }));

  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = db.batch();
    updates.slice(i, i + CHUNK).forEach(({ s, code }) => {
      batch.update(orgCol('students').doc(s.number), { studentCode: code });
    });
    await batch.commit().catch(e => { showToast('Failed — ' + (e.message || 'check console')); throw e; });
  }

  for (const { s, code } of updates) {
    STATE.students[s.number] = { ...STATE.students[s.number], studentCode: code };
  }

  // Mirror new codes into the studentCodes lookup so students can sign in.
  let codeSyncFailed = false;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = db.batch();
    updates.slice(i, i + CHUNK).forEach(({ s, code }) => {
      batch.set(db.collection('studentCodes').doc(code.toUpperCase()),
        { orgId: STATE.orgId, studentNumber: String(s.number) }, { merge: true });
    });
    await batch.commit().catch(e => { console.error('studentCodes sync failed:', e); codeSyncFailed = true; });
  }

  if (codeSyncFailed) {
    showToast('Some codes could not be registered — please try again.');
  } else {
    showToast(`${updates.length} code${updates.length !== 1 ? 's' : ''} generated.`);
  }
  render();
}

// ── Export student codes ──────────────────────────────────────────────────────
// Handing out sign-in codes is a start-of-season chore, so give directors both
// shapes: a printable sheet of cut-apart slips (one per student, with the
// sign-in steps on it) and a CSV for a spreadsheet or mail merge. Codes are
// credentials — director-only, like the rest of the roster options menu.

let _exportCodesScope = 'all'; // 'all' | 'filtered'

// True when the roster's filter bar is actually narrowing the list, so the
// export can offer "just what I'm looking at".
function _rosterFilterIsNarrowing() {
  const f = _rosterFilter;
  return !!(f.search || f.instruments.length || f.sections.length || f.grades.length);
}

// The students to export, always alphabetical — the order you want when you're
// handing slips out or reading down a list.
function _exportCodeStudents() {
  const all = Object.values(DB.getStudents());
  const pool = _exportCodesScope === 'filtered' ? filterAndSortStudents(all, _rosterFilter) : all;
  return [...pool].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '') || String(a.number).localeCompare(String(b.number)));
}

function showExportCodesModal() {
  if (!STATE.isAdmin) return;
  const total = Object.keys(DB.getStudents()).length;
  if (!total) { showToast('No students to export yet.'); return; }
  _exportCodesScope = 'all';
  const narrowing = _rosterFilterIsNarrowing();
  const filteredCount = narrowing ? filterAndSortStudents(Object.values(DB.getStudents()), _rosterFilter).length : total;
  const missing = _exportCodeStudents().filter(s => !s.studentCode).length;

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Export Student Codes</div>
    <p class="form-hint" style="margin:0 0 16px">
      Name${hasField('instrument') ? ', instrument' : ''} and sign-in code for each student.
      Print the slips to cut apart and hand out, or download the CSV for a spreadsheet or mail merge.
      Slips print ${hasField('instrument') ? 'by instrument, then ' : ''}alphabetically by last name.
    </p>
    ${narrowing ? `
      <div class="form-label" style="margin-bottom:8px">Who to include</div>
      <div class="seg-chip-row" style="margin-bottom:16px">
        <button class="seg-chip seg-selected" id="exp-chip-all" onclick="selectExportCodesScope('all')">Whole roster (${total})</button>
        <button class="seg-chip" id="exp-chip-filtered" onclick="selectExportCodesScope('filtered')">Current filter (${filteredCount})</button>
      </div>` : ''}
    <div id="exp-codes-missing">${_exportCodesMissingNote(missing)}</div>
    <button class="btn btn-primary btn-full btn-lg" onclick="printStudentCodeSheet()">🖨 Print / Save PDF</button>
    <button class="btn btn-secondary btn-full" style="margin-top:8px" onclick="downloadStudentCodesCsv()">⬇️ Download CSV</button>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

// Slips are useless without a code, so say up front how many students would be
// skipped and offer the one-tap fix.
function _exportCodesMissingNote(missing) {
  if (!missing) return '';
  return `
    <div class="form-hint" style="margin:0 0 12px;color:var(--danger)">
      ${missing} student${missing !== 1 ? 's have' : ' has'} no code yet and will be left off the printed slips.
      <button class="btn-link" onclick="closeModal();showAutoGenerateCodesModal()"
        style="background:none;border:none;padding:0;color:var(--primary);text-decoration:underline;cursor:pointer;font-size:inherit">
        Generate codes first
      </button>
    </div>`;
}

function selectExportCodesScope(scope) {
  _exportCodesScope = scope;
  ['all', 'filtered'].forEach(s =>
    document.getElementById(`exp-chip-${s}`)?.classList.toggle('seg-selected', s === scope));
  const note = document.getElementById('exp-codes-missing');
  if (note) note.innerHTML = _exportCodesMissingNote(_exportCodeStudents().filter(s => !s.studentCode).length);
}

function downloadStudentCodesCsv() {
  if (!STATE.isAdmin) return;
  const students = _exportCodeStudents();
  if (!students.length) { showToast('No students in that selection.'); return; }
  closeModal();
  const slug = (STATE.bandName || 'band').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'band';
  _downloadCsv(`${slug}-student-codes.csv`,
    buildStudentCodesCsv(students, { includeInstrument: hasField('instrument') }));
}

// Slips come off the printer in the order they'll be handed out: instrument by
// instrument (score order), alphabetical by last name inside each. The CSV
// stays name-alphabetical — a spreadsheet can re-sort itself.
function printStudentCodeSheet() {
  if (!STATE.isAdmin) return;
  const withCode = _exportCodeStudents().filter(s => s.studentCode)
    .sort(compareStudentsByInstrumentThenLastName);
  if (!withCode.length) {
    showToast('No student in that selection has a code yet.');
    return;
  }
  closeModal();
  _printHtmlDocument(buildStudentCodeSheetHTML(withCode));
}

// Where students go to sign in — this deployment's own URL, so it's right for
// bandmarks.app and any other host the app is served from.
function _appSignInUrl() {
  return (location.origin + location.pathname).replace(/index\.html$/, '');
}

function buildStudentCodeSheetHTML(students) {
  const bandName = STATE.bandName || 'Band Marks';
  const urlShort = _appSignInUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');

  // The slip is written to the student, so it carries only what means something
  // to them: their name, their instrument and their code. Roster numbers are a
  // director's filing system — they stay in the CSV, off the slip.
  const slips = students.map(s => `
      <div class="slip">
        <div class="slip-band">${esc(bandName)}</div>
        <div class="slip-name">${esc(s.name || `Student #${s.number}`)}</div>
        ${hasField('instrument') && normInstrument(s.instrument)
          ? `<div class="slip-detail">${esc(normInstrument(s.instrument))}</div>` : ''}
        <div class="slip-code-label">Your sign-in code</div>
        <div class="slip-code">${esc(String(s.studentCode).toUpperCase())}</div>
        <div class="slip-section">First time — set your PIN</div>
        <ol class="slip-steps">
          <li>Go to <strong>${esc(urlShort)}</strong></li>
          <li>Tap <strong>Student Sign-In</strong></li>
          <li>Enter the code above</li>
          <li>Choose a 6-digit PIN you'll remember</li>
        </ol>
        <div class="slip-note">
          <strong>Keep this code to yourself until you've set your PIN</strong> — until then,
          anyone holding it could claim your account.
        </div>
        <div class="slip-note">
          After that your code is your <strong>username</strong> and your PIN is your
          <strong>password</strong> — you'll need both every time you sign in, so don't lose either.
        </div>
        <div class="slip-section">Keep it one tap away</div>
        <div class="slip-note">
          Add it to your phone's home screen and it opens like an app.
          <strong>iPhone:</strong> in Safari, tap the Share button, then <em>Add to Home Screen</em>.
          <strong>Android:</strong> in Chrome, tap the &#8942; menu, then <em>Install app</em>
          (or <em>Add to Home screen</em>).
        </div>
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Student Codes — ${esc(bandName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; background: #fff; padding: 24px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
  .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .slip { border: 1px dashed #9ca3af; border-radius: 8px; padding: 14px 16px; page-break-inside: avoid; break-inside: avoid; }
  .slip-band { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin-bottom: 6px; }
  .slip-name { font-size: 16px; font-weight: 700; line-height: 1.2; }
  .slip-detail { font-size: 11px; color: #6b7280; margin-bottom: 10px; }
  .slip-code-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }
  .slip-code { font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 22px; font-weight: 700; letter-spacing: .12em; margin: 2px 0 10px; }
  .slip-section { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 10px 0 4px; }
  .slip-steps { font-size: 11px; line-height: 1.5; padding-left: 16px; color: #374151; }
  .slip-note { font-size: 10px; line-height: 1.45; color: #4b5563; margin-top: 8px; }
  @media print {
    body { padding: 10px; }
    @page { margin: 1cm; }
  }
</style>
</head>
<body>
  <h1>Student Sign-In Codes</h1>
  <div class="meta">${esc(bandName)} &nbsp;·&nbsp; ${students.length} student${students.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Generated ${esc(fmtDate(today()))} &nbsp;·&nbsp; Cut apart and hand out</div>
  <div class="sheet">${slips}</div>
</body>
</html>`;
}

function showDeleteRosterModal() {
  const count = Object.keys(DB.getStudents()).length;
  if (!count) { showToast('Roster is already empty.'); return; }
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title" style="color:var(--danger)">Delete Entire Roster</div>
    <p style="font-size:.9rem;line-height:1.6;margin-bottom:8px">
      This will permanently delete <strong>all ${count} student${count !== 1 ? 's' : ''}</strong> from the roster.
    </p>
    <p style="font-size:.85rem;color:var(--text-muted);line-height:1.5;margin-bottom:16px">
      Rehearsal history and attendance records will remain but will no longer be linked to any student. This cannot be undone.
    </p>
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">Type <strong>DELETE</strong> to confirm</label>
      <input class="form-input" id="delete-roster-confirm" type="text"
             placeholder="DELETE" autocomplete="off"
             oninput="document.getElementById('delete-roster-btn').disabled = this.value !== 'DELETE'">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="delete-roster-btn" disabled onclick="deleteRoster()">Delete All Students</button>
    </div>
  `);
  setTimeout(() => document.getElementById('delete-roster-confirm')?.focus(), 80);
}

async function deleteRoster() {
  if (!STATE.isAdmin) return;
  const nums = Object.keys(STATE.students);
  if (!nums.length) { closeModal(); return; }

  closeModal();

  // Login codes to retire alongside the student docs.
  const codes = nums
    .map(num => STATE.students[num]?.studentCode)
    .filter(Boolean)
    .map(c => String(c).toUpperCase());

  const CHUNK = 500;
  for (let i = 0; i < nums.length; i += CHUNK) {
    const batch = db.batch();
    nums.slice(i, i + CHUNK).forEach(num => {
      batch.delete(orgCol('students').doc(num));
    });
    await batch.commit().catch(e => { showToast('Delete failed — ' + (e.message || 'check console')); throw e; });
  }

  // Retire login codes so they can't be used to rejoin as ghost students.
  for (let i = 0; i < codes.length; i += CHUNK) {
    const batch = db.batch();
    codes.slice(i, i + CHUNK).forEach(code => {
      batch.delete(db.collection('studentCodes').doc(code));
    });
    await batch.commit().catch(() => {});
  }

  // Remove student memberships so existing sessions lose access.
  try {
    const memSnap = await db.collection('members')
      .where('orgId', '==', STATE.orgId).where('role', '==', 'student').get();
    for (let i = 0; i < memSnap.docs.length; i += CHUNK) {
      const batch = db.batch();
      memSnap.docs.slice(i, i + CHUNK).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  } catch (e) { console.error('student membership cleanup failed:', e); }

  // Clear per-student results from song docs.
  if (STATE.songs.some(song => song.statuses && Object.keys(song.statuses).length)) {
    const batch = db.batch();
    STATE.songs.forEach(song => {
      if (song.statuses && Object.keys(song.statuses).length) {
        batch.update(orgCol('songs').doc(song.id), { statuses: {} });
      }
    });
    await batch.commit().catch(() => {});
  }

  STATE.students = {};
  showToast('Roster deleted.');
  render();
}

// filterTrackerInstrument and filterTrackerGrade replaced by updateFilter / unified filter bar

// ── View: Student Detail ──────────────────────────────────────────────────────
