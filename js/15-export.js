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

let _exportDataset   = 'roster';   // which data set is selected
let _exportFormat    = 'csv';      // 'csv' | 'pdf'
let _exportMarksMode = 'detail';   // marks only: 'detail' | 'summary'

// The students every table is built over: whole roster, name-sorted.
function _exportStudents() {
  return Object.values(DB.getStudents()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
  return { title: 'Songs', table: buildSongsExportTable(_exportStudents(), DB.getSongs()) };
}

function _exportTasksTable() {
  return { title: 'Tasks', table: buildTasksExportTable(_exportStudents(), STATE.tasks || []) };
}

const EXPORT_DATASETS = [
  { id: 'roster',      label: 'Roster',      avail: () => true,                                     build: _exportRosterTable },
  { id: 'marks',       label: 'Marks',       avail: () => featureOn('marks'),                       build: _exportMarksTable },
  { id: 'leaderboard', label: 'Leaderboard', avail: () => featureOn('stats') && featureOn('marks'), build: _exportLeaderboardTable },
  { id: 'songs',       label: 'Songs',       avail: () => featureOn('songs'),                       build: _exportSongsTable },
  { id: 'tasks',       label: 'Tasks',       avail: () => featureOn('tasks'),                       build: _exportTasksTable },
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
  openModal(`<div id="exp-root">${_exportModalInner()}</div>`);
}

// Rebuild only the inner content (openModal supplies the close row). Called when
// the data set or marks mode changes; column checkboxes reset to all-on, which
// is the right default for a different set.
function _exportRerender() {
  const root = document.getElementById('exp-root');
  if (root) root.innerHTML = _exportModalInner();
}

function _exportModalInner() {
  const datasets = _exportAvailableDatasets();
  const ds = datasets.find(d => d.id === _exportDataset) || datasets[0];
  _exportDataset = ds.id;
  const { table } = ds.build();

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

function selectExportDataset(id)   { _exportDataset = id;   _exportRerender(); }
function selectExportMarksMode(m)  { _exportMarksMode = m;  _exportRerender(); }

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
  // any date range the director just set.
  const { title, table } = ds.build();
  const picked = pickColumns(table, selected);

  const slug = (STATE.bandName || 'band').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'band';
  closeModal();

  if (_exportFormat === 'csv') {
    _downloadCsv(`${slug}-${_exportDataset}.csv`, tableToCsv(picked.columns, picked.rows));
    return;
  }
  const n = picked.rows.length;
  const subtitle = `${STATE.bandName || ''} · Generated ${fmtDate(today())} · ${n} row${n !== 1 ? 's' : ''}`;
  _printHtmlDocument(tableToPrintHtml({
    title: `${title} — ${STATE.bandName || 'Band'}`,
    subtitle,
    columns: picked.columns,
    rows: picked.rows,
  }));
}
