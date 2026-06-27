// Band Tracker — js/04-render.js — Render engine (header, nav, view switch).
// Plain script sharing global scope; load order is set in index.html.

// ── Render engine ─────────────────────────────────────────────────────────────

function render() {
  const backBtn = document.getElementById('back-btn');
  const title   = document.getElementById('page-title');
  const actions = document.getElementById('header-actions');
  const main    = document.getElementById('main-content');
  const tabs    = document.querySelectorAll('.nav-tab');
  const nav     = document.getElementById('bottom-nav');

  // Apply the band's custom primary color (no-op when unset / already applied).
  applyBandColor(STATE.bandColor);

  // Sync header logo + browser tab title
  const headerLogo = document.getElementById('header-logo');
  if (headerLogo) {
    if (STATE.bandLogo) {
      headerLogo.src = STATE.bandLogo;
      headerLogo.style.display = '';
    } else {
      headerLogo.style.display = 'none';
    }
  }
  document.title = STATE.bandName || 'Band Tracker';

  if (STATE.authChecking) {
    backBtn.classList.add('hidden');
    title.textContent = STATE.bandName || 'Band Tracker';
    actions.innerHTML = '';
    nav.style.display = 'none';
    main.innerHTML = `<div class="loading-view"><div class="spinner"></div></div>`;
    return;
  }

  if (!STATE.user) {
    backBtn.classList.add('hidden');
    title.textContent = 'Band Tracker';
    actions.innerHTML = '';
    nav.style.display = 'none';
    main.innerHTML = viewLogin();
    return;
  }

  if (_pendingVerification && !STATE.user.emailVerified && !STATE.user.isAnonymous) {
    backBtn.classList.add('hidden');
    title.textContent = 'Verify Email';
    actions.innerHTML = '';
    nav.style.display = 'none';
    main.innerHTML = viewVerificationPending();
    return;
  }

  nav.style.display = '';

  if (STATE.loading) {
    backBtn.classList.add('hidden');
    title.textContent = 'Band Tracker';
    actions.innerHTML = userBtn();
    main.innerHTML = `<div class="loading-view"><div class="spinner"></div><span>Loading data…</span></div>`;
    return;
  }

  // A backend read failed transiently — the user IS still signed in. Show a
  // reassuring retry instead of the login/onboarding screen (which looks like a
  // logout and lost data).
  if (STATE.connError) {
    backBtn.classList.add('hidden');
    title.textContent = STATE.bandName || 'Band Tracker';
    actions.innerHTML = '';
    nav.style.display = 'none';
    main.innerHTML = viewConnError();
    return;
  }

  // Signed in but not yet linked to a band. The self-serve create/join flow is a
  // separate milestone; for now show a clear message instead of a blank app.
  if (STATE.needsOnboarding) {
    backBtn.classList.add('hidden');
    title.textContent = 'Band Tracker';
    actions.innerHTML = '';
    nav.style.display = 'none';
    main.innerHTML = viewOnboarding();
    return;
  }

  // Anonymous user with no valid student code — should never reach here normally,
  // but guard in case tick() check was bypassed
  if (STATE.user?.isAnonymous && !STATE.studentNum) {
    backBtn.classList.add('hidden');
    title.textContent = 'Band Tracker';
    actions.innerHTML = '';
    nav.style.display = 'none';
    main.innerHTML = viewLogin();
    localStorage.removeItem('bandStudentCode');
    localStorage.removeItem('bandStudentNum');
    auth.signOut();
    return;
  }

  // Student portal — non-admin user with a linked student account
  if (STATE.studentNum && !STATE.isAdmin && _view !== 'leaderboard') {
    backBtn.classList.add('hidden');
    title.textContent = 'My Band Profile';
    actions.innerHTML = userBtn();
    nav.style.display = 'none';
    main.innerHTML = viewStudentPortal();
    return;
  }
  if (STATE.studentNum && !STATE.isAdmin) {
    nav.style.display = 'none'; // keep nav hidden for students on leaderboard too
  }

  const studentOnLeaderboard = _view === 'leaderboard' && STATE.studentNum && !STATE.isAdmin;
  const isTop = ['roster','rehearsals','songs','attendance-tab','leaderboard','dashboard','drill'].includes(_view) && !studentOnLeaderboard;
  backBtn.classList.toggle('hidden', isTop);
  backBtn.onclick = () => history.back();

  tabs.forEach(t => {
    const match = t.dataset.view;
    t.classList.toggle('active',
      match === _view ||
      (_view === 'student'    && match === 'roster') ||
      (_view === 'rehearsal'  && match === 'rehearsals') ||
      ((_view === 'attendance' || _view === 'attendance-block') && _params.from === 'attendance-tab' && match === 'attendance-tab') ||
      ((_view === 'attendance' || _view === 'attendance-block') && _params.from === 'rehearsals' && match === 'rehearsals') ||
      ((_view === 'attendance' || _view === 'attendance-block') && _params.from !== 'attendance-tab' && _params.from !== 'rehearsals' && match === 'rehearsals') ||
      (_view === 'song'       && match === 'songs')
    );
    // Hide tabs for disabled features (and the admin-only tabs for students).
    if (match === 'roster')         t.style.display = STATE.isAdmin ? '' : 'none';
    if (match === 'attendance-tab') t.style.display = featureOn('attendance') ? '' : 'none';
    if (match === 'songs')          t.style.display = featureOn('songs') ? '' : 'none';
    if (match === 'leaderboard')    t.style.display = (STATE.isAdmin && featureOn('stats')) ? '' : 'none';
    if (match === 'dashboard')      t.style.display = (STATE.isAdmin && featureOn('marks')) ? '' : 'none';
    if (match === 'drill')          t.style.display = (STATE.isAdmin && featureOn('drill')) ? '' : 'none';
  });

  // If the current view belongs to a disabled feature, bounce to a safe view.
  const curFeature = VIEW_FEATURE[_view];
  if (curFeature && !featureOn(curFeature)) {
    navigate(STATE.studentNum && !STATE.isAdmin ? '' : 'rehearsals');
    return;
  }

  actions.innerHTML = '';

  // The block-attendance screen pins its "Next column" footer to the bottom, so
  // it drops #main-content's bottom padding to sit flush above the nav.
  main.classList.toggle('mc-block-att', _view === 'attendance-block');
  // The Drill tab fills the content area with an immersive, zoomable chart
  // (header + nav stay put), so it drops #main-content's padding/scroll.
  main.classList.toggle('mc-drill', _view === 'drill');

  // New bands: guide admin to roster on login before any students exist
  if (STATE.isAdmin && _view === 'rehearsals' && !Object.keys(STATE.students).length) {
    _view = 'roster';
  }

  switch (_view) {
    case 'roster':
      title.textContent = 'Student Roster';
      actions.innerHTML = (STATE.isAdmin ? optBtn('showRosterOptionsModal()') + addBtn('showAddStudentModal()') : '') + userBtn();
      main.innerHTML = viewRoster();
      break;

    case 'student': {
      const s = DB.getStudents()[_params.num];
      title.textContent = s ? (s.name || 'Student') : 'Student';
      const previewBtn = `<button class="icon-btn" onclick="showStudentPortalPreview('${esc(_params.num)}')" title="Preview student view" aria-label="Preview student view">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>`;
      actions.innerHTML = (STATE.isAdmin ? previewBtn + editBtn(`showEditStudentModal('${esc(_params.num)}')`) : '') + userBtn();
      main.innerHTML = viewStudent(_params.num);
      break;
    }

    case 'rehearsals': {
      // Hide header + when the in-content "Start a New Rehearsal" button is visible
      // (admin, has rehearsals, none currently open). Keep it when list is empty or a rehearsal is open.
      const _hasOpen = STATE.rehearsals.some(r => !r.ended);
      const _hasAny  = STATE.rehearsals.length > 0;
      title.textContent = 'Rehearsals';
      actions.innerHTML = (STATE.isAdmin && (!_hasAny || _hasOpen) ? addBtn('showNewRehearsalModal()') : '') + userBtn();
      main.innerHTML = viewRehearsals();
      break;
    }

    case 'attendance-tab':
      title.textContent = 'Attendance';
      actions.innerHTML = (STATE.isAdmin ? optBtn('showAttendanceReportModal()') : '') + userBtn();
      main.innerHTML = viewAttendanceTab();
      break;

    case 'rehearsal': {
      const r = DB.getRehearsals().find(r => r.id === _params.rid);
      title.textContent = r ? fmtShort(r.date) + (r.label ? ` — ${r.label}` : '') : 'Rehearsal';
      actions.innerHTML = userBtn();
      main.innerHTML = viewRehearsal(_params.rid);
      if (_blockMode && !_activeNum) initBlockPinch(_params.rid);
      break;
    }

    case 'attendance': {
      const _attR = STATE.rehearsals.find(r => r.id === _params.rid);
      title.textContent = _attR
        ? fmtShort(_attR.date) + (_attR.label ? ` — ${_attR.label}` : '')
        : 'Take Attendance';
      actions.innerHTML = userBtn();
      main.innerHTML = viewAttendance(_params.rid);
      break;
    }

    case 'attendance-block': {
      const _blkR = STATE.rehearsals.find(r => r.id === _params.rid);
      title.textContent = _blkR
        ? fmtShort(_blkR.date) + (_blkR.label ? ` — ${_blkR.label}` : '')
        : 'Take Attendance';
      actions.innerHTML = userBtn();
      main.innerHTML = viewAttendanceBlock(_params.rid);
      break;
    }

    case 'songs':
      title.textContent = 'Songs';
      actions.innerHTML = (STATE.isAdmin ? optBtn('showSongOptionsModal()') + addBtn('showAddSongModal()') : '') + userBtn();
      main.innerHTML = viewSongs();
      break;

    case 'drill':
      title.textContent = 'Field Chart';
      actions.innerHTML = (STATE.isAdmin ? optBtn('showDrillOptionsModal()') : '') + userBtn();
      main.innerHTML = viewDrill();
      if (typeof _drillViewSetup === 'function') _drillViewSetup();
      break;

    case 'song': {
      const song = STATE.songs.find(s => s.id === _params.sid);
      title.textContent = song?.title || 'Song';
      actions.innerHTML = (STATE.isAdmin ? editBtn(`showEditSongModal('${esc(_params.sid)}')`) : '') + userBtn();
      main.innerHTML = viewSong(_params.sid);
      break;
    }

    case 'leaderboard':
      title.textContent = 'Band Stats';
      actions.innerHTML = (STATE.isAdmin ? optBtn('showLeaderboardSettingsModal()') : '') + userBtn();
      main.innerHTML = STATE.isAdmin ? viewLeaderboard() : viewLeaderboardStudent();
      break;

    case 'dashboard': {
      // The Marks tab always shows the summary. Recording for an open rehearsal
      // happens on the dedicated 'rehearsal' page, reached via a button in
      // viewDashboard() (so the summary stays available even mid-rehearsal).
      title.textContent = 'Rehearsal Marks';
      actions.innerHTML = (STATE.isAdmin ? optBtn('showMarksOptionsModal()') : '') + userBtn();
      main.innerHTML = viewDashboard();
      break;
    }
  }
}

function reportBtn(fn) {
  return `<button class="icon-btn" onclick="${fn}" title="Attendance Report">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg></button>`;
}

function addBtn(fn) {
  return `<button class="icon-btn" onclick="${fn}" title="Add">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg></button>`;
}

function editBtn(fn) {
  return `<button class="icon-btn" onclick="${fn}" title="Edit">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg></button>`;
}

function optBtn(fn) {
  return `<button class="icon-btn" onclick="${fn}" title="Options">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="12" cy="5" r="1.2" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
      <circle cx="12" cy="19" r="1.2" fill="currentColor"/>
    </svg></button>`;
}

function userBtn() {
  const initials = (STATE.user?.email || '?').slice(0, 2).toUpperCase();
  return `<button class="user-btn" onclick="showUserMenu()" title="${esc(STATE.user?.email || '')}">${esc(initials)}</button>`;
}
