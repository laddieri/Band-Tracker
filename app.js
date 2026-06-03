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
  students:     {},
  rehearsals:   [],
  entries:      {},
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
    if (loaded.size >= 3 && STATE.loading) {
      STATE.loading = false;
      render();
    } else if (!STATE.loading) {
      render();
    }
  }

  STATE._unsubs = [
    db.collection('students').onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') delete STATE.students[ch.doc.id];
        else STATE.students[ch.doc.id] = { ...ch.doc.data(), _id: ch.doc.id };
      });
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
    })
  ];
}

// ── Auth ──────────────────────────────────────────────────────────────────────

auth.onAuthStateChanged(user => {
  STATE.user = user;
  STATE.authChecking = false;
  if (user) {
    startListeners();
  } else {
    STATE._unsubs.forEach(u => u());
    STATE._unsubs = [];
    STATE.loading  = false;
    STATE.students  = {};
    STATE.rehearsals = [];
    STATE.entries   = {};
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

function fmtShort(d) {
  if (!d) return '';
  const [, m, day] = d.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m-1]} ${day}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

  const isTop = ['home','roster','rehearsals'].includes(_view);
  backBtn.classList.toggle('hidden', isTop);
  backBtn.onclick = () => {
    if (_view === 'student')    navigate('roster');
    else if (_view === 'rehearsal') navigate('rehearsals');
    else navigate('home');
  };

  tabs.forEach(t => {
    const match = t.dataset.view;
    t.classList.toggle('active',
      match === _view ||
      (_view === 'student'    && match === 'roster') ||
      (_view === 'rehearsal'  && match === 'rehearsals')
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
      actions.innerHTML = addBtn('showAddStudentModal()') + userBtn();
      main.innerHTML = viewRoster();
      break;

    case 'student': {
      const s = DB.getStudents()[_params.num];
      title.textContent = s ? `Student #${esc(s.number)}` : 'Student';
      actions.innerHTML = editBtn(`showEditStudentModal('${esc(_params.num)}')`) + userBtn();
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
      <div class="login-sub">Director login required</div>

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

      <button class="btn btn-primary btn-full btn-lg" onclick="doLogin()">Sign In</button>
      <div class="login-divider">or</div>
      <button class="btn btn-secondary btn-full" onclick="doSignup()">Create Account</button>
    </div>
  `;
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
  await auth.signOut();
}

function showUserMenu() {
  openModal(`
    <div class="modal-title">Account</div>
    <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:20px">
      Signed in as<br><strong style="color:var(--text)">${esc(STATE.user?.email || '')}</strong>
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

function viewRoster() {
  const students = DB.getStudents();
  const list = Object.values(students)
    .sort((a,b) => String(a.number).localeCompare(String(b.number), undefined, {numeric:true}));

  return `
    <div class="search-wrap">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input class="search-input" type="search" id="roster-search"
             placeholder="Search number, instrument, section…"
             value="${esc(_rosterSearch)}"
             oninput="filterRoster(this.value)" autocomplete="off">
    </div>
    <div style="text-align:right;margin:-4px 0 12px">
      <button class="btn btn-ghost btn-sm" style="color:var(--primary);font-size:0.8rem;padding:4px 0"
              onclick="showImportModal()">
        ↑ Import from CSV
      </button>
    </div>
    <div id="roster-list">${rosterRows(list, _rosterSearch)}</div>
    ${list.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <p>No students yet.</p>
        <p>Tap <strong>+</strong> above to add your first student,<br>or use <strong>Import from CSV</strong>.</p>
      </div>` : ''}
  `;
}

function rosterRows(list, search) {
  const q = search.toLowerCase().trim();
  const filtered = q
    ? list.filter(s =>
        String(s.number).includes(q) ||
        (s.instrument||'').toLowerCase().includes(q) ||
        (s.section||'').toLowerCase().includes(q) ||
        (s.name||'').toLowerCase().includes(q))
    : list;

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
          <div class="student-detail">${esc([s.instrument,s.section].filter(Boolean).join(' · ')) || '<em style="color:var(--text-muted)">No instrument set</em>'}</div>
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
  document.getElementById('roster-list').innerHTML = rosterRows(list, val);
}

// ── View: Student Detail ──────────────────────────────────────────────────────

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
        const mn = evts.filter(ev=>ev.type==='mistake' &&ev.note.trim()).map(ev=>esc(ev.note));
        const pn = evts.filter(ev=>ev.type==='positive'&&ev.note.trim()).map(ev=>esc(ev.note));
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
  const allEvts    = activeEntry?.events || [];
  const activeStu  = _activeNum ? students[_activeNum] : null;

  const entryList = Object.entries(entries)
    .sort(([a],[b]) => String(a).localeCompare(String(b), undefined, {numeric:true}));

  return `
    <div class="tracker-card">
      <div class="tracker-label">Track a Student</div>
      <input class="num-input" type="text" inputmode="numeric" pattern="[0-9]*"
             id="num-input" placeholder="Student #"
             value="${esc(_numSearch)}"
             autocomplete="off" autocorrect="off" autocapitalize="off"
             oninput="onNumInput(this.value,'${esc(rid)}')"
             onkeydown="onNumKey(event,'${esc(rid)}')">

      ${_activeNum ? `
        <div class="active-card">
          <div class="active-card-name">
            #${esc(_activeNum)}
            ${activeStu
              ? `<span class="sub">${esc([activeStu.instrument, activeStu.name].filter(Boolean).join(' · '))}</span>`
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
              ${allEvts.map((e,i) => `
                <div class="event-note-row">
                  <span class="event-note-type ${e.type==='mistake'?'is-mistake':'is-positive'}">${e.type==='mistake'?'✗':'✓'}</span>
                  <input type="text" class="event-note-inp"
                         placeholder="what happened…"
                         value="${esc(e.note)}"
                         oninput="saveEventNote('${esc(rid)}','${esc(_activeNum)}',${i},this.value)">
                </div>`).join('')}
            </div>` : ''}

          <textarea class="active-notes" placeholder="General note for today…"
            oninput="saveNote('${esc(rid)}','${esc(_activeNum)}',this.value)">${esc(activeEntry.notes)}</textarea>

          ${!activeStu ? `
            <button class="btn btn-secondary btn-sm btn-full mt-8"
              onclick="showAddStudentModal('${esc(_activeNum)}')">
              + Add #${esc(_activeNum)} to Roster
            </button>` : ''}

          <button class="next-btn" onclick="clearActive()">Next Student →</button>
        </div>
      ` : ''}
    </div>

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
                ${stu ? `<span class="sub">${esc([stu.instrument,stu.name].filter(Boolean).join(' · '))}</span>` : '<span class="sub" style="color:var(--warning)">Not in roster</span>'}
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
  `;
}

function onNumInput(val, rid) {
  _numSearch = val;
  _activeNum = val.trim() || null;
  reRender(rid);
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
  const inp = document.getElementById('num-input');
  if (inp) { inp.value = ''; inp.focus(); }
  reRender(_params.rid);
}

function adjustCount(rid, num, field, delta) {
  const ents    = DB.getRehearsalEntries(rid);
  const cur     = ents[num] || { mistakes:0, positives:0, notes:'', events:[] };
  const newVal  = Math.max(0, (cur[field]||0) + delta);
  const events  = [...(cur.events || [])];
  const evtType = field === 'mistakes' ? 'mistake' : 'positive';

  if (delta > 0) {
    events.push({ type: evtType, note: '', ts: Date.now() });
  } else if (delta < 0 && newVal < (cur[field]||0)) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === evtType) { events.splice(i, 1); break; }
    }
  }

  // Optimistic update
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  STATE.entries[rid][num] = { ...cur, [field]: newVal, events };

  fsUpsertEntry(rid, num, { mistakes: STATE.entries[rid][num].mistakes, positives: STATE.entries[rid][num].positives, notes: STATE.entries[rid][num].notes || '', events });
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

function reRender(rid) {
  const mc = document.getElementById('main-content');
  const st = mc.scrollTop;
  mc.innerHTML = viewRehearsal(rid);
  mc.scrollTop = st;
}

// ── Modals: Students ──────────────────────────────────────────────────────────

function showAddStudentModal(prefill = '') {
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
  const s = DB.getStudents()[num];
  if (!s) return;
  openModal(`
    <div class="modal-title">Edit Student #${esc(s.number)}</div>
    <div class="form-group">
      <label class="form-label">Name (optional)</label>
      <input class="form-input" id="m-name" type="text" value="${esc(s.name||'')}" autocomplete="off">
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
    name:       document.getElementById('m-name').value.trim(),
    instrument: document.getElementById('m-instrument').value,
    section:    document.getElementById('m-section').value,
    notes:      document.getElementById('m-notes').value.trim(),
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
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRehearsalEdit('${esc(rid)}')">Save</button>
    </div>
    <div class="danger-zone">
      <div class="danger-zone-title">Danger Zone</div>
      <button class="btn btn-danger btn-full" onclick="confirmDeleteRehearsal('${esc(rid)}')">
        Delete This Rehearsal
      </button>
    </div>
  `);
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
  const LABELS    = { number:'Number', name:'Name', instrument:'Instrument', section:'Section', notes:'Notes' };
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

  for (const row of rows) {
    const num = row[colMap.number]?.trim();
    if (!num) continue;
    const incoming = {
      number:     num,
      name:       (colMap.name       !== undefined ? row[colMap.name]       : '').trim(),
      instrument: (colMap.instrument !== undefined ? row[colMap.instrument] : '').trim(),
      section:    (colMap.section    !== undefined ? row[colMap.section]    : '').trim(),
      notes:      (colMap.notes      !== undefined ? row[colMap.notes]      : '').trim(),
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

  await batch.commit();
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
