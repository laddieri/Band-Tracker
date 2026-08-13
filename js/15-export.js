// Band Tracker — js/15-export.js — Export Center (customizable CSV / PDF export).
// Plain script sharing global scope; load order is set in index.html.
//
// Director-only. The Export Center (opened from Band Settings) lets a director
// pick a data set, toggle which columns to include, optionally bound marks by
// date, and download a CSV or print a PDF. The heavy lifting — turning plain
// data into a { columns, rows } table and rendering it — is pure logic in
// js/00-logic.js (tableToCsv / tableToPrintHtml / the build*ExportTable fns);
// this file only gathers STATE and wires the UI. Downloads go through
// _downloadCsv / _printHtmlDocument (js/03-router.js).
//
// Songs and Tasks add two extra controls: a student picker (the familiar
// search / sort / filter bar, bound to _exportFilter under the 'export' viewId —
// see the filter plumbing in js/03-router.js) and an item selector, so a
// director can export "which songs has this student/group completed?" (grid over
// the chosen students) or "who has passed this one song?" (one row per student).

let _exportDataset   = 'roster';   // which data set is selected
let _exportFormat    = 'csv';      // 'csv' | 'pdf'
let _exportMarksMode = 'detail';   // marks only: 'detail' | 'summary'
let _exportItemId    = '';         // songs/tasks: '' = grid over students, else a single song/task id

