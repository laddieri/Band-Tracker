// =============================================================================
// BAND TRACKER — Firebase Edition
// =============================================================================

const INSTRUMENTS = [
  'Piccolo','Flute','Clarinet','Bass Clarinet',
  'Alto Saxophone','Tenor Saxophone','Baritone Saxophone',
  'Trumpet','Mellophone','French Horn',
  'Trombone','Bass Trombone','Baritone/Euphonium','Tuba',
  'Snare Drum','Tenor Drums','Bass Drum','Cymbals',
  'Marimba','Xylophone','Vibraphone',
  'Color Guard','Drum Major','Other'
];

const SECTIONS = ['Woodwinds','Brass','Percussion','Front Ensemble','Color Guard','Leadership'];

const MISTAKE_PRESETS  = ['Out of step','Missed turn','Poor posture','Late to mark','Wrong direction','Dress/cover issue','Instrument angle','Off the line'];
const POSITIVE_PRESETS = ['Snappy turns','Great marching style','Good posture','Strong presence','Perfect timing','Excellent dress/cover','High energy','Great recovery'];

const COLUMNS = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const ROWS    = [1,2,3,4,5,6,7,8,9,10,11,12];

// ── Firebase init ─────────────────────────────────────────────────────────────

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// ── State ─────────────────────────────────────────────────────────────────────

const STATE = {
  user:         null,
  authChecking: true,
  loading:      true,
  isAdmin:      false,
  studentNum:   null,
  students:     {},
  rehearsals:   [],
  entries:      {},
  songs:        [],
  _unsubs:      []
};

// ── DB read layer (same API as before — views unchanged) ──────────────────────

const DB = {
  getStudents()        { return STATE.students; },
  getRehearsals()      { return STATE.rehearsals; },
  getRehearsalEntries(rid) { return STATE.entries[rid] || {}; },
  getStudentHistory(num) {
    return STATE.rehearsals
      .filter(r => STATE.entries[r.id]?.[num])
      .map(r => ({ rehearsal: r, entry: STATE.entries[r.id][num] }))
      .sort((a, b) => b.rehearsal.date.localeCompare(a.rehearsal.date));
  }
};

// ── Firestore write helpers ───────────────────────────────────────────────────

async function fsUpsertEntry(rid, num, data) {
  const docId = `${rid}_${String(num)}`;
  await db.collection('entries').doc(docId).set({
    rehearsalId: rid,
    studentNumber: String(num),
    ...data,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: STATE.user?.email || ''
  }, { merge: true });
}

// ── Firestore listeners ───────────────────────────────────────────────────────

function startListeners() {
  STATE._unsubs.forEach(u => u());
  STATE._unsubs = [];
  STATE.loading = true;
  const loaded = new Set();

  function tick(key) {
    loaded.add(key);
    if (loaded.size >= 4 && STATE.loading) {
      // All collections loaded — reject anonymous sessions with no valid student code
      if (STATE.user?.isAnonymous && !STATE.studentNum) {
        localStorage.removeItem('bandStudentCode');
        localStorage.removeItem('bandStudentNum');
        showToast('Code not found. Please check and try again.');
        auth.signOut(); // onAuthStateChanged will clear state and call render()
        return;
      }
      STATE.loading = false;
      render();
    } else if (!STATE.loading) {
      render();
    }
  }

  const listeners = [];

  // Admin listener — not applicable to anonymous student sessions
  if (!STATE.user.isAnonymous && STATE.user.email) {
    listeners.push(
      db.collection('admins').doc(STATE.user.email).onSnapshot(doc => {
        const prev = STATE.isAdmin;
        STATE.isAdmin = doc.exists;
        if (prev !== STATE.isAdmin && !STATE.loading) render();
      })
    );
  }

  listeners.push(
    db.collection('students').onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') delete STATE.students[ch.doc.id];
        else STATE.students[ch.doc.id] = { ...ch.doc.data(), _id: ch.doc.id };
      });

      if (STATE.user?.isAnonymous) {
        // Keep previously-resolved student num, or look up by stored num
        const storedNum = localStorage.getItem('bandStudentNum');
        if (storedNum && STATE.students[storedNum]) {
          STATE.studentNum = storedNum;
        } else if (_pendingStudentCode) {
          STATE.studentNum = null;
          for (const [num, s] of Object.entries(STATE.students)) {
            if (s.studentCode && s.studentCode.toUpperCase() === _pendingStudentCode.toUpperCase()) {
              STATE.studentNum = num;
              localStorage.setItem('bandStudentNum', num);
              _pendingStudentCode = '';
              break;
            }
          }
          // Invalid code — tick() will detect this once all collections load
        }
      } else {
        // Regular (email) users: look up by studentEmail field
        STATE.studentNum = null;
        const email = STATE.user?.email?.toLowerCase();
        if (email) {
          for (const [num, s] of Object.entries(STATE.students)) {
            if (s.studentEmail && s.studentEmail.toLowerCase() === email) {
              STATE.studentNum = num;
              break;
            }
          }
        }
      }

      tick('students');
    }),

    db.collection('rehearsals').onSnapshot(snap => {
      STATE.rehearsals = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => b.date.localeCompare(a.date));
      tick('rehearsals');
    }),

    db.collection('entries').onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (!d.rehearsalId || !d.studentNumber) return;
        if (ch.type === 'removed') {
          if (STATE.entries[d.rehearsalId]) delete STATE.entries[d.rehearsalId][d.studentNumber];
        } else {
          if (!STATE.entries[d.rehearsalId]) STATE.entries[d.rehearsalId] = {};
          STATE.entries[d.rehearsalId][d.studentNumber] = d;
        }
      });
      tick('entries');
    }),

    db.collection('songs').onSnapshot(snap => {
      STATE.songs = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      tick('songs');
    }, err => {
      console.error('songs listener error:', err);
      tick('songs'); // don't hang the app — songs will be empty
    })
  );

  STATE._unsubs = listeners;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

auth.onAuthStateChanged(user => {
  STATE.user = user;
  STATE.authChecking = false;
  if (user) {
    if (user.isAnonymous) {
      // Restore anonymous student session from localStorage
      const storedCode = localStorage.getItem('bandStudentCode');
      const storedNum  = localStorage.getItem('bandStudentNum');
      if (!storedCode && !storedNum) {
        // Anonymous session with no stored code — sign out immediately
        auth.signOut();
        return;
      }
      _pendingStudentCode = storedCode || '';
      if (storedNum) STATE.studentNum = storedNum; // optimistically restore
    }
    startListeners();
  } else {
    STATE._unsubs.forEach(u => u());
    STATE._unsubs = [];
    STATE.loading    = false;
    STATE.isAdmin    = false;
    STATE.studentNum = null;
    STATE.students   = {};
    STATE.rehearsals = [];
    STATE.entries    = {};
    STATE.songs      = [];
    render();
  }
});

// ── Router ────────────────────────────────────────────────────────────────────

let _view   = 'home';
let _params = {};

function navigate(view, params = {}) {
  if (_view === 'rehearsal' && view !== 'rehearsal') {
    _activeNum  = null;
    _numSearch  = '';
    _blockMode  = false;
    _blockPath  = [];
    _trackerInstrumentFilter = '';
  }
  if (_view === 'song' && view !== 'song') {
    _songSectionFilter = '';
  }
  _view   = view;
  _params = params;
  render();
  document.getElementById('main-content').scrollTop = 0;
}

// ── Rehearsal state ───────────────────────────────────────────────────────────

let _activeNum  = null;
let _numSearch  = '';
let _rosterSearch = '';
let _rosterInstrumentFilter  = '';
let _trackerInstrumentFilter = '';
let _songSectionFilter       = '';
let _blockMode  = false;
let _blockPath  = []; // [{c0,c1,r0,r1}] — zoom drill path
let _pendingSegment    = ''; // currently selected rehearsal segment in mark modal
let _pendingStudentCode = ''; // code being verified for anonymous student login

// ── Debounce store for note fields ────────────────────────────────────────────

const _debounce = {};

function debounced(key, fn, ms = 800) {
  clearTimeout(_debounce[key]);
  _debounce[key] = setTimeout(fn, ms);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${months[m-1]} ${day}, ${y}`;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d    = new Date(ts);
  const h    = d.getHours();
  const m    = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${m}${ampm}`;
}

