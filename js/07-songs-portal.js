// Band Tracker — js/07-songs-portal.js — Songs views/status tracking + student portal.
// Plain script sharing global scope; load order is set in index.html.

// ── View: Songs ───────────────────────────────────────────────────────────────

function _buildSongRosterRows() {
  const songs    = STATE.songs;
  const students = Object.values(DB.getStudents()).filter(s => !memExcluded(s));
  const total    = songs.length;

  const scoreMap = {};
  students.forEach(s => {
    const passed  = songs.filter(song => song.statuses?.[String(s.number)]?.status === 'passed').length;
    const missing = total - passed;
    scoreMap[s.number] = { passed, missing };
  });

  const sorted = filterAndSortStudents(students, _songRosterFilter, scoreMap);
  if (!sorted.length)
    return `<div class="empty-state" style="padding:24px"><p>No students match the current filter.</p></div>`;

  return sorted.map(s => {
    const { passed, missing } = scoreMap[s.number];
    const pct = total ? Math.round(passed / total * 100) : 0;
    const meta = [normInstrument(s.instrument), s.section].filter(Boolean).map(esc).join(' · ');
    return `
    <div class="song-roster-row" onclick="showStudentSongProgress('${esc(s.number)}')">
      <div class="song-roster-info">
        <div class="song-roster-name">${esc(s.name || `#${s.number}`)}</div>
        ${meta ? `<div class="song-roster-meta">${meta}</div>` : ''}
      </div>
      <div class="song-roster-right">
        <div class="song-prog-wrap song-roster-prog">
          <div class="song-prog-bar"><div class="song-prog-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="song-roster-counts">
          <span class="src-passed">${passed} ✓</span>
          <span class="src-missing">${missing} left</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function showStudentSongProgress(num) {
  const s     = STATE.students[String(num)];
  const songs = STATE.songs;
  const cats  = STATE.songCategories;
  const name  = s?.name || `#${num}`;

  const songRow = song => {
    const entry    = song.statuses?.[String(num)];
    const status   = entry?.status || 'not_attempted';
    const failNote = status === 'failed' ? (entry?.note || '') : '';
    return `
    <div class="ssp-song-row">
      <div class="ssp-song-info">
        <div class="ssp-song-title">${esc(song.title)}</div>
        ${failNote ? `<div class="ssp-fail-note">📝 ${esc(failNote)}</div>` : ''}
      </div>
      <span class="portal-song-status ${status === 'passed' ? 'pss-pass' : status === 'failed' ? 'pss-fail' : 'pss-na'}">
        ${status === 'passed' ? '✓ Passed' : status === 'failed' ? '✗ Failed' : '— Not Attempted'}
      </span>
    </div>`;
  };

  let body;
  if (!cats.length) {
    body = `<div class="ssp-song-list">${songs.map(songRow).join('')}</div>`;
  } else {
    const grouped = {};
    const uncategorized = [];
    cats.forEach(c => { grouped[c] = []; });
    songs.forEach(song => {
      if (song.category && grouped[song.category] !== undefined) grouped[song.category].push(song);
      else uncategorized.push(song);
    });
    body = '';
    cats.forEach(cat => {
      if (!grouped[cat].length) return;
      body += `<div class="ssp-cat-label">${esc(cat)}</div>
               <div class="ssp-song-list">${grouped[cat].map(songRow).join('')}</div>`;
    });
    if (uncategorized.length) {
      const label = songs.length > uncategorized.length ? 'Other' : '';
      if (label) body += `<div class="ssp-cat-label">${esc(label)}</div>`;
      body += `<div class="ssp-song-list">${uncategorized.map(songRow).join('')}</div>`;
    }
  }

  openModal(`
    <div class="modal-title">${esc(name)}</div>
    ${body}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    </div>`);
}

function viewSongs() {
  const songs = STATE.songs;
  // Count only students who memorize music, so progress isn't diluted by
  // excluded groups (e.g. majorettes).
  const total = Object.values(STATE.students).filter(s => !memExcluded(s)).length;
  const cats  = STATE.songCategories;

  if (songs.length === 0) {
    return `
      <div class="empty-state" style="padding:48px 24px">
        <div class="empty-icon">🎵</div>
        <p>No songs added yet.</p>
        ${STATE.isAdmin ? `<p>Tap <strong>+</strong> to add a song to memorize.</p>` : ''}
      </div>`;
  }

  const songRow = song => {
    const passed  = Object.values(song.statuses || {}).filter(s => s.status === 'passed').length;
    const failed  = Object.values(song.statuses || {}).filter(s => s.status === 'failed').length;
    const pct     = total ? Math.round(passed / total * 100) : 0;
    const overdue = song.dueDate && song.dueDate < today();
    return `
    <div class="song-row" onclick="navigate('song',{sid:'${esc(song.id)}'})">
      <div class="song-row-info">
        <div class="song-row-title">${esc(song.title)}</div>
        ${song.dueDate ? `<div class="song-row-due ${overdue ? 'song-overdue' : ''}">
          Due ${fmtDate(song.dueDate)}${overdue ? ' — overdue' : ''}
        </div>` : ''}
      </div>
      <div class="song-row-right">
        <div class="song-prog-wrap">
          <div class="song-prog-bar"><div class="song-prog-fill" style="width:${pct}%"></div></div>
          <div class="song-prog-lbl">${passed}✓ ${failed > 0 ? `${failed}✗ ` : ''}/ ${total}</div>
        </div>
      </div>
    </div>`;
  };

  const rosterSection = !STATE.isAdmin ? '' : `
    <div id="songs-prog-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('songs-prog-sec')" style="margin-top:24px">
      <span class="section-title songs-prog-hdr-title">Student Progress</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="songs-prog-sec">
      ${renderFilterBar('song-roster', _songRosterFilter, [
        {value:'passed',     label:'Most Passed'},
        {value:'missing',    label:'Most Missing'},
        {value:'name',       label:'Name'},
        {value:'instrument', label:'Instrument'},
        {value:'grade',      label:'Grade'},
      ])}
      <div id="song-roster-list">
        ${_buildSongRosterRows()}
      </div>
    </div>`;

  if (!cats.length) {
    return `<div class="songs-page">
      <div class="songs-list-grid">${songs.map(songRow).join('')}</div>
      ${rosterSection}
    </div>`;
  }

  // Group songs by category
  const grouped = {};
  const uncategorized = [];
  cats.forEach(c => { grouped[c] = []; });
  songs.forEach(song => {
    if (song.category && grouped[song.category] !== undefined) grouped[song.category].push(song);
    else uncategorized.push(song);
  });

  const catSection = (catKey, label, rows, idx) => {
    const id          = `song-cat-${idx}`;
    const isCollapsed = _songCatCollapsed.has(catKey);
    return `
      <div id="${id}-hdr" class="song-cat-hdr ${isCollapsed ? '' : 'sec-hdr-open'}"
           onclick="toggleSongCat('${esc(catKey)}','${id}')">
        <span>${esc(label)}</span>
        <span class="sec-chevron">▾</span>
      </div>
      <div id="${id}" class="song-cat-body ${isCollapsed ? 'sec-collapsed' : ''}">
        ${rows.map(songRow).join('')}
      </div>`;
  };

  let html = '<div class="songs-page"><div class="songs-list-grid">';
  let idx = 0;
  cats.forEach(cat => {
    if (!grouped[cat].length) return;
    html += catSection(cat, cat, grouped[cat], idx++);
  });
  if (uncategorized.length) {
    const label = songs.length > uncategorized.length ? 'Other' : '';
    if (label) html += catSection('\x00other', label, uncategorized, idx++);
    else html += uncategorized.map(songRow).join('');
  }
  html += `</div>${rosterSection}</div>`;
  return html;
}

function viewSong(sid) {
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return `<div class="empty-state"><p>Song not found.</p></div>`;

  const students = Object.values(DB.getStudents())
    .filter(s => !memExcluded(s))
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
  const statuses  = song.statuses || {};
  const getStatus = num => statuses[String(num)]?.status || 'not_attempted';

  const passed  = students.filter(s => getStatus(s.number) === 'passed').length;
  const failed  = students.filter(s => getStatus(s.number) === 'failed').length;
  const notAtt  = students.filter(s => getStatus(s.number) === 'not_attempted').length;
  const songSortOpts = [
    {value:'name',       label:'Name'},
    {value:'number',     label:'Number'},
    {value:'songStatus', label:'Status'},
    ...(hasField('instrument') ? [{value:'instrument', label:'Instrument'}] : []),
    ...(hasField('section')    ? [{value:'section',    label:'Section'}]    : []),
    ...(hasField('grade')      ? [{value:'grade',      label:'Grade'}]      : []),
  ];

  return `
    <div class="song-detail-view">
      ${song.dueDate ? `<div class="song-detail-due ${song.dueDate < today() ? 'song-overdue' : ''}">
        Due ${fmtDate(song.dueDate)}${song.dueDate < today() ? ' — overdue' : ''}
      </div>` : ''}

      <div class="song-stats-row">
        <div class="song-stat song-stat-pass"><div class="song-stat-val">${passed}</div><div class="song-stat-lbl">Passed</div></div>
        <div class="song-stat song-stat-fail"><div class="song-stat-val">${failed}</div><div class="song-stat-lbl">Failed</div></div>
        <div class="song-stat song-stat-na">  <div class="song-stat-val">${notAtt}</div><div class="song-stat-lbl">Not Attempted</div></div>
      </div>

      ${renderFilterBar('song', _songFilter, songSortOpts)}
      <div class="inst-filter-row" style="padding-top:4px">
        <button class="inst-chip ${_songHidePassedFilter ? 'inst-active' : ''}"
                onclick="toggleSongHidePassed('${esc(sid)}')">Not Passed Only</button>
      </div>

      <div id="song-student-list">
        ${songStudentRows(sid, students, statuses)}
      </div>
    </div>`;
}

function songStudentRows(sid, students, statuses) {
  const getStatus  = num => statuses[String(num)]?.status || 'not_attempted';
  const getMeta    = num => {
    const s = statuses[String(num)];
    if (!s || s.status === 'not_attempted') return '';
    return [s.updatedBy ? dirLabel(s.updatedBy) : '', s.updatedAt ? fmtTime(s.updatedAt) : ''].filter(Boolean).join(' · ');
  };
  const scoreMap = {};
  for (const s of students) scoreMap[s.number] = { status: getStatus(s.number) };

  const pool = _songHidePassedFilter ? students.filter(s => getStatus(s.number) !== 'passed') : students;
  const sorted = filterAndSortStudents(pool, _songFilter, scoreMap);

  if (!sorted.length) return `<div class="empty-state" style="padding:24px"><p>No students match the current filter.</p></div>`;

  return sorted.map(s => {
    const status    = getStatus(s.number);
    const meta      = getMeta(s.number);
    const failNote  = status === 'failed' ? (statuses[String(s.number)]?.note || '') : '';
    return `
      <div class="song-stu-row">
        <div class="song-stu-info">
          <span class="song-stu-name song-stu-name-link" onclick="navigate('student',{num:'${esc(s.number)}'});event.stopPropagation()">${esc(s.name || `#${s.number}`)}</span>
          <span class="song-stu-status ${status === 'passed' ? 'sss-pass' : status === 'failed' ? 'sss-fail' : 'sss-na'}">
            ${status === 'passed' ? '✓ Passed' : status === 'failed' ? '✗ Failed' : '— Not Attempted'}
          </span>
          ${meta ? `<span class="song-stu-meta">${esc(meta)}</span>` : ''}
          ${failNote ? `<span class="song-stu-fail-note">${esc(failNote)}</span>` : ''}
        </div>
        <div class="song-stu-btns">
          <button class="ssb ${status === 'passed' ? 'ssb-on-pass' : 'ssb-pass'}"
                  onclick="setSongStatus('${esc(sid)}','${esc(s.number)}','passed')">✓</button>
          <button class="ssb ${status === 'failed' ? 'ssb-on-fail' : 'ssb-fail'}"
                  onclick="setSongStatus('${esc(sid)}','${esc(s.number)}','failed')">✗</button>
        </div>
      </div>`;
  }).join('');
}

function toggleSongHidePassed(sid) {
  _songHidePassedFilter = !_songHidePassedFilter;
  const el = document.getElementById('song-student-list');
  if (el) {
    const song = STATE.songs.find(s => s.id === sid);
    if (song) el.innerHTML = songStudentRows(sid, Object.values(DB.getStudents()).filter(s => !memExcluded(s)), song.statuses || {});
  }
  // Refresh the toggle chip appearance
  document.querySelectorAll('.inst-filter-row .inst-chip').forEach(btn => {
    if (btn.textContent.trim() === 'Not Passed Only')
      btn.classList.toggle('inst-active', _songHidePassedFilter);
  });
}

function toggleSongCat(catKey, id) {
  if (_songCatCollapsed.has(catKey)) _songCatCollapsed.delete(catKey);
  else _songCatCollapsed.add(catKey);
  toggleCollapse(id);
}

function setSongStatus(sid, num, newStatus) {
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return;
  if (!song.statuses) song.statuses = {};

  const curStatus = song.statuses[String(num)]?.status || 'not_attempted';
  // Tapping the active button resets to not_attempted
  const status = curStatus === newStatus ? 'not_attempted' : newStatus;

  // Require confirmation before removing a passing mark
  if (curStatus === 'passed' && status === 'not_attempted') {
    const s = STATE.students[String(num)];
    const name = s?.name || `#${num}`;
    showConfirmModal(
      `Remove passing mark for ${name}?`,
      `This will unmark "${esc(song.title)}" as passed and reset it to Not Attempted.`,
      () => _applySongStatus(sid, num, song, status)
    );
    return;
  }

  // Require confirmation before removing a failed mark
  if (curStatus === 'failed' && status === 'not_attempted') {
    const s = STATE.students[String(num)];
    const name = s?.name || `#${num}`;
    showConfirmModal(
      `Remove failed mark for ${name}?`,
      `This will unmark "${esc(song.title)}" as failed and reset it to Not Attempted.`,
      () => _applySongStatus(sid, num, song, status),
      'Remove', 'btn-danger'
    );
    return;
  }

  // Offer a comment when marking as failed
  if (status === 'failed') {
    showSongFailNoteModal(sid, num, song);
    return;
  }

  _applySongStatus(sid, num, song, status);
}

function showSongFailNoteModal(sid, num, song) {
  const s = STATE.students[String(num)];
  const name = s?.name || `#${num}`;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">✗ Failed
      <div style="font-size:0.78rem;font-weight:400;color:var(--text-muted);margin-top:2px">${esc(name)}</div>
    </div>
    <div class="form-label" style="margin-bottom:6px">
      What to work on?
      <span style="font-weight:400;color:var(--text-muted)"> (optional)</span>
    </div>
    <textarea class="form-textarea" id="fail-note-input" rows="3"
              placeholder="e.g. Bars 12–16, entrance timing…"
              maxlength="200" style="resize:none"></textarea>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-mistake"   onclick="confirmSongFail('${esc(sid)}','${esc(String(num))}')">✗ Fail</button>
    </div>
  `);
  setTimeout(() => document.getElementById('fail-note-input')?.focus(), 60);
}

function confirmSongFail(sid, num) {
  const note = document.getElementById('fail-note-input')?.value.trim() || '';
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) { closeModal(); return; }

  if (note) {
    // Warn the director that the comment will be visible to the student.
    _pendingSongFail = { sid, num, note };
    openModal(`
      <div class="modal-title" style="font-size:1rem">Share comment with student?</div>
      <p style="font-size:0.88rem;color:var(--text-muted);margin-bottom:8px">Your comment:</p>
      <p class="portal-fail-note-preview">${esc(note)}</p>
      <p style="font-size:0.88rem;color:var(--text-muted);margin:12px 0 20px">
        Students will be able to see this note in their portal.
      </p>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-mistake"   onclick="_applyPendingSongFail()">✗ Fail &amp; Share</button>
      </div>
    `);
  } else {
    closeModal();
    _applySongStatus(sid, num, song, 'failed', '');
  }
}

function _applyPendingSongFail() {
  const { sid, num, note } = _pendingSongFail || {};
  _pendingSongFail = null;
  const song = STATE.songs.find(s => s.id === sid);
  closeModal();
  if (song) _applySongStatus(sid, num, song, 'failed', note);
}

function _applySongStatus(sid, num, song, status, note = '') {
  if (status === 'not_attempted') {
    delete song.statuses[String(num)];
    orgCol('songs').doc(sid).update({
      [`statuses.${num}`]: firebase.firestore.FieldValue.delete()
    }).catch(() => {
      orgCol('songs').doc(sid).set({ statuses: song.statuses }, { merge: false });
    });
    // Keep the student's own mirror in sync — songs are director-only, so the
    // portal reads results from songStatuses on the student's own doc.
    orgCol('students').doc(String(num)).update({
      [`songStatuses.${sid}`]: firebase.firestore.FieldValue.delete()
    }).catch(() => {});
  } else {
    song.statuses[String(num)] = { status, note: note || '', updatedAt: Date.now(), updatedBy: STATE.user?.email || '' };
    orgCol('songs').doc(sid).set({ statuses: { [String(num)]: song.statuses[String(num)] } }, { merge: true });
    orgCol('students').doc(String(num)).set({
      songStatuses: { [sid]: { status, note: note || '', updatedAt: Date.now() } }
    }, { merge: true }).catch(() => {});
  }

  const listEl = document.getElementById('song-student-list');
  if (listEl) {
    const students = Object.values(DB.getStudents())
      .filter(s => !memExcluded(s))
      .sort((a,b) => (a.name||'').localeCompare(b.name||''));
    listEl.innerHTML = songStudentRows(sid, students, song.statuses || {});
  } else if (_view === 'student') {
    const mc = document.getElementById('main-content');
    if (mc) { const st = mc.scrollTop; mc.innerHTML = viewStudent(_params.num); mc.scrollTop = st; }
  }
}

function showConfirmModal(title, body, onConfirm, confirmLabel = 'Remove', confirmCls = 'btn-danger') {
  _pendingConfirm = onConfirm;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${title}</div>
    ${body ? `<p style="font-size:.9rem;color:var(--text-muted);margin-bottom:8px;line-height:1.5">${body}</p>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn ${confirmCls}" onclick="runPendingConfirm()">${confirmLabel}</button>
    </div>
  `);
}

function runPendingConfirm() {
  const fn = _pendingConfirm;
  _pendingConfirm = null;
  closeModal();
  if (fn) fn();
}

function _songCategorySelect(selected) {
  return `<select class="form-input" id="m-song-category">
    <option value="">— No category —</option>
    ${STATE.songCategories.map(c => `<option value="${esc(c)}" ${selected === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
  </select>`;
}

function showSongOptionsModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Song Options</div>
    <div class="options-menu">
      <button class="options-menu-item" onclick="closeModal();showManageSongCategoriesModal()">
        <div class="options-menu-icon">🗂️</div>
        <div>
          <div class="options-menu-label">Manage Categories</div>
          <div class="options-menu-sub">${STATE.songCategories.length ? STATE.songCategories.join(', ') : 'No categories yet'}</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showMemorizationExclusionsModal()">
        <div class="options-menu-icon">🚫</div>
        <div>
          <div class="options-menu-label">Memorization Exclusions</div>
          <div class="options-menu-sub">${STATE.memorizationExclusions.length ? STATE.memorizationExclusions.join(', ') : 'Everyone memorizes music'}</div>
        </div>
      </button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function showManageSongCategoriesModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Song Categories</div>
    <div class="preset-section">
      <div id="song-cat-list">${_renderSongCategoryList()}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-song-cat-input" type="text"
               placeholder="New category…" maxlength="60"
               onkeydown="if(event.key==='Enter')addSongCategory()">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addSongCategory()">Add</button>
      </div>
    </div>
    <div class="modal-actions" style="margin-top:10px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function _renderSongCategoryList() {
  if (!STATE.songCategories.length) return `<div class="preset-empty">No categories yet — add one below.</div>`;
  return STATE.songCategories.map((cat, i) => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(cat)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editSongCategory(${i})">Edit</button>
        <button class="preset-btn-del"  onclick="deleteSongCategory(${i})">×</button>
      </div>
    </div>`).join('');
}

function addSongCategory() {
  const input = document.getElementById('add-song-cat-input');
  const val = input?.value.trim();
  if (!val) return;
  STATE.songCategories = [...STATE.songCategories, val];
  _saveSongCategories();
  input.value = '';
  document.getElementById('song-cat-list').innerHTML = _renderSongCategoryList();
}

function deleteSongCategory(idx) {
  STATE.songCategories = STATE.songCategories.filter((_, i) => i !== idx);
  _saveSongCategories();
  document.getElementById('song-cat-list').innerHTML = _renderSongCategoryList();
}

function editSongCategory(idx) {
  const current = STATE.songCategories[idx];
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Category</div>
    <input class="form-input" id="edit-song-cat-input" type="text"
           value="${esc(current)}" maxlength="60"
           onkeydown="if(event.key==='Enter')saveEditSongCategory(${idx})">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManageSongCategoriesModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditSongCategory(${idx})">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-song-cat-input')?.focus(), 60);
}

function saveEditSongCategory(idx) {
  const val = document.getElementById('edit-song-cat-input')?.value.trim();
  if (!val) return;
  const old = STATE.songCategories[idx];
  STATE.songCategories[idx] = val;
  _saveSongCategories();
  // Update any songs using the old category name
  STATE.songs.forEach(song => {
    if (song.category === old) {
      song.category = val;
      orgCol('songs').doc(song.id).set({ category: val }, { merge: true });
    }
  });
  showManageSongCategoriesModal();
}

async function _saveSongCategories() {
  try {
    await orgCol('settings').doc('presets').set(
      { songCategories: STATE.songCategories }, { merge: true }
    );
  } catch(e) {
    console.error('Failed to save song categories:', e);
    showToast('Failed to save categories.');
  }
}

// ── Memorization exclusions ───────────────────────────────────────────────────
// Directors can drop instruments or sections (e.g. majorettes) from the music
// memorization lists. Excluded students are left out of the Songs progress
// roster, per-song lists and aggregates, and see no "Songs to Memorize" in
// their portal. Stored on settings/presets and published to settings/public.

// The instrument and section names offered as exclusion options: what's in the
// roster, plus anything already excluded so it stays toggleable if the roster
// changes.
function _memExclusionGroups() {
  const exclSet = new Set(STATE.memorizationExclusions || []);
  const instruments = [...new Set([
    ...instrumentsInRoster(),
    ...[...exclSet].filter(n => (STATE.instruments || []).includes(n)),
  ])].sort((a, b) => instrOrder(a) - instrOrder(b));
  const sections = [...new Set([
    ...sectionsInRoster(),
    ...[...exclSet].filter(n => (STATE.sections || []).includes(n)),
  ])].sort();
  return { instruments, sections, exclSet };
}

function _renderMemExclusionBody() {
  const { instruments, sections, exclSet } = _memExclusionGroups();
  if (!instruments.length && !sections.length)
    return `<div class="preset-empty">Add instruments or sections to students first, then choose which groups skip memorization.</div>`;
  const group = (title, items) => !items.length ? '' : `
    <div class="sfb-group">
      <div class="sfb-group-label">${title}</div>
      <div class="sfb-checks">
        ${items.map(item => `
          <label class="sfb-check-label">
            <input type="checkbox" class="sfb-checkbox" ${exclSet.has(item) ? 'checked' : ''}
                   onchange="toggleMemExclusion('${esc(item)}',this.checked)">
            <span>${esc(item)}</span>
          </label>`).join('')}
      </div>
    </div>`;
  return group('Instruments', instruments) + group('Sections', sections);
}

function showMemorizationExclusionsModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Memorization Exclusions</div>
    <p class="form-hint" style="margin:0 0 12px">
      Pick instruments or groups that don't memorize music (e.g. majorettes).
      They're removed from the song lists and progress, and won't see
      "Songs to Memorize" in their portal.
    </p>
    <div class="preset-section">${_renderMemExclusionBody()}</div>
    <div class="modal-actions" style="margin-top:10px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function toggleMemExclusion(name, checked) {
  const set = new Set(STATE.memorizationExclusions || []);
  if (checked) set.add(name); else set.delete(name);
  STATE.memorizationExclusions = [...set];
  _saveMemExclusions();
}

async function _saveMemExclusions() {
  try {
    await orgCol('settings').doc('presets').set(
      { memorizationExclusions: STATE.memorizationExclusions }, { merge: true }
    );
  } catch(e) {
    console.error('Failed to save memorization exclusions:', e);
    showToast('Failed to save exclusions.');
  }
}

function showAddSongModal() {
  openModal(`
    <div class="modal-title">Add Song</div>
    <div class="form-group">
      <label class="form-label">Song Title</label>
      <input class="form-input" id="m-song-title" type="text" placeholder="e.g. Fight Song" autocomplete="off"
             onkeydown="if(event.key==='Enter')saveSong()">
    </div>
    <div class="form-group">
      <label class="form-label">Memorization Due Date (optional)</label>
      <input class="form-input" id="m-song-due" type="date">
    </div>
    ${STATE.songCategories.length ? `
    <div class="form-group">
      <label class="form-label">Category (optional)</label>
      ${_songCategorySelect('')}
    </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSong()">Add Song</button>
    </div>
  `);
  setTimeout(() => document.getElementById('m-song-title')?.focus(), 80);
}

function saveSong() {
  const title    = document.getElementById('m-song-title')?.value.trim();
  const dueDate  = document.getElementById('m-song-due')?.value || '';
  const category = document.getElementById('m-song-category')?.value || '';
  if (!title) { showToast('Please enter a song title.'); return; }
  closeModal();
  const ref = orgCol('songs').doc();
  const doc = { title, dueDate, category, addedBy: STATE.user?.email || '', addedAt: Date.now(), statuses: {} };
  STATE.songs.push({ ...doc, id: ref.id });
  STATE.songs.sort((a, b) => (a.dueDate || 'z').localeCompare(b.dueDate || 'z'));
  ref.set(doc);
  render();
  showToast(`"${title}" added.`);
}

function showEditSongModal(sid) {
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return;
  openModal(`
    <div class="modal-title">Edit Song</div>
    <div class="form-group">
      <label class="form-label">Song Title</label>
      <input class="form-input" id="m-song-title" type="text" value="${esc(song.title)}" autocomplete="off">
    </div>
    <div class="form-group">
      <label class="form-label">Due Date</label>
      <input class="form-input" id="m-song-due" type="date" value="${esc(song.dueDate || '')}">
    </div>
    ${STATE.songCategories.length ? `
    <div class="form-group">
      <label class="form-label">Category</label>
      ${_songCategorySelect(song.category || '')}
    </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateSong('${esc(sid)}')">Save</button>
    </div>
    <div class="danger-zone">
      <div class="danger-zone-title">Danger Zone</div>
      <button class="btn btn-danger btn-full" onclick="confirmDeleteSong('${esc(sid)}')">Delete Song</button>
    </div>
  `);
}

function updateSong(sid) {
  const title    = document.getElementById('m-song-title')?.value.trim();
  const dueDate  = document.getElementById('m-song-due')?.value || '';
  const category = document.getElementById('m-song-category')?.value || '';
  if (!title) { showToast('Please enter a song title.'); return; }
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return;
  song.title    = title;
  song.dueDate  = dueDate;
  song.category = category;
  orgCol('songs').doc(sid).set({ title, dueDate, category }, { merge: true });
  closeModal();
  render();
}

function confirmDeleteSong(sid) {
  const song = STATE.songs.find(s => s.id === sid);
  showConfirmModal(
    'Delete this song?',
    `<strong>${esc(song?.title || 'This song')}</strong> and all its memorization
     data will be permanently deleted. This cannot be undone.`,
    () => {
      STATE.songs = STATE.songs.filter(s => s.id !== sid);
      orgCol('songs').doc(sid).delete();
      // Best-effort cleanup of the per-student songStatuses mirrors.
      const batch = db.batch();
      let dirty = false;
      for (const [num, s] of Object.entries(STATE.students)) {
        if (s.songStatuses && s.songStatuses[sid] !== undefined) {
          batch.update(orgCol('students').doc(String(num)), {
            [`songStatuses.${sid}`]: firebase.firestore.FieldValue.delete()
          });
          dirty = true;
        }
      }
      if (dirty) batch.commit().catch(() => {});
      navigate('songs');
      showToast('Song deleted.');
    },
    'Delete'
  );
}

function showStudentPortalPreview(num) {
  const prev = STATE.studentNum;
  STATE.studentNum = num;
  const html = viewStudentPortal(true);
  STATE.studentNum = prev;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title" style="font-size:0.85rem;color:var(--text-muted);font-weight:500;margin-bottom:8px">Student View Preview</div>
    <div style="margin: 0 -4px">${html}</div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
    </div>
  `);
}

function previewLeaderboard(num) {
  const prev = STATE.studentNum;
  STATE.studentNum = num;
  const html = viewLeaderboardStudent();
  STATE.studentNum = prev;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title" style="font-size:0.85rem;color:var(--text-muted);font-weight:500;margin-bottom:8px">Student View Preview — Band Stats</div>
    <div style="margin: 0 -4px">${html}</div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
    </div>
  `);
}

// A student's leaderboard pseudonym. Students can't read the pseudonym salt
// (it lives in director-only settings/presets), so they look their name up in
// the published leaderboard; directors compute it directly.
function portalPseudonym(num) {
  if (STATE.isAdmin) return fakeAnimalName(num);
  const row = (STATE.publicStats?.leaderboard || []).find(r => String(r.num) === String(num));
  return row ? row.name : '';
}

// Songs for the student portal: the catalog plus this student's own result.
// Directors read song docs directly; students join the published catalog
// (settings/public) with the songStatuses mirror on their own student doc.
function _portalSongs(num) {
  if (!portalFeatureOn('songs')) return [];
  // Students in an excluded group (e.g. majorettes) don't memorize music.
  if (memExcluded(STATE.students[String(num)])) return [];
  if (STATE.isAdmin) {
    return STATE.songs.map(song => ({
      id: song.id, title: song.title, dueDate: song.dueDate || '',
      category: song.category || '', mine: song.statuses?.[String(num)] || null,
    }));
  }
  const mine = STATE.students[String(num)]?.songStatuses || {};
  return (STATE.publicStats?.songs || []).map(song => ({
    id: song.id, title: song.title, dueDate: song.dueDate || '',
    category: song.category || '', mine: mine[song.id] || null,
  }));
}

function viewStudentPortal(previewMode = false) {
  const num  = STATE.studentNum;
  const s    = STATE.students[num];
  const hist = DB.getStudentHistory(num);
  const mySongs   = _portalSongs(num);
  const pseudonym = portalPseudonym(num);

  const pos        = fmtPos(s?.column, s?.row);
  const metaParts  = [s?.instrument, s?.section, s?.grade ? s.grade + ' Grade' : '', pos ? `Position ${pos}` : ''].filter(Boolean);
  const totalErr   = hist.reduce((sum, {entry: e}) => sum + (e.mistakes  || 0), 0);
  const totalPos   = hist.reduce((sum, {entry: e}) => sum + (e.positives || 0), 0);

  return `
    <div class="portal-view">
      <div class="portal-student-card">
        <div class="portal-avatar">${(s?.name || '#' + num).charAt(0).toUpperCase()}</div>
        <div>
          <div class="portal-name">${esc(s?.name || 'Student #' + num)}</div>
          ${metaParts.length ? `<div class="portal-meta">${metaParts.map(esc).join(' &middot; ')}</div>` : ''}
          ${(STATE.marchingLeaderboardEnabled && portalFeatureOn('stats') && pseudonym) ? `<div class="portal-animal-name">🐾 Leaderboard name: <strong>${esc(pseudonym)}</strong></div>` : ''}
        </div>
      </div>

      ${(hist.length > 0 && portalFeatureOn('attendance')) ? `
        <div id="portal-sec-attendance-hdr" class="sec-hdr" onclick="toggleCollapse('portal-sec-attendance')">
          <span class="section-title" style="margin:0">Attendance</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="portal-sec-attendance" class="sec-collapsed">
          ${(() => {
            const absences = hist.filter(({entry:e}) => e.attendance === 'absent');
            const lates    = hist.filter(({entry:e}) => e.attendance === 'late');
            return `
              <div class="card mb-12" style="padding:12px 16px">
                <div class="att-summary-row">
                  <span class="att-summary-chip att-chip-absent">${absences.length} Absence${absences.length!==1?'s':''}</span>
                  <span class="att-summary-chip att-chip-late">${lates.length} Late${lates.length!==1?'s':''}</span>
                </div>
                ${absences.length ? `
                  <div class="att-date-list">
                    <span class="att-date-heading">Absent:</span>
                    ${absences.map(({rehearsal:r}) => `<span class="att-date-chip att-chip-absent">${fmtDate(r.date)}</span>`).join('')}
                  </div>` : ''}
                ${lates.length ? `
                  <div class="att-date-list">
                    <span class="att-date-heading">Late:</span>
                    ${lates.map(({rehearsal:r}) => `<span class="att-date-chip att-chip-late">${fmtDate(r.date)}</span>`).join('')}
                  </div>` : ''}
              </div>`;
          })()}
        </div>
      ` : ''}

      ${(hist.length > 0 && portalFeatureOn('marks')) ? `
        <div id="portal-sec-marks-hdr" class="sec-hdr" onclick="toggleCollapse('portal-sec-marks')">
          <span class="section-title" style="margin:0">Marks</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="portal-sec-marks" class="sec-collapsed">
          <div class="portal-stats">
            ${!STATE.hideNegativeFromPortal ? `
            <button type="button" class="portal-stat portal-stat-btn" onclick="showPortalMistakesModal()">
              <div class="portal-stat-value portal-stat-mistake">${totalErr}</div>
              <div class="portal-stat-label">Mistake Marks</div>
            </button>` : ''}
            <button type="button" class="portal-stat portal-stat-btn" onclick="showPortalPositivesModal()">
              <div class="portal-stat-value portal-stat-positive">${totalPos}</div>
              <div class="portal-stat-label">Positives</div>
            </button>
          </div>
        </div>
      ` : ''}

      ${mySongs.length > 0 ? `
        <div id="portal-sec-songs-hdr" class="sec-hdr" onclick="toggleCollapse('portal-sec-songs')">
          <span class="section-title" style="margin:0">Songs to Memorize</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="portal-sec-songs" class="sec-collapsed">
          ${(() => {
            const cats = STATE.songCategories;
            const portalSongRow = song => {
              const entry    = song.mine;
              const status   = entry?.status || 'not_attempted';
              const failNote = status === 'failed' ? (entry?.note || '') : '';
              const overdue  = song.dueDate && song.dueDate < today() && status !== 'passed';
              return `
              <div class="portal-song-row">
                <div class="portal-song-info">
                  <div class="portal-song-title">${esc(song.title)}</div>
                  ${song.dueDate ? `<div class="portal-song-due ${overdue ? 'song-overdue' : ''}">Due ${fmtDate(song.dueDate)}</div>` : ''}
                  ${failNote ? `<div class="portal-song-fail-note">📝 ${esc(failNote)}</div>` : ''}
                </div>
                <span class="portal-song-status ${status === 'passed' ? 'pss-pass' : status === 'failed' ? 'pss-fail' : 'pss-na'}">
                  ${status === 'passed' ? '✓ Passed' : status === 'failed' ? '✗ Failed' : '— Not Attempted'}
                </span>
              </div>`;
            };
            if (!cats.length) {
              return `<div class="portal-songs-list">${mySongs.map(portalSongRow).join('')}</div>`;
            }
            const grouped = {};
            const uncategorized = [];
            cats.forEach(c => { grouped[c] = []; });
            mySongs.forEach(song => {
              if (song.category && grouped[song.category] !== undefined) grouped[song.category].push(song);
              else uncategorized.push(song);
            });
            let catIdx = 0;
            let html = '';
            cats.forEach(cat => {
              if (!grouped[cat].length) return;
              const id = `portal-song-cat-${catIdx++}`;
              html += `
                <div id="${id}-hdr" class="sec-hdr sec-hdr-open song-cat-sec-hdr" onclick="toggleCollapse('${id}')">
                  <span>${esc(cat)}</span>
                  <span class="sec-chevron">▾</span>
                </div>
                <div id="${id}">
                  <div class="portal-songs-list">${grouped[cat].map(portalSongRow).join('')}</div>
                </div>`;
            });
            if (uncategorized.length) {
              const id = `portal-song-cat-${catIdx}`;
              const label = mySongs.length > uncategorized.length ? 'Other' : 'Songs';
              html += `
                <div id="${id}-hdr" class="sec-hdr sec-hdr-open song-cat-sec-hdr" onclick="toggleCollapse('${id}')">
                  <span>${label}</span>
                  <span class="sec-chevron">▾</span>
                </div>
                <div id="${id}">
                  <div class="portal-songs-list">${uncategorized.map(portalSongRow).join('')}</div>
                </div>`;
            }
            return html;
          })()}
        </div>
      ` : ''}

      ${hist.length > 0 ? `
        <div id="portal-sec-history-hdr" class="sec-hdr" onclick="toggleCollapse('portal-sec-history')">
          <span class="section-title" style="margin:0">Rehearsal History</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="portal-sec-history" class="sec-collapsed">
        ${hist.map(({rehearsal: r, entry: e}) => {
          // Mark feedback (events + the entry note) is only shown when Marks is
          // visible to students; otherwise the history shows just dates and any
          // attendance badges.
          const showMarks = portalFeatureOn('marks');
          const noteEvts  = showMarks
            ? (e.events || []).filter(ev => ev.note?.trim() && (!STATE.hideNegativeFromPortal || ev.type !== 'mistake'))
            : [];
          const entryNote = showMarks ? (e.notes || '') : '';
          const hasDetail = entryNote || noteEvts.length > 0;
          return `
          <div class="portal-rehearsal-card" id="prc-${esc(r.id)}">
            <div class="portal-rehear-hdr" onclick="togglePortalRehearsal('${esc(r.id)}')">
              <div class="portal-rehear-info">
                <div class="portal-rehear-date">${fmtDate(r.date)}</div>
                ${r.label ? `<div class="portal-rehear-label">${esc(r.label)}</div>` : ''}
              </div>
              <div class="portal-badges">
                ${portalFeatureOn('attendance') && e.attendance==='absent' ? `<span class="portal-badge att-portal-badge-absent">Absent</span>` : ''}
                ${portalFeatureOn('attendance') && e.attendance==='late'   ? `<span class="portal-badge att-portal-badge-late">Late</span>`   : ''}
                ${portalFeatureOn('marks') && !STATE.hideNegativeFromPortal && (e.mistakes || 0) > 0 ? `<span class="portal-badge portal-badge-mistake">✗ ${e.mistakes}</span>` : ''}
                ${portalFeatureOn('marks') && (e.positives || 0) > 0 ? `<span class="portal-badge portal-badge-positive">✓ ${e.positives}</span>` : ''}
              </div>
              ${hasDetail ? `<span class="portal-chevron">▸</span>` : '<span class="portal-chevron" style="opacity:0">▸</span>'}
            </div>
            <div class="portal-rehearsal-detail">
              ${entryNote ? `<div class="portal-entry-note">${esc(entryNote)}</div>` : ''}
              ${noteEvts.map(ev => `
                <div class="portal-event-row ${ev.sectionMark ? 'is-section-mark' : ''}">
                  <span class="event-note-type ${ev.type === 'mistake' ? 'is-mistake' : 'is-positive'}">${ev.type === 'mistake' ? '✗' : '✓'}</span>
                  ${ev.sectionMark ? `<span class="section-mark-badge">§ ${esc(ev.section||'Section')}</span>` : ''}
                  ${ev.segment ? `<span class="event-seg">${esc(ev.segment)}</span>` : ''}
                  <span class="portal-event-text">${esc(ev.note)}</span>
                  ${ev.ts ? `<span class="event-note-time">${fmtTime(ev.ts)}</span>` : ''}
                </div>`).join('')}
            </div>
          </div>`;
        }).join('')}
        </div>
      ` : `<p class="empty-state" style="padding:24px 0">No rehearsal history yet.</p>`}

      ${portalFeatureOn('stats') ? `
      <button class="leaderboard-link-btn" onclick="${previewMode ? `previewLeaderboard('${esc(num)}')` : "navigate('leaderboard')"}">
        📊 View Band Stats &amp; Leaderboard
      </button>` : ''}
    </div>`;
}

function showPortalMistakesModal() {
  const num  = STATE.studentNum;
  const hist = DB.getStudentHistory(num);
  const relevant = hist.filter(({entry: e}) => (e.mistakes || 0) > 0);
  if (!relevant.length) {
    openModal(`<div class="modal-title">Mistake Marks</div><p class="empty-state" style="padding:24px 0">No mistake marks recorded.</p>`);
    return;
  }
  const totalErr = relevant.reduce((sum, {entry: e}) => sum + (e.mistakes || 0), 0);
  const sections = relevant.map(({rehearsal: r, entry: e}) => {
    const noteEvts = (e.events || []).filter(ev => ev.type === 'mistake' && ev.note?.trim());
    const blankCount = Math.max(0, (e.mistakes || 0) - noteEvts.length);
    const noteRows = noteEvts.map(ev => `
      <div class="portal-event-row ${ev.sectionMark ? 'is-section-mark' : ''}">
        <span class="event-note-type is-mistake">✗</span>
        ${ev.sectionMark ? `<span class="section-mark-badge">§ ${esc(ev.section||'Section')}</span>` : ''}
        ${ev.segment ? `<span class="event-seg">${esc(ev.segment)}</span>` : ''}
        <span class="portal-event-text">${esc(ev.note)}</span>
        ${ev.ts ? `<span class="event-note-time">${fmtTime(ev.ts)}</span>` : ''}
      </div>`).join('');
    const blankRow = blankCount > 0
      ? `<div class="portal-modal-blank-marks">+ ${blankCount} mark${blankCount!==1?'s':''} without notes</div>` : '';
    return `
      <div class="portal-modal-section">
        <div class="portal-modal-section-hdr">
          <span class="portal-modal-date">${fmtDate(r.date)}</span>
          ${r.label ? `<span class="portal-modal-label">${esc(r.label)}</span>` : ''}
          <span class="portal-badge portal-badge-mistake" style="margin-left:auto">✗ ${e.mistakes}</span>
        </div>
        ${noteRows}${blankRow}
      </div>`;
  }).join('');
  openModal(`
    <div class="modal-title">Mistake Marks</div>
    <div class="portal-modal-total portal-total-mistake">${totalErr} total mistake mark${totalErr!==1?'s':''}</div>
    <div class="portal-modal-list">${sections}</div>`);
}

function showPortalPositivesModal() {
  const num  = STATE.studentNum;
  const hist = DB.getStudentHistory(num);
  const relevant = hist.filter(({entry: e}) => (e.positives || 0) > 0);
  if (!relevant.length) {
    openModal(`<div class="modal-title">Positive Marks</div><p class="empty-state" style="padding:24px 0">No positive marks recorded yet.</p>`);
    return;
  }
  const totalPos = relevant.reduce((sum, {entry: e}) => sum + (e.positives || 0), 0);
  const sections = relevant.map(({rehearsal: r, entry: e}) => {
    const noteEvts = (e.events || []).filter(ev => ev.type === 'positive' && ev.note?.trim());
    const blankCount = Math.max(0, (e.positives || 0) - noteEvts.length);
    const noteRows = noteEvts.map(ev => `
      <div class="portal-event-row ${ev.sectionMark ? 'is-section-mark' : ''}">
        <span class="event-note-type is-positive">✓</span>
        ${ev.sectionMark ? `<span class="section-mark-badge">§ ${esc(ev.section||'Section')}</span>` : ''}
        ${ev.segment ? `<span class="event-seg">${esc(ev.segment)}</span>` : ''}
        <span class="portal-event-text">${esc(ev.note)}</span>
        ${ev.ts ? `<span class="event-note-time">${fmtTime(ev.ts)}</span>` : ''}
      </div>`).join('');
    const blankRow = blankCount > 0
      ? `<div class="portal-modal-blank-marks portal-blank-positive">+ ${blankCount} positive${blankCount!==1?'s':''} without notes</div>` : '';
    return `
      <div class="portal-modal-section">
        <div class="portal-modal-section-hdr">
          <span class="portal-modal-date">${fmtDate(r.date)}</span>
          ${r.label ? `<span class="portal-modal-label">${esc(r.label)}</span>` : ''}
          <span class="portal-badge portal-badge-positive" style="margin-left:auto">✓ ${e.positives}</span>
        </div>
        ${noteRows}${blankRow}
      </div>`;
  }).join('');
  openModal(`
    <div class="modal-title">Positive Marks</div>
    <div class="portal-modal-total portal-total-positive">${totalPos} total positive mark${totalPos!==1?'s':''}</div>
    <div class="portal-modal-list">${sections}</div>`);
}

function toggleCollapse(id) {
  const content = document.getElementById(id);
  const hdr     = document.getElementById(id + '-hdr');
  if (!content) return;
  const collapsed = content.classList.toggle('sec-collapsed');
  if (hdr) hdr.classList.toggle('sec-hdr-open', !collapsed);
}

function togglePortalRehearsal(rid) {
  const card = document.getElementById('prc-' + rid);
  if (!card) return;
  const detail  = card.querySelector('.portal-rehearsal-detail');
  const chevron = card.querySelector('.portal-chevron');
  const opening = !card.classList.contains('prc-open');
  card.classList.toggle('prc-open', opening);
  if (detail)  detail.style.maxHeight = opening ? detail.scrollHeight + 'px' : '0';
  if (chevron) chevron.style.transform = opening ? 'rotate(90deg)' : '';
}

function showDashStatModal(statKey) {
  // Build scoped student list (same logic as viewDashboard)
  const scopeMap = _dashRid
    ? (STATE.entries[_dashRid] || {})
    : Object.values(STATE.entries).reduce((acc, re) => {
        for (const [num, e] of Object.entries(re)) {
          if (!acc[num]) acc[num] = { positives: 0, mistakes: 0 };
          acc[num].positives += e.positives || 0;
          acc[num].mistakes  += e.mistakes  || 0;
        }
        return acc;
      }, {});

  const stuList = Object.entries(scopeMap).map(([num, e]) => ({
    num,
    name: STATE.students[num]?.name || `#${num}`,
    pos: e.positives || 0,
    mis: e.mistakes  || 0,
  }));

  let rows, title, cls, valFn;
  if (statKey === 'positives') {
    rows   = stuList.filter(s => s.pos > 0).sort((a, b) => b.pos - a.pos || a.name.localeCompare(b.name));
    title  = '✓ Positives';
    cls    = 'dash-val-pos';
    valFn  = s => `+${s.pos}`;
  } else if (statKey === 'mistakes') {
    rows   = stuList.filter(s => s.mis > 0).sort((a, b) => b.mis - a.mis || a.name.localeCompare(b.name));
    title  = '✗ Mistakes';
    cls    = 'dash-val-mis';
    valFn  = s => `${s.mis}`;
  } else {
    rows   = stuList.filter(s => s.pos + s.mis > 0).sort((a, b) => (b.pos + b.mis) - (a.pos + a.mis) || a.name.localeCompare(b.name));
    title  = 'Students Marked';
    cls    = '';
    valFn  = s => `${s.pos + s.mis}`;
  }

  if (!rows.length) {
    openModal(`<div class="modal-title">${title}</div><p style="color:var(--text-muted)">No students to show.</p>`);
    return;
  }

  openModal(`
    <div class="modal-title">${title}</div>
    ${rows.map(s => `
      <div class="dash-stu-row" onclick="closeModal();showStudentMarksModal('${esc(s.num)}','${esc(_dashRid||'')}')">
        <span class="dash-stu-name">${esc(s.name)}</span>
        <span class="dash-stu-val ${cls}">${valFn(s)}</span>
        <span class="dash-stu-chevron">›</span>
      </div>`).join('')}
  `);
}

function showMarkStudentsModal(note, type) {
  const tally = {};
  const scan = entries => {
    for (const [num, e] of Object.entries(entries)) {
      for (const evt of (e.events || [])) {
        if (evt.type === type && evt.note?.trim() === note) {
          tally[num] = (tally[num] || 0) + 1;
        }
      }
    }
  };
  if (_dashRid) {
    scan(STATE.entries[_dashRid] || {});
  } else {
    for (const entries of Object.values(STATE.entries)) scan(entries);
  }
  const rows = Object.entries(tally)
    .map(([num, count]) => ({ num, name: STATE.students[num]?.name || `#${num}`, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const typeCls = type === 'positive' ? 'dash-val-pos' : 'dash-val-mis';
  const typeIcon = type === 'positive' ? '✓' : '✗';
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">${typeIcon} ${esc(note)}</div>
    <div class="form-hint" style="margin:0 0 12px">${rows.length} student${rows.length !== 1 ? 's' : ''} received this mark</div>
    <div class="card" style="padding:0;overflow:hidden">
      ${rows.map(s => `
        <div class="dash-stu-row" onclick="closeModal();navigate('student',{num:'${esc(s.num)}'})">
          <span class="dash-stu-name">${esc(s.name)}</span>
          ${s.count > 1 ? `<span class="dash-stu-val ${typeCls}">×${s.count}</span>` : ''}
          <span class="dash-stu-chevron">›</span>
        </div>`).join('')}
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}
