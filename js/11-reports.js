// Band Tracker — js/11-reports.js — Attendance report export.
// Plain script sharing global scope; load order is set in index.html.

// ── Attendance Report ─────────────────────────────────────────────────────────

let _reportType = 'alltime'; // alltime | week | single

function showAttendanceReportModal() {
  const rehearsals = DB.getRehearsals().slice().sort((a, b) => (a.date > b.date ? 1 : -1));
  const { mon } = currentWeekRange();

  const rehearsalOptions = rehearsals.map(r =>
    `<option value="${esc(r.id)}">${esc(fmtDate(r.date))}${r.label ? ' — ' + r.label : ''}</option>`
  ).join('');

  _reportType = 'alltime';

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Attendance Report</div>
    <div class="form-label" style="margin-bottom:8px">Report period</div>
    <div class="seg-chip-row" style="margin-bottom:16px">
      <button class="seg-chip seg-selected" id="rpt-chip-alltime" onclick="selectReportType('alltime')">All Time</button>
      <button class="seg-chip" id="rpt-chip-week" onclick="selectReportType('week')">By Week</button>
      <button class="seg-chip" id="rpt-chip-single" onclick="selectReportType('single')">Single Rehearsal</button>
    </div>
    <div id="rpt-week-input" style="display:none;margin-bottom:16px">
      <label class="form-label">Week of (any date in that week)</label>
      <input class="form-input" id="rpt-week-date" type="date" value="${mon}">
    </div>
    <div id="rpt-single-input" style="display:none;margin-bottom:16px">
      <label class="form-label">Rehearsal</label>
      <select class="form-input" id="rpt-single-rid">
        ${rehearsalOptions || '<option value="">No rehearsals</option>'}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="exportAttendanceReport()">Export PDF</button>
    </div>
  `);
}

function selectReportType(type) {
  _reportType = type;
  ['alltime','week','single'].forEach(t => {
    document.getElementById(`rpt-chip-${t}`)?.classList.toggle('seg-selected', t === type);
  });
  document.getElementById('rpt-week-input').style.display   = type === 'week'   ? '' : 'none';
  document.getElementById('rpt-single-input').style.display = type === 'single' ? '' : 'none';
}

function exportAttendanceReport() {
  const allRehearsals = DB.getRehearsals().slice().sort((a, b) => (a.date > b.date ? 1 : -1));
  let rehearsals, periodLabel;

  if (_reportType === 'single') {
    const rid = document.getElementById('rpt-single-rid')?.value;
    const r = allRehearsals.find(r => r.id === rid);
    if (!r) { showToast('Select a rehearsal.'); return; }
    rehearsals  = [r];
    periodLabel = fmtDate(r.date) + (r.label ? ' — ' + r.label : '');
  } else if (_reportType === 'week') {
    const dateVal = document.getElementById('rpt-week-date')?.value;
    if (!dateVal) { showToast('Pick a date.'); return; }
    const { mon, fri } = weekRangeForDate(dateVal);
    rehearsals  = allRehearsals.filter(r => r.date >= mon && r.date <= fri);
    periodLabel = `Week of ${fmtDate(mon)} – ${fmtDate(fri)}`;
  } else {
    rehearsals  = allRehearsals;
    periodLabel = 'All Time';
  }

  closeModal();
  if (!rehearsals.length) { showToast('No rehearsals in that period.'); return; }

  const html = buildAttendanceReportHTML(rehearsals, periodLabel);
  const win  = window.open('', '_blank');
  if (!win) { showToast('Allow pop-ups to export PDF.'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

function buildAttendanceReportHTML(rehearsals, periodLabel) {
  const stuMap = DB.getStudents();
  const students = Object.values(stuMap).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  // Tally per student across selected rehearsals
  const tally = {};
  for (const s of students) {
    tally[s.number] = { absences: 0, lates: 0, absenceDates: [], lateDates: [] };
  }
  for (const r of rehearsals) {
    const entries = STATE.entries[r.id] || {};
    for (const [num, e] of Object.entries(entries)) {
      if (!tally[num]) tally[num] = { absences: 0, lates: 0, absenceDates: [], lateDates: [] };
      if (e.attendance === 'absent') {
        tally[num].absences++;
        tally[num].absenceDates.push(r.date);
      } else if (e.attendance === 'late') {
        tally[num].lates++;
        tally[num].lateDates.push(r.date);
      }
    }
  }

  // Only students with at least one incident
  const flagged = students.filter(s => (tally[s.number]?.absences || 0) + (tally[s.number]?.lates || 0) > 0);
  flagged.sort((a, b) => {
    const ta = tally[a.number], tb = tally[b.number];
    const diff = (tb.absences * 2 + tb.lates) - (ta.absences * 2 + ta.lates);
    return diff !== 0 ? diff : (a.name || '').localeCompare(b.name || '');
  });

  const summaryRows = flagged.map(s => {
    const t = tally[s.number];
    return `<tr>
      <td>${esc(s.name || '—')}</td>
      <td>${esc(normInstrument(s.instrument) || '—')}</td>
      <td class="cell-absent">${t.absences || 0}</td>
      <td class="cell-late">${t.lates || 0}</td>
    </tr>`;
  }).join('');

  // Per-rehearsal detail
  const detailSections = rehearsals.map(r => {
    const entries = STATE.entries[r.id] || {};
    const absent = students.filter(s => entries[s.number]?.attendance === 'absent');
    const late   = students.filter(s => entries[s.number]?.attendance === 'late');
    if (!absent.length && !late.length) return '';
    const nameOf = s => `${s.name || '—'} (#${s.number})${s.instrument ? ', ' + normInstrument(s.instrument) : ''}`;
    return `
      <div class="detail-block">
        <div class="detail-date">${esc(fmtDate(r.date))}${r.label ? ' — ' + esc(r.label) : ''}</div>
        ${absent.length ? `
          <div class="detail-type absent-hdr">Absent (${absent.length})</div>
          <ul>${absent.map(s => `<li>${esc(nameOf(s))}</li>`).join('')}</ul>` : ''}
        ${late.length ? `
          <div class="detail-type late-hdr">Late (${late.length})</div>
          <ul>${late.map(s => `<li>${esc(nameOf(s))}</li>`).join('')}</ul>` : ''}
      </div>`;
  }).filter(Boolean).join('');

  const generatedOn = fmtDate(today());

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Attendance Report — ${esc(periodLabel)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 32px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 28px; }
  h2 { font-size: 15px; font-weight: 700; margin: 24px 0 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #e5e7eb; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .cell-absent { color: #dc2626; font-weight: 700; text-align: center; }
  .cell-late   { color: #d97706; font-weight: 700; text-align: center; }
  .none-msg { color: #666; font-style: italic; margin-bottom: 24px; }
  .detail-block { margin-bottom: 18px; page-break-inside: avoid; }
  .detail-date { font-weight: 700; font-size: 13px; margin-bottom: 6px; }
  .detail-type { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; margin: 6px 0 4px; }
  .absent-hdr { color: #dc2626; }
  .late-hdr   { color: #d97706; }
  ul { list-style: none; padding-left: 8px; }
  ul li { padding: 2px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
  ul li:last-child { border-bottom: none; }
  @media print {
    body { padding: 16px; }
    @page { margin: 1cm; }
    .detail-block { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>Attendance Report</h1>
  <div class="meta">Period: ${esc(periodLabel)} &nbsp;·&nbsp; Generated ${esc(generatedOn)} &nbsp;·&nbsp; ${rehearsals.length} rehearsal${rehearsals.length !== 1 ? 's' : ''}</div>

  <h2>Summary</h2>
  ${flagged.length ? `
  <table>
    <thead><tr>
      <th>Name</th><th>Instrument</th>
      <th style="text-align:center">Absences</th>
      <th style="text-align:center">Late</th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>` : `<p class="none-msg">No absences or late arrivals recorded for this period.</p>`}

  ${detailSections ? `<h2>Detail by Rehearsal</h2>${detailSections}` : ''}
</body>
</html>`;
}
