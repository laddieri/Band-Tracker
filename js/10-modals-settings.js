// Band Tracker — js/10-modals-settings.js — Student/rehearsal modals, CSV import, instrument/section/preset/auto-mark settings.
// Plain script sharing global scope; load order is set in index.html.

// ── Modals: Students ──────────────────────────────────────────────────────────

function showAddStudentModal(prefill = '') {
  if (!STATE.isAdmin) return;
  openModal(`
    <div class="modal-title">Add Student</div>
    <div class="form-group">
      <label class="form-label">Student Number *</label>
      <input class="form-input" id="m-num" type="text" value="${esc(prefill)}"
             placeholder="e.g. 042" autocomplete="off" inputmode="numeric">
    </div>
    <div class="form-group">
      <label class="form-label">Name (optional)</label>
      <input class="form-input" id="m-name" type="text" placeholder="First Last" autocomplete="off">
    </div>
    ${(hasField('column')||hasField('row')) ? `
    <div style="display:grid;grid-template-columns:${hasField('column')&&hasField('row')?'1fr 1fr':'1fr'};gap:12px">
      ${hasField('column') ? `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">Column (A–L)</label>
        <select class="form-select" id="m-column">
          <option value="">—</option>
          ${COLUMNS.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>` : ''}
      ${hasField('row') ? `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">Row (1–12)</label>
        <select class="form-select" id="m-row">
          <option value="">—</option>
          ${ROWS.map(r=>`<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>` : ''}
    </div>` : ''}
    ${hasField('instrument') ? `<div class="form-group">
      <label class="form-label">Instrument</label>
      <select class="form-select" id="m-instrument">
        <option value="">— Select instrument —</option>
        ${STATE.instruments.map(i=>`<option value="${esc(i)}">${esc(i)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('section') ? `<div class="form-group">
      <label class="form-label">Section</label>
      <select class="form-select" id="m-section">
        <option value="">— Select section —</option>
        ${STATE.sections.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('grade') ? `<div class="form-group">
      <label class="form-label">Grade</label>
      <select class="form-select" id="m-grade">
        <option value="">— Select grade —</option>
        ${GRADE_LEVELS.map(g=>`<option value="${g}">${g} Grade</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('notes') ? `<div class="form-group">
      <label class="form-label">Director Notes (optional)</label>
      <textarea class="form-textarea" id="m-notes" placeholder="Any notes about this student…"></textarea>
    </div>` : ''}
    ${(STATE.customStudentFields||[]).map(cf => `<div class="form-group">
      <label class="form-label">${esc(cf.label)}</label>
      <input class="form-input" id="m-cf-${cf.key}" type="text" autocomplete="off">
    </div>`).join('')}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveNewStudent()">Add Student</button>
    </div>
  `);
  if (!prefill) document.getElementById('m-num').focus();
}

function saveNewStudent() {
  const num = document.getElementById('m-num').value.trim();
  if (!num) { showToast('Student number is required'); return; }
  if (STATE.students[num]) { showToast(`Student #${num} already exists`); return; }

  const student = {
    number: num,
    name:   document.getElementById('m-name').value.trim(),
    songs:  []
  };
  if (hasField('column'))     student.column     = document.getElementById('m-column')?.value     || '';
  if (hasField('row'))        student.row        = document.getElementById('m-row')?.value        || '';
  if (hasField('instrument')) student.instrument = document.getElementById('m-instrument')?.value || '';
  if (hasField('section'))    student.section    = document.getElementById('m-section')?.value    || '';
  if (hasField('grade'))      student.grade      = document.getElementById('m-grade')?.value      || '';
  if (hasField('notes'))      student.notes      = document.getElementById('m-notes')?.value?.trim() || '';
  for (const cf of (STATE.customStudentFields || [])) {
    student[cf.key] = document.getElementById(`m-cf-${cf.key}`)?.value?.trim() || '';
  }

  STATE.students[num] = student;
  orgCol('students').doc(num).set(student);
  closeModal();
  showToast(`${student.name || `#${num}`} added`);
  if (_view === 'roster' || _view === 'student') render();
  else navigate('roster');
}

function showEditStudentModal(num) {
  if (!STATE.isAdmin) return;
  const s = DB.getStudents()[num];
  if (!s) return;
  openModal(`
    <div class="modal-title">Edit ${esc(s.name || `#${s.number}`)}</div>
    <div class="form-group">
      <label class="form-label">Name (optional)</label>
      <input class="form-input" id="m-name" type="text" value="${esc(s.name||'')}" autocomplete="off">
    </div>
    ${(hasField('column')||hasField('row')) ? `
    <div style="display:grid;grid-template-columns:${hasField('column')&&hasField('row')?'1fr 1fr':'1fr'};gap:12px">
      ${hasField('column') ? `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">Column (A–L)</label>
        <select class="form-select" id="m-column">
          <option value="">—</option>
          ${COLUMNS.map(c=>`<option value="${c}" ${s.column===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>` : ''}
      ${hasField('row') ? `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">Row (1–12)</label>
        <select class="form-select" id="m-row">
          <option value="">—</option>
          ${ROWS.map(r=>`<option value="${r}" ${String(s.row)===String(r)?'selected':''}>${r}</option>`).join('')}
        </select>
      </div>` : ''}
    </div>` : ''}
    ${hasField('instrument') ? `<div class="form-group">
      <label class="form-label">Instrument</label>
      <select class="form-select" id="m-instrument">
        <option value="">— Select instrument —</option>
        ${STATE.instruments.map(i=>`<option value="${esc(i)}" ${(normInstrument(s.instrument)===i||s.instrument===i)?'selected':''}>${esc(i)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('section') ? `<div class="form-group">
      <label class="form-label">Section</label>
      <select class="form-select" id="m-section">
        <option value="">— Select section —</option>
        ${STATE.sections.map(sec=>`<option value="${esc(sec)}" ${s.section===sec?'selected':''}>${esc(sec)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('grade') ? `<div class="form-group">
      <label class="form-label">Grade</label>
      <select class="form-select" id="m-grade">
        <option value="">— Select grade —</option>
        ${GRADE_LEVELS.map(g=>`<option value="${g}" ${s.grade===g?'selected':''}>${g} Grade</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('notes') ? `<div class="form-group">
      <label class="form-label">Director Notes</label>
      <textarea class="form-textarea" id="m-notes">${esc(s.notes||'')}</textarea>
    </div>` : ''}
    ${(STATE.customStudentFields||[]).map(cf => `<div class="form-group">
      <label class="form-label">${esc(cf.label)}</label>
      <input class="form-input" id="m-cf-${cf.key}" type="text" value="${esc(s[cf.key]||'')}" autocomplete="off">
    </div>`).join('')}
    <div class="form-group">
      <label class="form-label">Student Code</label>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="m-student-code" type="text"
               value="${esc(s.studentCode||'')}"
               placeholder="e.g. BLUE42"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               style="text-transform:uppercase;letter-spacing:.08em;flex:1">
        <button class="btn btn-secondary" type="button"
                onclick="document.getElementById('m-student-code').value=genStudentCode()"
                style="flex-shrink:0">Generate</button>
      </div>
      <div class="form-hint">Share this code with the student so they can view their own page.</div>
    </div>
    <div class="form-group">
      <label class="form-label">Student Login Email <span style="font-weight:400;opacity:.6">(optional — for email/password login instead)</span></label>
      <input class="form-input" id="m-student-email" type="email" value="${esc(s.studentEmail||'')}"
             placeholder="student@example.com" autocomplete="off">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditStudent('${esc(num)}')">Save Changes</button>
    </div>
    <div class="danger-zone">
      <div class="danger-zone-title">Danger Zone</div>
      <button class="btn btn-danger btn-full" onclick="confirmDeleteStudent('${esc(num)}')">
        Delete Student
      </button>
    </div>
  `);
}

function saveEditStudent(num) {
  if (!STATE.students[num]) return;
  const patch = {
    name:         document.getElementById('m-name').value.trim(),
    studentCode:  document.getElementById('m-student-code').value.trim().toUpperCase(),
    studentEmail: document.getElementById('m-student-email').value.trim().toLowerCase(),
  };
  if (hasField('column'))     patch.column     = document.getElementById('m-column')?.value     || '';
  if (hasField('row'))        patch.row        = document.getElementById('m-row')?.value        || '';
  if (hasField('instrument')) patch.instrument = document.getElementById('m-instrument')?.value || '';
  if (hasField('section'))    patch.section    = document.getElementById('m-section')?.value    || '';
  if (hasField('grade'))      patch.grade      = document.getElementById('m-grade')?.value      || '';
  if (hasField('notes'))      patch.notes      = document.getElementById('m-notes')?.value?.trim() || '';
  for (const cf of (STATE.customStudentFields || [])) {
    patch[cf.key] = document.getElementById(`m-cf-${cf.key}`)?.value?.trim() || '';
  }
  STATE.students[num] = { ...STATE.students[num], ...patch };
  orgCol('students').doc(num).set(patch, { merge: true });
  setStudentCodeLookup(patch.studentCode, num);
  closeModal();
  showToast('Student updated');
  render();
}

function confirmDeleteStudent(num) {
  const s     = STATE.students[num];
  const sName = s?.name || `#${num}`;
  showConfirmModal(
    `Delete ${esc(sName)}?`,
    `All of <strong>${esc(sName)}</strong>'s rehearsal records, marks, song
     results and their login code will be permanently deleted. This cannot be
     undone.`,
    () => _deleteStudent(num),
    'Delete'
  );
}

function _deleteStudent(num) {
  const s     = STATE.students[num];
  const sName = s?.name || `#${num}`;
  delete STATE.students[num];
  orgCol('students').doc(num).delete();
  // Delete all entries for this student
  orgCol('entries').where('studentNumber', '==', String(num)).get().then(snap => {
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    batch.commit();
  });
  // Retire their login code so it can't be used to rejoin as a ghost student.
  if (s?.studentCode) {
    db.collection('studentCodes').doc(String(s.studentCode).toUpperCase()).delete().catch(() => {});
  }
  // Remove their org membership(s) so existing sessions lose access.
  db.collection('members')
    .where('orgId', '==', STATE.orgId).where('studentNumber', '==', String(num))
    .get().then(snap => {
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      batch.commit();
    }).catch(() => {});
  // Remove their results from song docs.
  const songBatch = db.batch();
  let songDirty = false;
  STATE.songs.forEach(song => {
    if (song.statuses && song.statuses[String(num)] !== undefined) {
      songBatch.update(orgCol('songs').doc(song.id), {
        [`statuses.${num}`]: firebase.firestore.FieldValue.delete()
      });
      songDirty = true;
    }
  });
  if (songDirty) songBatch.commit().catch(() => {});
  closeModal();
  showToast(`${sName} deleted`);
  navigate('roster');
}

// ── Modals: Rehearsals ────────────────────────────────────────────────────────

function showNewRehearsalModal() {
  openModal(`
    <div class="modal-title">New Rehearsal</div>
    <div class="form-group">
      <label class="form-label">Date *</label>
      <input class="form-input" id="m-date" type="date" value="${today()}">
    </div>
    <div class="form-group">
      <label class="form-label">Label (optional)</label>
      <input class="form-input" id="m-label" type="text"
             placeholder="e.g. Evening, Full Band, Sectional…" autocomplete="off">
    </div>
    ${_rehearsalScopeFields()}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveNewRehearsal()">Create</button>
    </div>
  `);
}

function saveNewRehearsal() {
  const date = document.getElementById('m-date').value;
  if (!date) { showToast('Date is required'); return; }
  const id = genId();
  const r  = { id, date, label: document.getElementById('m-label').value.trim() };
  const scope = _readRehearsalScope();
  if (scope) r.scope = scope;
  STATE.rehearsals.unshift(r);
  STATE.rehearsals.sort((a,b) => b.date.localeCompare(a.date));
  orgCol('rehearsals').doc(id).set(r);
  closeModal();
  _activeRid = id;
  navigate('attendance-tab');
}

// ── Rehearsal scope (who attends) ─────────────────────────────────────────────
// A rehearsal defaults to the full band. Directors can limit it to instruments,
// sections and/or grades; a student attends if they match any checked group.

function _rehearsalScopeFields(scope = null) {
  const instruments = instrumentsInRoster();
  const sections    = sectionsInRoster();
  const grades      = gradesInRoster();
  if (!instruments.length && !sections.length && !grades.length) return '';

  const sel = {
    instruments: new Set(scope?.instruments || []),
    sections:    new Set(scope?.sections    || []),
    grades:      new Set(scope?.grades      || []),
  };
  const group = (title, items, cls, set) => !items.length ? '' : `
    <div class="sfb-group">
      <div class="sfb-group-label">${title}</div>
      <div class="sfb-checks">
        ${items.map(item => `
          <label class="sfb-check-label">
            <input type="checkbox" class="sfb-checkbox ${cls}" value="${esc(item)}" ${set.has(item) ? 'checked' : ''}>
            <span>${esc(item)}</span>
          </label>`).join('')}
      </div>
    </div>`;

  // Collapsed by default; auto-expanded when editing a rehearsal that already
  // has a scope so the director can see/change it.
  const hasScope = sel.instruments.size || sel.sections.size || sel.grades.size;
  const open     = !!hasScope;
  const summary  = hasScope ? rehearsalScopeLabel(scope) : 'Full band';

  return `
    <div class="form-group">
      <div id="reh-scope-sec-hdr" class="sec-hdr ${open ? 'sec-hdr-open' : ''}" style="margin-top:0"
           onclick="toggleCollapse('reh-scope-sec')">
        <span class="form-label" style="margin:0">Who's attending? <span style="font-weight:400;color:var(--text-muted)">· ${esc(summary)}</span></span>
        <span class="sec-chevron">▾</span>
      </div>
      <div id="reh-scope-sec" class="${open ? '' : 'sec-collapsed'}">
        <p class="form-hint" style="margin:0 0 8px">Leave everything unchecked for the full band, or pick the groups rehearsing.</p>
        <div class="sfb-panel">
          ${group('Instruments', instruments, 'reh-scope-inst', sel.instruments)}
          ${group('Sections',    sections,    'reh-scope-sect', sel.sections)}
          ${group('Grades',      grades,      'reh-scope-grade', sel.grades)}
        </div>
      </div>
    </div>`;
}

// Reads the checked scope from the open modal. null = full band.
function _readRehearsalScope() {
  const get = cls => [...document.querySelectorAll('.' + cls + ':checked')].map(c => c.value);
  const instruments = get('reh-scope-inst');
  const sections    = get('reh-scope-sect');
  const grades      = get('reh-scope-grade');
  if (!instruments.length && !sections.length && !grades.length) return null;
  return { instruments, sections, grades };
}

function showEndedRehearsalOptions(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  const label = fmtDate(r.date) + (r.label ? ` — ${esc(r.label)}` : '');
  openModal(`
    <div class="modal-title">${label}</div>
    <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:20px">What would you like to view?</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${featureOn('attendance') ? `
      <button class="btn btn-primary btn-full" onclick="closeModal();navigate('attendance',{rid:'${esc(rid)}',from:'rehearsals'})">
        📋 View Attendance
      </button>` : ''}
      ${featureOn('marks') ? `
      <button class="btn btn-secondary btn-full" onclick="closeModal();viewHistoricalMarks('${esc(rid)}')">
        ✏️ View Marks
      </button>` : ''}
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-ghost btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function viewHistoricalMarks(rid) {
  _dashRid = rid;
  _dashForceHistory = true;
  navigate('dashboard');
}

function showRehearsalEditModal(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  openModal(`
    <div class="modal-title">Edit Rehearsal</div>
    <div class="form-group">
      <label class="form-label">Date</label>
      <input class="form-input" id="m-date" type="date" value="${esc(r.date)}">
    </div>
    <div class="form-group">
      <label class="form-label">Label (optional)</label>
      <input class="form-input" id="m-label" type="text" value="${esc(r.label||'')}"
             placeholder="e.g. Evening, Full Band…" autocomplete="off">
    </div>
    ${_rehearsalScopeFields(r.scope || null)}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRehearsalEdit('${esc(rid)}')">Save</button>
    </div>
  `);
}

function showRehearsalPlanModal(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  const segments = r.segments || [];
  openModal(`
    <div class="modal-title">Rehearsal Plan</div>
    <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">
      Segments let directors tag which part of rehearsal a mark was noticed in.
    </p>
    ${segments.length ? `
      <div class="seg-plan-list">
        ${segments.map((s, i) => `
          <div class="seg-plan-item">
            <span>${esc(s)}</span>
            ${STATE.isAdmin ? `<button class="seg-plan-remove" onclick="removeSegment('${esc(rid)}',${i})" title="Remove">×</button>` : ''}
          </div>`).join('')}
      </div>` : `<p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:10px">No segments added yet.</p>`}
    ${STATE.isAdmin ? `
      <div class="flex gap-8" style="margin-top:12px">
        <input class="form-input" id="seg-input" type="text"
               placeholder="e.g. Warmup, Closer drill…" autocomplete="off"
               onkeydown="if(event.key==='Enter')addSegment('${esc(rid)}')">
        <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="addSegment('${esc(rid)}')">+ Add</button>
      </div>` : ''}
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function addSegment(rid) {
  const inp  = document.getElementById('seg-input');
  const name = inp?.value.trim();
  if (!name) return;
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  const segments = [...(r.segments || []), name];
  r.segments = segments;
  orgCol('rehearsals').doc(rid).set({ segments }, { merge: true });
  showRehearsalPlanModal(rid);
}

function removeSegment(rid, idx) {
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  const segments = (r.segments || []).filter((_, i) => i !== idx);
  r.segments = segments;
  orgCol('rehearsals').doc(rid).set({ segments }, { merge: true });
  showRehearsalPlanModal(rid);
}

function selectSegment(name) {
  _pendingSegment = (_pendingSegment === name) ? '' : name;
  document.querySelectorAll('.seg-chip').forEach(el => {
    el.classList.toggle('seg-selected', el.dataset.seg === _pendingSegment);
  });
}

function saveRehearsalEdit(rid) {
  const idx = STATE.rehearsals.findIndex(r => r.id === rid);
  if (idx === -1) return;
  const scope = _readRehearsalScope();
  const patch = {
    date:  document.getElementById('m-date').value,
    label: document.getElementById('m-label').value.trim(),
    // Persist the scope, or clear it back to full band when nothing is checked.
    scope: scope || firebase.firestore.FieldValue.delete(),
  };
  const next = { ...STATE.rehearsals[idx], date: patch.date, label: patch.label };
  if (scope) next.scope = scope; else delete next.scope;
  STATE.rehearsals[idx] = next;
  orgCol('rehearsals').doc(rid).set(patch, { merge: true });
  closeModal();
  showToast('Rehearsal updated');
  render();
}

function confirmEndRehearsal(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  const endMarks = _getAutoMarks().filter(m => m.when === 'end');
  const marksList = endMarks.length
    ? endMarks.map(m => `<li>${esc(m.note)}</li>`).join('')
    : '<li style="color:var(--text-muted)">None configured</li>';
  openModal(`
    <div class="modal-title">End Rehearsal?</div>
    <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:8px">
      The following auto marks will be applied to eligible students:
    </p>
    <ul style="font-size:0.85rem;color:var(--text);margin:0 0 16px 16px;line-height:1.7">${marksList}</ul>
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:20px">
      Existing auto marks will be recalculated — no duplicates.
    </p>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-success" onclick="endRehearsal('${esc(rid)}')">End Rehearsal</button>
    </div>
  `);
}

async function endRehearsal(rid) {
  closeModal();
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  const entries  = STATE.entries[rid] || {};
  // Only the rehearsal's in-scope students earn end-of-rehearsal auto marks.
  const students = rehearsalStudents(r);
  const batch    = db.batch();
  let autoCount = 0;

  r.ended = true; // set before _computeAutoMarkEvents so 'end' marks are included

  for (const stu of students) {
    const num    = String(stu.number ?? stu._id);
    const entry  = entries[num] || { mistakes: 0, positives: 0, notes: '', events: [] };
    const events = _computeAutoMarkEvents(entry, r);
    const newAuto = events.filter(e => e.auto).length;
    autoCount += newAuto;

    const positives = events.filter(e => e.type === 'positive').length;
    const docRef    = orgCol('entries').doc(`${rid}_${num}`);
    batch.set(docRef, {
      rehearsalId:   rid,
      studentNumber: String(num),
      mistakes:      entry.mistakes  || 0,
      positives,
      notes:         entry.notes     || '',
      events,
      ...(entry.attendance ? { attendance: entry.attendance } : {}),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: STATE.user?.uid || ''
    });

    if (!STATE.entries[rid]) STATE.entries[rid] = {};
    STATE.entries[rid][num] = { ...entry, events, positives };
  }

  orgCol('rehearsals').doc(rid).set({ ended: true }, { merge: true });
  await batch.commit();
  if (_activeRid === rid || !_activeRid) {
    const next = STATE.rehearsals.find(r2 => !r2.ended && r2.id !== rid);
    _activeRid = next ? next.id : null;
  }
  showToast(`Rehearsal ended — ${autoCount ? `${autoCount} auto mark${autoCount !== 1 ? 's' : ''} applied.` : 'no auto marks.'}`);
  render();
}

function reopenRehearsal(rid) {
  closeModal();
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  const currentActive = getActiveRehearsal();
  if (currentActive && currentActive.id !== rid) {
    const curLabel = fmtDate(currentActive.date) + (currentActive.label ? ` — ${currentActive.label}` : '');
    const newLabel  = fmtDate(r.date)            + (r.label            ? ` — ${r.label}`            : '');
    showConfirmModal(
      'Switch Active Rehearsal?',
      `<strong>${curLabel}</strong> is currently open. Reopening <strong>${newLabel}</strong> will make it the active rehearsal for student feedback. The current rehearsal will remain open and become active again once this one is ended.`,
      () => {
        r.ended = false;
        orgCol('rehearsals').doc(rid).set({ ended: false }, { merge: true });
        _activeRid = rid;
        showToast(`Switched to ${newLabel}`);
        render();
      },
      'Switch Rehearsal',
      'btn-primary'
    );
    return;
  }
  r.ended = false;
  orgCol('rehearsals').doc(rid).set({ ended: false }, { merge: true });
  _activeRid = rid;
  showToast('Rehearsal reopened.');
  render();
}

function confirmDeleteRehearsal(rid) {
  const r = STATE.rehearsals.find(r => r.id === rid);
  showConfirmModal(
    'Delete this rehearsal?',
    `${r ? `<strong>${fmtDate(r.date)}${r.label ? ' — ' + esc(r.label) : ''}</strong> and a` : 'A'}ll
     of its attendance and marks records will be permanently deleted. This
     cannot be undone.`,
    () => {
      STATE.rehearsals = STATE.rehearsals.filter(r => r.id !== rid);
      delete STATE.entries[rid];
      orgCol('rehearsals').doc(rid).delete();
      orgCol('entries').where('rehearsalId', '==', rid).get().then(snap => {
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        batch.commit();
      });
      showToast('Rehearsal deleted');
      navigate('rehearsals');
    },
    'Delete'
  );
}

// ── CSV Import ────────────────────────────────────────────────────────────────

// ── Instrument Management ─────────────────────────────────────────────────────

function showManageInstrumentsModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Instruments</div>
    <div class="preset-section">
      <div id="instrument-list">${_renderInstrumentList()}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-instrument-input" type="text"
               placeholder="New instrument…" maxlength="60"
               onkeydown="if(event.key==='Enter')addInstrument()">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addInstrument()">Add</button>
      </div>
    </div>
    <button class="btn btn-secondary" style="width:100%;margin-top:10px;font-size:0.8rem"
            onclick="resetInstrumentsToDefaults()">Reset to defaults</button>
    <div class="modal-actions" style="margin-top:10px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function _renderInstrumentList() {
  if (!STATE.instruments.length) return `<div class="preset-empty">No instruments — add one below.</div>`;
  return STATE.instruments.map((inst, i) => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(inst)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editInstrument(${i})">Edit</button>
        <button class="preset-btn-del"  onclick="deleteInstrument(${i})">×</button>
      </div>
    </div>`).join('');
}

function addInstrument() {
  const input = document.getElementById('add-instrument-input');
  const val = input?.value.trim();
  if (!val) return;
  STATE.instruments = [...STATE.instruments, val];
  _saveInstruments();
  input.value = '';
  document.getElementById('instrument-list').innerHTML = _renderInstrumentList();
}

function deleteInstrument(idx) {
  STATE.instruments = STATE.instruments.filter((_, i) => i !== idx);
  _saveInstruments();
  document.getElementById('instrument-list').innerHTML = _renderInstrumentList();
}

function editInstrument(idx) {
  const current = STATE.instruments[idx];
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Instrument</div>
    <input class="form-input" id="edit-instrument-input" type="text"
           value="${esc(current)}" maxlength="60"
           onkeydown="if(event.key==='Enter')saveEditInstrument(${idx})">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManageInstrumentsModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditInstrument(${idx})">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-instrument-input')?.focus(), 60);
}

function saveEditInstrument(idx) {
  const val = document.getElementById('edit-instrument-input')?.value.trim();
  if (!val) return;
  STATE.instruments[idx] = val;
  _saveInstruments();
  showManageInstrumentsModal();
}

function resetInstrumentsToDefaults() {
  STATE.instruments = [...INSTRUMENTS];
  _saveInstruments();
  document.getElementById('instrument-list').innerHTML = _renderInstrumentList();
}

async function _saveInstruments() {
  try {
    await orgCol('settings').doc('presets').set(
      { instruments: STATE.instruments }, { merge: true }
    );
  } catch(e) {
    console.error('Failed to save instruments:', e);
    showToast('Failed to save instruments.');
  }
}

// filterLb replaced by updateFilter / unified filter bar

async function randomizePseudonyms() {
  const salt = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  try {
    await orgCol('settings').doc('presets').set({ pseudonymSalt: salt }, { merge: true });
    showToast('Leaderboard names reassigned.');
  } catch(e) {
    console.error('Failed to randomize pseudonyms:', e);
    showToast('Failed to randomize names.');
  }
}

async function toggleMarchingLeaderboard() {
  STATE.marchingLeaderboardEnabled = !STATE.marchingLeaderboardEnabled;
  try {
    await orgCol('settings').doc('presets').set(
      { marchingLeaderboardEnabled: STATE.marchingLeaderboardEnabled }, { merge: true }
    );
  } catch(e) {
    console.error('Failed to save leaderboard setting:', e);
    showToast('Failed to save setting.');
    STATE.marchingLeaderboardEnabled = !STATE.marchingLeaderboardEnabled; // revert
  }
  render();
}

// ── Section Management ────────────────────────────────────────────────────────

function showManageSectionsModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Sections</div>
    <div class="preset-section">
      <div id="section-list">${_renderSectionList()}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-section-input" type="text"
               placeholder="New section…" maxlength="60"
               onkeydown="if(event.key==='Enter')addSection()">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addSection()">Add</button>
      </div>
    </div>
    <button class="btn btn-secondary" style="width:100%;margin-top:10px;font-size:0.8rem"
            onclick="resetSectionsToDefaults()">Reset to defaults</button>
    <div class="modal-actions" style="margin-top:10px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function _renderSectionList() {
  if (!STATE.sections.length) return `<div class="preset-empty">No sections — add one below.</div>`;
  return STATE.sections.map((sec, i) => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(sec)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editSection(${i})">Edit</button>
        <button class="preset-btn-del"  onclick="deleteSection(${i})">×</button>
      </div>
    </div>`).join('');
}

function addSection() {
  const input = document.getElementById('add-section-input');
  const val = input?.value.trim();
  if (!val) return;
  STATE.sections = [...STATE.sections, val];
  _saveSections();
  input.value = '';
  document.getElementById('section-list').innerHTML = _renderSectionList();
}

function deleteSection(idx) {
  STATE.sections = STATE.sections.filter((_, i) => i !== idx);
  _saveSections();
  document.getElementById('section-list').innerHTML = _renderSectionList();
}

function editSection(idx) {
  const current = STATE.sections[idx];
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Section</div>
    <input class="form-input" id="edit-section-input" type="text"
           value="${esc(current)}" maxlength="60"
           onkeydown="if(event.key==='Enter')saveEditSection(${idx})">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManageSectionsModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditSection(${idx})">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-section-input')?.focus(), 60);
}

function saveEditSection(idx) {
  const val = document.getElementById('edit-section-input')?.value.trim();
  if (!val) return;
  STATE.sections[idx] = val;
  _saveSections();
  showManageSectionsModal();
}

function resetSectionsToDefaults() {
  STATE.sections = [...SECTIONS];
  _saveSections();
  document.getElementById('section-list').innerHTML = _renderSectionList();
}

async function _saveSections() {
  try {
    await orgCol('settings').doc('presets').set(
      { sections: STATE.sections }, { merge: true }
    );
  } catch(e) {
    console.error('Failed to save sections:', e);
    showToast('Failed to save sections.');
  }
}

// ── Preset Management ─────────────────────────────────────────────────────────

function _renderPresetList(type) {
  const arr = type === 'mistake' ? STATE.mistakePresets : STATE.positivePresets;
  if (!arr.length) return `<div class="preset-empty">No presets — add one below.</div>`;
  return arr.map((p, i) => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(p)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editPreset('${type}',${i})">Edit</button>
        <button class="preset-btn-del"  onclick="deletePreset('${type}',${i})">×</button>
      </div>
    </div>`).join('');
}

function showManagePresetsModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Mark Presets</div>

    <div class="preset-section">
      <div class="preset-section-hdr preset-mistake-hdr">✗ Mistake Marks</div>
      <div id="preset-list-mistake">${_renderPresetList('mistake')}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-mistake-input" type="text"
               placeholder="New mistake preset…" maxlength="80"
               onkeydown="if(event.key==='Enter')addPreset('mistake')">
        <button class="preset-add-btn preset-add-btn-mistake" onclick="addPreset('mistake')">Add</button>
      </div>
    </div>

    <div class="preset-section" style="margin-top:16px">
      <div class="preset-section-hdr preset-positive-hdr">✓ Positive Marks</div>
      <div id="preset-list-positive">${_renderPresetList('positive')}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-positive-input" type="text"
               placeholder="New positive preset…" maxlength="80"
               onkeydown="if(event.key==='Enter')addPreset('positive')">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addPreset('positive')">Add</button>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function addPreset(type) {
  const input = document.getElementById(`add-${type}-input`);
  const val = input?.value.trim();
  if (!val) return;
  if (type === 'mistake') STATE.mistakePresets = [...STATE.mistakePresets, val];
  else                    STATE.positivePresets = [...STATE.positivePresets, val];
  _savePresets();
  input.value = '';
  document.getElementById(`preset-list-${type}`).innerHTML = _renderPresetList(type);
}

function deletePreset(type, idx) {
  if (type === 'mistake') STATE.mistakePresets  = STATE.mistakePresets.filter((_,i)  => i !== idx);
  else                    STATE.positivePresets = STATE.positivePresets.filter((_,i) => i !== idx);
  _savePresets();
  document.getElementById(`preset-list-${type}`).innerHTML = _renderPresetList(type);
}

function editPreset(type, idx) {
  const arr     = type === 'mistake' ? STATE.mistakePresets : STATE.positivePresets;
  const current = arr[idx];
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Preset</div>
    <input class="form-input" id="edit-preset-input" type="text"
           value="${esc(current)}" maxlength="80"
           onkeydown="if(event.key==='Enter')saveEditPreset('${type}',${idx})">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManagePresetsModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditPreset('${type}',${idx})">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-preset-input')?.focus(), 60);
}

function saveEditPreset(type, idx) {
  const val = document.getElementById('edit-preset-input')?.value.trim();
  if (!val) return;
  if (type === 'mistake') STATE.mistakePresets[idx]  = val;
  else                    STATE.positivePresets[idx] = val;
  _savePresets();
  showManagePresetsModal();
}

async function _savePresets() {
  try {
    await orgCol('settings').doc('presets').set({
      mistakePresets:  STATE.mistakePresets,
      positivePresets: STATE.positivePresets
    });
  } catch(e) {
    console.error('Failed to save presets:', e);
    showToast('Failed to save presets.');
  }
}

// ── Auto Marks Settings ───────────────────────────────────────────────────────

function showAutoMarksModal() {
  if (!STATE.isAdmin) return;
  const marks = _getAutoMarks();
  const condLabel = c => ({ on_time: 'On time', no_mistakes: 'No mistakes', present: 'Present' }[c] || c);
  const whenLabel = w => w === 'start' ? 'Attendance submitted' : 'Rehearsal ends';

  const rows = marks.length
    ? marks.map(m => `
        <div class="auto-mark-row">
          <div class="auto-mark-info">
            <div class="auto-mark-note">${esc(m.note)}</div>
            <div class="auto-mark-meta">${condLabel(m.condition)} · ${whenLabel(m.when)}</div>
          </div>
          <div class="auto-mark-actions">
            <button class="icon-btn" onclick="showEditAutoMarkModal('${esc(m.id)}')" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="icon-btn icon-btn-danger" onclick="deleteAutoMark('${esc(m.id)}')" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>`)
        .join('')
    : '<p style="font-size:0.85rem;color:var(--text-muted);text-align:center;padding:8px 0">No auto marks configured.</p>';

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Auto Marks</div>
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:14px">
      Automatically award marks to students based on attendance and performance.
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">${rows}</div>
    <button class="btn btn-primary btn-full" onclick="showEditAutoMarkModal(null)">+ Add Auto Mark</button>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function showEditAutoMarkModal(id) {
  const existing = id ? _getAutoMarks().find(m => m.id === id) : null;
  const sel = (v, match) => v === match ? 'selected' : '';
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${existing ? 'Edit Auto Mark' : 'New Auto Mark'}</div>
    <div class="form-group">
      <label class="form-label">Mark text</label>
      <input class="form-input" id="am-note" type="text"
             value="${esc(existing?.note || '')}" placeholder="e.g. Full rehearsal attended">
    </div>
    <div class="form-group">
      <label class="form-label">Award when</label>
      <select class="form-input" id="am-when">
        <option value="end"   ${sel(existing?.when ?? 'end', 'end'  )}>Rehearsal ends</option>
        <option value="start" ${sel(existing?.when,          'start')}>Attendance submitted</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Condition</label>
      <select class="form-input" id="am-condition">
        <option value="on_time"    ${sel(existing?.condition ?? 'on_time', 'on_time'   )}>On time — not absent, not late</option>
        <option value="present"    ${sel(existing?.condition,              'present'   )}>Present — not absent (includes late)</option>
        <option value="no_mistakes"${sel(existing?.condition,              'no_mistakes')}>No mistakes — present with zero mistake marks</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="showAutoMarksModal()">Back</button>
      <button class="btn btn-primary" onclick="saveAutoMark('${esc(id || '')}')">Save</button>
    </div>
  `);
}

function saveAutoMark(id) {
  const note = document.getElementById('am-note')?.value.trim();
  if (!note) { showToast('Mark text is required'); return; }
  const when      = document.getElementById('am-when')?.value      || 'end';
  const condition = document.getElementById('am-condition')?.value || 'on_time';
  const marks     = [..._getAutoMarks()];
  if (id) {
    const idx = marks.findIndex(m => m.id === id);
    if (idx >= 0) marks[idx] = { ...marks[idx], note, when, condition };
  } else {
    marks.push({ id: `am-${Date.now()}`, note, type: 'positive', when, condition });
  }
  STATE.autoMarks = marks;
  orgCol('settings').doc('presets').set({ autoMarks: marks }, { merge: true });
  showToast('Auto mark saved.');
  showAutoMarksModal();
}

function deleteAutoMark(id) {
  const marks = _getAutoMarks().filter(m => m.id !== id);
  STATE.autoMarks = marks;
  orgCol('settings').doc('presets').set({ autoMarks: marks }, { merge: true });
  showToast('Auto mark removed.');
  showAutoMarksModal();
}

// ─────────────────────────────────────────────────────────────────────────────

let _csvData = null;

function showImportModal() {
  if (!STATE.isAdmin) return;
  _csvData = null;
  openModal(`
    <div class="modal-title">Import Roster from CSV</div>
    <div class="import-hint">
      <strong>Your CSV must have a header row.</strong> The <em>Number</em> column is required; all others are optional. Headers are case-insensitive.
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:10px">
        <thead>
          <tr style="border-bottom:1.5px solid var(--border)">
            <th style="text-align:left;padding:4px 6px 6px;font-weight:700;white-space:nowrap">Field</th>
            <th style="text-align:left;padding:4px 6px 6px;font-weight:700">Description</th>
            <th style="text-align:left;padding:4px 6px 6px;font-weight:700">Accepted column headers</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 6px;font-weight:700;white-space:nowrap;color:var(--primary)">Number ★</td>
            <td style="padding:5px 6px">Unique student ID used for all tracking</td>
            <td style="padding:5px 6px;color:var(--text-muted)">Number, Student #, Student No, Student ID, ID, #, Num</td>
          </tr>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 6px;font-weight:700;white-space:nowrap">Name</td>
            <td style="padding:5px 6px">Student's display name</td>
            <td style="padding:5px 6px;color:var(--text-muted)">Name, Student Name, Full Name, First Name, Last Name</td>
          </tr>
          ${STUDENT_FIELD_DEFS.filter(f => hasField(f.key)).map(f => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 6px;font-weight:700;white-space:nowrap">${f.label}</td>
            <td style="padding:5px 6px">${f.description}</td>
            <td style="padding:5px 6px;color:var(--text-muted)">${f.aliases}</td>
          </tr>`).join('')}
          ${(STATE.customStudentFields||[]).map((cf, i, arr) => `
          <tr${i < arr.length-1 ? ' style="border-bottom:1px solid var(--border)"' : ''}>
            <td style="padding:5px 6px;font-weight:700;white-space:nowrap">${esc(cf.label)}</td>
            <td style="padding:5px 6px">Custom field</td>
            <td style="padding:5px 6px;color:var(--text-muted)">${esc(cf.label)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">Choose .csv File</label>
      <input type="file" accept=".csv,text/csv" id="csv-file-input"
             class="form-input" style="padding:10px"
             onchange="handleCSVFile(this)">
    </div>
    <div id="import-preview"></div>
    <div class="modal-actions" id="import-actions">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

// CSV parsing (parseCSVLine/parseCSV/detectCols/normalizeGrade) lives in 00-logic.js.

const STUDENT_FIELD_DEFS = [
  { key: 'instrument', label: 'Instrument',  description: 'Instrument played',                        aliases: 'Instrument, Inst' },
  { key: 'section',    label: 'Section',     description: 'Band section or ensemble group',           aliases: 'Section, Part, Group, Ensemble' },
  { key: 'column',     label: 'Column',      description: 'Marching position — column letter (A–L)',  aliases: 'Column, Col, Letter, Column Letter, File' },
  { key: 'row',        label: 'Row',         description: 'Marching position — row number (1–12)',    aliases: 'Row, Rank, Row Number, Set' },
  { key: 'grade',      label: 'Grade',       description: 'Grade level (9–12)',                       aliases: 'Grade, Grade Level, Year, Class Year' },
  { key: 'notes',      label: 'Notes',       description: 'Private director notes for the student',   aliases: 'Notes, Note, Comments, Director Notes' },
];

function handleCSVFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) { showImportError('File appears to be empty or has only a header row.'); return; }
      const headers = rows[0];
      const colMap  = detectCols(headers, STATE.customStudentFields || []);
      if (colMap.number === undefined) {
        showImportError(
          `Could not find a student number column.<br>
           Recognized names: <em>Number, Student #, ID, #</em><br>
           Your headers: <em>${esc(headers.join(', '))}</em>`
        );
        return;
      }
      const dataRows = rows.slice(1).filter(r => r[colMap.number]?.trim());
      if (!dataRows.length) { showImportError('No data rows found after the header.'); return; }
      _csvData = { rows: dataRows, colMap, headers };
      renderImportPreview();
    } catch(err) {
      showImportError('Could not read file: ' + esc(err.message));
    }
  };
  reader.readAsText(file);
}

function showImportError(msg) {
  document.getElementById('import-preview').innerHTML = `<div class="import-error">${msg}</div>`;
}

function renderImportPreview() {
  const { rows, colMap, headers } = _csvData;
  const existing  = DB.getStudents();
  const newCount  = rows.filter(r => !existing[r[colMap.number]?.trim()]).length;
  const dupCount  = rows.length - newCount;
  const preview   = rows.slice(0, 8);
  const LABELS    = { number:'Number', name:'Name', column:'Column', row:'Row', instrument:'Instrument', section:'Section', grade:'Grade', notes:'Notes' };
  for (const cf of (STATE.customStudentFields || [])) LABELS[cf.key] = cf.label;
  const customKeys = new Set((STATE.customStudentFields || []).map(cf => cf.key));
  const fields    = Object.keys(colMap).filter(f => f === 'number' || f === 'name' || hasField(f) || customKeys.has(f));

  document.getElementById('import-preview').innerHTML = `
    <hr class="divider">
    <div class="import-summary">
      <span class="badge badge-primary">${rows.length} row${rows.length!==1?'s':''}</span>
      <span class="badge badge-success">${newCount} new</span>
      ${dupCount > 0 ? `<span class="badge badge-danger">${dupCount} duplicate${dupCount!==1?'s':''}</span>` : ''}
    </div>

    <div class="col-map-grid">
      ${fields.map(f => `
        <div class="col-map-row">
          <span class="col-map-field">${LABELS[f]}</span>
          <span class="col-map-arrow">←</span>
          <span class="col-map-src">${esc(headers[colMap[f]])}</span>
        </div>`).join('')}
    </div>

    ${dupCount > 0 ? `
      <div class="form-group" style="margin:12px 0 4px">
        <label class="form-label">If a student number already exists</label>
        <select class="form-select" id="dup-strategy">
          <option value="skip">Skip — keep existing data</option>
          <option value="overwrite">Overwrite — replace with CSV data</option>
        </select>
      </div>` : ''}

    <div class="section-title" style="margin-top:14px">
      Preview (first ${preview.length} of ${rows.length})
    </div>
    <div style="overflow-x:auto">
      <table class="preview-table">
        <thead><tr>
          ${fields.map(f=>`<th>${LABELS[f]}</th>`).join('')}
          <th></th>
        </tr></thead>
        <tbody>
          ${preview.map(r => {
            const num   = r[colMap.number]?.trim() || '';
            const isDup = !!existing[num];
            return `<tr class="${isDup ? 'dup-row' : ''}">
              ${fields.map(f=>`<td>${esc(r[colMap[f]]||'')}</td>`).join('')}
              <td>${isDup ? '<span style="color:var(--warning);font-size:0.72rem">exists</span>' : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('import-actions').innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="executeImport()">
      Import ${newCount} Student${newCount!==1?'s':''}${dupCount>0?' (+'+dupCount+')':''}
    </button>
  `;
}

async function executeImport() {
  if (!_csvData) return;
  const { rows, colMap } = _csvData;
  const strategy = document.getElementById('dup-strategy')?.value || 'skip';
  const existing = DB.getStudents();
  let added = 0, updated = 0, skipped = 0;

  const batch = db.batch();

  for (const csvRow of rows) {
    const num = csvRow[colMap.number]?.trim();
    if (!num) continue;
    const incoming = { number: num };
    if (colMap.name       !== undefined)              incoming.name       = csvRow[colMap.name].trim();
    if (colMap.column     !== undefined && hasField('column'))     incoming.column     = csvRow[colMap.column].trim().toUpperCase();
    if (colMap.row        !== undefined && hasField('row'))        incoming.row        = csvRow[colMap.row].trim();
    if (colMap.instrument !== undefined && hasField('instrument')) incoming.instrument = csvRow[colMap.instrument].trim();
    if (colMap.section    !== undefined && hasField('section'))    incoming.section    = csvRow[colMap.section].trim();
    if (colMap.grade      !== undefined && hasField('grade'))      incoming.grade      = normalizeGrade(csvRow[colMap.grade].trim());
    if (colMap.notes      !== undefined && hasField('notes'))      incoming.notes      = csvRow[colMap.notes].trim();
    for (const cf of (STATE.customStudentFields || [])) {
      if (colMap[cf.key] !== undefined) incoming[cf.key] = csvRow[colMap[cf.key]]?.trim() || '';
    }
    if (existing[num]) {
      if (strategy === 'overwrite') {
        STATE.students[num] = { ...STATE.students[num], ...incoming };
        batch.set(orgCol('students').doc(num), incoming, { merge: true });
        updated++;
      } else {
        skipped++;
      }
    } else {
      STATE.students[num] = incoming;
      batch.set(orgCol('students').doc(num), incoming);
      added++;
    }
  }

  try {
    await batch.commit();
  } catch(e) {
    showToast('Import failed — ' + (e.message || 'check console'));
    return;
  }

  _csvData = null;
  closeModal();

  const parts = [];
  if (added)   parts.push(`${added} added`);
  if (updated) parts.push(`${updated} updated`);
  if (skipped) parts.push(`${skipped} skipped`);
  showToast(`Import complete — ${parts.join(', ')}`);
  render();
}
