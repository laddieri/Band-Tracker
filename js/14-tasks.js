// Band Tracker — js/14-tasks.js — Tasks (check-off tracking: forms, fees, to-dos).
// Plain script sharing global scope; load order is set in index.html.
//
// A "task" is something each student must complete, tracked as a simple
// done / not-done. Unlike Songs (a global memorization-exclusion list), each
// task carries its OWN applicability rules — an everyone/only-selected mode over
// instrument/section/grade groups, plus individual include/exempt overrides — so
// e.g. majorettes (exempt from song memorization) still turn in the handbook
// form. Completion is director/staff-recorded; students see their own status in
// the portal. Data model + privacy: docs/DATA_MODEL.md.

// The students a task applies to (director/staff live view; the pure predicate
// is taskAppliesToStudent in js/00-logic.js).
function _taskApplicableStudents(task) {
  return Object.values(DB.getStudents()).filter(s => taskAppliesToStudent(s, task));
}

// A short human summary of who a task applies to, for list/detail headers.
function _taskAppliesLabel(task) {
  const n = _taskApplicableStudents(task).length;
  return `${n} student${n !== 1 ? 's' : ''}`;
}

// ── View: Tasks list ──────────────────────────────────────────────────────────

function viewTasks() {
  const tasks = STATE.tasks;
  if (!tasks.length) {
    return `
      <div class="empty-state" style="padding:48px 24px">
        <div class="empty-icon">📋</div>
        <p>No tasks yet.</p>
        ${STATE.isAdmin ? `<p>Tap <strong>+</strong> to add a task — a form to turn in, a fee to pay, anything to check off.</p>` : ''}
      </div>`;
  }

  const taskRow = task => {
    const applicable = _taskApplicableStudents(task);
    const total = applicable.length;
    const done  = applicable.filter(s => task.statuses?.[String(s.number)]?.done).length;
    const pct   = total ? Math.round(done / total * 100) : 0;
    const overdue = task.dueDate && task.dueDate < today();
    return `
    <div class="song-row" onclick="navigate('task',{tid:'${esc(task.id)}'})">
      <div class="song-row-info">
        <div class="song-row-title">${esc(task.title)}${task.studentVisible === false ? ' <span class="badge badge-neutral" style="font-weight:600">hidden</span>' : ''}</div>
        <div class="song-row-due ${overdue ? 'song-overdue' : ''}">
          ${task.dueDate ? `Due ${fmtDate(task.dueDate)}${overdue ? ' — overdue' : ''} · ` : ''}${_taskAppliesLabel(task)}
        </div>
      </div>
      <div class="song-row-right">
        <div class="song-prog-wrap">
          <div class="song-prog-bar"><div class="song-prog-fill" style="width:${pct}%"></div></div>
          <div class="song-prog-lbl">${done} / ${total} done</div>
        </div>
      </div>
    </div>`;
  };

  return `<div class="songs-page">
    <div class="sec-card">
      <div class="sec-hdr sec-hdr-open" style="cursor:default">
        <span class="section-title">Tasks</span>
      </div>
      <div><div class="songs-list-grid">${tasks.map(taskRow).join('')}</div></div>
    </div>
  </div>`;
}

// ── View: Task detail ─────────────────────────────────────────────────────────

