// Band Tracker — js/16-absences.js — Anticipated absences (advance notices).
// Plain script sharing global scope; load order is set in index.html.
//
// A student tells the director ahead of time — usually in writing — that
// they'll miss, arrive late to, or leave early from an event on some date.
// Directors log those notices here so they stay organized, and the attendance
// screen surfaces a matching notice as a NON-BINDING badge while recording (the
// director still marks the real status). Directors manage notices; staff only
// read them (for the badge). Students see their own upcoming notices in the
// portal via the students/{num}.anticipatedAbsences mirror (js/02-data.js).
//
// The pure date logic (absenceCoversDate / anticipatedForDate / upcomingAbsences)
// lives in js/00-logic.js so it's unit-testable.

// ── Notice display helpers ────────────────────────────────────────────────────

// A human sentence describing one notice's window, e.g.
// "Absent · Sept 4" or "Leaving early · Sept 4 · ~2:30pm".
function _absenceWhenText(a) {
  const range = a.endDate && a.endDate !== a.date
    ? `${fmtShort(a.date)} – ${fmtShort(a.endDate)}`
    : fmtDate(a.date);
  const time = a.time ? ` · ~${_fmtClock(a.time)}` : '';
  return `${range}${time}`;
}

// 24h "HH:MM" (from an <input type=time>) → "2:30pm".
function _fmtClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return esc(hhmm || '');
  let h = +m[1]; const min = m[2]; const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${min}${ampm}`;
}

function _absenceChipClass(type) {
  return type === 'late' ? 'att-chip-late'
       : type === 'leave-early' ? 'att-chip-leave'
       : 'att-chip-absent';
}

// The "reported" badge shown on an attendance row / block button when the given
// student has a notice covering the given event date. '' when none. Purely
// informational — recording still sets the real status.
function absenceRowBadgeHtml(num, dateStr) {
  if (!dateStr) return '';
  const hits = anticipatedForDate(STATE.anticipatedAbsences, num, dateStr);
  if (!hits.length) return '';
  return hits.map(a => {
    const parts = [absenceTypeShort(a.type)];
    if (a.time) parts.push(`~${_fmtClock(a.time)}`);
    if (a.note) parts.push(esc(a.note));
    return `<span class="att-anticipated ${_absenceChipClass(a.type)}" title="Student reported this ahead of time">
      🗓 Reported: ${parts.join(' · ')}</span>`;
  }).join('');
}

// ── Director management: cards ─────────────────────────────────────────────────

// A single management row (director only): student, type, when, note + edit.
function _absenceManageRow(a, { showStudent = true } = {}) {
  const s = STATE.students[String(a.studentNumber)];
  const name = s ? (s.name || `#${a.studentNumber}`) : `#${a.studentNumber}`;
  return `
    <div class="abs-row" onclick="showEditAbsenceModal('${esc(a.id)}')">
      <div class="abs-row-main">
        ${showStudent ? `<span class="abs-row-name">${esc(name)}</span>` : ''}
        <span class="att-summary-chip ${_absenceChipClass(a.type)}">${esc(absenceTypeLabel(a.type))}</span>
      </div>
      <div class="abs-row-when">${_absenceWhenText(a)}</div>
      ${a.note ? `<div class="abs-row-note">📝 ${esc(a.note)}</div>` : ''}
    </div>`;
}

// The Attendance-tab card listing every upcoming notice (director only). Hidden
// entirely for staff (they only get the recording badge) and when attendance is
// off. Rendered by viewAttendanceTab().
function renderAnticipatedCard() {
  if (!STATE.isAdmin || !featureOn('attendance')) return '';
  const upcoming = upcomingAbsences(STATE.anticipatedAbsences, today());
  const body = upcoming.length
    ? upcoming.map(a => _absenceManageRow(a)).join('')
    : `<div class="empty-state" style="padding:12px 0"><p>No upcoming anticipated absences.</p></div>`;
  return `
    <div class="sec-card">
    <div id="att-tab-anticipated-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-anticipated')">
      <span class="section-title" style="margin:0">Anticipated Absences</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-anticipated">
      <p class="modal-sub" style="margin:2px 0 10px">Advance notices from students — surfaced while you take attendance.</p>
      <button class="btn btn-secondary" style="width:100%;margin-bottom:12px" onclick="showAddAbsenceModal()">
        + Add anticipated absence
      </button>
      <div id="att-tab-anticipated-list">${body}</div>
    </div>
    </div>`;
}