function fmtShort(d) {
  if (!d) return '';
  const [, m, day] = d.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m-1]} ${day}`;
}

function fmtPos(col, row) {
  if (!col && !row) return '';
  return `${col || ''}${row || ''}`;
}

function dirLabel(email) {
  return email ? email.split('@')[0] : '';
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function genStudentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous I/O/0/1
  return Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function showToast(msg) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 2700);
}

function handleModalClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function openModal(html) {
  document.getElementById('modal-body').innerHTML = `<div class="modal-handle"></div>${html}`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

// ── Render engine ─────────────────────────────────────────────────────────────

function render() {
  const backBtn = document.getElementById('back-btn');
  const title   = document.getElementById('page-title');
  const actions = document.getElementById('header-actions');
  const main    = document.getElementById('main-content');
  const tabs    = document.querySelectorAll('.nav-tab');
  const nav     = document.getElementById('bottom-nav');

  if (STATE.authChecking) {
    backBtn.classList.add('hidden');
    title.textContent = 'Band Tracker';
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

  nav.style.display = '';

  if (STATE.loading) {
    backBtn.classList.add('hidden');
    title.textContent = 'Band Tracker';
    actions.innerHTML = userBtn();
    main.innerHTML = `<div class="loading-view"><div class="spinner"></div><span>Loading data…</span></div>`;
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
  if (STATE.studentNum && !STATE.isAdmin) {
    backBtn.classList.add('hidden');
    title.textContent = 'My Band Profile';
    actions.innerHTML = userBtn();
    nav.style.display = 'none';
    main.innerHTML = viewStudentPortal();
    return;
  }

  const isTop = ['home','roster','rehearsals','songs'].includes(_view);
  backBtn.classList.toggle('hidden', isTop);
  backBtn.onclick = () => {
    if (_view === 'student')   navigate('roster');
    else if (_view === 'rehearsal') navigate('rehearsals');
    else if (_view === 'song') navigate('songs');
    else navigate('home');
  };

  tabs.forEach(t => {
    const match = t.dataset.view;
    t.classList.toggle('active',
      match === _view ||
      (_view === 'student'   && match === 'roster') ||
      (_view === 'rehearsal' && match === 'rehearsals') ||
      (_view === 'song'      && match === 'songs')
    );
  });

  actions.innerHTML = '';

  switch (_view) {
    case 'home':
      title.textContent = 'Band Tracker';
      actions.innerHTML = userBtn();
      main.innerHTML = viewHome();
      break;

    case 'roster':
      title.textContent = 'Student Roster';
      actions.innerHTML = (STATE.isAdmin ? addBtn('showAddStudentModal()') : '') + userBtn();
      main.innerHTML = viewRoster();
      break;

    case 'student': {
      const s = DB.getStudents()[_params.num];
      title.textContent = s ? `Student #${esc(s.number)}` : 'Student';
      actions.innerHTML = (STATE.isAdmin ? editBtn(`showEditStudentModal('${esc(_params.num)}')`) : '') + userBtn();
      main.innerHTML = viewStudent(_params.num);
      break;
    }

    case 'rehearsals':
      title.textContent = 'Rehearsals';
      actions.innerHTML = addBtn('showNewRehearsalModal()') + userBtn();
      main.innerHTML = viewRehearsals();
      break;

    case 'rehearsal': {
      const r = DB.getRehearsals().find(r => r.id === _params.rid);
      title.textContent = r ? fmtShort(r.date) + (r.label ? ` — ${r.label}` : '') : 'Rehearsal';
      actions.innerHTML = optBtn(`showRehearsalOptions('${esc(_params.rid)}')`) + userBtn();
      main.innerHTML = viewRehearsal(_params.rid);
      if (_blockMode && !_activeNum) initBlockPinch(_params.rid);
      break;
    }

    case 'songs':
      title.textContent = 'Songs';
      actions.innerHTML = (STATE.isAdmin ? addBtn('showAddSongModal()') : '') + userBtn();
      main.innerHTML = viewSongs();
      break;

    case 'song': {
      const song = STATE.songs.find(s => s.id === _params.sid);
      title.textContent = song?.title || 'Song';
      actions.innerHTML = (STATE.isAdmin ? editBtn(`showEditSongModal('${esc(_params.sid)}')`) : '') + userBtn();
      main.innerHTML = viewSong(_params.sid);
      break;
    }
  }
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

// ── Auth views ────────────────────────────────────────────────────────────────

function viewLogin() {
  return `
    <div class="login-view">
      <div class="login-logo">🎺</div>
      <div class="login-title">Band Tracker</div>

      <div class="login-section-label">Students</div>
      <div id="student-code-error"></div>
      <div class="form-group">
        <input class="form-input" id="student-code" type="text"
               placeholder="Enter your student code"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               style="text-transform:uppercase;letter-spacing:.1em;font-size:1.1rem;text-align:center"
               onkeydown="if(event.key==='Enter')loginWithStudentCode()">
      </div>
      <button class="btn btn-primary btn-full btn-lg" onclick="loginWithStudentCode()">View My Page</button>

      <div class="login-divider"><span>Directors</span></div>

      <div id="auth-error"></div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="auth-email" type="email"
               placeholder="director@school.edu" autocomplete="email"
               onkeydown="if(event.key==='Enter')doLogin()">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" id="auth-password" type="password"
               placeholder="••••••••" autocomplete="current-password"
               onkeydown="if(event.key==='Enter')doLogin()">
      </div>
      <button class="btn btn-secondary btn-full" onclick="doLogin()">Director Sign In</button>
    </div>
  `;
}

async function loginWithStudentCode() {
  const raw  = document.getElementById('student-code')?.value.trim();
  const code = raw?.toUpperCase();
  if (!code) { showStudentCodeError('Please enter your student code.'); return; }
  try {
    _pendingStudentCode = code;
    localStorage.setItem('bandStudentCode', code);
    await auth.signInAnonymously();
  } catch(e) {
    _pendingStudentCode = '';
    localStorage.removeItem('bandStudentCode');
    showStudentCodeError('Unable to connect. Please try again.');
  }
}

function showStudentCodeError(msg) {
  const el = document.getElementById('student-code-error');
  if (el) el.innerHTML = `<div class="auth-error">${esc(msg)}</div>`;
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.innerHTML = `<div class="auth-error">${esc(msg)}</div>`;
}

function authMsg(code) {
  const map = {
    'auth/user-not-found':        'No account found with that email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/invalid-email':         'Invalid email address.',
    'auth/email-already-in-use':  'An account already exists with that email.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/too-many-requests':     'Too many attempts. Try again later.',
    'auth/invalid-credential':    'Incorrect email or password.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

async function doLogin() {
  const email = document.getElementById('auth-email')?.value.trim();
  const pass  = document.getElementById('auth-password')?.value;
  if (!email || !pass) { showAuthError('Email and password are required.'); return; }
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch(e) {
    showAuthError(authMsg(e.code));
  }
}

async function doSignup() {
  const email = document.getElementById('auth-email')?.value.trim();
  const pass  = document.getElementById('auth-password')?.value;
  if (!email || !pass) { showAuthError('Email and password are required.'); return; }
  try {
    await auth.createUserWithEmailAndPassword(email, pass);
  } catch(e) {
    showAuthError(authMsg(e.code));
  }
}

async function doLogout() {
  closeModal();
  localStorage.removeItem('bandStudentCode');
  localStorage.removeItem('bandStudentNum');
  await auth.signOut();
}

function showUserMenu() {
  if (STATE.user?.isAnonymous) {
    const s = STATE.students[STATE.studentNum];
    openModal(`
      <div class="modal-title">Student View</div>
      <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:20px">
        Viewing as<br><strong style="color:var(--text)">${esc(s?.name || 'Student #' + STATE.studentNum)}</strong>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
        <button class="btn btn-danger btn-full" onclick="doLogout()">Exit Student View</button>
      </div>
    `);
    return;
  }
  openModal(`
    <div class="modal-title">Account</div>
    <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:20px">
      Signed in as<br><strong style="color:var(--text)">${esc(STATE.user?.email || '')}</strong><br>
      <span style="font-size:0.8rem">${STATE.isAdmin ? '⭐ Admin' : 'Director'}</span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
      <button class="btn btn-danger btn-full" onclick="doLogout()">Sign Out</button>
    </div>
  `);
}

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
        const cnt  = Object.keys(ents).length;
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
                <div class="text-sm text-muted">${cnt} tracked</div>
                <div class="flex gap-6 mt-4" style="justify-content:flex-end">
                  ${errs>0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
                  ${pos>0  ? `<span class="badge badge-success">${pos}✓</span>` : ''}
                </div>
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
  db.collection('rehearsals').doc(id).set(r);
  navigate('rehearsal', { rid: id });
}

// ── View: Roster ──────────────────────────────────────────────────────────────

function instrumentsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.instrument) seen.add(s.instrument); });
  return [...seen].sort();
}

function sectionsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.section) seen.add(s.section); });
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

function studentSuggestions(query, instrumentFilter) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return Object.values(DB.getStudents()).filter(s => {
    if (instrumentFilter && s.instrument !== instrumentFilter) return false;
    return (s.name||'').toLowerCase().includes(q) ||
           String(s.number).includes(q) ||
           (s.section||'').toLowerCase().includes(q);
  }).sort((a,b) => String(a.number).localeCompare(String(b.number),undefined,{numeric:true}))
    .slice(0, 10);
}

