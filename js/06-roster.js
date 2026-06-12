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
      <div class="hero-title">🎺 Band Tracker</div>
      <div class="hero-sub">${sc} student${sc!==1?'s':''} · ${rehearsals.length} rehearsal${rehearsals.length!==1?'s':''}</div>
      ${todayR
        ? `<button class="btn btn-full btn-lg" style="background:white;color:var(--primary);margin-bottom:10px"
               onclick="navigate('rehearsal',{rid:'${esc(todayR.id)}'})">
               Continue Today's Rehearsal →
             </button>`
        : `<button class="btn btn-full btn-lg" style="background:white;color:var(--primary);margin-bottom:10px"
               onclick="startToday()">
               Start Today's Rehearsal
             </button>`
      }
      <button class="btn btn-full btn-lg"
        style="background:rgba(255,255,255,.15);color:white;border:2px solid rgba(255,255,255,.4);"
        onclick="showNewRehearsalModal()">
        New Rehearsal for Another Date
      </button>
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
  const id = genId();
  const r  = { id, date: today(), label: '' };
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

function rowsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.row != null && s.row !== '') seen.add(String(s.row)); });
  return [...seen].sort((a, b) => Number(a) - Number(b));
}

function columnsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.column) seen.add(s.column); });
  return [...seen].sort();
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

function studentSuggestions(query, instrumentFilter, gradeFilter) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return Object.values(DB.getStudents()).filter(s => {
    if (instrumentFilter && normInstrument(s.instrument) !== instrumentFilter) return false;
    if (gradeFilter && (s.grade || '') !== gradeFilter) return false;
    return (s.name||'').toLowerCase().includes(q) ||
           String(s.number).includes(q) ||
           (s.section||'').toLowerCase().includes(q);
  }).sort((a,b) => (a.name||'').localeCompare(b.name||''))
    .slice(0, 10);
}

function viewRoster() {
  const students = DB.getStudents();
  const allStudents = Object.values(students);
  const filtered = filterAndSortStudents(allStudents, _rosterFilter);

  const rosterSortOpts = [
    {value:'name',   label:'Name'},
    {value:'number', label:'Number'},
    ...(hasField('instrument') ? [{value:'instrument', label:'Instrument'}] : []),
    ...(hasField('section')    ? [{value:'section',    label:'Section'}]    : []),
    ...(hasField('grade')      ? [{value:'grade',      label:'Grade'}]      : []),
    ...(hasField('column')     ? [{value:'column',     label:'Column'}]     : []),
    ...(hasField('row')        ? [{value:'row',        label:'Row'}]        : []),
  ];
  if (STATE.isAdmin && allStudents.length === 0) {
    return viewRosterOnboarding();
  }

  return `
    ${renderFilterBar('roster', _rosterFilter, rosterSortOpts)}
    <div id="roster-list">${rosterRows(filtered)}</div>
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

function rosterRows(list) {
  if (!list.length) {
    return `<div class="empty-state" style="padding:24px"><p>No students match the current filter.</p></div>`;
  }

  return list.map(s => {
    const hist = DB.getStudentHistory(s.number);
    const errs = hist.reduce((sum,e)=>sum+(e.entry.mistakes||0),0);
    const pos  = hist.reduce((sum,e)=>sum+(e.entry.positives||0),0);
    const avg  = hist.length ? (errs/hist.length).toFixed(1) : null;
    return `
      <div class="roster-row" onclick="navigate('student',{num:'${esc(s.number)}'})">
        <div class="student-info">
          ${s.name ? `<div class="student-name">${esc(s.name)}</div>` : `<div class="student-name text-muted">#${esc(s.number)}</div>`}
          <div class="student-detail">${esc([
            (hasField('column')||hasField('row')) ? fmtPos(hasField('column')?s.column:'',hasField('row')?s.row:'') : '',
            hasField('instrument') ? normInstrument(s.instrument) : '',
            hasField('section')    ? s.section : '',
            ...(STATE.customStudentFields||[]).map(cf => s[cf.key] ? `${cf.label}: ${s[cf.key]}` : '')
          ].filter(Boolean).join(' · ')) || '<em style="color:var(--text-muted)">No details set</em>'}</div>
        </div>
        <div class="student-badges">
          ${featureOn('marks') ? `
          ${avg !== null ? `<span class="badge badge-danger">${avg}✗</span>` : ''}
          ${pos > 0      ? `<span class="badge badge-success">${pos}✓</span>` : ''}` : ''}
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

function genStudentCode(existing = new Set()) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (existing.has(code));
  existing.add(code);
  return code;
}

async function autoGenerateStudentCodes() {
  if (!STATE.isAdmin) return;
  const students = Object.values(STATE.students);
  const usedCodes = new Set(students.map(s => s.studentCode).filter(Boolean).map(c => c.toUpperCase()));
  const toUpdate = students.filter(s => !s.studentCode);
  if (!toUpdate.length) { showToast('All students already have a code.'); return; }

  const CHUNK = 500;
  const updates = toUpdate.map(s => ({ s, code: genStudentCode(usedCodes) }));

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
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = db.batch();
    updates.slice(i, i + CHUNK).forEach(({ s, code }) => {
      batch.set(db.collection('studentCodes').doc(code.toUpperCase()),
        { orgId: STATE.orgId, studentNumber: String(s.number) }, { merge: true });
    });
    await batch.commit().catch(e => console.error('studentCodes sync failed:', e));
  }

  showToast(`${updates.length} code${updates.length !== 1 ? 's' : ''} generated.`);
  render();
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