// The per-student card on the director's student detail page (js/08-stats.js).
function viewStudentAbsencesCard(num) {
  if (!STATE.isAdmin || !featureOn('attendance')) return '';
  const upcoming = upcomingAbsences(STATE.anticipatedAbsences, today(), num);
  const body = upcoming.length
    ? upcoming.map(a => _absenceManageRow(a, { showStudent: false })).join('')
    : `<div class="empty-state" style="padding:8px 0"><p>No upcoming anticipated absences.</p></div>`;
  return `
    <div class="sec-card">
      <div class="sec-hdr sec-hdr-open" style="cursor:default">
        <span class="section-title" style="margin:0">Anticipated Absences</span>
      </div>
      <div>
        <button class="btn btn-secondary" style="width:100%;margin-bottom:12px" onclick="showAddAbsenceModal('${esc(String(num))}')">
          + Add anticipated absence
        </button>
        ${body}
      </div>
    </div>`;
}

// ── Director management: add / edit modal ──────────────────────────────────────

let _absEditState = null; // { num, type, search }

function showAddAbsenceModal(prefillNum) {
  if (!STATE.isAdmin) return;
  _absEditState = { num: prefillNum ? String(prefillNum) : '', type: 'absent', search: '' };
  openModal(_absenceModalHtml('Add Anticipated Absence', {
    type: 'absent', date: today(), endDate: '', time: '', note: '',
  }, 'saveAbsence()'));
  setTimeout(() => document.getElementById(prefillNum ? 'm-abs-date' : 'abs-student-search')?.focus(), 80);
}

function showEditAbsenceModal(id) {
  if (!STATE.isAdmin) return;
  const a = STATE.anticipatedAbsences.find(x => x.id === id);
  if (!a) return;
  _absEditState = { num: String(a.studentNumber), type: a.type || 'absent', search: '' };
  openModal(_absenceModalHtml('Edit Anticipated Absence', a, `updateAbsence('${esc(id)}')`, id));
}

function _absenceModalHtml(title, a, saveCall, editId) {
  const type = _absEditState.type;
  const typeChip = (val, label) => `
    <button class="seg-chip abs-type-chip ${type === val ? 'seg-selected' : ''}" data-type="${val}"
            onclick="absEditSetType('${val}')">${label}</button>`;
  return `
    <div class="modal-title">${title}</div>

    <div class="form-group">
      <label class="form-label">Student</label>
      <div id="abs-student">${_absStudentPickerHtml()}</div>
    </div>

    <div class="form-group">
      <label class="form-label">What are they reporting?</label>
      <div class="seg-chip-row">
        ${typeChip('absent', 'Absent')}
        ${typeChip('late', 'Arriving late')}
        ${typeChip('leave-early', 'Leaving early')}
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Date</label>
      <input class="form-input" id="m-abs-date" type="date" value="${esc(a.date || today())}">
    </div>

    <div class="form-group">
      <label class="form-label">Through <span style="font-weight:400;color:var(--text-muted)">(optional — for a multi-day absence)</span></label>
      <input class="form-input" id="m-abs-enddate" type="date" value="${esc(a.endDate || '')}">
    </div>

    <div class="form-group" id="abs-time-wrap" style="${type === 'absent' ? 'display:none' : ''}">
      <label class="form-label" id="abs-time-label">${type === 'late' ? 'Expected arrival time' : 'Expected departure time'} <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <input class="form-input" id="m-abs-time" type="time" value="${esc(a.time || '')}">
    </div>

    <div class="form-group">
      <label class="form-label">Reason / note <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <textarea class="form-textarea" id="m-abs-note" rows="2" maxlength="300" style="resize:none"
                placeholder="e.g. Orthodontist appointment">${esc(a.note || '')}</textarea>
    </div>

    <div class="modal-actions" style="margin-top:6px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="${saveCall}">${editId ? 'Save' : 'Add'}</button>
    </div>
    ${editId ? `
    <div class="danger-zone">
      <div class="danger-zone-title">Danger Zone</div>
      <button class="btn btn-danger btn-full" onclick="confirmDeleteAbsence('${esc(editId)}')">Delete Notice</button>
    </div>` : ''}`;
}