function viewRoster() {
  const students = DB.getStudents();
  const list = Object.values(students)
    .sort((a,b) => String(a.number).localeCompare(String(b.number), undefined, {numeric:true}));

  return `
    ${instrumentFilterChips(_rosterInstrumentFilter, 'filterRosterInstrument')}
    <div class="search-wrap">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input class="search-input" type="search" id="roster-search"
             placeholder="Search by name, number, section…"
             value="${esc(_rosterSearch)}"
             oninput="filterRoster(this.value)" autocomplete="off">
    </div>
    ${STATE.isAdmin ? `
    <div style="text-align:right;margin:-4px 0 12px">
      <button class="btn btn-ghost btn-sm" style="color:var(--primary);font-size:0.8rem;padding:4px 0"
              onclick="showImportModal()">
        ↑ Import from CSV
      </button>
    </div>` : ''}
    <div id="roster-list">${rosterRows(list, _rosterSearch, _rosterInstrumentFilter)}</div>
    ${list.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <p>No students yet.</p>
        <p>Tap <strong>+</strong> above to add your first student,<br>or use <strong>Import from CSV</strong>.</p>
      </div>` : ''}
  `;
}

function rosterRows(list, search, instrumentFilter) {
  const q = search.toLowerCase().trim();
  const filtered = list.filter(s => {
    if (instrumentFilter && s.instrument !== instrumentFilter) return false;
    if (!q) return true;
    return String(s.number).includes(q) ||
           (s.instrument||'').toLowerCase().includes(q) ||
           (s.section||'').toLowerCase().includes(q) ||
           (s.name||'').toLowerCase().includes(q);
  });

  if (!filtered.length && q) {
    return `<div class="empty-state" style="padding:24px"><p>No students match "${esc(q)}"</p></div>`;
  }

  return filtered.map(s => {
    const hist = DB.getStudentHistory(s.number);
    const errs = hist.reduce((sum,e)=>sum+(e.entry.mistakes||0),0);
    const pos  = hist.reduce((sum,e)=>sum+(e.entry.positives||0),0);
    const avg  = hist.length ? (errs/hist.length).toFixed(1) : null;
    return `
      <div class="roster-row" onclick="navigate('student',{num:'${esc(s.number)}'})">
        <div class="student-num">#${esc(s.number)}</div>
        <div class="student-info">
          ${s.name ? `<div class="student-name">${esc(s.name)}</div>` : ''}
          <div class="student-detail">${esc([fmtPos(s.column,s.row),s.instrument,s.section].filter(Boolean).join(' · ')) || '<em style="color:var(--text-muted)">No details set</em>'}</div>
        </div>
        <div class="student-badges">
          ${avg !== null ? `<span class="badge badge-danger">${avg}✗</span>` : ''}
          ${pos > 0      ? `<span class="badge badge-success">${pos}✓</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

function filterRoster(val) {
  _rosterSearch = val;
  const list = Object.values(DB.getStudents())
    .sort((a,b) => String(a.number).localeCompare(String(b.number), undefined, {numeric:true}));
  document.getElementById('roster-list').innerHTML = rosterRows(list, val, _rosterInstrumentFilter);
}

function filterRosterInstrument(inst) {
  _rosterInstrumentFilter = inst;
  const main = document.getElementById('main-content');
  if (main) main.innerHTML = viewRoster();
}

function filterTrackerInstrument(rid, inst) {
  _trackerInstrumentFilter = inst;
  _activeNum = null;
  _numSearch = '';
  reRender(rid);
}

// ── View: Student Detail ──────────────────────────────────────────────────────

// ── View: Songs ───────────────────────────────────────────────────────────────

function viewSongs() {
  const songs    = STATE.songs;
  const total    = Object.keys(STATE.students).length;

  return `
    ${songs.length === 0 ? `
      <div class="empty-state" style="padding:48px 24px">
        <div class="empty-icon">🎵</div>
        <p>No songs added yet.</p>
        ${STATE.isAdmin ? `<p>Tap <strong>+</strong> to add a song to memorize.</p>` : ''}
      </div>` : `
      <div style="padding:8px 0">
        ${songs.map(song => {
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
        }).join('')}
      </div>`}
  `;
}

function viewSong(sid) {
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return `<div class="empty-state"><p>Song not found.</p></div>`;

  const students = Object.values(DB.getStudents())
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, {numeric:true}));
  const statuses  = song.statuses || {};
  const getStatus = num => statuses[String(num)]?.status || 'not_attempted';

  const passed  = students.filter(s => getStatus(s.number) === 'passed').length;
  const failed  = students.filter(s => getStatus(s.number) === 'failed').length;
  const notAtt  = students.filter(s => getStatus(s.number) === 'not_attempted').length;
  const sections = sectionsInRoster();

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

      ${sections.length ? instrumentFilterChips(_songSectionFilter, 'filterSongSection', sid) : ''}

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
  const filtered = _songSectionFilter
    ? students.filter(s => s.section === _songSectionFilter)
    : students;

  if (!filtered.length) return `<div class="empty-state" style="padding:24px"><p>No students in this section.</p></div>`;

  return filtered.map(s => {
    const status = getStatus(s.number);
    const meta   = getMeta(s.number);
    return `
      <div class="song-stu-row">
        <div class="song-stu-info">
          <span class="song-stu-num">#${esc(s.number)}</span>
          ${s.name ? `<span class="song-stu-name">${esc(s.name)}</span>` : ''}
          <span class="song-stu-status ${status === 'passed' ? 'sss-pass' : status === 'failed' ? 'sss-fail' : 'sss-na'}">
            ${status === 'passed' ? '✓ Passed' : status === 'failed' ? '✗ Failed' : '— Not Attempted'}
          </span>
          ${meta ? `<span class="song-stu-meta">${esc(meta)}</span>` : ''}
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

function filterSongSection(sid, section) {
  _songSectionFilter = section;
  const song     = STATE.songs.find(s => s.id === sid);
  const students = Object.values(DB.getStudents())
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, {numeric:true}));
  // Re-render the full song view so filter chips update active state
  document.getElementById('main-content').innerHTML = viewSong(sid);
}