// Whole roster, name-sorted — the students roster/marks/leaderboard export over.
function _exportStudents() {
  return Object.values(DB.getStudents()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// The students Songs/Tasks export over: the director's search / sort / filter
// selection, via the shared engine. Same result the roster list would show.
function _exportFilteredStudents() {
  return filterAndSortStudents(Object.values(DB.getStudents()), _exportFilter, _rosterScoreMap());
}

function _exportSortOptions() {
  const opts = [{ value: 'name', label: 'Name' }, { value: 'number', label: 'Number' }];
  if (hasField('instrument')) opts.push({ value: 'instrument', label: 'Instrument' });
  if (hasField('section'))    opts.push({ value: 'section',    label: 'Section' });
  if (hasField('grade'))      opts.push({ value: 'grade',      label: 'Grade' });
  return opts;
}

function _exportSlug(s) {
  return (s || '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'item';
}

// Roster columns respect the band's enabled fields (+ custom fields). Number and
// name always; the sign-in code always last.
function _exportRosterColumns() {
  const cols = [
    { key: 'number', label: 'Student Number' },
    { key: 'name',   label: 'Name' },
  ];
  if (hasField('instrument')) cols.push({ key: 'instrument', label: 'Instrument' });
  if (hasField('section'))    cols.push({ key: 'section',    label: 'Section' });
  if (hasField('grade'))      cols.push({ key: 'grade',      label: 'Grade' });
  for (const cf of (STATE.customStudentFields || [])) cols.push({ key: cf.key, label: cf.label });
  if (hasField('notes'))      cols.push({ key: 'notes',      label: 'Notes' });
  cols.push({ key: 'studentCode', label: 'Student Code' });
  return cols;
}

function _exportRosterTable() {
  return { title: 'Roster', table: buildRosterExportTable(_exportStudents(), _exportRosterColumns()) };
}

function _exportMarksTable() {
  const from = document.getElementById('exp-date-from')?.value || '';
  const to   = document.getElementById('exp-date-to')?.value   || '';
  let rehearsals = DB.getRehearsals().slice().sort((a, b) => (a.date > b.date ? 1 : -1));
  if (from) rehearsals = rehearsals.filter(r => r.date >= from);
  if (to)   rehearsals = rehearsals.filter(r => r.date <= to);
  const table = buildMarksExportTable(rehearsals, STATE.entries, _exportStudents(),
    { mode: _exportMarksMode, authorLabel: dirLabel });
  return { title: `Marks (${_exportMarksMode === 'summary' ? 'Season Totals' : 'Per Event'})`, table };
}

function _exportLeaderboardTable() {
  return { title: 'Leaderboard', table: buildLeaderboardExportTable(_scoreStudents()) };
}

function _exportSongsTable() {
  const students = _exportFilteredStudents();
  const songs = DB.getSongs();
  if (_exportItemId) {
    const song = songs.find(s => s.id === _exportItemId);
    if (song) return {
      title: `Song — ${song.title || 'Untitled'}`,
      slug:  `song-${_exportSlug(song.title)}`,
      table: buildSongRosterExportTable(students, song, fmtDateFromTs),
    };
  }
  return { title: 'Songs', table: buildSongsExportTable(students, songs) };
}

function _exportTasksTable() {
  const students = _exportFilteredStudents();
  const tasks = STATE.tasks || [];
  if (_exportItemId) {
    const task = tasks.find(t => t.id === _exportItemId);
    if (task) return {
      title: `Task — ${task.title || 'Untitled'}`,
      slug:  `task-${_exportSlug(task.title)}`,
      table: buildTaskRosterExportTable(students, task, fmtDateFromTs),
    };
  }
  return { title: 'Tasks', table: buildTasksExportTable(students, tasks) };
}

const EXPORT_DATASETS = [
  { id: 'roster',      label: 'Roster',      avail: () => true,                                     build: _exportRosterTable,      scoped: false },
  { id: 'marks',       label: 'Marks',       avail: () => featureOn('marks'),                       build: _exportMarksTable,       scoped: false },
  { id: 'leaderboard', label: 'Leaderboard', avail: () => featureOn('stats') && featureOn('marks'), build: _exportLeaderboardTable, scoped: false },
  { id: 'songs',       label: 'Songs',       avail: () => featureOn('songs'),                       build: _exportSongsTable,       scoped: true,  items: () => DB.getSongs().map(s => ({ id: s.id, title: s.title })), itemNoun: 'song' },
  { id: 'tasks',       label: 'Tasks',       avail: () => featureOn('tasks'),                       build: _exportTasksTable,       scoped: true,  items: () => (STATE.tasks || []).map(t => ({ id: t.id, title: t.title })), itemNoun: 'task' },
];

function _exportAvailableDatasets() {
  return EXPORT_DATASETS.filter(d => d.avail());
}

// Opened from Band Settings. Directors only — this reaches director-only data.
function showExportModal() {
  if (!STATE.isAdmin) return;
  _exportDataset   = _exportAvailableDatasets()[0]?.id || 'roster';
  _exportFormat    = 'csv';
  _exportMarksMode = 'detail';
  _exportItemId    = '';
  _exportFilter    = _mkFilter('name', 'asc');
  openModal(`<div id="exp-root">${_exportModalInner()}</div>`);
}

// Rebuild only the inner content (openModal supplies the close row). Called when
// the data set / mode / item changes, and by the filter plumbing when the student
// picker changes (see _rerenderForFilter in js/03-router.js).
function _exportRerender() {
  const root = document.getElementById('exp-root');
  if (root) root.innerHTML = _exportModalInner();
}

// The live student count + names under the picker. Refreshed on its own (leaving
// the search box focused) while typing — see _refreshFilterList('export').
function _exportStudentPreviewRows() {
  const students = _exportFilteredStudents();
  const total = Object.keys(DB.getStudents()).length;
  const names = students.map(s =>
    `<div style="padding:3px 0;font-size:.85rem">${esc(s.name || '—')} <span style="color:var(--text-muted)">#${esc(String(s.number))}</span></div>`
  ).join('');
  return `<div style="font-size:.75rem;color:var(--text-muted);margin-bottom:4px">${students.length} of ${total} students</div>`
    + (names || '<div style="color:var(--text-muted);font-size:.8rem">No students match this filter.</div>');
}

function _exportModalInner() {
  const datasets = _exportAvailableDatasets();
  const ds = datasets.find(d => d.id === _exportDataset) || datasets[0];
  _exportDataset = ds.id;
  const built = ds.build();
  const table = built.table;

  const dsChips = datasets.map(d =>
    `<button class="seg-chip${d.id === ds.id ? ' seg-selected' : ''}" onclick="selectExportDataset('${d.id}')">${esc(d.label)}</button>`
  ).join('');

  const marksControls = ds.id === 'marks' ? `
    <div class="form-label" style="margin-bottom:8px">Detail level</div>
    <div class="seg-chip-row" style="margin-bottom:16px">
      <button class="seg-chip${_exportMarksMode === 'detail'  ? ' seg-selected' : ''}" onclick="selectExportMarksMode('detail')">Per event</button>
      <button class="seg-chip${_exportMarksMode === 'summary' ? ' seg-selected' : ''}" onclick="selectExportMarksMode('summary')">Season totals</button>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <label style="flex:1"><span class="form-label">From date</span>
        <input class="form-input" id="exp-date-from" type="date"></label>
      <label style="flex:1"><span class="form-label">To date</span>
        <input class="form-input" id="exp-date-to" type="date"></label>
    </div>` : '';

  // Songs / Tasks: an item selector (grid over students vs. a single item) and
  // the familiar student search / sort / filter bar with a live preview.
  const scopedControls = ds.scoped ? (() => {
    const items = ds.items();
    const itemOpts = [`<option value="">Everyone — grid of all ${esc(ds.itemNoun)}s</option>`]
      .concat(items.map(it => `<option value="${esc(it.id)}"${it.id === _exportItemId ? ' selected' : ''}>${esc(it.title || 'Untitled')}</option>`))
      .join('');
    return `
    <div class="form-group" style="margin-bottom:14px">
      <label class="form-label" for="exp-item-select">Report</label>
      <select class="form-input" id="exp-item-select" onchange="selectExportItem(this.value)">${itemOpts}</select>
      <p style="font-size:.72rem;color:var(--text-muted);margin-top:4px">
        ${_exportItemId
          ? `One row per student showing their result for this ${esc(ds.itemNoun)}.`
          : `A grid: one row per student, one column per ${esc(ds.itemNoun)}.`}
      </p>
    </div>
    <div class="form-label" style="margin-bottom:6px">Students</div>
    ${renderFilterBar('export', _exportFilter, _exportSortOptions())}
    <div id="exp-student-preview" style="max-height:150px;overflow-y:auto;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:6px 10px;margin:8px 0 16px">
      ${_exportStudentPreviewRows()}
    </div>`;
  })() : '';

  const colChecks = table.columns.map(c => `
    <label style="display:flex;align-items:center;gap:10px;padding:6px 2px;cursor:pointer">
      <input type="checkbox" class="exp-col-check" value="${esc(c.key)}" checked
             style="width:16px;height:16px;flex-shrink:0">
      <span>${esc(c.label)}</span>
    </label>`).join('');

  return `
    <div class="modal-title">Export Data</div>
    <p style="font-size:.8rem;color:var(--text-muted);margin:-4px 0 14px">
      Director-only. Choose a data set and columns, then download a spreadsheet
      (CSV) or print to PDF.
    </p>

    <div class="form-label" style="margin-bottom:8px">Data set</div>
    <div class="seg-chip-row" style="margin-bottom:16px;flex-wrap:wrap">${dsChips}</div>

    ${marksControls}
    ${scopedControls}

    <div class="form-label" style="margin-bottom:6px">Columns</div>
    <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:6px 10px;margin-bottom:4px">
      ${colChecks || '<p style="color:var(--text-muted);font-size:.8rem;padding:6px 0">Nothing to export yet.</p>'}
    </div>

    <div class="form-label" style="margin:14px 0 8px">Format</div>
    <div class="seg-chip-row" style="margin-bottom:16px">
      <button class="seg-chip${_exportFormat === 'csv' ? ' seg-selected' : ''}" id="exp-fmt-csv" onclick="selectExportFormat('csv')">CSV (spreadsheet)</button>
      <button class="seg-chip${_exportFormat === 'pdf' ? ' seg-selected' : ''}" id="exp-fmt-pdf" onclick="selectExportFormat('pdf')">PDF (print)</button>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="runExport()">Export</button>
    </div>`;
}

function selectExportDataset(id)  { _exportDataset = id; _exportItemId = ''; _exportRerender(); }
function selectExportMarksMode(m) { _exportMarksMode = m; _exportRerender(); }
function selectExportItem(id)     { _exportItemId = id; _exportRerender(); }

// Format doesn't change the columns, so just repaint the two chips — no rerender,
// which would wipe the user's column choices.
function selectExportFormat(f) {
  _exportFormat = f;
  document.getElementById('exp-fmt-csv')?.classList.toggle('seg-selected', f === 'csv');
  document.getElementById('exp-fmt-pdf')?.classList.toggle('seg-selected', f === 'pdf');
}

function runExport() {
  if (!STATE.isAdmin) return;
  const ds = EXPORT_DATASETS.find(d => d.id === _exportDataset);
  if (!ds) return;

  const selected = [...document.querySelectorAll('.exp-col-check')].filter(b => b.checked).map(b => b.value);
  if (!selected.length) { showToast('Pick at least one column.'); return; }

  // Rebuild from current STATE + inputs so the export reflects the live data and
  // whatever date range / student filter / item the director just set.
  const built  = ds.build();
  const picked = pickColumns(built.table, selected);
  if (!picked.rows.length) { showToast('No data for this selection.'); return; }

  const slug = (STATE.bandName || 'band').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'band';
  const name = `${slug}-${built.slug || _exportDataset}`;
  closeModal();

  if (_exportFormat === 'csv') {
    _downloadCsv(`${name}.csv`, tableToCsv(picked.columns, picked.rows));
    return;
  }
  const n = picked.rows.length;
  const subtitle = `${STATE.bandName || ''} · Generated ${fmtDate(today())} · ${n} row${n !== 1 ? 's' : ''}`;
  _printHtmlDocument(tableToPrintHtml({
    title: `${built.title} — ${STATE.bandName || 'Band'}`,
    subtitle,
    columns: picked.columns,
    rows: picked.rows,
  }));
}