// The student field: a chosen-student chip, or a search box to pick one.
function _absStudentPickerHtml() {
  const num = _absEditState.num;
  if (num) {
    const s = STATE.students[String(num)];
    const name = s ? (s.name || `#${num}`) : `#${num}`;
    const meta = s && hasField('instrument') && s.instrument ? ` · ${esc(normInstrument(s.instrument))}` : '';
    return `<div class="abs-student-chosen">
      <span>${esc(name)}${meta}</span>
      <button type="button" class="abs-student-change" onclick="absEditClearStudent()">Change</button>
    </div>`;
  }
  return `
    <input class="form-input" id="abs-student-search" type="text" autocomplete="off"
           placeholder="Search a student by name or number…"
           oninput="absEditSearch(this.value)" value="${esc(_absEditState.search)}">
    <div id="abs-student-results">${_absStudentResultsHtml()}</div>`;
}

function _absStudentResultsHtml() {
  const q = _absEditState.search.trim().toLowerCase();
  if (!q) return '';
  const matches = Object.values(STATE.students)
    .filter(s => (s.name || '').toLowerCase().includes(q) || String(s.number).includes(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .slice(0, 8);
  if (!matches.length) return `<div class="preset-empty" style="margin-top:6px">No matching students.</div>`;
  return `<div class="task-ex-results-list">${matches.map(s => `
    <button type="button" class="abs-student-result" onclick="absEditPickStudent('${esc(String(s.number))}')">
      ${esc(s.name || `#${s.number}`)}${hasField('instrument') && s.instrument ? ` <span style="color:var(--text-muted)">· ${esc(normInstrument(s.instrument))}</span>` : ''}
    </button>`).join('')}</div>`;
}

function _rerenderAbsStudent() {
  const el = document.getElementById('abs-student');
  if (el) el.innerHTML = _absStudentPickerHtml();
}

function absEditSearch(val) {
  _absEditState.search = val;
  const el = document.getElementById('abs-student-results');
  if (el) el.innerHTML = _absStudentResultsHtml();
}

function absEditPickStudent(num) {
  _absEditState.num = String(num);
  _absEditState.search = '';
  _rerenderAbsStudent();
}

function absEditClearStudent() {
  _absEditState.num = '';
  _rerenderAbsStudent();
  setTimeout(() => document.getElementById('abs-student-search')?.focus(), 30);
}

// Type change: no full re-render (would drop the date/note fields being typed).
// Just repaint the chip selection and the time field's visibility + label.
function absEditSetType(type) {
  _absEditState.type = type;
  document.querySelectorAll('.abs-type-chip').forEach(c =>
    c.classList.toggle('seg-selected', c.dataset.type === type));
  const wrap  = document.getElementById('abs-time-wrap');
  const label = document.getElementById('abs-time-label');
  if (wrap)  wrap.style.display = type === 'absent' ? 'none' : '';
  if (label) label.firstChild.textContent =
    (type === 'late' ? 'Expected arrival time' : 'Expected departure time') + ' ';
}

// ── Persisting notices ─────────────────────────────────────────────────────────

function _readAbsenceForm() {
  const num = _absEditState.num;
  if (!num) { showToast('Pick a student first.'); return null; }
  const date = document.getElementById('m-abs-date')?.value || '';
  if (!date) { showToast('Please choose a date.'); return null; }
  const endDate = document.getElementById('m-abs-enddate')?.value || '';
  if (endDate && endDate < date) { showToast('The end date can’t be before the start date.'); return null; }
  const type = _absEditState.type;
  const data = {
    studentNumber: String(num),
    type,
    date,
    note: document.getElementById('m-abs-note')?.value.trim() || '',
  };
  if (endDate && endDate !== date) data.endDate = endDate;
  // Time only makes sense for late / leave-early.
  const time = document.getElementById('m-abs-time')?.value || '';
  if (time && type !== 'absent') data.time = time;
  return data;
}

function saveAbsence() {
  const data = _readAbsenceForm();
  if (!data) return;
  closeModal();
  const ref = orgCol('anticipatedAbsences').doc();
  const doc = { ...data, createdBy: STATE.user?.uid || '', createdAt: Date.now() };
  STATE.anticipatedAbsences.push({ ...doc, id: ref.id });
  ref.set(doc);
  _syncAbsenceMirror(); // backfill this student's portal mirror right away
  render();
  const s = STATE.students[String(data.studentNumber)];
  showToast(`Anticipated absence saved for ${s?.name || '#' + data.studentNumber}.`);
}

function updateAbsence(id) {
  const data = _readAbsenceForm();
  if (!data) return;
  const a = STATE.anticipatedAbsences.find(x => x.id === id);
  if (!a) { closeModal(); return; }
  // Clear fields that no longer apply (e.g. a range narrowed to one day, or a
  // time dropped when switched back to a full absence) so stale values don't
  // linger on the doc or in the mirror.
  const del = firebase.firestore.FieldValue.delete();
  const write = { ...data };
  if (!('endDate' in data)) write.endDate = del;
  if (!('time' in data))    write.time    = del;
  Object.assign(a, data);
  if (!('endDate' in data)) delete a.endDate;
  if (!('time' in data))    delete a.time;
  orgCol('anticipatedAbsences').doc(id).set(write, { merge: true });
  _syncAbsenceMirror();
  closeModal();
  render();
}

function confirmDeleteAbsence(id) {
  const a = STATE.anticipatedAbsences.find(x => x.id === id);
  const s = a && STATE.students[String(a.studentNumber)];
  showConfirmModal(
    'Delete this notice?',
    `The anticipated absence${s ? ` for <strong>${esc(s.name || '#' + a.studentNumber)}</strong>` : ''} will be removed.`,
    () => {
      STATE.anticipatedAbsences = STATE.anticipatedAbsences.filter(x => x.id !== id);
      orgCol('anticipatedAbsences').doc(id).delete();
      _syncAbsenceMirror();
      closeModal();
      render();
      showToast('Notice deleted.');
    },
    'Delete'
  );
}

// ── Student portal ─────────────────────────────────────────────────────────────
// Students read their own upcoming notices from the mirror on their own doc.
// Returns '' when there are none. Called from viewStudentPortal (js/07).

function portalAbsencesSectionHtml(num) {
  if (!portalFeatureOn('attendance')) return '';
  const mine = (STATE.students[String(num)]?.anticipatedAbsences) || [];
  const upcoming = upcomingAbsences(mine, today());
  if (!upcoming.length) return '';
  return `
    <div class="sec-card">
    <div id="portal-sec-anticipated-hdr" class="sec-hdr" onclick="toggleCollapse('portal-sec-anticipated')">
      <span class="section-title" style="margin:0">Absences You Reported</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="portal-sec-anticipated" class="sec-collapsed">
      <p class="modal-sub" style="margin:2px 0 10px">Your directors have these on file. Something wrong? Let them know.</p>
      ${upcoming.map(a => `
        <div class="abs-row" style="cursor:default">
          <div class="abs-row-main">
            <span class="att-summary-chip ${_absenceChipClass(a.type)}">${esc(absenceTypeLabel(a.type))}</span>
          </div>
          <div class="abs-row-when">${_absenceWhenText(a)}</div>
          ${a.note ? `<div class="abs-row-note">📝 ${esc(a.note)}</div>` : ''}
        </div>`).join('')}
    </div>
    </div>`;
}