function setSongStatus(sid, num, newStatus) {
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return;
  if (!song.statuses) song.statuses = {};

  const curStatus = song.statuses[String(num)]?.status || 'not_attempted';
  // Tapping the active button resets to not_attempted
  const status = curStatus === newStatus ? 'not_attempted' : newStatus;

  if (status === 'not_attempted') {
    delete song.statuses[String(num)];
    db.collection('songs').doc(sid).update({
      [`statuses.${num}`]: firebase.firestore.FieldValue.delete()
    }).catch(() => {
      // Document may not exist yet — use set+merge instead
      db.collection('songs').doc(sid).set({ statuses: song.statuses }, { merge: false });
    });
  } else {
    song.statuses[String(num)] = { status, updatedAt: Date.now(), updatedBy: STATE.user?.email || '' };
    db.collection('songs').doc(sid).set({ statuses: { [String(num)]: song.statuses[String(num)] } }, { merge: true });
  }

  // Targeted update — don't destroy the list
  const listEl = document.getElementById('song-student-list');
  if (listEl) {
    const students = Object.values(DB.getStudents())
      .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, {numeric:true}));
    listEl.innerHTML = songStudentRows(sid, students, song.statuses || {});
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
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSong()">Add Song</button>
    </div>
  `);
  setTimeout(() => document.getElementById('m-song-title')?.focus(), 80);
}

function saveSong() {
  const title   = document.getElementById('m-song-title')?.value.trim();
  const dueDate = document.getElementById('m-song-due')?.value || '';
  if (!title) { showToast('Please enter a song title.'); return; }
  closeModal();
  const ref = db.collection('songs').doc();
  const doc = { title, dueDate, addedBy: STATE.user?.email || '', addedAt: Date.now(), statuses: {} };
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
  const title   = document.getElementById('m-song-title')?.value.trim();
  const dueDate = document.getElementById('m-song-due')?.value || '';
  if (!title) { showToast('Please enter a song title.'); return; }
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return;
  song.title   = title;
  song.dueDate = dueDate;
  db.collection('songs').doc(sid).set({ title, dueDate }, { merge: true });
  closeModal();
  render();
}

function confirmDeleteSong(sid) {
  if (!confirm('Delete this song and all its memorization data?\n\nThis cannot be undone.')) return;
  STATE.songs = STATE.songs.filter(s => s.id !== sid);
  db.collection('songs').doc(sid).delete();
  closeModal();
  navigate('songs');
  showToast('Song deleted.');
}

function viewStudentPortal() {
  const num  = STATE.studentNum;
  const s    = STATE.students[num];
  const hist = DB.getStudentHistory(num);

  const pos        = fmtPos(s?.column, s?.row);
  const metaParts  = [s?.instrument, s?.section, pos ? `Position ${pos}` : ''].filter(Boolean);
  const totalErr   = hist.reduce((sum, {entry: e}) => sum + (e.mistakes  || 0), 0);
  const totalPos   = hist.reduce((sum, {entry: e}) => sum + (e.positives || 0), 0);

  return `
    <div class="portal-view">
      <div class="portal-student-card">
        <div class="portal-avatar">${(s?.name || '#' + num).charAt(0).toUpperCase()}</div>
        <div>
          <div class="portal-name">${esc(s?.name || 'Student #' + num)}</div>
          ${metaParts.length ? `<div class="portal-meta">${metaParts.map(esc).join(' &middot; ')}</div>` : ''}
        </div>
      </div>

      ${hist.length > 0 ? `
        <div class="portal-stats">
          <div class="portal-stat">
            <div class="portal-stat-value">${hist.length}</div>
            <div class="portal-stat-label">Rehearsals</div>
          </div>
          <div class="portal-stat">
            <div class="portal-stat-value portal-stat-mistake">${totalErr}</div>
            <div class="portal-stat-label">Total Marks</div>
          </div>
          <div class="portal-stat">
            <div class="portal-stat-value portal-stat-positive">${totalPos}</div>
            <div class="portal-stat-label">Positives</div>
          </div>
        </div>

        ${STATE.songs.length > 0 ? `
          <div class="section-title">Songs to Memorize</div>
          <div class="portal-songs-list">
            ${STATE.songs.map(song => {
              const status = song.statuses?.[String(num)]?.status || 'not_attempted';
              const overdue = song.dueDate && song.dueDate < today() && status !== 'passed';
              return `
              <div class="portal-song-row">
                <div class="portal-song-info">
                  <div class="portal-song-title">${esc(song.title)}</div>
                  ${song.dueDate ? `<div class="portal-song-due ${overdue ? 'song-overdue' : ''}">Due ${fmtDate(song.dueDate)}</div>` : ''}
                </div>
                <span class="portal-song-status ${status === 'passed' ? 'pss-pass' : status === 'failed' ? 'pss-fail' : 'pss-na'}">
                  ${status === 'passed' ? '✓ Passed' : status === 'failed' ? '✗ Failed' : '— Not Attempted'}
                </span>
              </div>`;
            }).join('')}
          </div>
        ` : ''}

        <div class="section-title">Rehearsal History</div>
        ${hist.map(({rehearsal: r, entry: e}) => {
          const evts     = e.events || [];
          const noteEvts = evts.filter(ev => ev.note?.trim());
          const hasDetail = e.notes || noteEvts.length > 0;
          return `
          <div class="portal-rehearsal-card" id="prc-${esc(r.id)}">
            <div class="portal-rehear-hdr" onclick="togglePortalRehearsal('${esc(r.id)}')">
              <div class="portal-rehear-info">
                <div class="portal-rehear-date">${fmtDate(r.date)}</div>
                ${r.label ? `<div class="portal-rehear-label">${esc(r.label)}</div>` : ''}
              </div>
              <div class="portal-badges">
                ${(e.mistakes  || 0) > 0 ? `<span class="portal-badge portal-badge-mistake">✗ ${e.mistakes}</span>`  : ''}
                ${(e.positives || 0) > 0 ? `<span class="portal-badge portal-badge-positive">✓ ${e.positives}</span>` : ''}
              </div>
              ${hasDetail ? `<span class="portal-chevron">▸</span>` : '<span class="portal-chevron" style="opacity:0">▸</span>'}
            </div>
            <div class="portal-rehearsal-detail">
              ${e.notes ? `<div class="portal-entry-note">${esc(e.notes)}</div>` : ''}
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
      ` : `<p class="empty-state">No rehearsal history yet.</p>`}
    </div>`;
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

function viewStudent(num) {
  const s = DB.getStudents()[num];
  if (!s) return `<div class="empty-state"><p>Student not found.</p></div>`;

  const hist = DB.getStudentHistory(num);
  const errs = hist.reduce((sum,e)=>sum+(e.entry.mistakes||0),0);
  const pos  = hist.reduce((sum,e)=>sum+(e.entry.positives||0),0);
  const avgE = hist.length ? (errs/hist.length).toFixed(1) : '—';
  const avgP = hist.length ? (pos/hist.length).toFixed(1)  : '—';

  return `
    <div class="card mb-12" style="text-align:center">
      <div style="font-size:2.6rem;font-weight:800;color:var(--primary);line-height:1;margin-bottom:6px">#${esc(s.number)}</div>
      ${s.name ? `<div style="font-size:1.1rem;font-weight:600;margin-bottom:8px">${esc(s.name)}</div>` : ''}
      <div class="flex gap-6" style="justify-content:center;flex-wrap:wrap">
        ${fmtPos(s.column,s.row) ? `<span class="badge badge-primary" style="font-size:0.85rem;font-weight:800">${esc(fmtPos(s.column,s.row))}</span>` : ''}
        ${s.instrument ? `<span class="badge badge-primary">${esc(s.instrument)}</span>` : ''}
        ${s.section    ? `<span class="badge badge-neutral">${esc(s.section)}</span>` : ''}
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-block">
        <div class="stat-value">${hist.length}</div>
        <div class="stat-label">Rehearsals</div>
      </div>
      <div class="stat-block">
        <div class="stat-value" style="color:var(--danger)">${avgE}</div>
        <div class="stat-label">Avg Mistakes</div>
      </div>
      <div class="stat-block">
        <div class="stat-value" style="color:var(--success)">${avgP}</div>
        <div class="stat-label">Avg Positives</div>
      </div>
    </div>

    ${s.notes ? `
      <div class="card mb-12">
        <div class="section-title" style="margin-top:0">Director Notes</div>
        <div style="font-size:0.9rem;white-space:pre-wrap;color:var(--text-muted)">${esc(s.notes)}</div>
      </div>` : ''}

    ${hist.length ? `
      <div class="section-title">Rehearsal History</div>
      ${hist.map(({rehearsal:r, entry:e}) => {
        const evts = e.events || [];
        const mn = evts.filter(ev=>ev.type==='mistake' &&ev.note.trim()).map(ev=>(ev.sectionMark?`<span class="section-mark-badge">§ ${esc(ev.section||'Section')}</span> `:'')+(ev.segment?`<span class="event-seg">${esc(ev.segment)}</span> `:'') +esc(ev.note)+(ev.by&&ev.by!=='system'?` <em style="opacity:.6">(${esc(dirLabel(ev.by))})</em>`:''));
        const pn = evts.filter(ev=>ev.type==='positive'&&ev.note.trim()).map(ev=>(ev.sectionMark?`<span class="section-mark-badge">§ ${esc(ev.section||'Section')}</span> `:'')+(ev.segment?`<span class="event-seg">${esc(ev.segment)}</span> `:'') +esc(ev.note)+(ev.by&&ev.by!=='system'?` <em style="opacity:.6">(${esc(dirLabel(ev.by))})</em>`:''));
        return `
        <div class="history-row ${e.mistakes>0?'had-mistakes':''} ${e.positives>0&&!e.mistakes?'had-positives':''}"
             onclick="navigate('rehearsal',{rid:'${esc(r.id)}'})">
          <div class="history-info">
            <div class="history-date">${fmtDate(r.date)}</div>
            ${r.label ? `<div class="history-label">${esc(r.label)}</div>` : ''}
            ${e.notes  ? `<div class="history-note">${esc(e.notes)}</div>` : ''}
            ${mn.length ? `<div class="history-note" style="color:var(--danger)">✗ ${mn.join(' &middot; ')}</div>` : ''}
            ${pn.length ? `<div class="history-note" style="color:var(--success)">✓ ${pn.join(' &middot; ')}</div>` : ''}
          </div>
          <div class="flex gap-6">
            ${e.mistakes  > 0 ? `<span class="badge badge-danger">${e.mistakes}✗</span>`  : '<span class="badge badge-neutral">0✗</span>'}
            ${e.positives > 0 ? `<span class="badge badge-success">${e.positives}✓</span>` : '<span class="badge badge-neutral">0✓</span>'}
          </div>
        </div>`;
      }).join('')}
    ` : `
      <div class="empty-state" style="padding:24px">
        <p>No rehearsal data recorded yet.</p>
      </div>`}
  `;
}

// ── View: Rehearsals List ─────────────────────────────────────────────────────

function viewRehearsals() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b)=>b.date.localeCompare(a.date));
  if (!rehearsals.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>No rehearsals yet.</p>
        <p>Tap <strong>+</strong> above or use the Home tab.</p>
      </div>`;
  }

  const grouped = {};
  for (const r of rehearsals) {
    const key = r.date.slice(0,7);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  return Object.entries(grouped).map(([key, group]) => {
    const [y, m] = key.split('-').map(Number);
    return `
      <div class="section-title">${MONTHS[m-1]} ${y}</div>
      ${group.map(r => {
        const ents = DB.getRehearsalEntries(r.id);
        const cnt  = Object.keys(ents).length;
        const errs = Object.values(ents).reduce((s,e)=>s+(e.mistakes||0),0);
        const pos  = Object.values(ents).reduce((s,e)=>s+(e.positives||0),0);
        return `
          <div class="card clickable" onclick="navigate('rehearsal',{rid:'${esc(r.id)}'})">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-bold">${fmtDate(r.date)}</div>
                ${r.label ? `<div class="text-muted text-sm mt-4">${esc(r.label)}</div>` : ''}
              </div>
              <div class="flex gap-6 items-center">
                <span class="badge badge-neutral">${cnt} tracked</span>
                ${errs>0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
                ${pos>0  ? `<span class="badge badge-success">${pos}✓</span>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')}`;
  }).join('');
}

// ── View: Rehearsal Detail ────────────────────────────────────────────────────

function viewRehearsal(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return `<div class="empty-state"><p>Rehearsal not found.</p></div>`;

  const entries    = DB.getRehearsalEntries(rid);
  const students   = DB.getStudents();
  const activeEntry = _activeNum
    ? (entries[_activeNum] || { mistakes:0, positives:0, notes:'', events:[] })
    : null;
  const allEvts   = activeEntry?.events || [];
  const activeStu = _activeNum ? students[_activeNum] : null;

  const entryList = Object.entries(entries)
    .sort(([a],[b]) => String(a).localeCompare(String(b), undefined, {numeric:true}));

  // Active student card — shared across block and normal modes
  const activeCard = _activeNum ? `
    <div class="active-card">
      <div class="active-card-name">
        #${esc(_activeNum)}
        ${activeStu
          ? `<span class="sub">${esc([fmtPos(activeStu.column,activeStu.row),activeStu.instrument,activeStu.name].filter(Boolean).join(' · '))}</span>`
          : '<span class="sub" style="color:var(--warning)"> Not in roster</span>'}
      </div>

      <div class="active-counters">
        <div class="counter-col">
          <div class="counter-col-label mistakes">Mistakes</div>
          <div class="counter-value mistakes">${activeEntry.mistakes}</div>
          <button class="count-btn add-mistake"
            onclick="adjustCount('${esc(rid)}','${esc(_activeNum)}','mistakes',1)">
            +1 Mistake
          </button>
          ${activeEntry.mistakes > 0 ? `
            <button class="count-btn undo"
              onclick="adjustCount('${esc(rid)}','${esc(_activeNum)}','mistakes',-1)">
              Undo −1
            </button>` : ''}
        </div>
        <div class="counter-col">
          <div class="counter-col-label positives">Positives</div>
          <div class="counter-value positives">${activeEntry.positives}</div>
          <button class="count-btn add-positive"
            onclick="adjustCount('${esc(rid)}','${esc(_activeNum)}','positives',1)">
            +1 Positive
          </button>
          ${activeEntry.positives > 0 ? `
            <button class="count-btn undo"
              onclick="adjustCount('${esc(rid)}','${esc(_activeNum)}','positives',-1)">
              Undo −1
            </button>` : ''}
        </div>
      </div>

      ${allEvts.length > 0 ? `
        <div class="event-notes-section">
          <div class="event-notes-hdr">Notes per mark</div>
          ${allEvts.map((e,i) => {
            const canDelete = STATE.isAdmin || !e.by || e.by === STATE.user?.email;
            return `
            <div class="event-note-row ${e.sectionMark ? 'is-section-mark' : ''}">
              <span class="event-note-type ${e.type==='mistake'?'is-mistake':'is-positive'}">${e.type==='mistake'?'✗':'✓'}</span>
              ${e.sectionMark ? `<span class="section-mark-badge">§ ${esc(e.section||'Section')}</span>` : ''}
              ${e.segment ? `<span class="event-seg">${esc(e.segment)}</span>` : ''}
              <input type="text" class="event-note-inp"
                     placeholder="what happened…"
                     value="${esc(e.note)}"
                     oninput="saveEventNote('${esc(rid)}','${esc(_activeNum)}',${i},this.value)">
              ${e.ts ? `<span class="event-note-time">${fmtTime(e.ts)}</span>` : ''}
              ${e.by ? `<span class="event-note-by">${esc(dirLabel(e.by))}</span>` : ''}
              ${canDelete ? `<button class="event-note-del" onclick="deleteEvent('${esc(rid)}','${esc(_activeNum)}',${i})" aria-label="Delete mark">×</button>` : ''}
            </div>`;
          }).join('')}
        </div>` : ''}

      <textarea class="active-notes" placeholder="General note for today…"
        oninput="saveNote('${esc(rid)}','${esc(_activeNum)}',this.value)">${esc(activeEntry.notes)}</textarea>

      ${!activeStu && STATE.isAdmin ? `
        <button class="btn btn-secondary btn-sm btn-full mt-8"
          onclick="showAddStudentModal('${esc(_activeNum)}')">
          + Add #${esc(_activeNum)} to Roster
        </button>` : ''}

      <button class="next-btn" onclick="clearActive()">
        ${_blockMode ? '← Back to Block Grid' : 'Next Student →'}
      </button>
    </div>` : '';

  // Tracker section — changes based on block mode
  let trackerSection;
  if (_blockMode && !_activeNum) {
    trackerSection = renderBlockNav(rid);
  } else if (_blockMode && _activeNum) {
    trackerSection = `
      <div class="tracker-card">
        <div class="block-active-hdr">
          <span class="block-active-label">Selected from Block Grid</span>
          <button class="block-ctrl-btn" onclick="clearActive()">← Grid</button>
        </div>
        ${activeCard}
      </div>`;
  } else {
    const isNameSearch = _numSearch.trim() && !/^\d+$/.test(_numSearch.trim());
    const suggestions  = isNameSearch ? studentSuggestions(_numSearch, _trackerInstrumentFilter) : [];
    // When instrument filter is active with no text typed, list that section's students
    const showAllForFilter = _trackerInstrumentFilter && !_numSearch.trim();
    const allFiltered = showAllForFilter
      ? Object.values(students)
          .filter(s => s.instrument === _trackerInstrumentFilter)
          .sort((a,b) => String(a.number).localeCompare(String(b.number),undefined,{numeric:true}))
      : [];

    trackerSection = `
      <div class="tracker-card">
        <div class="tracker-label">Track a Student</div>
        ${instrumentFilterChips(_trackerInstrumentFilter, 'filterTrackerInstrument', rid)}
        <input class="num-input" type="text" inputmode="text"
               id="num-input" placeholder="Student # or name…"
               value="${esc(_numSearch)}"
               autocomplete="off" autocorrect="off" autocapitalize="off"
               oninput="onNumInput(this.value,'${esc(rid)}')"
               onkeydown="onNumKey(event,'${esc(rid)}')">
        <div id="tracker-suggestions" class="student-suggestions">
          ${isNameSearch ? suggestions.map(s => `
            <div class="suggestion-row" onclick="pickStudent('${esc(s.number)}','${esc(rid)}')">
              <span class="suggestion-num">#${esc(s.number)}</span>
              <span class="suggestion-name">${esc(s.name || '—')}</span>
              <span class="suggestion-detail">${esc([fmtPos(s.column,s.row),s.instrument].filter(Boolean).join(' · '))}</span>
            </div>`).join('') : ''}
          ${showAllForFilter && !_activeNum ? allFiltered.map(s => `
            <div class="suggestion-row" onclick="pickStudent('${esc(s.number)}','${esc(rid)}')">
              <span class="suggestion-num">#${esc(s.number)}</span>
              <span class="suggestion-name">${esc(s.name || '—')}</span>
              <span class="suggestion-detail">${esc(fmtPos(s.column,s.row))}</span>
            </div>`).join('') : ''}
        </div>
        ${activeCard}
        ${!_activeNum ? `
          <button class="block-toggle-btn" onclick="toggleBlockMode('${esc(rid)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            Open Block Grid
          </button>` : ''}
      </div>`;
  }

  return `
    ${trackerSection}

    ${(() => {
      const sections = sectionsInRoster();
      if (!sections.length) return '';
      return `
      <div class="section-marks-card">
        <div class="section-marks-hdr">Mark a Section</div>
        ${sections.map(sec => `
          <div class="section-mark-row">
            <span class="section-mark-name">${esc(sec)}</span>
            <button class="sm-btn sm-positive" onclick="showSectionMarkModal('${esc(rid)}','${esc(sec)}','positive')">✓ Positive</button>
            <button class="sm-btn sm-mistake"  onclick="showSectionMarkModal('${esc(rid)}','${esc(sec)}','mistake')">✗ Mark</button>
          </div>`).join('')}
      </div>`;
    })()}

    ${entryList.length ? `
      <div class="section-title">Tracked This Rehearsal (${entryList.length})</div>
      ${entryList.map(([num, entry]) => {
        const stu = students[num];
        return `
          <div class="entry-row ${_activeNum===num?'is-active':''}"
               onclick="pickStudent('${esc(num)}','${esc(rid)}')">
            <div class="entry-header">
              <div class="entry-student">
                #${esc(num)}
                ${stu ? `<span class="sub">${esc([fmtPos(stu.column,stu.row),stu.instrument,stu.name].filter(Boolean).join(' · '))}</span>` : '<span class="sub" style="color:var(--warning)">Not in roster</span>'}
              </div>
              <div class="entry-badges">
                <span class="badge ${entry.mistakes>0?'badge-danger':'badge-neutral'}">${entry.mistakes}✗</span>
                <span class="badge ${entry.positives>0?'badge-success':'badge-neutral'}">${entry.positives}✓</span>
              </div>
            </div>
            ${entry.notes ? `<div class="entry-notes">${esc(entry.notes)}</div>` : ''}
          </div>`;
      }).join('')}
    ` : `
      <div class="empty-state" style="padding:24px">
        <p>No students tracked yet.</p>
        <p>Enter a student number above to begin.</p>
      </div>`}

    ${r.ended ? `
      <div class="ended-banner">
        ✓ Rehearsal ended — automatic positive marks have been applied
      </div>` : ''}
  `;
}

function onNumInput(val, rid) {
  _numSearch = val;
  const trimmed = val.trim();
  if (!trimmed) {
    _activeNum = null;
    reRender(rid);
  } else if (/^\d+$/.test(trimmed)) {
    // Pure number: direct select — full re-render to show/update student card
    _activeNum = trimmed;
    reRender(rid);
  } else {
    // Name search: update only the suggestions list so the input keeps focus
    _activeNum = null;
    const el = document.getElementById('tracker-suggestions');
    if (el) {
      const matches = studentSuggestions(trimmed, _trackerInstrumentFilter);
      el.innerHTML = matches.map(s => `
        <div class="suggestion-row" onclick="pickStudent('${esc(s.number)}','${esc(rid)}')">
          <span class="suggestion-num">#${esc(s.number)}</span>
          <span class="suggestion-name">${esc(s.name || '—')}</span>
          <span class="suggestion-detail">${esc([fmtPos(s.column,s.row),s.instrument].filter(Boolean).join(' · '))}</span>
        </div>`).join('');
    } else {
      reRender(rid); // fallback if container not found
    }
  }
}

function onNumKey(e, rid) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const num = _numSearch.trim();
    if (num) {
      _activeNum = num;
      reRender(rid);
    }
  }
}

