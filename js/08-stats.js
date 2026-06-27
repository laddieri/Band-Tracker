// Band Tracker — js/08-stats.js — Marks dashboard, leaderboard (admin + student), score settings, student detail.
// Plain script sharing global scope; load order is set in index.html.

// ── Rehearsal Marks Dashboard ─────────────────────────────────────────────────

function setDashboardRehearsal(rid) {
  _dashRid = rid || null;
  render();
}

function viewDashboard() {
  if (!STATE.isAdmin) return '';

  const rehearsals = [...STATE.rehearsals].sort((a, b) => b.date.localeCompare(a.date));

  // Collect entries for selected scope
  const scopeMap = _dashRid
    ? (STATE.entries[_dashRid] || {})
    : Object.values(STATE.entries).reduce((acc, re) => {
        for (const [num, e] of Object.entries(re)) {
          if (!acc[num]) acc[num] = { positives: 0, mistakes: 0, events: [], absences: 0, lates: 0 };
          acc[num].positives += e.positives || 0;
          acc[num].mistakes  += e.mistakes  || 0;
          acc[num].events     = acc[num].events.concat(e.events || []);
          if (e.attendance === 'absent') acc[num].absences++;
          if (e.attendance === 'late')   acc[num].lates++;
        }
        return acc;
      }, {});

  const scopeEntries = Object.values(_dashRid ? scopeMap : scopeMap);
  const allEvents    = scopeEntries.flatMap(e => e.events || []);

  // Totals
  const totalPos    = scopeEntries.reduce((s, e) => s + (e.positives || 0), 0);
  const totalMis    = scopeEntries.reduce((s, e) => s + (e.mistakes  || 0), 0);
  const totalAbsent = _dashRid
    ? Object.values(scopeMap).filter(e => e.attendance === 'absent').length
    : Object.values(scopeMap).reduce((s, e) => s + (e.absences || 0), 0);
  const marked = scopeEntries.filter(e => (e.positives || 0) + (e.mistakes || 0) > 0).length;
  const totalStudents = Object.keys(STATE.students).length;

  // Note frequency counts (exclude auto-bonus marks)
  const posCounts = {};
  const misCounts = {};
  for (const evt of allEvents) {
    if (!evt.note?.trim()) continue;
    const target = evt.type === 'positive' ? posCounts : misCounts;
    target[evt.note] = (target[evt.note] || 0) + 1;
  }
  const topPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topMis = Object.entries(misCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Per-student totals for rankings
  const stuList = Object.entries(_dashRid ? scopeMap : scopeMap).map(([num, e]) => ({
    num,
    name: STATE.students[num]?.name || `#${num}`,
    pos:  e.positives || 0,
    mis:  e.mistakes  || 0,
  }));
  const topPerformers = [...stuList].sort((a, b) => b.pos - a.pos || a.name.localeCompare(b.name)).filter(s => s.pos > 0).slice(0, 10);
  const mostMistakes  = [...stuList].sort((a, b) => b.mis - a.mis || a.name.localeCompare(b.name)).filter(s => s.mis > 0).slice(0, 10);

  const selectedR = _dashRid ? rehearsals.find(r => r.id === _dashRid) : null;
  const scopeLabel = selectedR
    ? fmtDate(selectedR.date) + (selectedR.label ? ` — ${selectedR.label}` : '')
    : `All Rehearsals (${rehearsals.length} total)`;

  const statCard = (label, value, sub, cls, onclick) => `
    <div class="dash-stat${onclick ? ' dash-stat-clickable' : ''}" ${onclick ? `onclick="${onclick}"` : ''}>
      <div class="dash-stat-val ${cls || ''}">${value}</div>
      <div class="dash-stat-lbl">${label}</div>
      ${sub ? `<div class="dash-stat-sub">${sub}</div>` : ''}
    </div>`;

  const noteRow = (note, count, type) => `
    <div class="dash-note-row" onclick="showMarkStudentsModal('${esc(note)}','${type}')">
      <span class="dash-note-text">${esc(note)}</span>
      <span class="dash-note-count ${type === 'positive' ? 'dash-count-pos' : 'dash-count-mis'}">${count}</span>
      <span class="dash-stu-chevron">›</span>
    </div>`;

  const stuRow = (s, valKey, cls) => `
    <div class="dash-stu-row" onclick="showStudentMarksModal('${esc(s.num)}','${esc(_dashRid||'')}')">
      <span class="dash-stu-name">${esc(s.name)}</span>
      <span class="dash-stu-val ${cls}">${valKey === 'pos' ? '+' : ''}${s[valKey]}</span>
      <span class="dash-stu-chevron">›</span>
    </div>`;

  return `
    <div class="dash-view">

      <div class="dash-select-wrap">
        <select class="dash-select" onchange="setDashboardRehearsal(this.value)">
          <option value="" ${!_dashRid ? 'selected' : ''}>Season Summary — All Rehearsals</option>
          ${rehearsals.map(r => `
            <option value="${esc(r.id)}" ${_dashRid === r.id ? 'selected' : ''}>
              ${esc(fmtDate(r.date))}${r.label ? ' — ' + esc(r.label) : ''}${r.ended ? '' : ' (in progress)'}
            </option>`).join('')}
        </select>
      </div>

      <div class="dash-stat-grid">
        ${statCard('Positives',       totalPos, null,                                  'dash-val-pos', "showDashStatModal('positives')")}
        ${statCard('Mistakes',        totalMis, null,                                  'dash-val-mis', "showDashStatModal('mistakes')")}
        ${statCard('Students Marked', marked,   totalStudents ? `of ${totalStudents}` : null, '',     "showDashStatModal('marked')")}
      </div>

      ${topPos.length || topMis.length ? `
        <div class="section-title" style="margin:20px 0 8px">Most Common Marks</div>
        <div class="dash-notes-cols">
          <div class="dash-notes-col">
            <div class="dash-notes-hdr dash-notes-hdr-pos">✓ Positives</div>
            ${topPos.length
              ? topPos.map(([note, count]) => noteRow(note, count, 'positive')).join('')
              : `<div class="dash-notes-empty">No positive marks recorded</div>`}
          </div>
          <div class="dash-notes-col">
            <div class="dash-notes-hdr dash-notes-hdr-mis">✗ Mistakes</div>
            ${topMis.length
              ? topMis.map(([note, count]) => noteRow(note, count, 'mistake')).join('')
              : `<div class="dash-notes-empty">No mistake marks recorded</div>`}
          </div>
        </div>` : ''}

      ${topPerformers.length ? `
        <div class="section-title" style="margin:20px 0 8px">Top Performers</div>
        <div class="card" style="padding:0;overflow:hidden">
          ${topPerformers.map(s => stuRow(s, 'pos', 'dash-val-pos')).join('')}
        </div>` : ''}

      ${mostMistakes.length ? `
        <div class="section-title" style="margin:20px 0 8px">Most Mistakes</div>
        <div class="card" style="padding:0;overflow:hidden">
          ${mostMistakes.map(s => stuRow(s, 'mis', 'dash-val-mis')).join('')}
        </div>` : ''}

      ${!topPos.length && !topMis.length && !topPerformers.length ? `
        <div class="empty-state" style="padding:48px 24px">
          <p>No marks recorded${selectedR ? ' for this rehearsal' : ' yet'}.</p>
        </div>` : ''}

    </div>`;
}

function showStudentMarksModal(num, rid) {
  const s = STATE.students[num];
  const name = s?.name || `#${num}`;

  // Build a list of { rehearsal, events } pairs for the scope
  const rehearsals = [...STATE.rehearsals].sort((a, b) => b.date.localeCompare(a.date));
  const scoped = rid
    ? rehearsals.filter(r => r.id === rid)
    : rehearsals.filter(r => STATE.entries[r.id]?.[num]);

  const eventRow = (evt) => {
    const isMistake = evt.type === 'mistake';
    const parts = [evt.note?.trim(), evt.segment?.trim()].filter(Boolean);
    return `
      <div class="dash-evt-row">
        <span class="dash-evt-icon ${isMistake ? 'dash-evt-mis' : 'dash-evt-pos'}">${isMistake ? '✗' : '✓'}</span>
        <span class="dash-evt-text">${parts.length ? esc(parts.join(' — ')) : `<em style="color:var(--text-muted)">No note</em>`}</span>
        ${evt.ts ? `<span class="dash-evt-time">${fmtTime(evt.ts)}</span>` : ''}
      </div>`;
  };

  const rehSection = (r) => {
    const entry = STATE.entries[r.id]?.[num];
    if (!entry) return '';
    const evts = (entry.events || []);
    const posCount = entry.positives || 0;
    const misCount = entry.mistakes  || 0;
    if (!posCount && !misCount) return '';
    return `
      ${!rid ? `<div class="dash-modal-reh-hdr">${esc(fmtDate(r.date))}${r.label ? ' — ' + esc(r.label) : ''}</div>` : ''}
      ${evts.length
        ? evts.map(eventRow).join('')
        : `<div class="dash-evt-summary">
             ${posCount ? `<span class="dash-count-pos" style="border-radius:4px;padding:2px 7px;font-size:.8rem;font-weight:700">+${posCount}</span>` : ''}
             ${misCount ? `<span class="dash-count-mis" style="border-radius:4px;padding:2px 7px;font-size:.8rem;font-weight:700">${misCount}✗</span>` : ''}
             <span style="font-size:.82rem;color:var(--text-muted);margin-left:4px">No detail recorded</span>
           </div>`}`;
  };

  const body = scoped.map(rehSection).filter(Boolean).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${esc(name)}
      <div style="font-size:0.78rem;font-weight:400;color:var(--text-muted);margin-top:2px">
        ${rid ? (() => { const r = STATE.rehearsals.find(r => r.id === rid); return r ? fmtDate(r.date) + (r.label ? ' — ' + esc(r.label) : '') : ''; })() : 'All Rehearsals'}
      </div>
    </div>
    <div class="dash-modal-events">
      ${body || `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:.88rem">No marks recorded.</div>`}
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
    </div>
  `);
}

function _lbW() {
  return lbWeights(STATE.lbWeights);
}

// Scores every student from the raw data (director clients only — students
// can't read the inputs). Shared by the admin leaderboard view and the
// settings/public publisher.
function _scoreStudents() {
  return scoreStudentsCore(STATE.students, STATE.entries, DB.getSongs(), _lbW(), {
    marksOn:       featureOn('marks'),
    attendanceOn:  featureOn('attendance'),
    countNegative: STATE.countNegativeInScore,
  }, STATE.pseudonymSalt);
}

function _buildLbRankRows() {
  const myDocId = STATE.studentNum;
  const allScored = _scoreStudents();

  const lbScoreMap = {};
  allScored.forEach(({ s, score, positives, mistakes }) => {
    lbScoreMap[s.number] = { score, positives, mistakes };
  });

  const filteredLbStudents = filterAndSortStudents(allScored.map(({ s }) => s), _lbFilter, lbScoreMap);
  const scored = filteredLbStudents.map(s => allScored.find(a => a.s === s)).filter(Boolean);

  if (scored.length === 0)
    return `<div class="lb-stat-row"><div class="lb-stat-label">No students match this filter.</div></div>`;
  return scored.map(({ docId, s, name, score }, i) => {
    const isMe = docId === myDocId;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    const click = STATE.isAdmin ? `onclick="navigate('student',{num:'${esc(s.number)}'})"` : '';
    return `
    <div class="lb-rank-row ${isMe ? 'lb-rank-me' : ''} ${i % 2 === 1 ? 'lb-stat-row-alt' : ''} ${STATE.isAdmin ? 'lb-row-clickable' : ''}" ${click}>
      <span class="lb-rank-medal">${medal}</span>
      <span class="lb-rank-name">
        ${esc(name)}${isMe ? ' <span class="lb-you-badge">you</span>' : ''}
        ${STATE.isAdmin ? `<span class="lb-real-name">${esc(s.name || `#${s.number}`)}</span>` : ''}
      </span>
      <span class="lb-rank-score ${score > 0 ? 'lb-val-ok' : score < 0 ? 'lb-val-warn' : ''}">${score > 0 ? '+' : ''}${score}</span>
      ${STATE.isAdmin ? `<span class="lb-row-chevron">›</span>` : ''}
    </div>`;
  }).join('');
}

// Renders the "Band Attendance Data" card from per-rehearsal absence rows
// [{date, label, absent}] (sorted desc). Shared by the admin and student views.
function _lbAttendanceSectionHtml(rehearsalRows) {
  if (!featureOn('attendance')) return '';
  const last         = rehearsalRows[0] || null;
  const { mon, fri } = currentWeekRange();
  const weekRows     = rehearsalRows.filter(r => r.date >= mon && r.date <= fri);
  const weekAbsences = weekRows.reduce((s, r) => s + r.absent, 0);
  const seasonTotal  = rehearsalRows.reduce((s, r) => s + r.absent, 0);
  const seasonAvg    = rehearsalRows.length ? (seasonTotal / rehearsalRows.length).toFixed(1) : '—';

  // Director-only drill-downs: a single rehearsal opens its attendance screen;
  // the week/season aggregates open a breakdown modal. Students see the same
  // card as plain, non-clickable rows.
  const chevron     = `<span class="lb-row-chevron">›</span>`;
  const recentClick = STATE.isAdmin && last && last.id;
  const weekClick   = STATE.isAdmin && weekRows.length > 0;
  const seasonClick = STATE.isAdmin && rehearsalRows.length > 0;

  return `
      <div id="lb-sec-attendance-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('lb-sec-attendance')">
        <span class="section-title" style="margin:0">Band Attendance Data</span>
        <span class="sec-chevron">▾</span>
      </div>
      <div id="lb-sec-attendance">
        <div class="card mb-12" style="padding:0;overflow:hidden">
          ${last ? `
          <div class="lb-stat-row ${recentClick ? 'lb-row-clickable' : ''}"
               ${recentClick ? `onclick="navigate('attendance',{rid:'${esc(last.id)}',from:'leaderboard'})"` : ''}>
            <div class="lb-stat-label">
              Most recent rehearsal
              <div class="lb-stat-sub">${fmtDate(last.date)}${last.label ? ' — ' + esc(last.label) : ''}</div>
            </div>
            <div class="lb-stat-val ${last.absent > 0 ? 'lb-val-warn' : 'lb-val-ok'}">
              ${last.absent} absent
            </div>
            ${recentClick ? chevron : ''}
          </div>` : `
          <div class="lb-stat-row">
            <div class="lb-stat-label">No rehearsals yet</div>
          </div>`}
          <div class="lb-stat-row lb-stat-row-alt ${weekClick ? 'lb-row-clickable' : ''}"
               ${weekClick ? `onclick="showLbAttendanceModal('week')"` : ''}>
            <div class="lb-stat-label">
              This week
              <div class="lb-stat-sub">${fmtDate(mon)} – ${fmtDate(fri)} · ${weekRows.length} rehearsal${weekRows.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="lb-stat-val ${weekAbsences > 0 ? 'lb-val-warn' : 'lb-val-ok'}">
              ${weekRows.length ? `${weekAbsences} absent` : '—'}
            </div>
            ${weekClick ? chevron : ''}
          </div>
          <div class="lb-stat-row ${seasonClick ? 'lb-row-clickable' : ''}"
               ${seasonClick ? `onclick="showLbAttendanceModal('season')"` : ''}>
            <div class="lb-stat-label">
              Season average
              <div class="lb-stat-sub">${rehearsalRows.length} rehearsal${rehearsalRows.length !== 1 ? 's' : ''} total</div>
            </div>
            <div class="lb-stat-val">${seasonAvg !== '—' ? `${seasonAvg} / rehearsal` : '—'}</div>
            ${seasonClick ? chevron : ''}
          </div>
        </div>
      </div>`;
}

// Director-only breakdown of absences by rehearsal (scope: 'week' | 'season').
// Each row links to that rehearsal's attendance screen.
function showLbAttendanceModal(scope) {
  const { mon, fri } = currentWeekRange();
  let rows = [...STATE.rehearsals]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(r => ({ r, absent: Object.values(STATE.entries[r.id] || {}).filter(e => e.attendance === 'absent').length }));
  if (scope === 'week') rows = rows.filter(({ r }) => r.date >= mon && r.date <= fri);

  const title = scope === 'week' ? 'This Week’s Attendance' : 'Season Attendance';
  if (!rows.length) {
    openModal(`<div class="modal-title">${title}</div><p class="empty-state" style="padding:24px 0">No rehearsals in range.</p>`);
    return;
  }
  const total = rows.reduce((s, x) => s + x.absent, 0);
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${title}</div>
    <div class="form-hint" style="margin:0 0 12px">${total} absence${total !== 1 ? 's' : ''} across ${rows.length} rehearsal${rows.length !== 1 ? 's' : ''}</div>
    <div class="card" style="padding:0;overflow:hidden">
      ${rows.map(({ r, absent }) => `
        <div class="dash-stu-row" onclick="closeModal();navigate('attendance',{rid:'${esc(r.id)}',from:'leaderboard'})">
          <span class="dash-stu-name">${fmtDate(r.date)}${r.label ? ` · ${esc(r.label)}` : ''}</span>
          <span class="dash-stu-val ${absent > 0 ? 'dash-val-mis' : ''}">${absent} absent</span>
          <span class="dash-stu-chevron">›</span>
        </div>`).join('')}
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

// Renders the "Songs to Memorize" progress section from aggregate rows
// [{song:{title,dueDate,category}, passed, remaining, pct}]. Shared by the
// admin and student views.
function _lbSongsSectionHtml(songRows) {
  if (!songRows.length) return '';
  const cats = STATE.songCategories;
  // Directors can open each song's detail page; the published student rows have
  // no song id, so they stay non-clickable.
  const lbSongRow = ({ song, passed, remaining, pct }, i) => {
    const sid = STATE.isAdmin && song.id ? song.id : null;
    return `
    <div class="lb-song-row ${i % 2 === 1 ? 'lb-stat-row-alt' : ''} ${sid ? 'lb-row-clickable' : ''}"
         ${sid ? `onclick="navigate('song',{sid:'${esc(sid)}'})"` : ''}>
      <div class="lb-song-info">
        <div class="lb-song-title">${esc(song.title)}</div>
        ${song.dueDate ? `<div class="lb-song-due ${song.dueDate < today() && remaining > 0 ? 'song-overdue' : ''}">Due ${fmtDate(song.dueDate)}</div>` : ''}
        <div class="lb-prog-bar"><div class="lb-prog-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="lb-song-counts">
        <span class="lb-count-pass">${passed} passed</span>
        <span class="lb-count-rem">${remaining} left</span>
      </div>
      ${sid ? `<span class="lb-row-chevron">›</span>` : ''}
    </div>`;
  };

  let body;
  if (!cats.length) {
    body = `<div class="card mb-12" style="padding:0;overflow:hidden">${songRows.map(lbSongRow).join('')}</div>`;
  } else {
    const grouped = {};
    const uncategorized = [];
    cats.forEach(c => { grouped[c] = []; });
    songRows.forEach(row => {
      if (row.song.category && grouped[row.song.category] !== undefined) grouped[row.song.category].push(row);
      else uncategorized.push(row);
    });
    let catIdx = 0;
    body = '';
    cats.forEach(cat => {
      if (!grouped[cat].length) return;
      const id = `lb-song-cat-${catIdx++}`;
      body += `
        <div id="${id}-hdr" class="sec-hdr sec-hdr-open song-cat-sec-hdr" onclick="toggleCollapse('${id}')">
          <span>${esc(cat)}</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="${id}">
          <div class="card mb-12" style="padding:0;overflow:hidden">${grouped[cat].map(lbSongRow).join('')}</div>
        </div>`;
    });
    if (uncategorized.length) {
      const id = `lb-song-cat-${catIdx}`;
      const label = songRows.length > uncategorized.length ? 'Other' : 'Songs';
      body += `
        <div id="${id}-hdr" class="sec-hdr sec-hdr-open song-cat-sec-hdr" onclick="toggleCollapse('${id}')">
          <span>${label}</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="${id}">
          <div class="card mb-12" style="padding:0;overflow:hidden">${uncategorized.map(lbSongRow).join('')}</div>
        </div>`;
    }
  }

  return `
        <div id="lb-sec-songs-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('lb-sec-songs')">
          <span class="section-title" style="margin:0">Songs to Memorize</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="lb-sec-songs">${body}</div>`;
}

// Student-facing Band Stats view. Renders entirely from the director-published
// settings/public snapshot — students cannot read the raw data it was derived
// from. Directors get the same rendering when previewing the student view
// (computed locally so the preview is always current).
function viewLeaderboardStudent() {
  const pub = STATE.isAdmin ? computePublicStats() : STATE.publicStats;

  if (!pub) {
    return `
    <div class="leaderboard-view">
      <div class="empty-state" style="padding:48px 24px">
        <div class="empty-icon">📊</div>
        <p>Band stats haven't been published yet. Check back after your next rehearsal!</p>
      </div>
    </div>`;
  }

  const rehearsalRows = [...(pub.rehearsals || [])].sort((a, b) => b.date.localeCompare(a.date));
  const songRows = (portalFeatureOn('songs') ? (pub.songs || []) : []).map(s => ({
    song: s,
    passed: s.passed,
    remaining: s.remaining,
    pct: (s.passed + s.remaining) ? Math.round(s.passed / (s.passed + s.remaining) * 100) : 0,
  }));

  const lbRows = (STATE.marchingLeaderboardEnabled && portalFeatureOn('stats') && pub.leaderboard)
    ? pub.leaderboard : null;
  const rankingHtml = lbRows ? `
        <div class="sec-card">
          <div id="lb-sec-ranking-hdr" class="sec-hdr sec-hdr-open lb-marching-hdr" onclick="toggleCollapse('lb-sec-ranking')">
            <span class="section-title" style="margin:0">Marching Leaderboard</span>
            <span class="sec-chevron">▾</span>
          </div>
          <div id="lb-sec-ranking">
            <div class="card mb-12" style="padding:0;overflow:hidden">
              ${lbRows.map((r, i) => {
                const isMe  = String(r.num) === String(STATE.studentNum);
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                return `
              <div class="lb-rank-row ${isMe ? 'lb-rank-me' : ''} ${i % 2 === 1 ? 'lb-stat-row-alt' : ''}">
                <span class="lb-rank-medal">${medal}</span>
                <span class="lb-rank-name">${esc(r.name)}${isMe ? ' <span class="lb-you-badge">you</span>' : ''}</span>
                <span class="lb-rank-score ${r.score > 0 ? 'lb-val-ok' : r.score < 0 ? 'lb-val-warn' : ''}">${r.score > 0 ? '+' : ''}${r.score}</span>
              </div>`;
              }).join('')}
            </div>
          </div>
        </div>` : '';

  return `
    <div class="leaderboard-view">
      <div class="sec-card">${_lbAttendanceSectionHtml(rehearsalRows)}</div>
      <div class="sec-card">${_lbSongsSectionHtml(songRows)}</div>
      ${rankingHtml}
    </div>`;
}

function viewLeaderboard() {
  const rehearsals    = [...STATE.rehearsals].sort((a,b) => b.date.localeCompare(a.date));
  const totalStudents = Object.keys(STATE.students).length;

  const rehearsalRows = rehearsals.map(r => ({
    id:     r.id,
    date:   r.date,
    label:  r.label || '',
    absent: Object.values(STATE.entries[r.id] || {}).filter(e => e.attendance === 'absent').length,
  }));

  // Song progress is measured only over students who memorize music, so
  // excluded groups (e.g. majorettes) don't dilute the percentages.
  const memStudents = new Set(
    Object.values(STATE.students).filter(s => !memExcluded(s)).map(s => String(s.number))
  );
  const songTotal = memStudents.size;
  const songRows = DB.getSongs().map(song => {
    const passed    = Object.entries(song.statuses || {})
      .filter(([num, s]) => s.status === 'passed' && memStudents.has(String(num))).length;
    const remaining = Math.max(0, songTotal - passed);
    const pct       = songTotal ? Math.round(passed / songTotal * 100) : 0;
    return { song, passed, remaining, pct };
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return `
    <div class="leaderboard-view">

      <div class="sec-card">${_lbAttendanceSectionHtml(rehearsalRows)}</div>

      <div class="sec-card">${_lbSongsSectionHtml(songRows)}</div>

      ${(STATE.marchingLeaderboardEnabled || STATE.isAdmin) ? `
        <div class="sec-card">
          <div id="lb-sec-ranking-hdr" class="sec-hdr sec-hdr-open lb-marching-hdr" onclick="toggleCollapse('lb-sec-ranking')">
            <span class="section-title" style="margin:0">Marching Leaderboard</span>
            <div style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">
              ${STATE.isAdmin ? `
                <button class="lb-toggle-btn ${STATE.marchingLeaderboardEnabled ? 'lb-toggle-on' : 'lb-toggle-off'}"
                        onclick="toggleMarchingLeaderboard()">
                  ${STATE.marchingLeaderboardEnabled ? 'Visible to students' : 'Hidden from students'}
                </button>` : ''}
              <span class="sec-chevron" onclick="toggleCollapse('lb-sec-ranking')">▾</span>
            </div>
          </div>
          <div id="lb-sec-ranking">
            ${!STATE.marchingLeaderboardEnabled && STATE.isAdmin
              ? `<p class="lb-hidden-note">Students cannot see this leaderboard. Toggle above to enable it.</p>`
              : ''}
            ${renderFilterBar('lb', _lbFilter, [
              {value:'score',      label:'Score'},
              {value:'name',       label:'Name'},
              {value:'instrument', label:'Instrument'},
              {value:'grade',      label:'Grade'},
              {value:'positives',  label:'Positives'},
              {value:'mistakes',   label:'Mistakes'}
            ])}
            <div id="lb-rank-list" class="card mb-12" style="padding:0;overflow:hidden">
              ${_buildLbRankRows()}
            </div>
          </div>
        </div>` : ''}

    </div>`;
}

// ── Leaderboard Score Settings ────────────────────────────────────────────────

function showLeaderboardSettingsModal() {
  if (!STATE.isAdmin) return;
  const w = _lbW();

  const weightRow = (id, label, desc, val, step = '0.5') => `
    <div class="lb-weight-row">
      <div class="lb-weight-info">
        <div class="lb-weight-label">${label}</div>
        <div class="lb-weight-desc">${desc}</div>
      </div>
      <div class="lb-weight-input-wrap">
        <button class="lb-weight-btn" onclick="lbWeightAdj('${id}',-${step})">−</button>
        <input class="lb-weight-input" id="lbw-${id}" type="number"
               min="0" max="99" step="${step}" value="${val}">
        <button class="lb-weight-btn" onclick="lbWeightAdj('${id}',${step})">+</button>
      </div>
    </div>`;

  const negNote = !STATE.countNegativeInScore
    ? `<p class="lb-weight-warning">⚠ Negative marks are currently disabled in Band Settings → "Count in leaderboard score". The weight below won't apply until that's re-enabled.</p>`
    : '';

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Score Weights</div>
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:16px">
      Adjust how much each factor counts toward a student's leaderboard score.
    </p>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
      ${weightRow('positive', '✓ Positive marks',  'Per positive mark awarded',             w.positive)}
      ${weightRow('negative', '✗ Negative marks',  'Per mistake mark (when enabled)',       w.negative)}
      ${weightRow('song',     '♪ Songs memorized', 'Per song marked as passed',             w.song)}
      ${weightRow('absent',   '✗ Absences',        'Deducted per absence',                  w.absent)}
      ${weightRow('late',     '◷ Lates',           'Deducted per late arrival',             w.late)}
    </div>
    ${negNote}
    <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:16px;padding:8px 10px;background:var(--surface-alt);border-radius:var(--r-sm)">
      Score = (Songs × <strong id="lbw-preview-song">${w.song}</strong>) + (Positives × <strong id="lbw-preview-positive">${w.positive}</strong>) − (Negatives × <strong id="lbw-preview-negative">${w.negative}</strong>) − (Absences × <strong id="lbw-preview-absent">${w.absent}</strong>) − (Lates × <strong id="lbw-preview-late">${w.late}</strong>)
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveLbWeights()">Save</button>
    </div>
  `);
}

function lbWeightAdj(id, delta) {
  const input = document.getElementById(`lbw-${id}`);
  if (!input) return;
  const next = Math.max(0, Math.round((parseFloat(input.value) + parseFloat(delta)) * 100) / 100);
  input.value = next;
  const preview = document.getElementById(`lbw-preview-${id}`);
  if (preview) preview.textContent = next;
}

function saveLbWeights() {
  const parse = id => {
    const v = parseFloat(document.getElementById(`lbw-${id}`)?.value);
    return isNaN(v) || v < 0 ? null : Math.round(v * 100) / 100;
  };
  const weights = {
    positive: parse('positive'),
    negative: parse('negative'),
    absent:   parse('absent'),
    late:     parse('late'),
    song:     parse('song'),
  };
  if (Object.values(weights).some(v => v === null)) {
    showToast('All weights must be 0 or greater.');
    return;
  }
  STATE.lbWeights = weights;
  orgCol('settings').doc('presets').set({ lbWeights: weights }, { merge: true });
  showToast('Score weights saved.');
  closeModal();
  const mc = document.getElementById('main-content');
  if (_view === 'leaderboard' && mc) mc.innerHTML = viewLeaderboard();
}

function viewStudent(num) {
  const s = DB.getStudents()[num];
  if (!s) return `<div class="empty-state"><p>Student not found.</p></div>`;

  const hist = DB.getStudentHistory(num);
  const errs = hist.reduce((sum,e)=>sum+(e.entry.mistakes||0),0);
  const pos  = hist.reduce((sum,e)=>sum+(e.entry.positives||0),0);
  const avgE = hist.length ? (errs/hist.length).toFixed(1) : '—';
  const avgP = hist.length ? (pos/hist.length).toFixed(1)  : '—';

  return `
    <div class="student-view">
    <div class="card mb-12 clickable" onclick="showEditStudentModal('${esc(num)}')" style="text-align:center">
      <div style="font-size:1.4rem;font-weight:800;color:var(--primary);line-height:1;margin-bottom:8px">${esc(s.name || `#${s.number}`)}</div>
      <div class="flex gap-6" style="justify-content:center;flex-wrap:wrap">
        ${fmtPos(s.column,s.row) ? `<span class="badge badge-primary" style="font-size:0.85rem;font-weight:800">${esc(fmtPos(s.column,s.row))}</span>` : ''}
        ${s.instrument ? `<span class="badge badge-primary">${esc(normInstrument(s.instrument))}</span>` : ''}
        ${s.section    ? `<span class="badge badge-neutral">${esc(s.section)}</span>` : ''}
        ${(STATE.customStudentFields||[]).filter(cf => s[cf.key]).map(cf =>
          `<span class="badge badge-neutral">${esc(cf.label)}: ${esc(s[cf.key])}</span>`).join('')}
      </div>
    </div>

    ${featureOn('marks') ? `
    <div class="stats-row" style="grid-template-columns:repeat(2,1fr)">
      <div class="stat-block clickable" onclick="showStudentMarksModal('${esc(num)}','')">
        <div class="stat-value" style="color:var(--danger)">${avgE}</div>
        <div class="stat-label">Avg Mistakes</div>
      </div>
      <div class="stat-block clickable" onclick="showStudentMarksModal('${esc(num)}','')">
        <div class="stat-value" style="color:var(--success)">${avgP}</div>
        <div class="stat-label">Avg Positives</div>
      </div>
    </div>` : ''}

    ${s.notes ? `
      <div class="card mb-12 clickable" onclick="showEditStudentModal('${esc(num)}')">
        <div class="section-title" style="margin-top:0">Director Notes</div>
        <div style="font-size:0.9rem;white-space:pre-wrap;color:var(--text-muted)">${esc(s.notes)}</div>
      </div>` : ''}

    ${featureOn('attendance') ? (() => {
      const absences = hist.filter(({entry:e}) => e.attendance === 'absent');
      const lates    = hist.filter(({entry:e}) => e.attendance === 'late');
      if (!absences.length && !lates.length) return '';
      const { mon, fri } = currentWeekRange();
      const wkAbs  = absences.filter(({rehearsal:r}) => r.date >= mon && r.date <= fri);
      const wkLate = lates.filter(({rehearsal:r}) => r.date >= mon && r.date <= fri);
      return `
        <div class="card mb-12" style="padding:0;overflow:hidden">
          <div class="att-card-title">Attendance Record</div>

          <div class="att-card-section">
            <div class="att-card-period">This Week</div>
            <div class="att-summary-row" style="margin-bottom:0">
              <span class="att-summary-chip att-chip-absent">${wkAbs.length} Absence${wkAbs.length!==1?'s':''}</span>
              <span class="att-summary-chip att-chip-late">${wkLate.length} Late${wkLate.length!==1?'s':''}</span>
            </div>
          </div>

          <div class="att-card-section" style="border-top:1px solid var(--border)">
            <div class="att-card-period">All Time</div>
            <div class="att-summary-row">
              <span class="att-summary-chip att-chip-absent">${absences.length} Absence${absences.length!==1?'s':''}</span>
              <span class="att-summary-chip att-chip-late">${lates.length} Late${lates.length!==1?'s':''}</span>
            </div>
            ${absences.length ? `
              <div class="att-date-list">
                <span class="att-date-heading">Absent:</span>
                ${absences.map(({rehearsal:r}) => `<span class="att-date-chip att-chip-absent clickable" onclick="navigate('attendance',{rid:'${esc(r.id)}',from:'student'})">${fmtDate(r.date)}</span>`).join('')}
              </div>` : ''}
            ${lates.length ? `
              <div class="att-date-list">
                <span class="att-date-heading">Late:</span>
                ${lates.map(({rehearsal:r}) => `<span class="att-date-chip att-chip-late clickable" onclick="navigate('attendance',{rid:'${esc(r.id)}',from:'student'})">${fmtDate(r.date)}</span>`).join('')}
              </div>` : ''}
          </div>
        </div>
      `;
    })() : ''}

    ${(DB.getSongs().length && !memExcluded(s)) ? (() => {
      const allSongs   = DB.getSongs();
      const remaining  = allSongs.filter(song => song.statuses?.[String(num)]?.status !== 'passed');
      const completed  = allSongs.filter(song => song.statuses?.[String(num)]?.status === 'passed');

      const songRow = (song, showPassBtn = true) => {
        const st         = song.statuses?.[String(num)]?.status || 'not_attempted';
        const statusData = song.statuses?.[String(num)];
        const metaParts  = [];
        if (statusData && st !== 'not_attempted') {
          if (statusData.updatedAt) metaParts.push(fmtDateTime(statusData.updatedAt));
          if (statusData.updatedBy) metaParts.push(`by ${dirLabel(statusData.updatedBy)}`);
        }
        const meta     = metaParts.join(' ');
        const failNote = st === 'failed' ? (statusData?.note || '') : '';
        const overdue  = song.dueDate && song.dueDate < today() && st !== 'passed';
        return `
        <div class="stu-song-row">
          <div class="song-stu-info">
            <span class="song-stu-name song-stu-name-link" style="cursor:pointer"
                  onclick="navigate('song',{sid:'${esc(song.id)}'});event.stopPropagation()">${esc(song.title)}</span>
            ${song.dueDate ? `<span class="song-row-due ${overdue ? 'song-overdue' : ''}" style="font-size:.72rem">${overdue ? '⚠ ' : ''}Due ${fmtDate(song.dueDate)}</span>` : ''}
            <span class="song-stu-status ${st === 'passed' ? 'sss-pass' : st === 'failed' ? 'sss-fail' : 'sss-na'}">
              ${st === 'passed' ? '✓ Passed' : st === 'failed' ? '✗ Failed' : '— Not Attempted'}
            </span>
            ${meta ? `<span class="song-stu-meta">${esc(meta)}</span>` : ''}
            ${failNote ? `<span class="song-stu-fail-note">${esc(failNote)}</span>` : ''}
          </div>
          <div class="song-stu-btns">
            ${showPassBtn ? `<button class="ssb ${st === 'passed' ? 'ssb-on-pass' : 'ssb-pass'}"
                    onclick="setSongStatus('${esc(song.id)}','${esc(String(num))}','passed')">✓</button>` : ''}
            <button class="ssb ${st === 'failed' ? 'ssb-on-fail' : 'ssb-fail'}"
                    onclick="setSongStatus('${esc(song.id)}','${esc(String(num))}','failed')">✗</button>
          </div>
        </div>`;
      };

      // Group the still-to-memorize songs by category (each collapsible) when
      // categories are set; otherwise keep the flat list.
      const cats = STATE.songCategories || [];
      const catBlock = (label, rows, idx) => {
        const id = `stu-songcat-${idx}`;
        return `
          <div id="${id}-hdr" class="song-cat-hdr sec-hdr-open" onclick="toggleCollapse('${id}')">
            <span>${esc(label)} (${rows.length})</span>
            <span class="sec-chevron">▾</span>
          </div>
          <div id="${id}">${rows.map(s => songRow(s)).join('')}</div>`;
      };
      let remainingHtml;
      if (!remaining.length) {
        remainingHtml = `<p class="empty-state" style="padding:12px 0;font-size:0.88rem">All songs memorized! 🎉</p>`;
      } else if (!cats.length) {
        remainingHtml = remaining.map(s => songRow(s)).join('');
      } else {
        const grouped = {}; const uncategorized = [];
        cats.forEach(c => { grouped[c] = []; });
        remaining.forEach(song => {
          if (song.category && grouped[song.category] !== undefined) grouped[song.category].push(song);
          else uncategorized.push(song);
        });
        let html = ''; let ci = 0;
        cats.forEach(cat => { if (grouped[cat].length) html += catBlock(cat, grouped[cat], ci++); });
        if (uncategorized.length) html += catBlock(remaining.length > uncategorized.length ? 'Other' : 'Songs', uncategorized, ci++);
        remainingHtml = html;
      }

      return `
      <div class="sec-card">
        <div id="stu-songs-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('stu-songs-sec')">
          <span class="section-title" style="margin:0">Songs to Memorize</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="stu-songs-sec">
          ${remainingHtml}
          ${completed.length ? `
            <div id="stu-songs-done-hdr" class="song-cat-hdr" onclick="toggleCollapse('stu-songs-done')" style="margin-top:4px">
              <span>Songs Completed (${completed.length})</span>
              <span class="sec-chevron">▾</span>
            </div>
            <div id="stu-songs-done" class="sec-collapsed">${completed.map(s => songRow(s, false)).join('')}</div>` : ''}
        </div>
      </div>`;
    })() : ''}

    ${hist.length ? `
      <div class="sec-card">
      <div id="stu-hist-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('stu-hist-sec')">
        <span class="section-title" style="margin:0">Rehearsal History</span>
        <span class="sec-chevron">▾</span>
      </div>
      <div id="stu-hist-sec">
      ${hist.map(({rehearsal:r, entry:e}) => {
        const evts = e.events || [];
        const mn = evts.filter(ev=>ev.type==='mistake' &&ev.note.trim()).map(ev=>(ev.sectionMark?`<span class="section-mark-badge">§ ${esc(ev.section||'Section')}</span> `:'')+(ev.segment?`<span class="event-seg">${esc(ev.segment)}</span> `:'') +esc(ev.note)+(ev.by&&ev.by!=='system'?` <em style="opacity:.6">(${esc(dirLabel(ev.by))})</em>`:''));
        const pn = evts.filter(ev=>ev.type==='positive'&&ev.note.trim()).map(ev=>(ev.sectionMark?`<span class="section-mark-badge">§ ${esc(ev.section||'Section')}</span> `:'')+(ev.segment?`<span class="event-seg">${esc(ev.segment)}</span> `:'') +esc(ev.note)+(ev.by&&ev.by!=='system'?` <em style="opacity:.6">(${esc(dirLabel(ev.by))})</em>`:''));
        return `
        <div class="history-row ${e.mistakes>0?'had-mistakes':''} ${e.positives>0&&!e.mistakes?'had-positives':''}">
          <div class="history-info" onclick="navigate('rehearsal',{rid:'${esc(r.id)}'})">
            <div class="history-date">${fmtDate(r.date)}</div>
            ${r.label ? `<div class="history-label">${esc(r.label)}</div>` : ''}
            ${featureOn('attendance') && e.attendance==='absent' ? `<div class="history-note att-absent-note">✗ Absent</div>` : ''}
            ${featureOn('attendance') && e.attendance==='late'   ? `<div class="history-note att-late-note">◷ Late</div>`   : ''}
            ${e.notes  ? `<div class="history-note">${esc(e.notes)}</div>` : ''}
            ${featureOn('marks') && mn.length ? `<div class="history-note" style="color:var(--danger)">✗ ${mn.join(' &middot; ')}</div>` : ''}
            ${featureOn('marks') && pn.length ? `<div class="history-note" style="color:var(--success)">✓ ${pn.join(' &middot; ')}</div>` : ''}
          </div>
          ${featureOn('marks') ? `
          <div class="flex gap-6" style="flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
            <div class="flex gap-6">
              ${e.mistakes  > 0 ? `<span class="badge badge-danger">${e.mistakes}✗</span>`  : '<span class="badge badge-neutral">0✗</span>'}
              ${e.positives > 0 ? `<span class="badge badge-success">${e.positives}✓</span>` : '<span class="badge badge-neutral">0✓</span>'}
            </div>
            <div class="flex gap-6">
              <button class="ssb ssb-fail" style="width:28px;height:28px;font-size:.85rem"
                      onclick="showMarkModal('${esc(r.id)}','${esc(num)}','mistake')">✗</button>
              <button class="ssb ssb-pass" style="width:28px;height:28px;font-size:.85rem"
                      onclick="showMarkModal('${esc(r.id)}','${esc(num)}','positive')">✓</button>
            </div>
          </div>` : ''}
        </div>`;
      }).join('')}
      </div>
      </div>
    ` : `
      <div class="empty-state" style="padding:24px">
        <p>No rehearsal data recorded yet.</p>
      </div>`}
    </div>
  `;
}

// ── Active rehearsal helpers ──────────────────────────────────────────────────

function getActiveRehearsal() {
  return (_activeRid && STATE.rehearsals.find(r => r.id === _activeRid && !r.ended))
      || STATE.rehearsals.find(r => !r.ended)
      || null;
}

function switchToFeedback(rid) {
  _activeRid = rid;
  _dashForceHistory = false;
  navigate('dashboard', { rid });
}