function viewTask(tid) {
  const task = STATE.tasks.find(t => t.id === tid);
  if (!task) return `<div class="empty-state"><p>Task not found.</p></div>`;

  const students = _taskApplicableStudents(task);
  const statuses = task.statuses || {};
  const doneCount = students.filter(s => statuses[String(s.number)]?.done).length;
  const notCount  = students.length - doneCount;

  const sortOpts = [
    {value:'name',   label:'Name'},
    {value:'number', label:'Number'},
    {value:'done',   label:'Status'},
    ...(hasField('instrument') ? [{value:'instrument', label:'Instrument'}] : []),
    ...(hasField('section')    ? [{value:'section',    label:'Section'}]    : []),
    ...(hasField('grade')      ? [{value:'grade',      label:'Grade'}]      : []),
  ];
  const overdue = task.dueDate && task.dueDate < today();

  return `
    <div class="song-detail-view">
      ${task.description ? `<div class="task-desc">${esc(task.description)}</div>` : ''}
      <div class="task-detail-meta">
        ${task.dueDate ? `<span class="${overdue ? 'song-overdue' : ''}">Due ${fmtDate(task.dueDate)}${overdue ? ' — overdue' : ''}</span> · ` : ''}
        Applies to ${_taskAppliesLabel(task)}${task.studentVisible === false ? ' · <span style="color:var(--text-muted)">hidden from students</span>' : ''}
      </div>

      <div class="song-stats-row task-2col">
        <div class="song-stat song-stat-pass song-stat-btn ${_taskStatusFilter==='done' ? 'song-stat-active' : ''}"
             onclick="toggleTaskStatusFilter('${esc(tid)}','done')" aria-pressed="${_taskStatusFilter==='done'}"
             aria-label="Show only students who are done"><div class="song-stat-val" id="task-cnt-done">${doneCount}</div><div class="song-stat-lbl">Done</div></div>
        <div class="song-stat song-stat-na song-stat-btn ${_taskStatusFilter==='not_done' ? 'song-stat-active' : ''}"
             onclick="toggleTaskStatusFilter('${esc(tid)}','not_done')" aria-pressed="${_taskStatusFilter==='not_done'}"
             aria-label="Show only students who are not done"><div class="song-stat-val" id="task-cnt-notdone">${notCount}</div><div class="song-stat-lbl">Not Done</div></div>
      </div>

      ${renderFilterBar('task', _taskFilter, sortOpts)}

      <div id="task-student-list">
        ${_taskStudentRows(tid)}
      </div>
    </div>`;
}