function pickStudent(num, rid) {
  _activeNum = num;
  _numSearch = num;
  document.getElementById('main-content').scrollTop = 0;
  reRender(rid);
}

function clearActive() {
  _activeNum = null;
  _numSearch = '';
  if (!_blockMode) {
    const inp = document.getElementById('num-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }
  reRender(_params.rid);
}

function adjustCount(rid, num, field, delta) {
  if (delta > 0) {
    showMarkModal(rid, num, field === 'mistakes' ? 'mistake' : 'positive');
    return;
  }
  // Undo — instant, no modal
  const ents    = DB.getRehearsalEntries(rid);
  const cur     = ents[num] || { mistakes:0, positives:0, notes:'', events:[] };
  const newVal  = Math.max(0, (cur[field]||0) - 1);
  if (newVal === (cur[field]||0)) return;
  const events  = [...(cur.events || [])];
  const evtType = field === 'mistakes' ? 'mistake' : 'positive';
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === evtType) { events.splice(i, 1); break; }
  }
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  STATE.entries[rid][num] = { ...cur, [field]: newVal, events };
  fsUpsertEntry(rid, num, { mistakes: STATE.entries[rid][num].mistakes, positives: STATE.entries[rid][num].positives, notes: STATE.entries[rid][num].notes || '', events });
  reRender(rid);
}

function showMarkModal(rid, num, type) {
  const isMistake = type === 'mistake';
  const presets   = isMistake ? MISTAKE_PRESETS : POSITIVE_PRESETS;
  const btnCls    = isMistake ? 'is-mistake' : 'is-positive';
  const r         = DB.getRehearsals().find(r => r.id === rid);
  const segments  = r?.segments || [];

  const segHtml = segments.length ? `
    <div class="form-label" style="margin-bottom:7px">Which part of rehearsal?</div>
    <div class="seg-chip-row">
      ${segments.map(s => `
        <button class="seg-chip${_pendingSegment === s ? ' seg-selected' : ''}"
                data-seg="${esc(s)}"
                onclick="selectSegment('${esc(s)}')">
          ${esc(s)}
        </button>`).join('')}
    </div>
    <div class="form-label" style="margin:14px 0 7px">${isMistake ? 'What was the mistake?' : 'What went well?'}</div>
  ` : '';

  openModal(`
    <div class="modal-title">${isMistake ? '✗ Log Mistake' : '✓ Log Positive'}</div>
    ${segHtml}
    <div class="quick-note-grid">
      ${presets.map(p => `
        <button class="quick-note-btn ${btnCls}"
          onclick="confirmMark('${esc(rid)}','${esc(num)}','${esc(type)}','${esc(p)}')">
          ${esc(p)}
        </button>`).join('')}
    </div>
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">Custom note</label>
      <input class="form-input" id="mark-note-input" type="text"
             placeholder="or type your own…" autocomplete="off"
             onkeydown="if(event.key==='Enter')confirmMarkCustom('${esc(rid)}','${esc(num)}','${esc(type)}')">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="confirmMark('${esc(rid)}','${esc(num)}','${esc(type)}','')">No Note</button>
      <button class="btn btn-primary" onclick="confirmMarkCustom('${esc(rid)}','${esc(num)}','${esc(type)}')">Add Custom</button>
    </div>
  `);
  setTimeout(() => document.getElementById('mark-note-input')?.focus(), 80);
}

function confirmMark(rid, num, type, note) {
  const segment = _pendingSegment;
  closeModal();
  const field  = type === 'mistake' ? 'mistakes' : 'positives';
  const ents   = DB.getRehearsalEntries(rid);
  const cur    = ents[num] || { mistakes:0, positives:0, notes:'', events:[] };
  const newVal = (cur[field]||0) + 1;
  const events = [...(cur.events || [])];
  events.push({ type, note: note || '', segment, ts: Date.now(), by: STATE.user?.email || '' });
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  STATE.entries[rid][num] = { ...cur, [field]: newVal, events };
  fsUpsertEntry(rid, num, { mistakes: STATE.entries[rid][num].mistakes, positives: STATE.entries[rid][num].positives, notes: STATE.entries[rid][num].notes || '', events });
  reRender(rid);
}

function confirmMarkCustom(rid, num, type) {
  const note = document.getElementById('mark-note-input')?.value.trim() || '';
  confirmMark(rid, num, type, note);
}

// ── Section Marks ──────────────────────────────────────────────────────────────

function showSectionMarkModal(rid, sectionName, type) {
  const isMistake = type === 'mistake';
  const presets   = isMistake ? MISTAKE_PRESETS : POSITIVE_PRESETS;
  const btnCls    = isMistake ? 'is-mistake' : 'is-positive';
  const r         = DB.getRehearsals().find(r => r.id === rid);
  const segments  = r?.segments || [];
  const students  = Object.values(DB.getStudents()).filter(s => s.section === sectionName);

  const segHtml = segments.length ? `
    <div class="form-label" style="margin-bottom:7px">Which part of rehearsal?</div>
    <div class="seg-chip-row">
      ${segments.map(s => `
        <button class="seg-chip${_pendingSegment === s ? ' seg-selected' : ''}"
                data-seg="${esc(s)}"
                onclick="selectSegment('${esc(s)}')">
          ${esc(s)}
        </button>`).join('')}
    </div>
    <div class="form-label" style="margin:14px 0 7px">${isMistake ? 'What was the mistake?' : 'What went well?'}</div>
  ` : '';

  openModal(`
    <div class="modal-title">${isMistake ? '✗' : '✓'} ${esc(sectionName)} Section
      <div style="font-size:0.78rem;font-weight:400;color:var(--text-muted);margin-top:2px">${students.length} student${students.length!==1?'s':''}</div>
    </div>
    ${segHtml}
    <div class="quick-note-grid">
      ${presets.map(p => `
        <button class="quick-note-btn ${btnCls}"
          onclick="confirmSectionMark('${esc(rid)}','${esc(sectionName)}','${esc(type)}','${esc(p)}')">
          ${esc(p)}
        </button>`).join('')}
    </div>
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">Custom note</label>
      <input class="form-input" id="mark-note-input" type="text"
             placeholder="or type your own…" autocomplete="off"
             onkeydown="if(event.key==='Enter')confirmSectionMarkCustom('${esc(rid)}','${esc(sectionName)}','${esc(type)}')">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="confirmSectionMark('${esc(rid)}','${esc(sectionName)}','${esc(type)}','')">No Note</button>
      <button class="btn btn-primary" onclick="confirmSectionMarkCustom('${esc(rid)}','${esc(sectionName)}','${esc(type)}')">Add Custom</button>
    </div>
  `);
  setTimeout(() => document.getElementById('mark-note-input')?.focus(), 80);
}

function confirmSectionMarkCustom(rid, sectionName, type) {
  const note = document.getElementById('mark-note-input')?.value.trim() || '';
  confirmSectionMark(rid, sectionName, type, note);
}

async function confirmSectionMark(rid, sectionName, type, note) {
  const segment = _pendingSegment;
  closeModal();
  const stuList = Object.values(STATE.students).filter(s => s.section === sectionName);
  if (!stuList.length) { showToast('No students found in that section.'); return; }
  const field   = type === 'mistake' ? 'mistakes' : 'positives';
  const batch   = db.batch();
  const evt     = { type, note: note || '', segment, ts: Date.now(), by: STATE.user?.email || '', sectionMark: true, section: sectionName };

  for (const stu of stuList) {
    const num   = String(stu.number || stu._id);
    const cur   = STATE.entries[rid]?.[num] || { mistakes: 0, positives: 0, notes: '', events: [] };
    const events = [...(cur.events || []), evt];
    const newVal = (cur[field] || 0) + 1;
    if (!STATE.entries[rid]) STATE.entries[rid] = {};
    STATE.entries[rid][num] = { ...cur, [field]: newVal, events };
    batch.set(db.collection('entries').doc(`${rid}_${num}`), {
      rehearsalId: rid, studentNumber: num,
      mistakes: STATE.entries[rid][num].mistakes,
      positives: STATE.entries[rid][num].positives,
      notes: cur.notes || '', events,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: STATE.user?.email || ''
    });
  }

  await batch.commit();
  showToast(`${type === 'positive' ? 'Positive' : 'Mark'} applied to ${stuList.length} ${sectionName} student${stuList.length!==1?'s':''}.`);
  reRender(rid);
}

function saveNote(rid, num, notes) {
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  const cur = STATE.entries[rid][num] || { mistakes:0, positives:0, notes:'', events:[] };
  STATE.entries[rid][num] = { ...cur, notes };
  debounced(`note_${rid}_${num}`, () => fsUpsertEntry(rid, num, { notes }));
}

function saveEventNote(rid, num, idx, note) {
  if (!STATE.entries[rid]?.[num]) return;
  const events = [...(STATE.entries[rid][num].events || [])];
  if (!events[idx]) return;
  events[idx] = { ...events[idx], note };
  STATE.entries[rid][num] = { ...STATE.entries[rid][num], events };
  debounced(`evtnote_${rid}_${num}_${idx}`, () => fsUpsertEntry(rid, num, { events }));
}

function deleteEvent(rid, num, idx) {
  const cur = STATE.entries[rid]?.[num];
  if (!cur) return;
  const evt = (cur.events || [])[idx];
  if (!evt) return;
  // Enforce ownership — non-admins can only delete their own marks
  if (!STATE.isAdmin && evt.by && evt.by !== STATE.user?.email) return;
  const events   = (cur.events || []).filter((_, i) => i !== idx);
  const mistakes  = events.filter(e => e.type === 'mistake').length;
  const positives = events.filter(e => e.type === 'positive').length;
  STATE.entries[rid][num] = { ...cur, events, mistakes, positives };
  fsUpsertEntry(rid, num, { events, mistakes, positives, notes: cur.notes || '' });
  reRender(rid);
}

// ── Block Navigator ───────────────────────────────────────────────────────────

function findStudentAtPos(col, row, students) {
  for (const [num, s] of Object.entries(students)) {
    if (s.column === col && String(s.row) === String(row)) return num;
  }
  return null;
}