// Applicable-student rows for the task detail (shared by viewTask and the
// filter-bar partial re-render in js/03-router.js).
function _taskStudentRows(tid) {
  const task = STATE.tasks.find(t => t.id === tid);
  if (!task) return '';
  const students = _taskApplicableStudents(task);
  const statuses = task.statuses || {};
  const isDone   = num => !!statuses[String(num)]?.done;
  const getMeta  = num => {
    const st = statuses[String(num)];
    if (!st?.done) return '';
    return [st.updatedBy ? dirLabel(st.updatedBy) : '', st.updatedAt ? fmtDateTime(st.updatedAt) : ''].filter(Boolean).join(' · ');
  };

  const scoreMap = {};
  for (const s of students) scoreMap[s.number] = { done: isDone(s.number) ? 1 : 0 };

  let pool = students;
  if (_taskStatusFilter === 'done')     pool = pool.filter(s => isDone(s.number));
  else if (_taskStatusFilter === 'not_done') pool = pool.filter(s => !isDone(s.number));
  const sorted = filterAndSortStudents(pool, _taskFilter, scoreMap);

  if (!sorted.length) return `<div class="empty-state" style="padding:24px"><p>No students match the current filter.</p></div>`;

  return sorted.map(s => {
    const done = isDone(s.number);
    const meta = getMeta(s.number);
    return `
      <div class="song-stu-row">
        <div class="song-stu-info">
          <span class="song-stu-name song-stu-name-link" onclick="navigate('student',{num:'${esc(s.number)}'});event.stopPropagation()">${esc(s.name || `#${s.number}`)}</span>
          <span class="song-stu-status ${done ? 'sss-pass' : 'sss-na'}">${done ? '✓ Done' : '— Not done'}</span>
          ${meta ? `<span class="song-stu-meta">${esc(meta)}</span>` : ''}
        </div>
        <div class="song-stu-btns">
          <button class="ssb ${done ? 'ssb-on-pass' : 'ssb-pass'}" aria-label="${done ? 'Mark not done' : 'Mark done'}"
                  onclick="setTaskDone('${esc(tid)}','${esc(s.number)}')">✓</button>
        </div>
      </div>`;
  }).join('');
}

// Full re-render of the task detail (header counts + list change together).
// User-initiated taps only, so a direct render is fine.
function _refreshTaskView(tid) {
  const mc = document.getElementById('main-content');
  if (!mc) return;
  const st = mc.scrollTop;
  mc.innerHTML = viewTask(tid);
  mc.scrollTop = st;
}

// Tap a status box to filter the list to that status; tap the active box to clear.
function toggleTaskStatusFilter(tid, status) {
  _taskStatusFilter = _taskStatusFilter === status ? null : status;
  _refreshTaskView(tid);
}

// Toggle a student's completion. Marking done is instant; UNMARKING a
// previously-completed task asks for confirmation first — it's easy to tap by
// accident and it clears a record the student can see in their portal.
function setTaskDone(tid, num) {
  const task = STATE.tasks.find(t => t.id === tid);
  if (!task) return;
  if (!task.statuses) task.statuses = {};
  const currentlyDone = !!task.statuses[String(num)]?.done;
  if (currentlyDone) {
    const s = STATE.students[String(num)];
    const name = s?.name || `#${num}`;
    showConfirmModal(
      `Unmark ${esc(name)}?`,
      `This clears the completed mark for <strong>${esc(task.title)}</strong> and sets it back to Not done.`,
      () => _applyTaskDone(tid, num, false),
      'Unmark', 'btn-danger'
    );
    return;
  }
  _applyTaskDone(tid, num, true);
}

function _applyTaskDone(tid, num, done) {
  const task = STATE.tasks.find(t => t.id === tid);
  if (!task) return;
  if (!task.statuses) task.statuses = {};
  if (done) task.statuses[String(num)] = { done: true, updatedAt: Date.now(), updatedBy: STATE.user?.uid || '' };
  else delete task.statuses[String(num)];
  _bufferTaskStatus(tid, num, done);

  // Partial list update keeps rapid marking snappy (no keyboard/scroll churn);
  // patch the header counts in place so they stay live without a full re-render.
  const listEl = document.getElementById('task-student-list');
  if (listEl) listEl.innerHTML = _taskStudentRows(tid);
  const students = _taskApplicableStudents(task);
  const doneCount = students.filter(s => task.statuses[String(s.number)]?.done).length;
  const dEl = document.getElementById('task-cnt-done');
  const nEl = document.getElementById('task-cnt-notdone');
  if (dEl) dEl.textContent = doneCount;
  if (nEl) nEl.textContent = students.length - doneCount;
}

// ── Coalesced task-status writes ──────────────────────────────────────────────
// Same shape as the song-status coalescer (js/07-songs-portal.js): all of a
// task's completions live in ONE doc, so several people marking one tap at a
// time would contend on it. Taps update STATE + screen immediately; the buffer
// flushes a short window later as one merged task-doc write plus one batched
// write of the students' taskStatuses mirrors. The mirror ALWAYS carries a
// {done} entry (even for not-done) — its existence is how the portal knows the
// task applies to that student; only an applicability change (via
// _syncTaskMirror) removes it.

let _taskStatusBuf  = {};   // tid → { studentNumber → { done, updatedAt, updatedBy } }
let _taskFlushTimer = null;
const _TASK_FLUSH_MS = 2000;

function _bufferTaskStatus(tid, num, done) {
  (_taskStatusBuf[tid] = _taskStatusBuf[tid] || {})[String(num)] =
    { done, updatedAt: Date.now(), updatedBy: STATE.user?.uid || '' };
  _notePendingWrites('taskStatusBuf', true);
  if (!_taskFlushTimer) _taskFlushTimer = setTimeout(_flushTaskStatusWrites, _TASK_FLUSH_MS);
}

function _flushTaskStatusWrites() {
  clearTimeout(_taskFlushTimer);
  _taskFlushTimer = null;
  const buf = _taskStatusBuf;
  _taskStatusBuf = {};
  _notePendingWrites('taskStatusBuf', false);
  const tids = Object.keys(buf);
  if (!tids.length) return;

  const gone = () => firebase.firestore.FieldValue.delete();
  let batch = db.batch(), ops = 0;
  const commit = () => { if (ops) { batch.commit(); batch = db.batch(); ops = 0; } };
  tids.forEach(tid => {
    const statuses = {};
    Object.keys(buf[tid]).forEach(num => {
      const e = buf[tid][num];
      // Task doc keeps only "done" marks (absence = not done).
      statuses[num] = e.done ? { done: true, updatedAt: e.updatedAt, updatedBy: e.updatedBy } : gone();
      // Mirror carries {done, updatedAt} (no director identity), kept even when
      // not done so the task still shows for the student.
      batch.set(orgCol('students').doc(num), {
        taskStatuses: { [tid]: { done: e.done, updatedAt: e.updatedAt } }
      }, { merge: true });
      if (++ops >= 400) commit(); // stay clear of the 500-op batch cap
    });
    orgCol('tasks').doc(tid).set({ statuses }, { merge: true });
  });
  commit();
  // No .catch: rejections surface through the global unhandledrejection toast.
}

// Between a tap and its flush, a tasks-listener snapshot rebuilds STATE.tasks
// without the buffered marks; lay them back over so the screen never flickers.
function _overlayTaskStatusBuf() {
  Object.keys(_taskStatusBuf).forEach(tid => {
    const task = STATE.tasks.find(t => t.id === tid);
    if (!task) return;
    if (!task.statuses) task.statuses = {};
    Object.keys(_taskStatusBuf[tid]).forEach(num => {
      const e = _taskStatusBuf[tid][num];
      if (e.done) task.statuses[num] = { done: true, updatedAt: e.updatedAt, updatedBy: e.updatedBy };
      else delete task.statuses[num];
    });
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _flushTaskStatusWrites();
});
window.addEventListener('pagehide', () => _flushTaskStatusWrites());

// ── Create / edit task (with applicability editor) ────────────────────────────
// The editor mutates this in-memory state (Sets for easy toggling), re-rendering
// only the applicability sub-body so the title/description/date inputs above it
// keep focus. Converted to plain arrays on save.
let _taskEditState = null;

function showAddTaskModal() {
  if (!STATE.isAdmin) return;
  _taskEditState = {
    applyMode: 'all',
    groups: { instruments: new Set(), sections: new Set(), grades: new Set() },
    include: new Set(), exempt: new Set(),
    exSearch: '',
  };
  openModal(_taskModalHtml('Add Task', { title: '', description: '', dueDate: '', studentVisible: true }, 'saveTask()'));
  setTimeout(() => document.getElementById('m-task-title')?.focus(), 80);
}

function showEditTaskModal(tid) {
  if (!STATE.isAdmin) return;
  const t = STATE.tasks.find(x => x.id === tid);
  if (!t) return;
  _taskEditState = {
    applyMode: t.applyMode === 'include' ? 'include' : 'all',
    groups: {
      instruments: new Set(t.groups?.instruments || []),
      sections:    new Set(t.groups?.sections    || []),
      grades:      new Set(t.groups?.grades       || []),
    },
    include: new Set((t.includeStudents || []).map(String)),
    exempt:  new Set((t.exemptStudents  || []).map(String)),
    exSearch: '',
  };
  openModal(_taskModalHtml('Edit Task', t, `updateTask('${esc(tid)}')`, tid));
}

function _taskModalHtml(title, t, saveCall, editId) {
  return `
    <div class="modal-title">${title}</div>
    <div class="form-group">
      <label class="form-label">Task Title</label>
      <input class="form-input" id="m-task-title" type="text" placeholder="e.g. Handbook Form" autocomplete="off"
             value="${esc(t.title || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">Description <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <textarea class="form-textarea" id="m-task-desc" rows="2" placeholder="What students need to do…" maxlength="300" style="resize:none">${esc(t.description || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Due Date <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <input class="form-input" id="m-task-due" type="date" value="${esc(t.dueDate || '')}">
    </div>
    <label class="sfb-check-label" style="padding:4px 0 8px">
      <input type="checkbox" class="sfb-checkbox" id="m-task-visible" ${t.studentVisible !== false ? 'checked' : ''}>
      <span>Show to students in their portal</span>
    </label>

    <div class="form-label" style="margin-bottom:6px">Who does this apply to?</div>
    <div id="task-applic-body">${_renderTaskApplicBody()}</div>

    <div class="modal-actions" style="margin-top:14px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="${saveCall}">${editId ? 'Save' : 'Add Task'}</button>
    </div>
    ${editId ? `
    <div class="danger-zone">
      <div class="danger-zone-title">Danger Zone</div>
      <button class="btn btn-danger btn-full" onclick="confirmDeleteTask('${esc(editId)}')">Delete Task</button>
    </div>` : ''}`;
}

function _renderTaskApplicBody() {
  const st = _taskEditState;
  const mode = st.applyMode;
  const grpLabel = mode === 'include'
    ? 'Only these groups need to do it:'
    : 'Everyone does it — except these groups:';

  const groupChecks = (cat, items) => {
    if (!items.length) return '';
    const set = st.groups[cat];
    return `
      <div class="sfb-group">
        <div class="sfb-group-label">${cat[0].toUpperCase() + cat.slice(1)}</div>
        <div class="sfb-checks">
          ${items.map(item => `
            <label class="sfb-check-label">
              <input type="checkbox" class="sfb-checkbox" ${set.has(item) ? 'checked' : ''}
                     onchange="taskEditToggleGroup('${cat}','${esc(item)}',this.checked)">
              <span>${esc(item)}</span>
            </label>`).join('')}
        </div>
      </div>`;
  };

  const count = _taskApplicableCountFromState();
  const exceptionChip = (num, kind) => {
    const s = STATE.students[String(num)];
    const name = s ? (s.name || `#${num}`) : `#${num}`;
    return `<button class="task-ex-chip task-ex-${kind}" onclick="taskEditRemoveException('${esc(String(num))}')">
      ${kind === 'include' ? '➕' : '🚫'} ${esc(name)}<span class="song-group-chip-x">×</span></button>`;
  };
  const chips = [...st.include].map(n => exceptionChip(n, 'include'))
    .concat([...st.exempt].map(n => exceptionChip(n, 'exempt'))).join('');

  return `
    <div class="seg-chip-row" style="margin-bottom:10px">
      <button class="seg-chip ${mode === 'all' ? 'seg-selected' : ''}" onclick="taskEditSetMode('all')">Everyone</button>
      <button class="seg-chip ${mode === 'include' ? 'seg-selected' : ''}" onclick="taskEditSetMode('include')">Only selected groups</button>
    </div>
    <div class="preset-section">
      <div class="form-hint" style="margin:0 0 8px">${grpLabel}</div>
      ${groupChecks('instruments', instrumentsInRoster())}
      ${groupChecks('sections', sectionsInRoster())}
      ${groupChecks('grades', gradesInRoster())}
      ${(!instrumentsInRoster().length && !sectionsInRoster().length && !gradesInRoster().length)
        ? `<div class="preset-empty">Add instruments, sections, or grades to students to filter by group.</div>` : ''}
    </div>

    <div class="form-label" style="margin:12px 0 4px">Exceptions <span style="font-weight:400;color:var(--text-muted)">(individual students)</span></div>
    ${chips ? `<div class="song-group-chips" style="margin-bottom:6px">${chips}</div>` : ''}
    <input class="form-input" id="task-ex-search" type="text" placeholder="Search a student to include or exempt…"
           autocomplete="off" oninput="taskEditExSearch(this.value)" value="${esc(st.exSearch)}">
    <div id="task-ex-results">${_taskExResultsHtml()}</div>

    <div class="task-applies-count">Applies to <strong>${count}</strong> student${count !== 1 ? 's' : ''}</div>`;
}

function _taskExResultsHtml() {
  const st = _taskEditState;
  const q = st.exSearch.trim().toLowerCase();
  if (!q) return '';
  const already = n => st.include.has(String(n)) || st.exempt.has(String(n));
  const matches = Object.values(STATE.students)
    .filter(s => !already(s.number) &&
      ((s.name || '').toLowerCase().includes(q) || String(s.number).includes(q)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .slice(0, 8);
  if (!matches.length) return `<div class="preset-empty" style="margin-top:6px">No matching students.</div>`;
  return `<div class="task-ex-results-list">${matches.map(s => `
    <div class="task-ex-result-row">
      <span class="task-ex-result-name">${esc(s.name || `#${s.number}`)}${hasField('instrument') && s.instrument ? ` <span style="color:var(--text-muted)">· ${esc(normInstrument(s.instrument))}</span>` : ''}</span>
      <span class="task-ex-result-btns">
        <button class="btn btn-success btn-sm" onclick="taskEditAddException('${esc(String(s.number))}','include')">Include</button>
        <button class="btn btn-mistake btn-sm" onclick="taskEditAddException('${esc(String(s.number))}','exempt')">Exempt</button>
      </span>
    </div>`).join('')}</div>`;
}

// Build a task-shaped object from the editor state to count applicable students live.
function _taskStateToTask() {
  const st = _taskEditState;
  return {
    applyMode: st.applyMode,
    groups: {
      instruments: [...st.groups.instruments],
      sections:    [...st.groups.sections],
      grades:      [...st.groups.grades],
    },
    includeStudents: [...st.include],
    exemptStudents:  [...st.exempt],
  };
}
function _taskApplicableCountFromState() {
  const task = _taskStateToTask();
  return Object.values(STATE.students).filter(s => taskAppliesToStudent(s, task)).length;
}

function _rerenderTaskApplicBody() {
  const el = document.getElementById('task-applic-body');
  if (el) el.innerHTML = _renderTaskApplicBody();
}

function taskEditSetMode(mode) { _taskEditState.applyMode = mode; _rerenderTaskApplicBody(); }
function taskEditToggleGroup(cat, name, checked) {
  const set = _taskEditState.groups[cat];
  if (checked) set.add(name); else set.delete(name);
  _rerenderTaskApplicBody();
}
function taskEditExSearch(val) {
  _taskEditState.exSearch = val;
  const el = document.getElementById('task-ex-results');
  if (el) el.innerHTML = _taskExResultsHtml();
}
function taskEditAddException(num, kind) {
  num = String(num);
  _taskEditState.include.delete(num);
  _taskEditState.exempt.delete(num);
  (kind === 'include' ? _taskEditState.include : _taskEditState.exempt).add(num);
  _taskEditState.exSearch = '';
  _rerenderTaskApplicBody();
}
function taskEditRemoveException(num) {
  num = String(num);
  _taskEditState.include.delete(num);
  _taskEditState.exempt.delete(num);
  _rerenderTaskApplicBody();
}

function _readTaskForm() {
  const title = document.getElementById('m-task-title')?.value.trim();
  if (!title) { showToast('Please enter a task title.'); return null; }
  const st = _taskStateToTask();
  return {
    title,
    description: document.getElementById('m-task-desc')?.value.trim() || '',
    dueDate:     document.getElementById('m-task-due')?.value || '',
    studentVisible: !!document.getElementById('m-task-visible')?.checked,
    completionType: 'checkoff',
    applyMode: st.applyMode,
    groups: st.groups,
    includeStudents: st.includeStudents,
    exemptStudents:  st.exemptStudents,
  };
}

function saveTask() {
  const data = _readTaskForm();
  if (!data) return;
  closeModal();
  const ref = orgCol('tasks').doc();
  const doc = { ...data, statuses: {}, addedBy: STATE.user?.uid || '', createdAt: Date.now() };
  STATE.tasks.push({ ...doc, id: ref.id });
  STATE.tasks.sort((a, b) => (a.dueDate || 'z').localeCompare(b.dueDate || 'z') || (a.title || '').localeCompare(b.title || ''));
  ref.set(doc);
  _syncTaskMirror();       // backfill the applicable students' mirrors right away
  render();
  showToast(`"${data.title}" added.`);
}

function updateTask(tid) {
  const data = _readTaskForm();
  if (!data) return;
  const task = STATE.tasks.find(t => t.id === tid);
  if (!task) { closeModal(); return; }
  Object.assign(task, data);
  orgCol('tasks').doc(tid).set(data, { merge: true });
  _syncTaskMirror();       // applicability may have changed — re-sync mirrors
  closeModal();
  render();
}

function confirmDeleteTask(tid) {
  const task = STATE.tasks.find(t => t.id === tid);
  showConfirmModal(
    'Delete this task?',
    `<strong>${esc(task?.title || 'This task')}</strong> and all its completion
     data will be permanently deleted. This cannot be undone.`,
    () => {
      STATE.tasks = STATE.tasks.filter(t => t.id !== tid);
      orgCol('tasks').doc(tid).delete();
      // Clean up the per-student taskStatuses mirrors.
      const batch = db.batch();
      let dirty = false;
      for (const [num, s] of Object.entries(STATE.students)) {
        if (s.taskStatuses && s.taskStatuses[tid] !== undefined) {
          batch.update(orgCol('students').doc(String(num)), {
            [`taskStatuses.${tid}`]: firebase.firestore.FieldValue.delete()
          });
          dirty = true;
        }
      }
      if (dirty) batch.commit().catch(() => {});
      navigate('tasks');
      showToast('Task deleted.');
    },
    'Delete'
  );
}

// ── Student portal tasks ──────────────────────────────────────────────────────
// The catalog + this student's own completion. Directors/staff compute live from
// STATE.tasks; students join the published catalog (settings/public) with the
// taskStatuses mirror on their own doc. A task shows for a student only when it
// applies to them (director/staff: taskAppliesToStudent; student: a mirror entry
// exists) AND it's student-visible.
function _portalTasks(num) {
  if (!portalFeatureOn('tasks')) return [];
  const s = STATE.students[String(num)];
  if (canRecord()) {
    return STATE.tasks
      .filter(t => t.studentVisible !== false && s && taskAppliesToStudent(s, t))
      .map(task => {
        const applicable = _taskApplicableStudents(task);
        return {
          id: task.id, title: task.title, dueDate: task.dueDate || '',
          done: !!task.statuses?.[String(num)]?.done,
          bandDone: applicable.filter(a => task.statuses?.[String(a.number)]?.done).length,
          total: applicable.length,
        };
      });
  }
  const mine = s?.taskStatuses || {};
  return (STATE.publicStats?.tasks || [])
    .filter(t => mine[t.id] !== undefined)   // mirror entry exists => applies to me
    .map(task => ({
      id: task.id, title: task.title, dueDate: task.dueDate || '',
      done: !!mine[task.id]?.done,
      bandDone: task.done || 0, total: task.total || 0,
    }));
}