function toggleBlockMode(rid) {
  _blockMode = !_blockMode;
  _blockPath = [];
  if (_blockMode) { _activeNum = null; _numSearch = ''; }
  reRender(rid);
}

function blockDrillIn(rid, c0, c1, r0, r1) {
  _blockPath.push({ c0, c1, r0, r1 });
  reRender(rid);
}

function blockZoomOut(rid) {
  if (_blockPath.length > 0) { _blockPath.pop(); reRender(rid); }
}

function blockSelect(num, rid) {
  pickStudent(String(num), rid);
}

function blockSelectEmpty(pos) {
  showToast(`No student assigned to ${pos}`);
}

function initBlockPinch(rid) {
  const el = document.getElementById('block-nav');
  if (!el || _blockPath.length === 0) return;
  let startDist = 0, armed = false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length >= 2) {
      armed = true;
      startDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!armed || e.touches.length < 2) return;
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (d < startDist * 0.65) { armed = false; blockZoomOut(rid); }
  }, { passive: true });
  el.addEventListener('touchend', () => { armed = false; }, { passive: true });
}

function blockMiniGrid(rid, c0, c1, r0, r1) {
  const entries  = DB.getRehearsalEntries(rid);
  const students = DB.getStudents();
  const cols = c1 - c0 + 1;
  let dots = '';
  for (let r = r1; r >= r0; r--) {
    for (let c = c1; c >= c0; c--) {
      const num   = findStudentAtPos(COLUMNS[c], String(r), students);
      const entry = num ? entries[num] : null;
      const cls   = !num ? 'bd-empty'
        : (entry?.mistakes  > 0 ? 'bd-mistake'
        : (entry?.positives > 0 ? 'bd-positive' : 'bd-filled'));
      dots += `<span class="bd-dot ${cls}"></span>`;
    }
  }
  return `<div class="bd-mini" style="--bd-cols:${cols}">${dots}</div>`;
}

function renderBlockNav(rid) {
  const level = _blockPath.length;
  let c0 = 0, c1 = 11, r0 = 1, r1 = 12;
  if (level > 0) ({ c0, c1, r0, r1 } = _blockPath[level - 1]);
  const colCount = c1 - c0 + 1;
  const rowCount = r1 - r0 + 1;

  const crumb = level === 0 ? 'Full Block'
    : `${COLUMNS[c0]}–${COLUMNS[c1]} · Rows ${r0}–${r1}`;

  let gridHtml = '', gridCols = 2;

  if (level < 2) {
    const midC = c0 + Math.floor(colCount / 2) - 1;
    const midR = r0 + Math.floor(rowCount / 2) - 1;
    const regions = [
      [midC+1, c1,  midR+1, r1  ],
      [c0,    midC, midR+1, r1  ],
      [midC+1, c1,  r0,     midR],
      [c0,    midC, r0,     midR],
    ];
    gridHtml = regions.map(([rc0,rc1,rr0,rr1]) => `
      <div class="block-region" onclick="blockDrillIn('${esc(rid)}',${rc0},${rc1},${rr0},${rr1})">
        ${blockMiniGrid(rid, rc0, rc1, rr0, rr1)}
        <div class="block-region-label">${COLUMNS[rc0]}–${COLUMNS[rc1]}<br><span>Rows ${rr0}–${rr1}</span></div>
      </div>`).join('');
  } else {
    const entries  = DB.getRehearsalEntries(rid);
    const students = DB.getStudents();
    gridCols = colCount;
    for (let r = r1; r >= r0; r--) {
      for (let c = c1; c >= c0; c--) {
        const col  = COLUMNS[c];
        const pos  = `${col}${r}`;
        const num  = findStudentAtPos(col, String(r), students);
        const entry = num ? (entries[num] || null) : null;
        const cls  = !num ? 'bc-empty'
          : (entry?.mistakes  > 0 ? 'bc-mistake'
          : (entry?.positives > 0 ? 'bc-positive' : 'bc-assigned'));
        const fn   = num
          ? `blockSelect('${esc(num)}','${esc(rid)}')`
          : `blockSelectEmpty('${esc(pos)}')`;
        gridHtml += `
          <div class="block-cell ${cls}" onclick="${fn}">
            <div class="bc-pos">${esc(pos)}</div>
            ${num ? `<div class="bc-num">#${esc(num)}</div>` : ''}
            ${(entry?.mistakes||0)+(entry?.positives||0) > 0 ? `
              <div class="bc-marks">
                ${entry.mistakes  > 0 ? `<span class="bc-m">${entry.mistakes}✗</span>`  : ''}
                ${entry.positives > 0 ? `<span class="bc-p">${entry.positives}✓</span>` : ''}
              </div>` : ''}
          </div>`;
      }
    }
  }

  return `
    <div class="block-nav" id="block-nav">
      <div class="block-nav-hdr">
        <div class="block-crumb">${esc(crumb)}</div>
        <div style="display:flex;gap:6px;align-items:center">
          ${level > 0 ? `<button class="block-ctrl-btn" onclick="blockZoomOut('${esc(rid)}')">← Back</button>` : ''}
          <button class="block-ctrl-btn" onclick="toggleBlockMode('${esc(rid)}')">✕ Close</button>
        </div>
      </div>
      <div class="block-grid" style="grid-template-columns:repeat(${gridCols},1fr)">
        ${gridHtml}
      </div>
      <div class="block-footer">
        <span>Col ${COLUMNS[c1 > 11 ? 11 : c1]}</span>
        <span>↑ Back &nbsp;·&nbsp; Front ↓</span>
        <span>Col ${COLUMNS[c0]}</span>
      </div>
    </div>`;
}

function reRender(rid) {
  const mc = document.getElementById('main-content');
  const st = mc.scrollTop;
  mc.innerHTML = viewRehearsal(rid);
  mc.scrollTop = st;
  if (_blockMode && !_activeNum) initBlockPinch(rid);
}

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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Column (A–L)</label>
        <select class="form-select" id="m-column">
          <option value="">—</option>
          ${COLUMNS.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Row (1–12)</label>
        <select class="form-select" id="m-row">
          <option value="">—</option>
          ${ROWS.map(r=>`<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Instrument</label>
      <select class="form-select" id="m-instrument">
        <option value="">— Select instrument —</option>
        ${INSTRUMENTS.map(i=>`<option value="${esc(i)}">${esc(i)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Section</label>
      <select class="form-select" id="m-section">
        <option value="">— Select section —</option>
        ${SECTIONS.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Director Notes (optional)</label>
      <textarea class="form-textarea" id="m-notes" placeholder="Any notes about this student…"></textarea>
    </div>
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
    number:     num,
    name:       document.getElementById('m-name').value.trim(),
    column:     document.getElementById('m-column').value,
    row:        document.getElementById('m-row').value,
    instrument: document.getElementById('m-instrument').value,
    section:    document.getElementById('m-section').value,
    notes:      document.getElementById('m-notes').value.trim(),
    songs:      []
  };

  STATE.students[num] = student;
  db.collection('students').doc(num).set(student);
  closeModal();
  showToast(`Student #${num} added`);
  if (_view === 'roster' || _view === 'student') render();
  else navigate('roster');
}

function showEditStudentModal(num) {
  if (!STATE.isAdmin) return;
  const s = DB.getStudents()[num];
  if (!s) return;
  openModal(`
    <div class="modal-title">Edit Student #${esc(s.number)}</div>
    <div class="form-group">
      <label class="form-label">Name (optional)</label>
      <input class="form-input" id="m-name" type="text" value="${esc(s.name||'')}" autocomplete="off">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Column (A–L)</label>
        <select class="form-select" id="m-column">
          <option value="">—</option>
          ${COLUMNS.map(c=>`<option value="${c}" ${s.column===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Row (1–12)</label>
        <select class="form-select" id="m-row">
          <option value="">—</option>
          ${ROWS.map(r=>`<option value="${r}" ${String(s.row)===String(r)?'selected':''}>${r}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Instrument</label>
      <select class="form-select" id="m-instrument">
        <option value="">— Select instrument —</option>
        ${INSTRUMENTS.map(i=>`<option value="${esc(i)}" ${s.instrument===i?'selected':''}>${esc(i)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Section</label>
      <select class="form-select" id="m-section">
        <option value="">— Select section —</option>
        ${SECTIONS.map(sec=>`<option value="${esc(sec)}" ${s.section===sec?'selected':''}>${esc(sec)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Director Notes</label>
      <textarea class="form-textarea" id="m-notes">${esc(s.notes||'')}</textarea>
    </div>
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
        Delete Student #${esc(num)}
      </button>
    </div>
  `);
}

function saveEditStudent(num) {
  if (!STATE.students[num]) return;
  const patch = {
    name:         document.getElementById('m-name').value.trim(),
    column:       document.getElementById('m-column').value,
    row:          document.getElementById('m-row').value,
    instrument:   document.getElementById('m-instrument').value,
    section:      document.getElementById('m-section').value,
    notes:        document.getElementById('m-notes').value.trim(),
    studentCode:  document.getElementById('m-student-code').value.trim().toUpperCase(),
    studentEmail: document.getElementById('m-student-email').value.trim().toLowerCase(),
  };
  STATE.students[num] = { ...STATE.students[num], ...patch };
  db.collection('students').doc(num).set(patch, { merge: true });
  closeModal();
  showToast('Student updated');
  render();
}

function confirmDeleteStudent(num) {
  if (!confirm(`Delete student #${num} and all their rehearsal data?\n\nThis cannot be undone.`)) return;
  delete STATE.students[num];
  db.collection('students').doc(num).delete();
  // Delete all entries for this student
  db.collection('entries').where('studentNumber', '==', String(num)).get().then(snap => {
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    batch.commit();
  });
  closeModal();
  showToast(`Student #${num} deleted`);
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
  STATE.rehearsals.unshift(r);
  STATE.rehearsals.sort((a,b) => b.date.localeCompare(a.date));
  db.collection('rehearsals').doc(id).set(r);
  closeModal();
  _activeNum = null;
  _numSearch = '';
  navigate('rehearsal', { rid: id });
}

function showRehearsalOptions(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  const segments = r.segments || [];
  openModal(`
    <div class="modal-title">Rehearsal Options</div>
    <div class="form-group">
      <label class="form-label">Date</label>
      <input class="form-input" id="m-date" type="date" value="${esc(r.date)}">
    </div>
    <div class="form-group">
      <label class="form-label">Label (optional)</label>
      <input class="form-input" id="m-label" type="text" value="${esc(r.label||'')}"
             placeholder="e.g. Evening, Full Band…" autocomplete="off">
    </div>
    <div class="modal-actions" style="margin-bottom:0">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRehearsalEdit('${esc(rid)}')">Save</button>
    </div>

    <div class="section-title" style="margin-top:24px">Rehearsal Plan</div>
    <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px">
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
      <div class="flex gap-8">
        <input class="form-input" id="seg-input" type="text"
               placeholder="e.g. Warmup, Closer drill…" autocomplete="off"
               onkeydown="if(event.key==='Enter')addSegment('${esc(rid)}')">
        <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="addSegment('${esc(rid)}')">+ Add</button>
      </div>` : ''}

    ${STATE.isAdmin ? `
    <div class="section-title" style="margin-top:24px">End Rehearsal</div>
    ${r.ended ? `
      <div class="ended-status-badge">✓ Rehearsal has been ended</div>
      <p style="font-size:0.82rem;color:var(--text-muted);margin:8px 0 12px">
        Automatic positive marks were applied to students with no mistakes.
        You can still edit marks, or reopen the rehearsal to run the process again.
      </p>
      <button class="btn btn-secondary btn-full" onclick="reopenRehearsal('${esc(rid)}')">Reopen Rehearsal</button>
    ` : `
      <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 12px">
        Students with zero mistakes will automatically receive a positive mark: "No noticeable mistakes."
      </p>
      <button class="btn btn-success btn-full" onclick="confirmEndRehearsal('${esc(rid)}')">End Rehearsal</button>
    `}` : ''}

    <div class="danger-zone">
      <div class="danger-zone-title">Danger Zone</div>
      <button class="btn btn-danger btn-full" onclick="confirmDeleteRehearsal('${esc(rid)}')">
        Delete This Rehearsal
      </button>
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
  db.collection('rehearsals').doc(rid).set({ segments }, { merge: true });
  showRehearsalOptions(rid);
}

function removeSegment(rid, idx) {
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  const segments = (r.segments || []).filter((_, i) => i !== idx);
  r.segments = segments;
  db.collection('rehearsals').doc(rid).set({ segments }, { merge: true });
  showRehearsalOptions(rid);
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
  const patch = {
    date:  document.getElementById('m-date').value,
    label: document.getElementById('m-label').value.trim()
  };
  STATE.rehearsals[idx] = { ...STATE.rehearsals[idx], ...patch };
  db.collection('rehearsals').doc(rid).set(patch, { merge: true });
  closeModal();
  showToast('Rehearsal updated');
  render();
}

function confirmEndRehearsal(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  const entries  = DB.getRehearsalEntries(rid);
  const students = DB.getStudents();
  const eligible = Object.keys(students).filter(num => !(entries[num]?.mistakes > 0));
  openModal(`
    <div class="modal-title">End Rehearsal?</div>
    <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:16px">
      <strong>${eligible.length} student${eligible.length !== 1 ? 's' : ''}</strong>
      with no mistakes will receive an automatic positive mark:<br>
      <em>"No noticeable mistakes"</em>
    </p>
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:20px">
      Students who already have that mark from a previous end will not get a duplicate.
    </p>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="showRehearsalOptions('${esc(rid)}')">Cancel</button>
      <button class="btn btn-success" onclick="endRehearsal('${esc(rid)}')">End Rehearsal</button>
    </div>
  `);
}

async function endRehearsal(rid) {
  closeModal();
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  const entries  = STATE.entries[rid] || {};
  const students = STATE.students;
  const batch    = db.batch();
  let count      = 0;

  for (const [num] of Object.entries(students)) {
    const entry     = entries[num] || { mistakes: 0, positives: 0, notes: '', events: [] };
    if ((entry.mistakes || 0) > 0) continue; // has mistakes — skip

    // Remove any previous auto-mark so re-ending doesn't duplicate
    const prevEvents = (entry.events || []).filter(e => e.note !== 'No noticeable mistakes');
    const autoEvt    = { type: 'positive', note: 'No noticeable mistakes', ts: Date.now(), by: 'system', auto: true };
    const events     = [...prevEvents, autoEvt];
    const positives  = events.filter(e => e.type === 'positive').length;

    const docRef = db.collection('entries').doc(`${rid}_${num}`);
    batch.set(docRef, {
      rehearsalId:   rid,
      studentNumber: String(num),
      mistakes:      entry.mistakes  || 0,
      positives,
      notes:         entry.notes     || '',
      events,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: STATE.user?.email || ''
    });

    if (!STATE.entries[rid]) STATE.entries[rid] = {};
    STATE.entries[rid][num] = { ...entry, events, positives };
    count++;
  }

  r.ended = true;
  db.collection('rehearsals').doc(rid).set({ ended: true }, { merge: true });
  await batch.commit();
  showToast(`Rehearsal ended — ${count} student${count !== 1 ? 's' : ''} received automatic positive.`);
  reRender(rid);
}

function reopenRehearsal(rid) {
  closeModal();
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  r.ended = false;
  db.collection('rehearsals').doc(rid).set({ ended: false }, { merge: true });
  showToast('Rehearsal reopened.');
  reRender(rid);
}

function confirmDeleteRehearsal(rid) {
  if (!confirm('Delete this rehearsal and all its data?\n\nThis cannot be undone.')) return;
  STATE.rehearsals = STATE.rehearsals.filter(r => r.id !== rid);
  delete STATE.entries[rid];
  db.collection('rehearsals').doc(rid).delete();
  db.collection('entries').where('rehearsalId', '==', rid).get().then(snap => {
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    batch.commit();
  });
  closeModal();
  showToast('Rehearsal deleted');
  navigate('rehearsals');
}

// ── CSV Import ────────────────────────────────────────────────────────────────

let _csvData = null;

function showImportModal() {
  if (!STATE.isAdmin) return;
  _csvData = null;
  openModal(`
    <div class="modal-title">Import Roster from CSV</div>
    <div class="import-hint">
      <strong>Column names recognized</strong> (header row required):<br>
      <em>Number / Student # / ID</em> &nbsp;·&nbsp; <em>Name</em> &nbsp;·&nbsp;
      <em>Instrument / Inst</em> &nbsp;·&nbsp; <em>Section / Part</em> &nbsp;·&nbsp; <em>Notes</em>
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

function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i+1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { fields.push(field.trim()); field = ''; }
      else field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function parseCSV(text) {
  return text.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .split('\n').filter(l => l.trim()).map(parseCSVLine);
}

const COL_ALIASES = {
  number:     ['number','student number','student #','student no','student id','id','#','num','no.','no'],
  name:       ['name','student name','full name','first name','last name','student'],
  column:     ['column','col','letter','column letter','file'],
  row:        ['row','rank','row number','set'],
  instrument: ['instrument','instruments','inst'],
  section:    ['section','part','group','ensemble'],
  notes:      ['notes','note','comments','comment','director notes']
};

function detectCols(headers) {
  const norm = headers.map(h => h.toLowerCase().trim());
  const map = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    const idx = norm.findIndex(h => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function handleCSVFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) { showImportError('File appears to be empty or has only a header row.'); return; }
      const headers = rows[0];
      const colMap  = detectCols(headers);
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
  const LABELS    = { number:'Number', name:'Name', column:'Column', row:'Row', instrument:'Instrument', section:'Section', notes:'Notes' };
  const fields    = Object.keys(colMap);

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
    const incoming = {
      number:     num,
      name:       (colMap.name       !== undefined ? csvRow[colMap.name]       : '').trim(),
      column:     (colMap.column     !== undefined ? csvRow[colMap.column]     : '').trim().toUpperCase(),
      row:        (colMap.row        !== undefined ? csvRow[colMap.row]        : '').trim(),
      instrument: (colMap.instrument !== undefined ? csvRow[colMap.instrument] : '').trim(),
      section:    (colMap.section    !== undefined ? csvRow[colMap.section]    : '').trim(),
      notes:      (colMap.notes      !== undefined ? csvRow[colMap.notes]      : '').trim(),
      songs:      []
    };
    if (existing[num]) {
      if (strategy === 'overwrite') {
        STATE.students[num] = { ...STATE.students[num], ...incoming };
        batch.set(db.collection('students').doc(num), incoming, { merge: true });
        updated++;
      } else {
        skipped++;
      }
    } else {
      STATE.students[num] = incoming;
      batch.set(db.collection('students').doc(num), incoming);
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

// ── Boot ──────────────────────────────────────────────────────────────────────

render();
