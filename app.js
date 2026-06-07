// =============================================================================
// BAND TRACKER — Firebase Edition
// =============================================================================

// ── Theme ─────────────────────────────────────────────────────────────────────

function initTheme() {
  const stored = localStorage.getItem('bandTheme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', stored || (prefersDark ? 'dark' : 'light'));
}
initTheme();

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('bandTheme', next);
  closeModal();
  showUserMenu();
}

const FAKE_ADJECTIVES = [
  'Fluffy','Speedy','Grumpy','Happy','Sleepy','Bouncy','Sparkly','Wobbly',
  'Snappy','Fuzzy','Silly','Jolly','Brave','Clever','Dizzy','Fancy',
  'Gentle','Hungry','Jumpy','Lazy','Mighty','Noisy','Orange','Peppy',
  'Quirky','Rusty','Sassy','Tiny','Vivid','Wavy','Zappy','Cheeky',
  'Dozy','Eager','Frisky','Goofy','Hasty','Inky','Lumpy','Misty',
  'Nutty','Plucky','Rainy','Soggy','Wacky','Zippy','Bumpy','Curly',
  'Droopy','Flaky'
];
const FAKE_ANIMALS = [
  'Panda','Giraffe','Alligator','Penguin','Flamingo','Hedgehog','Capybara',
  'Platypus','Narwhal','Axolotl','Wombat','Lemur','Tapir','Okapi','Quokka',
  'Pangolin','Echidna','Manatee','Sloth','Armadillo','Salamander','Gecko',
  'Chameleon','Toucan','Cockatoo','Cassowary','Kiwi','Meerkat','Mongoose',
  'Ocelot','Wolverine','Badger','Otter','Ferret','Chinchilla','Capybara',
  'Binturong','Tarantula','Axolotl','Dugong','Aardvark','Numbat','Kakapo',
  'Fossa','Saiga','Blobfish','Tardigrade','Mudskipper','Shoebill','Potoo'
];

function _strHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h, 31) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

function fakeAnimalName(id) {
  const h   = _strHash(String(id) + STATE.pseudonymSalt);
  const adj = FAKE_ADJECTIVES[h % FAKE_ADJECTIVES.length];
  const ani = FAKE_ANIMALS[Math.floor(h / FAKE_ADJECTIVES.length) % FAKE_ANIMALS.length];
  return `${adj} ${ani}`;
}

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

const COLUMNS      = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const ROWS         = [1,2,3,4,5,6,7,8,9,10,11,12];
const GRADE_LEVELS = ['8th','9th','10th','11th','12th'];

// ── Firebase init ─────────────────────────────────────────────────────────────

firebase.initializeApp(FIREBASE_CONFIG);

// Activate App Check before any Auth/Firestore calls so tokens attach to
// requests. Dormant until RECAPTCHA_V3_SITE_KEY is set (see firebase-config.js).
if (typeof RECAPTCHA_V3_SITE_KEY !== 'undefined' && RECAPTCHA_V3_SITE_KEY && firebase.appCheck) {
  try {
    firebase.appCheck().activate(RECAPTCHA_V3_SITE_KEY, /* autoRefresh */ true);
  } catch (e) {
    console.error('App Check activation failed:', e);
  }
}

const auth = firebase.auth();
const db   = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// ── State ─────────────────────────────────────────────────────────────────────

const STATE = {
  user:         null,
  authChecking: true,
  loading:      true,
  orgId:        null,
  org:          null,
  needsOnboarding: false,
  isAdmin:      false,
  studentNum:   null,
  students:     {},
  rehearsals:   [],
  entries:      {},
  songs:        [],
  mistakePresets:  [...MISTAKE_PRESETS],
  positivePresets: [...POSITIVE_PRESETS],
  instruments:              [...INSTRUMENTS],
  sections:                 [...SECTIONS],
  marchingLeaderboardEnabled: false,
  pseudonymSalt:              '',
  songCategories:             [],
  bandName:                   '',
  bandLogo:                   '',
  // Band-wide feature toggles (default on; missing = on, so existing bands keep
  // everything). 'stats' also requires 'marks' — see featureOn().
  features: { attendance: true, marks: true, songs: true, stats: true },
  activeStudentFields:        null,
  customStudentFields:        [],
  _unsubs:      []
};

function hasField(key) {
  const af = STATE.activeStudentFields;
  return !af || af.includes(key);
}

// ── DB read layer (same API as before — views unchanged) ──────────────────────

const DB = {
  getStudents()        { return STATE.students; },
  getRehearsals()      { return STATE.rehearsals; },
  // Feature-gated: when Songs is off this returns [], so every consumer
  // (Stats, roster detail, student portal, etc.) shows no song data without
  // each one needing its own check. Mutations still use STATE.songs directly.
  getSongs()           { return featureOn('songs') ? STATE.songs : []; },
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
  await orgCol('entries').doc(docId).set({
    rehearsalId: rid,
    studentNumber: String(num),
    ...data,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: STATE.user?.email || ''
  }, { merge: true });
}

// ── Org scoping ───────────────────────────────────────────────────────────────

// Returns a reference to a per-org subcollection. All app data lives under
// orgs/{orgId}/..., so every read and write is scoped to the current org.
function orgCol(name) {
  if (!STATE.orgId) throw new Error(`orgCol('${name}') called before an org was resolved`);
  return db.collection('orgs').doc(STATE.orgId).collection(name);
}

// Keep the top-level studentCodes lookup in sync so anonymous students can
// resolve their org from a code before any membership exists. (See
// docs/DATA_MODEL.md.) No-op for empty codes.
function setStudentCodeLookup(code, studentNumber) {
  if (!code || !STATE.orgId) return Promise.resolve();
  return db.collection('studentCodes').doc(String(code).toUpperCase())
    .set({ orgId: STATE.orgId, studentNumber: String(studentNumber) }, { merge: true });
}

// Resolve which org the signed-in user belongs to (and their role) before any
// data is read. Membership lives in /members/{uid} (interim model — see
// docs/DATA_MODEL.md). Returns true if an org was resolved and listeners should
// start; false if the flow was redirected (sign-out or onboarding).
async function resolveMembership() {
  const uid = STATE.user.uid;

  // Already a member? Use it.
  try {
    const snap = await db.collection('members').doc(uid).get();
    if (snap.exists) {
      const m = snap.data();
      STATE.orgId   = m.orgId;
      STATE.isAdmin = m.role === 'director';
      if (m.studentNumber) STATE.studentNum = String(m.studentNumber);
      return true;
    }
  } catch (e) {
    console.error('membership lookup failed:', e);
  }

  // Anonymous student with no membership yet — resolve via their student code.
  if (STATE.user.isAnonymous) {
    const code = (_pendingStudentCode || localStorage.getItem('bandStudentCode') || '').toUpperCase();
    if (code) {
      try {
        const codeSnap = await db.collection('studentCodes').doc(code).get();
        if (codeSnap.exists) {
          const { orgId, studentNumber } = codeSnap.data();
          // Create our own membership (rules permit this for a valid code).
          await db.collection('members').doc(uid).set({
            orgId, studentNumber: String(studentNumber), role: 'student', joinCode: code
          });
          STATE.orgId      = orgId;
          STATE.isAdmin    = false;
          STATE.studentNum = String(studentNumber);
          localStorage.setItem('bandStudentNum', String(studentNumber));
          _pendingStudentCode = '';
          return true;
        }
      } catch (e) {
        console.error('student code lookup failed:', e);
      }
    }
    // Missing or invalid code — end the anonymous session.
    localStorage.removeItem('bandStudentCode');
    localStorage.removeItem('bandStudentNum');
    showToast('Code not found. Please check and try again.');
    auth.signOut(); // onAuthStateChanged clears state and re-renders
    return false;
  }

  // Signed-in director/email user with no org yet — needs onboarding (create or
  // join a band). The onboarding UI is a separate milestone.
  STATE.orgId           = null;
  STATE.isAdmin         = false;
  STATE.needsOnboarding = true;
  STATE.loading         = false;
  render();
  return false;
}

// ── Firestore listeners ───────────────────────────────────────────────────────

async function startListeners() {
  STATE._unsubs.forEach(u => u());
  STATE._unsubs = [];
  STATE.loading = true;

  // Resolve the user's org before reading any data; bail if redirected.
  if (!await resolveMembership()) return;

  const loaded = new Set();
  function tick(key) {
    loaded.add(key);
    if (loaded.size >= 4 && STATE.loading) {
      STATE.loading = false;
      render();
    } else if (!STATE.loading) {
      render();
    }
  }

  const listeners = [
    // Org metadata (name, plan, invite code) — kept live for the settings UI.
    db.collection('orgs').doc(STATE.orgId).onSnapshot(doc => {
      STATE.org = doc.exists ? { id: doc.id, ...doc.data() } : null;
      if (!STATE.loading) render();
    }),

    // Settings — all members (students need the leaderboard toggle + pseudonym salt)
    orgCol('settings').doc('presets').onSnapshot(doc => {
      const d = doc.exists ? doc.data() : {};
      STATE.mistakePresets             = d.mistakePresets?.length  ? d.mistakePresets  : [...MISTAKE_PRESETS];
      STATE.positivePresets            = d.positivePresets?.length ? d.positivePresets : [...POSITIVE_PRESETS];
      STATE.instruments                = d.instruments?.length     ? d.instruments     : [...INSTRUMENTS];
      STATE.sections                   = d.sections?.length        ? d.sections        : [...SECTIONS];
      STATE.marchingLeaderboardEnabled = !!d.marchingLeaderboardEnabled;
      STATE.pseudonymSalt              = d.pseudonymSalt || '';
      STATE.songCategories             = d.songCategories || [];
      STATE.bandName                   = d.bandName || '';
      STATE.bandLogo                   = d.bandLogo || '';
      STATE.features = {
        attendance: d.features?.attendance !== false,
        marks:      d.features?.marks      !== false,
        songs:      d.features?.songs      !== false,
        stats:      d.features?.stats      !== false,
      };
      STATE.activeStudentFields        = Array.isArray(d.activeStudentFields) ? d.activeStudentFields : null;
      STATE.customStudentFields        = Array.isArray(d.customStudentFields)  ? d.customStudentFields  : [];
      if (!STATE.loading) render();
    }),

    orgCol('students').onSnapshot({ includeMetadataChanges: true }, snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') delete STATE.students[ch.doc.id];
        else STATE.students[ch.doc.id] = { ...ch.doc.data(), _id: ch.doc.id };
      });

      // Email (non-anonymous, non-director) users: match their student record by
      // studentEmail if we don't already have a student number.
      if (!STATE.user?.isAnonymous && !STATE.isAdmin && !STATE.studentNum) {
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

    orgCol('rehearsals').onSnapshot(snap => {
      STATE.rehearsals = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => b.date.localeCompare(a.date));
      tick('rehearsals');
    }),

    orgCol('entries').onSnapshot(snap => {
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

    orgCol('songs').onSnapshot(snap => {
      STATE.songs = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      tick('songs');
    }, err => {
      console.error('songs listener error:', err);
      tick('songs'); // don't hang the app — songs will be empty
    })
  ];

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
    STATE.orgId      = null;
    STATE.org        = null;
    STATE.needsOnboarding = false;
    STATE.isAdmin    = false;
    STATE.studentNum = null;
    STATE.students   = {};
    STATE.rehearsals = [];
    STATE.entries    = {};
    STATE.songs      = [];
    _authMode        = 'signin';
    render();
  }
});

// ── Router ────────────────────────────────────────────────────────────────────

let _view   = 'rehearsals';
let _params = {};
let _authMode = 'signin'; // 'signin' | 'signup' — which director auth screen to show
let _pendingVerification = false; // true after signup until email is verified

function navigate(view, params = {}) {
  if (_view === 'rehearsal' && view !== 'rehearsal') {
    _activeNum     = null;
    _numSearch     = '';
    _blockMode     = false;
    _blockPath     = [];
    _trackerFilter = _mkFilter('name', 'asc');
  }
  if (_view === 'song' && view !== 'song') {
    _songSectionFilter    = '';
    _songHidePassedFilter = false;
    _songSearch           = '';
  }
  if (_view === 'leaderboard' && view !== 'leaderboard') {
    _lbFilter = _mkFilter('score', 'desc');
  }
  if (_view === 'dashboard' && view !== 'dashboard') {
    _activeNum = null; _numSearch = ''; _blockMode = false; _blockPath = [];
    _trackerFilter = _mkFilter('name', 'asc');
    _dashRid = null; _dashForceHistory = false;
  }
  if (_view === 'attendance' && view !== 'attendance') {
    _attModifyMode = false;
    _attFilter     = _mkFilter('name', 'asc');
  }
  if (_view === 'roster' && view !== 'roster') {
    _rosterFilter = _mkFilter('name', 'asc');
  }
  if (_view === 'attendance-tab' && view !== 'attendance-tab') {
    _attTabFilter = _mkFilter('absences', 'desc');
  }
  _view   = view;
  _params = params;
  render();
  document.getElementById('main-content').scrollTop = 0;
}

// ── Rehearsal state ───────────────────────────────────────────────────────────

let _activeNum  = null;
let _numSearch  = '';
let _songSectionFilter       = '';
let _songHidePassedFilter    = false;
let _songSearch              = '';
let _dashRid        = null; // null = all rehearsals
let _activeRid      = null; // which open rehearsal is currently being marked
let _dashForceHistory = false; // force dashboard into historical view even when rehearsal is open
let _attModifyMode           = false; // true = show edit UI even when attendance is submitted
let _blockMode  = false;
let _blockPath  = []; // [{c0,c1,r0,r1}] — zoom drill path
let _pendingSegment    = ''; // currently selected rehearsal segment in mark modal
let _pendingStudentCode = ''; // code being verified for anonymous student login
let _pendingMarkAllFilter = null; // { instruments:[], grades:[] } snapshot for multi-select mark-all
let _pendingLogoData   = null; // null=no change, ''=clear, dataURL=new logo
let _pendingConfirm    = null; // callback for generic confirmation modal

// ── Unified filter state ──────────────────────────────────────────────────────

function _mkFilter(sortField, sortDir) {
  return { search: '', sortField, sortDir, instruments: [], sections: [], grades: [], panelOpen: false };
}
let _rosterFilter  = _mkFilter('name',     'asc');
let _trackerFilter = _mkFilter('name',     'asc');
let _attFilter     = _mkFilter('name',     'asc');
let _attTabFilter  = _mkFilter('absences', 'desc');
let _lbFilter      = _mkFilter('score',    'desc');

// ── Debounce store for note fields ────────────────────────────────────────────

const _debounce = {};

function debounced(key, fn, ms = 800) {
  clearTimeout(_debounce[key]);
  _debounce[key] = setTimeout(fn, ms);
}

// ── Core filter + sort ────────────────────────────────────────────────────────

function filterAndSortStudents(students, f, scoreMap) {
  let pool = [...students];
  // search
  if (f.search) {
    const q = f.search.toLowerCase();
    pool = pool.filter(s =>
      (s.name||'').toLowerCase().includes(q) ||
      String(s.number).includes(q) ||
      normInstrument(s.instrument).toLowerCase().includes(q)
    );
  }
  // filters — OR within category, AND across categories
  if (f.instruments.length) pool = pool.filter(s => f.instruments.includes(normInstrument(s.instrument)));
  if (f.grades.length)      pool = pool.filter(s => f.grades.includes(s.grade || ''));
  if (f.sections.length)    pool = pool.filter(s => f.sections.includes(s.section || ''));
  // sort
  pool.sort((a, b) => {
    let va, vb;
    switch (f.sortField) {
      case 'name':       va = (a.name||'').toLowerCase();          vb = (b.name||'').toLowerCase(); break;
      case 'number':     va = +a.number||0;                        vb = +b.number||0; break;
      case 'instrument': va = normInstrument(a.instrument).toLowerCase(); vb = normInstrument(b.instrument).toLowerCase(); break;
      case 'section':    va = (a.section||'').toLowerCase();       vb = (b.section||'').toLowerCase(); break;
      case 'grade':      va = GRADE_LEVELS.indexOf(a.grade||'');   vb = GRADE_LEVELS.indexOf(b.grade||''); break;
      case 'column':     va = (a.column||'').toUpperCase();        vb = (b.column||'').toUpperCase(); break;
      case 'row':        va = +a.row||0;                           vb = +b.row||0; break;
      case 'score': case 'positives': case 'mistakes': {
        va = scoreMap?.[a.number]?.[f.sortField] ?? -1;
        vb = scoreMap?.[b.number]?.[f.sortField] ?? -1;
        break;
      }
      case 'absences':   va = scoreMap?.[a.number]?.absences ?? 0; vb = scoreMap?.[b.number]?.absences ?? 0; break;
      case 'lates':      va = scoreMap?.[a.number]?.lates ?? 0;    vb = scoreMap?.[b.number]?.lates ?? 0; break;
      case 'attStatus': {
        const order = { absent: 0, late: 1, present: 2, undefined: 2 };
        va = order[scoreMap?.[a.number]?.att] ?? 2;
        vb = order[scoreMap?.[b.number]?.att] ?? 2;
        break;
      }
      default: va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase();
    }
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
    return f.sortDir === 'asc' ? cmp : -cmp;
  });
  return pool;
}

// ── Filter bar renderer ───────────────────────────────────────────────────────

function renderFilterBar(viewId, f, sortOptions) {
  const activeCount = f.instruments.length + f.sections.length + f.grades.length;
  const instruments = instrumentsInRoster();
  const sections    = sectionsInRoster();
  const grades      = gradesInRoster();

  const panel = f.panelOpen ? (() => {
    const checkGroup = (title, items, selected, field) => !items.length ? '' : `
      <div class="sfb-group">
        <div class="sfb-group-label">${title}</div>
        <div class="sfb-checks">
          ${items.map(item => `
            <label class="sfb-check-label">
              <input type="checkbox" class="sfb-checkbox" ${selected.includes(item)?'checked':''}
                     onchange="toggleFilterItem('${viewId}','${esc(field)}','${esc(item)}',this.checked)">
              <span>${esc(item)}</span>
            </label>`).join('')}
        </div>
      </div>`;
    return `<div class="sfb-panel">
      ${checkGroup('Instrument', instruments, f.instruments, 'instruments')}
      ${checkGroup('Grade',      grades,      f.grades,      'grades')}
      ${checkGroup('Section',    sections,    f.sections,    'sections')}
      ${activeCount ? `<button class="sfb-clear-btn" onclick="clearFilter('${viewId}')">Clear all filters</button>` : ''}
    </div>`;
  })() : '';

  return `
    <div class="sfb-wrap">
      <div class="search-wrap" style="margin-bottom:8px">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="search-input" type="search" placeholder="Search by name or number…"
               value="${esc(f.search)}"
               oninput="updateFilter('${viewId}','search',this.value)" autocomplete="off">
      </div>
      <div class="sfb-row">
        <div class="sfb-sort-wrap">
          <select class="sfb-sort-select" onchange="updateFilter('${viewId}','sortField',this.value)">
            ${sortOptions.map(o => `<option value="${esc(o.value)}" ${f.sortField===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
          </select>
          <button class="sfb-dir-btn" onclick="updateFilter('${viewId}','sortDir','${f.sortDir==='asc'?'desc':'asc'}')" title="Reverse sort">
            ${f.sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        <button class="sfb-filter-btn ${activeCount?'sfb-filter-active':''}"
                onclick="updateFilter('${viewId}','panelOpen',${!f.panelOpen})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          Filters${activeCount ? ` (${activeCount})` : ''}
        </button>
      </div>
      ${panel}
    </div>`;
}

// ── Filter event handlers ─────────────────────────────────────────────────────

function _getFilterObj(viewId) {
  return { roster: _rosterFilter, tracker: _trackerFilter, att: _attFilter, 'att-tab': _attTabFilter, lb: _lbFilter }[viewId];
}

function _rerenderForFilter(viewId) {
  const mc = document.getElementById('main-content');
  const st = mc ? mc.scrollTop : 0;
  switch (viewId) {
    case 'roster':  mc.innerHTML = viewRoster(); break;
    case 'att-tab': {
        const el = document.getElementById('att-tab-filtered');
        if (el) { el.innerHTML = _attTabFilteredContent(); if (mc) mc.scrollTop = st; }
        else mc.innerHTML = viewAttendanceTab();
        break;
      }
    case 'att':     mc.innerHTML = viewAttendance(_params.rid); break;
    case 'tracker': reRender(_params.rid); break;
    case 'lb':      mc.innerHTML = viewLeaderboard(); break;
  }
  if (mc) mc.scrollTop = st;
}

// Partial update of just the results list for a view, leaving the filter bar
// (and its focused search input) untouched. Used while typing in search so the
// keyboard/focus isn't lost to a full re-render. Returns false if the view has
// no dedicated list container (caller should fall back to a full re-render).
function _refreshFilterList(viewId) {
  const lists = {
    roster:    ['roster-list',       () => rosterRows(filterAndSortStudents(Object.values(DB.getStudents()), _rosterFilter))],
    'att-tab': ['att-tab-filtered',  () => _attTabFilteredContent()],
  };
  const entry = lists[viewId];
  if (!entry) return false;
  const el = document.getElementById(entry[0]);
  if (!el) return false;
  const mc = document.getElementById('main-content');
  const st = mc ? mc.scrollTop : 0;
  el.innerHTML = entry[1]();
  if (mc) mc.scrollTop = st;
  return true;
}

function updateFilter(viewId, field, value) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  f[field] = value;
  // While typing in search, update only the list so the input keeps focus
  // (a full re-render would replace the input and dismiss the keyboard).
  if (field === 'search' && _refreshFilterList(viewId)) return;
  _rerenderForFilter(viewId);
}

function toggleFilterItem(viewId, field, item, checked) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  if (checked) { if (!f[field].includes(item)) f[field].push(item); }
  else f[field] = f[field].filter(x => x !== item);
  _rerenderForFilter(viewId);
}

function clearFilter(viewId) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  f.instruments = [];
  f.sections    = [];
  f.grades      = [];
  _rerenderForFilter(viewId);
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

function fmtDateFromTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function currentWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun … 6=Sat
  const daysToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now); mon.setDate(now.getDate() + daysToMon);
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  const fmt = d =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { mon: fmt(mon), fri: fmt(fri) };
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

function normInstrument(str) {
  return (str || '').replace(/^\d+\s*/, '').trim();
}

function dirLabel(email) {
  return email ? email.split('@')[0] : '';
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

// ── Feature modules ───────────────────────────────────────────────────────────
// Band-wide toggles configured in Band Settings. Stats depends on Marks (it's
// built from mark data), so it's only "on" when both are enabled.
//
// Gating strategy (keep new feature-specific UI consistent with this):
//   • Songs has its own collection, so it's gated at the DATA layer via
//     DB.getSongs() (returns [] when off). Read song data through DB.getSongs()
//     in every DISPLAY site and it disappears everywhere automatically. Only
//     song mutations use STATE.songs directly.
//   • Marks & Attendance are fields on shared `entries` docs (no clean
//     accessor), so they're gated per-SECTION with featureOn() in the views
//     that blend features. Those cross-cutting surfaces are: viewLeaderboard
//     (Stats), viewStudent (roster detail), viewStudentPortal, viewRehearsals
//     /viewHome/viewRoster cards. If you add mark/attendance UI to any shared
//     view, gate it here too.
//   • Tabs + a router guard (see render) hide whole disabled views.
function featureOn(name) {
  const f = STATE.features || {};
  switch (name) {
    case 'attendance': return f.attendance !== false;
    case 'marks':      return f.marks      !== false;
    case 'songs':      return f.songs      !== false;
    case 'stats':      return f.stats !== false && f.marks !== false;
    default:           return true;
  }
}

// Maps a router view to the feature it belongs to (for hiding disabled views).
const VIEW_FEATURE = {
  'attendance-tab': 'attendance',
  'attendance':     'attendance',
  'dashboard':      'marks',
  'rehearsal':      'marks',
  'leaderboard':    'stats',
  'songs':          'songs',
  'song':           'songs',
};

// ── Render engine ─────────────────────────────────────────────────────────────

function render() {
  const backBtn = document.getElementById('back-btn');
  const title   = document.getElementById('page-title');
  const actions = document.getElementById('header-actions');
  const main    = document.getElementById('main-content');
  const tabs    = document.querySelectorAll('.nav-tab');
  const nav     = document.getElementById('bottom-nav');

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
  const isTop = ['roster','rehearsals','songs','attendance-tab','leaderboard','dashboard'].includes(_view) && !studentOnLeaderboard;
  backBtn.classList.toggle('hidden', isTop);
  backBtn.onclick = () => {
    if (_view === 'student')    navigate('roster');
    else if (_view === 'rehearsal')  navigate('rehearsals');
    else if (_view === 'attendance') {
      if (_params.from === 'attendance-tab') navigate('attendance-tab');
      else if (_params.from === 'rehearsals') navigate('rehearsals');
      else navigate('rehearsal', { rid: _params.rid });
    }
    else if (_view === 'song')  navigate('songs');
    else if (studentOnLeaderboard) navigate(''); // back to student portal
    else navigate('rehearsals');
  };

  tabs.forEach(t => {
    const match = t.dataset.view;
    t.classList.toggle('active',
      match === _view ||
      (_view === 'student'    && match === 'roster') ||
      (_view === 'rehearsal'  && match === 'rehearsals') ||
      (_view === 'attendance' && _params.from === 'attendance-tab' && match === 'attendance-tab') ||
      (_view === 'attendance' && _params.from === 'rehearsals' && match === 'rehearsals') ||
      (_view === 'attendance' && _params.from !== 'attendance-tab' && _params.from !== 'rehearsals' && match === 'rehearsals') ||
      (_view === 'song'       && match === 'songs')
    );
    // Hide tabs for disabled features (and the admin-only tabs for students).
    if (match === 'roster')         t.style.display = STATE.isAdmin ? '' : 'none';
    if (match === 'attendance-tab') t.style.display = featureOn('attendance') ? '' : 'none';
    if (match === 'songs')          t.style.display = featureOn('songs') ? '' : 'none';
    if (match === 'leaderboard')    t.style.display = (STATE.isAdmin && featureOn('stats')) ? '' : 'none';
    if (match === 'dashboard')      t.style.display = (STATE.isAdmin && featureOn('marks')) ? '' : 'none';
  });

  // If the current view belongs to a disabled feature, bounce to a safe view.
  const curFeature = VIEW_FEATURE[_view];
  if (curFeature && !featureOn(curFeature)) {
    navigate(STATE.studentNum && !STATE.isAdmin ? '' : 'rehearsals');
    return;
  }

  actions.innerHTML = '';

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
      title.textContent = 'Take Attendance';
      actions.innerHTML = userBtn();
      main.innerHTML = viewAttendance(_params.rid);
      break;
    }

    case 'songs':
      title.textContent = 'Songs';
      actions.innerHTML = (STATE.isAdmin ? optBtn('showSongOptionsModal()') + addBtn('showAddSongModal()') : '') + userBtn();
      main.innerHTML = viewSongs();
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
      actions.innerHTML = (STATE.isAdmin ? userBtn() : '');
      main.innerHTML = viewLeaderboard();
      break;

    case 'dashboard': {
      const openR = !_dashForceHistory ? getActiveRehearsal() : null;
      if (STATE.isAdmin && openR) {
        _activeRid = openR.id;
        _params = { ..._params, rid: openR.id };
        title.textContent = 'Student Feedback';
        actions.innerHTML = optBtn('showMarksOptionsModal()') + userBtn();
        main.innerHTML = viewRehearsal(openR.id);
        if (_blockMode && !_activeNum) initBlockPinch(openR.id);
      } else {
        title.textContent = 'Rehearsal Marks';
        actions.innerHTML = (STATE.isAdmin ? optBtn('showMarksOptionsModal()') : '') + userBtn();
        main.innerHTML = viewDashboard();
      }
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

// ── Auth views ────────────────────────────────────────────────────────────────

function viewLogin() {
  if (_authMode === 'signup') return viewSignup();
  return `
    <div class="login-view">
      ${STATE.bandLogo
        ? `<img src="${STATE.bandLogo}" class="login-logo-img" alt="Band Logo">`
        : `<div class="login-logo">🎺</div>`}
      <div class="login-title">${esc(STATE.bandName || 'Band Tracker')}</div>

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
      <div style="text-align:center;margin-top:12px">
        <button class="btn-link" onclick="setAuthMode('signup')"
          style="background:none;border:none;color:var(--primary);text-decoration:underline;cursor:pointer;font-size:.85rem">
          New director? Create an account
        </button>
      </div>
    </div>
  `;
}

function viewSignup() {
  return `
    <div class="login-view">
      <div class="login-logo">🎺</div>
      <div class="login-title">Create Director Account</div>
      <p style="color:var(--text-muted);font-size:.85rem;text-align:center;margin:-8px 0 16px">
        Set up your account — you’ll name your band on the next step.
      </p>

      <div id="auth-error"></div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="signup-email" type="email"
               placeholder="director@school.edu" autocomplete="email"
               onkeydown="if(event.key==='Enter')doSignup()">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" id="signup-password" type="password"
               placeholder="At least 6 characters" autocomplete="new-password"
               onkeydown="if(event.key==='Enter')doSignup()">
      </div>
      <div class="form-group">
        <label class="form-label">Confirm Password</label>
        <input class="form-input" id="signup-password-confirm" type="password"
               placeholder="Re-enter your password" autocomplete="new-password"
               onkeydown="if(event.key==='Enter')doSignup()">
      </div>
      <button class="btn btn-primary btn-full btn-lg" onclick="doSignup()">Create Account</button>

      <div style="text-align:center;margin-top:16px">
        <button class="btn-link" onclick="setAuthMode('signin')"
          style="background:none;border:none;color:var(--text-muted);text-decoration:underline;cursor:pointer;font-size:.85rem">
          ← Back to sign in
        </button>
      </div>
    </div>
  `;
}

function setAuthMode(mode) {
  _authMode = mode;
  render();
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
  const email    = document.getElementById('signup-email')?.value.trim();
  const pass     = document.getElementById('signup-password')?.value;
  const passConf = document.getElementById('signup-password-confirm')?.value;
  if (!email || !pass) { showAuthError('Email and password are required.'); return; }
  if (pass !== passConf) { showAuthError('Passwords do not match.'); return; }
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.sendEmailVerification();
    _pendingVerification = true;
    render();
  } catch(e) {
    showAuthError(authMsg(e.code));
  }
}

function viewVerificationPending() {
  const email = STATE.user?.email || 'your email address';
  return `
    <div class="login-view">
      <div class="login-logo">📬</div>
      <div class="login-title">Check your inbox</div>
      <p style="color:var(--text-muted);font-size:.85rem;text-align:center;margin:-8px 0 20px">
        We sent a verification link to<br><strong>${esc(email)}</strong>
      </p>
      <div id="verify-msg"></div>
      <button class="btn btn-primary btn-full btn-lg" onclick="checkEmailVerified()">
        I've verified my email
      </button>
      <button class="btn btn-secondary btn-full" style="margin-top:10px" onclick="resendVerification()">
        Resend email
      </button>
      <div style="text-align:center;margin-top:20px">
        <button class="btn-link" onclick="doLogout()"
          style="background:none;border:none;color:var(--text-muted);text-decoration:underline;cursor:pointer;font-size:.85rem">
          Sign out
        </button>
      </div>
    </div>
  `;
}

async function checkEmailVerified() {
  try {
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      _pendingVerification = false;
      STATE.user = auth.currentUser;
      render();
    } else {
      const el = document.getElementById('verify-msg');
      if (el) el.innerHTML = `<div class="auth-error" style="margin-bottom:12px">Email not yet verified — please click the link in the email first.</div>`;
    }
  } catch(e) {
    const el = document.getElementById('verify-msg');
    if (el) el.innerHTML = `<div class="auth-error" style="margin-bottom:12px">Could not check verification status. Please try again.</div>`;
  }
}

async function resendVerification() {
  try {
    await auth.currentUser.sendEmailVerification();
    const el = document.getElementById('verify-msg');
    if (el) el.innerHTML = `<div style="color:var(--success);font-size:.85rem;text-align:center;margin-bottom:12px">Verification email resent.</div>`;
  } catch(e) {
    const el = document.getElementById('verify-msg');
    if (el) el.innerHTML = `<div class="auth-error" style="margin-bottom:12px">Could not resend — please wait a moment and try again.</div>`;
  }
}

// ── Onboarding (create / join a band) ──────────────────────────────────────────

function viewOnboarding() {
  return `
    <div class="login-view">
      <div class="login-logo">🎺</div>
      <div class="login-title">Set up your band</div>
      <p style="color:var(--text-muted);font-size:.85rem;text-align:center;margin:-8px 0 16px">
        Signed in as ${esc(STATE.user?.email || '')}
      </p>

      <div class="login-section-label">Create a new band</div>
      <div id="onboard-create-error"></div>
      <div class="form-group">
        <input class="form-input" id="onboard-band-name" type="text"
               placeholder="e.g. Lincoln High School Band"
               onkeydown="if(event.key==='Enter')createBand()">
      </div>
      <div class="form-group">
        <input class="form-input" id="onboard-access-code" type="text"
               placeholder="Access code"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               style="text-transform:uppercase;letter-spacing:.1em;text-align:center"
               onkeydown="if(event.key==='Enter')createBand()">
      </div>
      <button class="btn btn-primary btn-full btn-lg" onclick="createBand()">Create Band</button>

      <div class="login-divider"><span>or</span></div>

      <div class="login-section-label">Join an existing band</div>
      <div id="onboard-join-error"></div>
      <div class="form-group">
        <input class="form-input" id="onboard-invite-code" type="text"
               placeholder="Enter invite code"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               style="text-transform:uppercase;letter-spacing:.1em;text-align:center"
               onkeydown="if(event.key==='Enter')joinBandWithInvite()">
      </div>
      <button class="btn btn-secondary btn-full" onclick="joinBandWithInvite()">Join Band</button>

      <div style="text-align:center;margin-top:24px">
        <button class="btn-link" onclick="doLogout()"
          style="background:none;border:none;color:var(--text-muted);text-decoration:underline;cursor:pointer;font-size:.85rem">
          Sign out
        </button>
      </div>
    </div>
  `;
}

function onboardErr(id, msg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="auth-error">${esc(msg)}</div>`;
}

async function createBand() {
  const name       = document.getElementById('onboard-band-name')?.value.trim();
  const accessCode = document.getElementById('onboard-access-code')?.value.trim().toUpperCase();
  if (!name)       { onboardErr('onboard-create-error', 'Please enter a band name.'); return; }
  if (!accessCode) { onboardErr('onboard-create-error', 'An access code is required to create a band.'); return; }
  try {
    const orgRef = db.collection('orgs').doc();
    const orgId  = orgRef.id;
    // Order matters for the security rules: create the org (createdBy = me, with
    // a valid access code), then my director membership, then seed settings.
    await orgRef.set({
      name, plan: 'free', createdBy: STATE.user.uid, accessCode,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('members').doc(STATE.user.uid).set({
      orgId, role: 'director', email: STATE.user.email || ''
    });
    await orgRef.collection('settings').doc('presets').set({ bandName: name }, { merge: true });

    STATE.needsOnboarding = false;
    STATE.loading = true;
    render();
    startListeners();
  } catch (e) {
    console.error('createBand failed:', e);
    if (e.code === 'permission-denied') {
      onboardErr('onboard-create-error', 'That access code isn’t valid. Please check and try again.');
    } else {
      onboardErr('onboard-create-error', 'Could not create the band. Please try again.');
    }
  }
}

async function joinBandWithInvite() {
  const code = document.getElementById('onboard-invite-code')?.value.trim().toUpperCase();
  if (!code) { onboardErr('onboard-join-error', 'Please enter an invite code.'); return; }
  try {
    const snap = await db.collection('inviteCodes').doc(code).get();
    if (!snap.exists) { onboardErr('onboard-join-error', 'Invite code not found.'); return; }
    const { orgId } = snap.data();
    await db.collection('members').doc(STATE.user.uid).set({
      orgId, role: 'director', email: STATE.user.email || '', inviteCode: code
    });

    STATE.needsOnboarding = false;
    STATE.loading = true;
    render();
    startListeners();
  } catch (e) {
    console.error('joinBandWithInvite failed:', e);
    onboardErr('onboard-join-error', 'Could not join the band. Please try again.');
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
        <button class="btn btn-secondary btn-full" onclick="toggleTheme()">${document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
        <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
        <button class="btn btn-danger btn-full" onclick="doLogout()">Exit Student View</button>
      </div>
    `);
    return;
  }
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  openModal(`
    <div class="modal-title">Account</div>
    <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:20px">
      Signed in as<br><strong style="color:var(--text)">${esc(STATE.user?.email || '')}</strong><br>
      <span style="font-size:0.8rem">${STATE.isAdmin ? '⭐ Admin' : 'Director'}</span>
    </div>
    <div class="modal-actions">
      ${STATE.isAdmin ? `
        <button class="btn btn-secondary btn-full" onclick="closeModal();navigate('roster')">Manage Roster</button>
        <button class="btn btn-secondary btn-full" onclick="closeModal();showBrandSettingsModal()">Band Settings</button>
      ` : ''}
      <button class="btn btn-secondary btn-full" onclick="toggleTheme()">${isDark ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
      <button class="btn btn-danger btn-full" onclick="doLogout()">Sign Out</button>
    </div>
  `);
}

// ── Brand settings ────────────────────────────────────────────────────────────

function showBrandSettingsModal() {
  if (!STATE.isAdmin) return;
  _pendingLogoData = null;
  const currentLogo = STATE.bandLogo;
  openModal(`
    <div class="modal-title">Band Settings</div>

    <div class="form-group">
      <label class="form-label">Band Name</label>
      <input class="form-input" id="brand-name-input" type="text"
             placeholder="e.g. Lincoln High School Band"
             value="${esc(STATE.bandName)}">
    </div>

    <div class="form-group">
      <label class="form-label">Logo</label>
      <div class="brand-logo-area" id="brand-logo-area">
        ${currentLogo
          ? `<img src="${currentLogo}" class="brand-logo-preview" id="brand-logo-preview" alt="Current logo">`
          : `<div class="brand-logo-placeholder" id="brand-logo-preview" style="display:none"></div>`}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <label class="btn btn-secondary" style="cursor:pointer;margin:0">
          ${currentLogo ? 'Replace Logo' : 'Upload Logo'}
          <input type="file" accept="image/*" style="display:none" onchange="handleLogoUpload(event)">
        </label>
        ${currentLogo ? `<button class="btn btn-secondary" onclick="removeBrandLogo()">Remove</button>` : ''}
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Features</label>
      <p style="font-size:.75rem;color:var(--text-muted);margin:-2px 0 8px">
        Turn off features your band doesn’t use. Existing data is kept and
        reappears if you turn a feature back on.
      </p>
      ${[
        ['attendance', 'Attendance', 'Track who’s absent, late, or present'],
        ['marks',      'Marks / Student Feedback', 'Log positive and mistake marks during rehearsals'],
        ['songs',      'Songs', 'Music memorization with pass/fail tracking'],
        ['stats',      'Stats / Leaderboard', 'Rankings built from marks (needs Marks on)'],
      ].map(([key, label, desc]) => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;cursor:pointer">
          <input type="checkbox" id="feat-${key}" ${STATE.features?.[key] !== false ? 'checked' : ''}
            style="margin-top:3px;width:18px;height:18px;flex-shrink:0">
          <span>
            <span style="font-weight:600">${label}</span>
            <span style="display:block;font-size:.75rem;color:var(--text-muted)">${desc}</span>
          </span>
        </label>`).join('')}
    </div>

    <div class="form-group">
      <label class="form-label">Co-director invite code</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <code id="invite-code-display"
          style="font-size:1.1rem;letter-spacing:.15em;padding:6px 12px;background:var(--surface-2,#eee);border-radius:6px">
          ${STATE.org?.inviteCode ? esc(STATE.org.inviteCode) : '— none —'}
        </code>
        <button class="btn btn-secondary" onclick="generateInviteCode()">
          ${STATE.org?.inviteCode ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      <p style="font-size:.75rem;color:var(--text-muted);margin-top:6px">
        Share this code with another director so they can join this band.
        Regenerating revokes the old code.
      </p>
    </div>

    <div class="form-group">
      <label class="form-label">Directors</label>
      <div id="directors-list" style="font-size:.9rem">Loading…</div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveBrandSettings()">Save</button>
    </div>
  `);
  loadDirectorsList();
}

async function loadDirectorsList() {
  const el = document.getElementById('directors-list');
  if (!el || !STATE.orgId) return;
  try {
    const snap = await db.collection('members')
      .where('orgId', '==', STATE.orgId)
      .where('role', '==', 'director')
      .get();
    const me      = STATE.user?.uid;
    const founder = STATE.org?.createdBy;
    const rows = snap.docs.map(d => {
      const uid   = d.id;
      const email = d.data().email || uid;
      const tags  = (uid === founder ? ' (owner)' : '') + (uid === me ? ' (you)' : '');
      const remove = uid === founder
        ? ''
        : `<button class="btn btn-danger" style="padding:4px 10px;font-size:.78rem;width:auto;margin:0"
             onclick="removeDirector('${esc(uid)}','${esc(email).replace(/'/g, "\\'")}')">Remove</button>`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,#eee)">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(email)}${tags}</span>
        ${remove}
      </div>`;
    }).join('');
    el.innerHTML = rows || '<span style="color:var(--text-muted)">No directors found.</span>';
  } catch (e) {
    console.error('loadDirectorsList failed:', e);
    el.innerHTML = '<span style="color:var(--text-muted)">Could not load directors.</span>';
  }
}

async function removeDirector(uid, label) {
  if (uid === STATE.user?.uid
      ? !confirm('Remove yourself as a director? You will lose access to this band.')
      : !confirm(`Remove ${label} as a director? They will lose access to this band.`)) return;
  try {
    await db.collection('members').doc(uid).delete();
    if (uid === STATE.user?.uid) {
      // We removed our own membership — re-resolve, which routes us to onboarding.
      closeModal();
      startListeners();
      return;
    }
    showToast('Director removed.');
    loadDirectorsList();
  } catch (e) {
    console.error('removeDirector failed:', e);
    showToast('Could not remove director.');
  }
}

async function generateInviteCode() {
  if (!STATE.isAdmin || !STATE.orgId) return;
  const code = genStudentCode();
  try {
    const old = STATE.org?.inviteCode;
    await db.collection('inviteCodes').doc(code).set({ orgId: STATE.orgId });
    await db.collection('orgs').doc(STATE.orgId).set({ inviteCode: code }, { merge: true });
    if (old && old !== code) {
      await db.collection('inviteCodes').doc(old).delete().catch(() => {});
    }
    if (STATE.org) STATE.org.inviteCode = code; // optimistic; org listener will confirm
    showToast('Invite code generated.');
    showBrandSettingsModal();
  } catch (e) {
    console.error('generateInviteCode failed:', e);
    showToast('Could not generate invite code.');
  }
}

function handleLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 192;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      _pendingLogoData = canvas.toDataURL('image/png');
      const preview = document.getElementById('brand-logo-preview');
      if (preview) {
        preview.src   = _pendingLogoData;
        preview.style.display = '';
        preview.className = 'brand-logo-preview';
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeBrandLogo() {
  _pendingLogoData = '';
  showBrandSettingsModal(); // re-open without current logo so Remove btn disappears
}

async function saveBrandSettings() {
  const name = document.getElementById('brand-name-input')?.value.trim() || '';
  const logo = _pendingLogoData !== null ? _pendingLogoData : STATE.bandLogo;
  _pendingLogoData = null;
  const readFeat = (key) => {
    const el = document.getElementById(`feat-${key}`);
    return el ? el.checked : (STATE.features?.[key] !== false);
  };
  const features = {
    attendance: readFeat('attendance'),
    marks:      readFeat('marks'),
    songs:      readFeat('songs'),
    stats:      readFeat('stats'),
  };
  STATE.bandName = name;
  STATE.bandLogo = logo;
  STATE.features = features;
  await orgCol('settings').doc('presets').set({ bandName: name, bandLogo: logo, features }, { merge: true });
  closeModal();
  showToast('Band settings saved.');
  render();
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
                ${featureOn('marks') ? `
                <div class="text-sm text-muted">${cnt} tracked</div>
                <div class="flex gap-6 mt-4" style="justify-content:flex-end">
                  ${errs>0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
                  ${pos>0  ? `<span class="badge badge-success">${pos}✓</span>` : ''}
                </div>` : ''}
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
  orgCol('rehearsals').doc(id).set(r);
  navigate(featureOn('marks') ? 'rehearsal' : 'rehearsals', featureOn('marks') ? { rid: id } : {});
}

// ── View: Roster ──────────────────────────────────────────────────────────────

function instrumentsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.instrument) seen.add(normInstrument(s.instrument)); });
  return [...seen].sort();
}

function sectionsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.section) seen.add(s.section); });
  return [...seen].sort();
}

function gradesInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.grade) seen.add(s.grade); });
  return GRADE_LEVELS.filter(g => seen.has(g));
}

function rowsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.row != null && s.row !== '') seen.add(String(s.row)); });
  return [...seen].sort((a, b) => Number(a) - Number(b));
}

function columnsInRoster() {
  const seen = new Set();
  Object.values(DB.getStudents()).forEach(s => { if (s.column) seen.add(s.column); });
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

function studentSuggestions(query, instrumentFilter, gradeFilter) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return Object.values(DB.getStudents()).filter(s => {
    if (instrumentFilter && normInstrument(s.instrument) !== instrumentFilter) return false;
    if (gradeFilter && (s.grade || '') !== gradeFilter) return false;
    return (s.name||'').toLowerCase().includes(q) ||
           String(s.number).includes(q) ||
           (s.section||'').toLowerCase().includes(q);
  }).sort((a,b) => (a.name||'').localeCompare(b.name||''))
    .slice(0, 10);
}

function viewRoster() {
  const students = DB.getStudents();
  const allStudents = Object.values(students);
  const filtered = filterAndSortStudents(allStudents, _rosterFilter);

  const rosterSortOpts = [
    {value:'name',   label:'Name'},
    {value:'number', label:'Number'},
    ...(hasField('instrument') ? [{value:'instrument', label:'Instrument'}] : []),
    ...(hasField('section')    ? [{value:'section',    label:'Section'}]    : []),
    ...(hasField('grade')      ? [{value:'grade',      label:'Grade'}]      : []),
    ...(hasField('column')     ? [{value:'column',     label:'Column'}]     : []),
    ...(hasField('row')        ? [{value:'row',        label:'Row'}]        : []),
  ];
  if (STATE.isAdmin && allStudents.length === 0) {
    return viewRosterOnboarding();
  }

  return `
    ${renderFilterBar('roster', _rosterFilter, rosterSortOpts)}
    <div id="roster-list">${rosterRows(filtered)}</div>
  `;
}

function viewRosterOnboarding() {
  const bandName = STATE.bandName || 'your band';
  return `
    <div class="onboard-card">
      <div class="onboard-card-title">👋 Welcome to ${esc(bandName)}!</div>
      <div class="onboard-card-sub">Let's get your roster set up. Follow these two steps to get started.</div>
      <div class="onboard-steps">

        <div class="onboard-step">
          <div class="onboard-step-num">1</div>
          <div>
            <div class="onboard-step-title">Configure your fields</div>
            <div class="onboard-step-desc">Choose which details to track for each student — marching position, instrument, grade, and more. You can also add your own custom fields like locker number or bus route.</div>
            <div class="onboard-step-btns">
              <button class="btn btn-secondary" onclick="showManageFieldsModal()">Manage Fields</button>
            </div>
          </div>
        </div>

        <div class="onboard-step">
          <div class="onboard-step-num">2</div>
          <div>
            <div class="onboard-step-title">Add your students</div>
            <div class="onboard-step-desc">Import your entire roster from a CSV file in seconds, or add students one at a time.</div>
            <div class="onboard-step-btns">
              <button class="btn btn-primary" onclick="showImportModal()">Import CSV</button>
              <button class="btn btn-secondary" onclick="showAddStudentModal()">Add Manually</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

function rosterRows(list) {
  if (!list.length) {
    return `<div class="empty-state" style="padding:24px"><p>No students match the current filter.</p></div>`;
  }

  return list.map(s => {
    const hist = DB.getStudentHistory(s.number);
    const errs = hist.reduce((sum,e)=>sum+(e.entry.mistakes||0),0);
    const pos  = hist.reduce((sum,e)=>sum+(e.entry.positives||0),0);
    const avg  = hist.length ? (errs/hist.length).toFixed(1) : null;
    return `
      <div class="roster-row" onclick="navigate('student',{num:'${esc(s.number)}'})">
        <div class="student-info">
          ${s.name ? `<div class="student-name">${esc(s.name)}</div>` : `<div class="student-name text-muted">#${esc(s.number)}</div>`}
          <div class="student-detail">${esc([
            (hasField('column')||hasField('row')) ? fmtPos(hasField('column')?s.column:'',hasField('row')?s.row:'') : '',
            hasField('instrument') ? normInstrument(s.instrument) : '',
            hasField('section')    ? s.section : '',
            ...(STATE.customStudentFields||[]).map(cf => s[cf.key] ? `${cf.label}: ${s[cf.key]}` : '')
          ].filter(Boolean).join(' · ')) || '<em style="color:var(--text-muted)">No details set</em>'}</div>
        </div>
        <div class="student-badges">
          ${featureOn('marks') ? `
          ${avg !== null ? `<span class="badge badge-danger">${avg}✗</span>` : ''}
          ${pos > 0      ? `<span class="badge badge-success">${pos}✓</span>` : ''}` : ''}
        </div>
      </div>`;
  }).join('');
}

// filterRoster, filterRosterInstrument, filterRosterGrade replaced by updateFilter / unified filter bar

function showRosterOptionsModal() {
  const students = Object.values(DB.getStudents());
  const missingCodes = students.filter(s => !s.studentCode).length;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Roster Options</div>
    <div class="options-menu">
      <button class="options-menu-item" onclick="closeModal();showManageFieldsModal()">
        <div class="options-menu-icon">🗃️</div>
        <div>
          <div class="options-menu-label">Manage Fields</div>
          <div class="options-menu-sub">Toggle built-in fields and add custom ones</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showAutoGenerateCodesModal()">
        <div class="options-menu-icon">🔑</div>
        <div>
          <div class="options-menu-label">Auto-generate Student Codes</div>
          <div class="options-menu-sub">${missingCodes === 0 ? 'All students have codes' : `${missingCodes} student${missingCodes !== 1 ? 's' : ''} missing a code`}</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showImportModal()">
        <div class="options-menu-icon">📥</div>
        <div>
          <div class="options-menu-label">Import from CSV</div>
          <div class="options-menu-sub">Add or update students in bulk</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showManageInstrumentsModal()">
        <div class="options-menu-icon">🎺</div>
        <div>
          <div class="options-menu-label">Manage Instruments</div>
          <div class="options-menu-sub">Add, edit, or remove available instruments</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();showManageSectionsModal()">
        <div class="options-menu-icon">🗂️</div>
        <div>
          <div class="options-menu-label">Manage Sections</div>
          <div class="options-menu-sub">Add, edit, or remove band sections</div>
        </div>
      </button>
      <button class="options-menu-item" onclick="closeModal();randomizePseudonyms()">
        <div class="options-menu-icon">🎲</div>
        <div>
          <div class="options-menu-label">Randomize Leaderboard Names</div>
          <div class="options-menu-sub">Reassign all animal pseudonyms</div>
        </div>
      </button>
      <button class="options-menu-item options-menu-item-danger" onclick="closeModal();showDeleteRosterModal()">
        <div class="options-menu-icon">🗑</div>
        <div>
          <div class="options-menu-label">Delete Entire Roster</div>
          <div class="options-menu-sub">Permanently remove all students</div>
        </div>
      </button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function showManageFieldsModal() {
  if (!STATE.isAdmin) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Manage Fields</div>
    <div class="section-title" style="margin-top:0">Built-in Fields</div>
    <div class="form-hint" style="margin:0 0 10px">Toggle which fields appear in forms, roster cards, and CSV import.</div>
    ${STUDENT_FIELD_DEFS.map(f => `
      <label style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" id="sf-${f.key}" ${hasField(f.key)?'checked':''}
               onchange="toggleBuiltinField('${f.key}')"
               style="width:18px;height:18px;flex-shrink:0;cursor:pointer">
        <div>
          <div style="font-weight:600">${f.label}</div>
          <div class="form-hint" style="margin:2px 0 0">${f.description}</div>
        </div>
      </label>`).join('')}
    <div class="section-title" style="margin-top:18px">Custom Fields</div>
    <div class="form-hint" style="margin:0 0 10px">Add your own fields to student profiles.</div>
    <div class="preset-section">
      <div id="custom-field-list">${_renderCustomFieldList()}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-cf-input" type="text"
               placeholder="New field name…" maxlength="40"
               onkeydown="if(event.key==='Enter')addCustomField()">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addCustomField()">Add</button>
      </div>
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function toggleBuiltinField(key) {
  const current = STATE.activeStudentFields ?? STUDENT_FIELD_DEFS.map(f => f.key);
  const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
  STATE.activeStudentFields = next.length === STUDENT_FIELD_DEFS.length ? null : next;
  orgCol('settings').doc('presets').set({ activeStudentFields: next }, { merge: true });
  if (_view === 'roster') render();
}

function _renderCustomFieldList() {
  const fields = STATE.customStudentFields || [];
  if (!fields.length) return `<div class="preset-empty">No custom fields yet — add one below.</div>`;
  return fields.map(cf => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(cf.label)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editCustomField('${esc(cf.key)}')">Edit</button>
        <button class="preset-btn-del"  onclick="deleteCustomField('${esc(cf.key)}')">×</button>
      </div>
    </div>`).join('');
}

function addCustomField() {
  const input = document.getElementById('add-cf-input');
  const label = input?.value.trim();
  if (!label) return;
  const key = 'cf_' + Date.now();
  STATE.customStudentFields = [...(STATE.customStudentFields || []), { key, label }];
  _saveCustomFields();
  input.value = '';
  document.getElementById('custom-field-list').innerHTML = _renderCustomFieldList();
}

function deleteCustomField(key) {
  STATE.customStudentFields = (STATE.customStudentFields || []).filter(cf => cf.key !== key);
  _saveCustomFields();
  document.getElementById('custom-field-list').innerHTML = _renderCustomFieldList();
}

function editCustomField(key) {
  const cf = (STATE.customStudentFields || []).find(f => f.key === key);
  if (!cf) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Field</div>
    <input class="form-input" id="edit-cf-input" type="text"
           value="${esc(cf.label)}" maxlength="40"
           onkeydown="if(event.key==='Enter')saveEditCustomField('${esc(key)}')">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManageFieldsModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditCustomField('${esc(key)}')">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-cf-input')?.focus(), 60);
}

function saveEditCustomField(key) {
  const label = document.getElementById('edit-cf-input')?.value.trim();
  if (!label) return;
  STATE.customStudentFields = (STATE.customStudentFields || []).map(cf =>
    cf.key === key ? { key, label } : cf
  );
  _saveCustomFields();
  showManageFieldsModal();
}

async function _saveCustomFields() {
  try {
    await orgCol('settings').doc('presets').set(
      { customStudentFields: STATE.customStudentFields }, { merge: true }
    );
  } catch(e) {
    showToast('Failed to save custom fields.');
  }
}

function showMarksOptionsModal() {
  if (!STATE.isAdmin) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Marks Settings</div>
    <div class="options-menu">
      <button class="options-menu-item" onclick="closeModal();showManagePresetsModal()">
        <div class="options-menu-icon">✏️</div>
        <div>
          <div class="options-menu-label">Manage Mark Presets</div>
          <div class="options-menu-sub">Edit preset comments for marks</div>
        </div>
      </button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function showAutoGenerateCodesModal() {
  const students = Object.values(DB.getStudents());
  const missing = students.filter(s => !s.studentCode);
  if (!missing.length) {
    showToast('All students already have a code.');
    return;
  }
  showConfirmModal(
    'Auto-generate Student Codes',
    `Generate codes for <strong>${missing.length} student${missing.length !== 1 ? 's' : ''}</strong> who ${missing.length !== 1 ? 'are' : 'is'} missing one.<br><br>Existing codes will not be changed.`,
    autoGenerateStudentCodes,
    'Generate',
    'btn-primary'
  );
}

function genStudentCode(existing = new Set()) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (existing.has(code));
  existing.add(code);
  return code;
}

async function autoGenerateStudentCodes() {
  if (!STATE.isAdmin) return;
  const students = Object.values(STATE.students);
  const usedCodes = new Set(students.map(s => s.studentCode).filter(Boolean).map(c => c.toUpperCase()));
  const toUpdate = students.filter(s => !s.studentCode);
  if (!toUpdate.length) { showToast('All students already have a code.'); return; }

  const CHUNK = 500;
  const updates = toUpdate.map(s => ({ s, code: genStudentCode(usedCodes) }));

  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = db.batch();
    updates.slice(i, i + CHUNK).forEach(({ s, code }) => {
      batch.update(orgCol('students').doc(s.number), { studentCode: code });
    });
    await batch.commit().catch(e => { showToast('Failed — ' + (e.message || 'check console')); throw e; });
  }

  for (const { s, code } of updates) {
    STATE.students[s.number] = { ...STATE.students[s.number], studentCode: code };
  }

  // Mirror new codes into the studentCodes lookup so students can sign in.
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = db.batch();
    updates.slice(i, i + CHUNK).forEach(({ s, code }) => {
      batch.set(db.collection('studentCodes').doc(code.toUpperCase()),
        { orgId: STATE.orgId, studentNumber: String(s.number) }, { merge: true });
    });
    await batch.commit().catch(e => console.error('studentCodes sync failed:', e));
  }

  showToast(`${updates.length} code${updates.length !== 1 ? 's' : ''} generated.`);
  render();
}

function showDeleteRosterModal() {
  const count = Object.keys(DB.getStudents()).length;
  if (!count) { showToast('Roster is already empty.'); return; }
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title" style="color:var(--danger)">Delete Entire Roster</div>
    <p style="font-size:.9rem;line-height:1.6;margin-bottom:8px">
      This will permanently delete <strong>all ${count} student${count !== 1 ? 's' : ''}</strong> from the roster.
    </p>
    <p style="font-size:.85rem;color:var(--text-muted);line-height:1.5;margin-bottom:16px">
      Rehearsal history and attendance records will remain but will no longer be linked to any student. This cannot be undone.
    </p>
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">Type <strong>DELETE</strong> to confirm</label>
      <input class="form-input" id="delete-roster-confirm" type="text"
             placeholder="DELETE" autocomplete="off"
             oninput="document.getElementById('delete-roster-btn').disabled = this.value !== 'DELETE'">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="delete-roster-btn" disabled onclick="deleteRoster()">Delete All Students</button>
    </div>
  `);
  setTimeout(() => document.getElementById('delete-roster-confirm')?.focus(), 80);
}

async function deleteRoster() {
  if (!STATE.isAdmin) return;
  const nums = Object.keys(STATE.students);
  if (!nums.length) { closeModal(); return; }

  closeModal();

  const CHUNK = 500;
  for (let i = 0; i < nums.length; i += CHUNK) {
    const batch = db.batch();
    nums.slice(i, i + CHUNK).forEach(num => {
      batch.delete(orgCol('students').doc(num));
    });
    await batch.commit().catch(e => { showToast('Delete failed — ' + (e.message || 'check console')); throw e; });
  }

  STATE.students = {};
  showToast('Roster deleted.');
  render();
}

// filterTrackerInstrument and filterTrackerGrade replaced by updateFilter / unified filter bar

// ── View: Student Detail ──────────────────────────────────────────────────────

// ── View: Songs ───────────────────────────────────────────────────────────────

function viewSongs() {
  const songs = STATE.songs;
  const total = Object.keys(STATE.students).length;
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

  if (!cats.length) {
    return `<div class="songs-list-grid">${songs.map(songRow).join('')}</div>`;
  }

  // Group songs by category
  const grouped = {};
  const uncategorized = [];
  cats.forEach(c => { grouped[c] = []; });
  songs.forEach(song => {
    if (song.category && grouped[song.category] !== undefined) grouped[song.category].push(song);
    else uncategorized.push(song);
  });

  let html = '<div class="songs-list-grid">';
  cats.forEach(cat => {
    if (!grouped[cat].length) return;
    html += `<div class="song-cat-hdr">${esc(cat)}</div>`;
    html += grouped[cat].map(songRow).join('');
  });
  if (uncategorized.length) {
    if (songs.length > uncategorized.length) html += `<div class="song-cat-hdr">Other</div>`;
    html += uncategorized.map(songRow).join('');
  }
  html += '</div>';
  return html;
}

function viewSong(sid) {
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return `<div class="empty-state"><p>Song not found.</p></div>`;

  const students = Object.values(DB.getStudents())
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
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
      <div class="inst-filter-row" style="padding-top:4px">
        <button class="inst-chip ${_songHidePassedFilter ? 'inst-active' : ''}"
                onclick="toggleSongHidePassed('${esc(sid)}')">Not Passed Only</button>
      </div>

      <input class="song-search-input" type="text" placeholder="Search by name…"
             value="${esc(_songSearch)}"
             autocomplete="off" autocorrect="off" autocapitalize="off"
             oninput="onSongSearch('${esc(sid)}',this.value)">

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
  const q = _songSearch.trim().toLowerCase();
  const filtered = students
    .filter(s => !_songSectionFilter || normInstrument(s.instrument) === _songSectionFilter)
    .filter(s => !_songHidePassedFilter || getStatus(s.number) !== 'passed')
    .filter(s => !q || (s.name || '').toLowerCase().includes(q));

  if (!filtered.length) return `<div class="empty-state" style="padding:24px"><p>No students match the current filter.</p></div>`;

  const sorted = [...filtered].sort((a,b) => (a.name||'').localeCompare(b.name||''));

  return sorted.map(s => {
    const status    = getStatus(s.number);
    const meta      = getMeta(s.number);
    const failNote  = status === 'failed' ? (statuses[String(s.number)]?.note || '') : '';
    return `
      <div class="song-stu-row">
        <div class="song-stu-info">
          <span class="song-stu-name">${esc(s.name || `#${s.number}`)}</span>
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

function onSongSearch(sid, val) {
  _songSearch = val;
  const song = STATE.songs.find(s => s.id === sid);
  if (!song) return;
  const students = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  const listEl = document.getElementById('song-student-list');
  if (listEl) listEl.innerHTML = songStudentRows(sid, students, song.statuses || {});
}

function filterSongSection(sid, section) {
  _songSectionFilter = section;
  document.getElementById('main-content').innerHTML = viewSong(sid);
}

function toggleSongHidePassed(sid) {
  _songHidePassedFilter = !_songHidePassedFilter;
  document.getElementById('main-content').innerHTML = viewSong(sid);
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
  } else {
    song.statuses[String(num)] = { status, note: note || '', updatedAt: Date.now(), updatedBy: STATE.user?.email || '' };
    orgCol('songs').doc(sid).set({ statuses: { [String(num)]: song.statuses[String(num)] } }, { merge: true });
  }

  const listEl = document.getElementById('song-student-list');
  if (listEl) {
    const students = Object.values(DB.getStudents())
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
  if (!confirm('Delete this song and all its memorization data?\n\nThis cannot be undone.')) return;
  STATE.songs = STATE.songs.filter(s => s.id !== sid);
  orgCol('songs').doc(sid).delete();
  closeModal();
  navigate('songs');
  showToast('Song deleted.');
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
  const html = viewLeaderboard();
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

function viewStudentPortal(previewMode = false) {
  const num  = STATE.studentNum;
  const s    = STATE.students[num];
  const hist = DB.getStudentHistory(num);

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
          ${(STATE.marchingLeaderboardEnabled && featureOn('stats')) ? `<div class="portal-animal-name">🐾 Leaderboard name: <strong>${esc(fakeAnimalName(num))}</strong></div>` : ''}
        </div>
      </div>

      ${(hist.length > 0 && featureOn('attendance')) ? `
        <div id="portal-sec-attendance-hdr" class="sec-hdr" onclick="toggleCollapse('portal-sec-attendance')">
          <span class="section-title" style="margin:0">Attendance</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="portal-sec-attendance" class="sec-collapsed">
          <div class="portal-stats">
            <div class="portal-stat">
              <div class="portal-stat-value">${hist.length}</div>
              <div class="portal-stat-label">Rehearsals</div>
            </div>
            ${featureOn('marks') ? `
            <div class="portal-stat">
              <div class="portal-stat-value portal-stat-mistake">${totalErr}</div>
              <div class="portal-stat-label">Mistake Marks</div>
            </div>
            <div class="portal-stat">
              <div class="portal-stat-value portal-stat-positive">${totalPos}</div>
              <div class="portal-stat-label">Positives</div>
            </div>` : ''}
          </div>
          ${(() => {
            const absences = hist.filter(({entry:e}) => e.attendance === 'absent');
            const lates    = hist.filter(({entry:e}) => e.attendance === 'late');
            if (!absences.length && !lates.length) return '';
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

      ${DB.getSongs().length > 0 ? `
        <div id="portal-sec-songs-hdr" class="sec-hdr" onclick="toggleCollapse('portal-sec-songs')">
          <span class="section-title" style="margin:0">Songs to Memorize</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="portal-sec-songs" class="sec-collapsed">
          ${(() => {
            const cats = STATE.songCategories;
            const portalSongRow = song => {
              const status  = song.statuses?.[String(num)]?.status || 'not_attempted';
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
            };
            if (!cats.length) {
              return `<div class="portal-songs-list">${STATE.songs.map(portalSongRow).join('')}</div>`;
            }
            const grouped = {};
            const uncategorized = [];
            cats.forEach(c => { grouped[c] = []; });
            STATE.songs.forEach(song => {
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
              const label = STATE.songs.length > uncategorized.length ? 'Other' : 'Songs';
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
                ${featureOn('attendance') && e.attendance==='absent' ? `<span class="portal-badge att-portal-badge-absent">Absent</span>` : ''}
                ${featureOn('attendance') && e.attendance==='late'   ? `<span class="portal-badge att-portal-badge-late">Late</span>`   : ''}
                ${featureOn('marks') && (e.mistakes  || 0) > 0 ? `<span class="portal-badge portal-badge-mistake">✗ ${e.mistakes}</span>`  : ''}
                ${featureOn('marks') && (e.positives || 0) > 0 ? `<span class="portal-badge portal-badge-positive">✓ ${e.positives}</span>` : ''}
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
        </div>
      ` : `<p class="empty-state" style="padding:24px 0">No rehearsal history yet.</p>`}

      ${featureOn('stats') ? `
      <button class="leaderboard-link-btn" onclick="${previewMode ? `previewLeaderboard('${esc(num)}')` : "navigate('leaderboard')"}">
        📊 View Band Stats &amp; Leaderboard
      </button>` : ''}
    </div>`;
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

  const statCard = (label, value, sub, cls) => `
    <div class="dash-stat">
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
        ${statCard('Positives', totalPos, null, 'dash-val-pos')}
        ${statCard('Mistakes',  totalMis, null, 'dash-val-mis')}
        ${statCard('Students Marked', `${marked}`, totalStudents ? `of ${totalStudents}` : null)}
        ${statCard('Absences', totalAbsent, _dashRid ? null : 'across all rehearsals')}
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

function viewLeaderboard() {
  const rehearsals    = [...STATE.rehearsals].sort((a,b) => b.date.localeCompare(a.date));
  const totalStudents = Object.keys(STATE.students).length;

  // ── Attendance stats ──────────────────────────────────────────────────────

  const absencesFor = rid =>
    Object.values(STATE.entries[rid] || {}).filter(e => e.attendance === 'absent').length;

  const lastRehearsal    = rehearsals[0] || null;
  const lastAbsences     = lastRehearsal ? absencesFor(lastRehearsal.id) : null;

  const { mon, fri }     = currentWeekRange();
  const weekRehearsals   = rehearsals.filter(r => r.date >= mon && r.date <= fri);
  const weekAbsences     = weekRehearsals.reduce((s, r) => s + absencesFor(r.id), 0);

  const seasonTotal      = rehearsals.reduce((s, r) => s + absencesFor(r.id), 0);
  const seasonAvg        = rehearsals.length ? (seasonTotal / rehearsals.length).toFixed(1) : '—';

  // ── Songs ─────────────────────────────────────────────────────────────────

  const songRows = DB.getSongs().map(song => {
    const passed    = Object.values(song.statuses || {}).filter(s => s.status === 'passed').length;
    const remaining = Math.max(0, totalStudents - passed);
    const pct       = totalStudents ? Math.round(passed / totalStudents * 100) : 0;
    return { song, passed, remaining, pct };
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return `
    <div class="leaderboard-view">

      ${featureOn('attendance') ? `
      <div id="lb-sec-attendance-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('lb-sec-attendance')">
        <span class="section-title" style="margin:0">Band Attendance Data</span>
        <span class="sec-chevron">▾</span>
      </div>
      <div id="lb-sec-attendance">
        <div class="card mb-12" style="padding:0;overflow:hidden">
          ${lastRehearsal ? `
          <div class="lb-stat-row">
            <div class="lb-stat-label">
              Most recent rehearsal
              <div class="lb-stat-sub">${fmtDate(lastRehearsal.date)}${lastRehearsal.label ? ' — ' + esc(lastRehearsal.label) : ''}</div>
            </div>
            <div class="lb-stat-val ${lastAbsences > 0 ? 'lb-val-warn' : 'lb-val-ok'}">
              ${lastAbsences} absent
            </div>
          </div>` : `
          <div class="lb-stat-row">
            <div class="lb-stat-label">No rehearsals yet</div>
          </div>`}
          <div class="lb-stat-row lb-stat-row-alt">
            <div class="lb-stat-label">
              This week
              <div class="lb-stat-sub">${fmtDate(mon)} – ${fmtDate(fri)} · ${weekRehearsals.length} rehearsal${weekRehearsals.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="lb-stat-val ${weekAbsences > 0 ? 'lb-val-warn' : 'lb-val-ok'}">
              ${weekRehearsals.length ? `${weekAbsences} absent` : '—'}
            </div>
          </div>
          <div class="lb-stat-row">
            <div class="lb-stat-label">
              Season average
              <div class="lb-stat-sub">${rehearsals.length} rehearsal${rehearsals.length !== 1 ? 's' : ''} total</div>
            </div>
            <div class="lb-stat-val">${seasonAvg !== '—' ? `${seasonAvg} / rehearsal` : '—'}</div>
          </div>
        </div>
      </div>` : ''}

      ${songRows.length ? `
        <div id="lb-sec-songs-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('lb-sec-songs')">
          <span class="section-title" style="margin:0">Songs to Memorize</span>
          <span class="sec-chevron">▾</span>
        </div>
        <div id="lb-sec-songs">
          ${(() => {
            const cats = STATE.songCategories;
            const lbSongRow = ({ song, passed, remaining, pct }, i) => `
              <div class="lb-song-row ${i % 2 === 1 ? 'lb-stat-row-alt' : ''}">
                <div class="lb-song-info">
                  <div class="lb-song-title">${esc(song.title)}</div>
                  ${song.dueDate ? `<div class="lb-song-due ${song.dueDate < today() && passed < totalStudents ? 'song-overdue' : ''}">Due ${fmtDate(song.dueDate)}</div>` : ''}
                  <div class="lb-prog-bar"><div class="lb-prog-fill" style="width:${pct}%"></div></div>
                </div>
                <div class="lb-song-counts">
                  <span class="lb-count-pass">${passed} passed</span>
                  <span class="lb-count-rem">${remaining} left</span>
                </div>
              </div>`;
            if (!cats.length) {
              return `<div class="card mb-12" style="padding:0;overflow:hidden">${songRows.map(lbSongRow).join('')}</div>`;
            }
            const grouped = {};
            const uncategorized = [];
            cats.forEach(c => { grouped[c] = []; });
            songRows.forEach(row => {
              if (row.song.category && grouped[row.song.category] !== undefined) grouped[row.song.category].push(row);
              else uncategorized.push(row);
            });
            let catIdx = 0;
            let html = '';
            cats.forEach(cat => {
              if (!grouped[cat].length) return;
              const id = `lb-song-cat-${catIdx++}`;
              html += `
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
              html += `
                <div id="${id}-hdr" class="sec-hdr sec-hdr-open song-cat-sec-hdr" onclick="toggleCollapse('${id}')">
                  <span>${label}</span>
                  <span class="sec-chevron">▾</span>
                </div>
                <div id="${id}">
                  <div class="card mb-12" style="padding:0;overflow:hidden">${uncategorized.map(lbSongRow).join('')}</div>
                </div>`;
            }
            return html;
          })()}
        </div>
      ` : ''}

      ${(STATE.marchingLeaderboardEnabled || STATE.isAdmin) ? (() => {
        const allScored = Object.entries(STATE.students).map(([docId, s]) => {
          const songPoints = DB.getSongs().reduce((sum, song) => {
            return sum + (song.statuses?.[String(s.number)]?.status === 'passed' ? 1 : 0);
          }, 0);
          const score = songPoints + Object.values(STATE.entries).reduce((sum, rehEntries) => {
            const e = rehEntries[String(s.number)];
            if (!e) return sum;
            return sum + (e.positives || 0) - (e.mistakes || 0)
                      - (featureOn('attendance') && e.attendance === 'absent' ? 1 : 0)
                      - (featureOn('attendance') && e.attendance === 'late'   ? 0.5 : 0);
          }, 0);
          return { docId, s, score, name: fakeAnimalName(docId), positives: Object.values(STATE.entries).reduce((sum, re) => sum + (re[String(s.number)]?.positives || 0), 0), mistakes: Object.values(STATE.entries).reduce((sum, re) => sum + (re[String(s.number)]?.mistakes || 0), 0) };
        });

        // Build scoreMap for filterAndSortStudents
        const lbScoreMap = {};
        allScored.forEach(({ s, score, positives, mistakes }) => {
          lbScoreMap[s.number] = { score, positives, mistakes };
        });

        // Apply filter+sort via unified system
        const lbStudents = allScored.map(({ s }) => s);
        // Override sortField 'score' since filterAndSortStudents handles it via scoreMap
        const filteredLbStudents = filterAndSortStudents(lbStudents, _lbFilter, lbScoreMap);
        // Map back to scored objects in filtered+sorted order
        const scored = filteredLbStudents.map(s => allScored.find(a => a.docId === (s._id || String(s.number)) || a.s === s)).filter(Boolean);

        const myDocId = STATE.studentNum;

        return `
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
            <div class="card mb-12" style="padding:0;overflow:hidden">
              ${scored.length === 0
                ? `<div class="lb-stat-row"><div class="lb-stat-label">No students match this filter.</div></div>`
                : scored.map(({ docId, s, name, score }, i) => {
                    const isMe = docId === myDocId;
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                    return `
                    <div class="lb-rank-row ${isMe ? 'lb-rank-me' : ''} ${i % 2 === 1 ? 'lb-stat-row-alt' : ''}">
                      <span class="lb-rank-medal">${medal}</span>
                      <span class="lb-rank-name">
                        ${esc(name)}${isMe ? ' <span class="lb-you-badge">you</span>' : ''}
                        ${STATE.isAdmin ? `<span class="lb-real-name">${esc(s.name || `#${s.number}`)}</span>` : ''}
                      </span>
                      <span class="lb-rank-score ${score > 0 ? 'lb-val-ok' : score < 0 ? 'lb-val-warn' : ''}">${score > 0 ? '+' : ''}${score}</span>
                    </div>`;
                  }).join('')}
            </div>
          </div>`;
      })() : ''}

    </div>`;
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
      <div style="font-size:1.4rem;font-weight:800;color:var(--primary);line-height:1;margin-bottom:8px">${esc(s.name || `#${s.number}`)}</div>
      <div class="flex gap-6" style="justify-content:center;flex-wrap:wrap">
        ${fmtPos(s.column,s.row) ? `<span class="badge badge-primary" style="font-size:0.85rem;font-weight:800">${esc(fmtPos(s.column,s.row))}</span>` : ''}
        ${s.instrument ? `<span class="badge badge-primary">${esc(normInstrument(s.instrument))}</span>` : ''}
        ${s.section    ? `<span class="badge badge-neutral">${esc(s.section)}</span>` : ''}
        ${(STATE.customStudentFields||[]).filter(cf => s[cf.key]).map(cf =>
          `<span class="badge badge-neutral">${esc(cf.label)}: ${esc(s[cf.key])}</span>`).join('')}
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-block">
        <div class="stat-value">${hist.length}</div>
        <div class="stat-label">Rehearsals</div>
      </div>
      ${featureOn('marks') ? `
      <div class="stat-block">
        <div class="stat-value" style="color:var(--danger)">${avgE}</div>
        <div class="stat-label">Avg Mistakes</div>
      </div>
      <div class="stat-block">
        <div class="stat-value" style="color:var(--success)">${avgP}</div>
        <div class="stat-label">Avg Positives</div>
      </div>` : ''}
    </div>

    ${s.notes ? `
      <div class="card mb-12">
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
                ${absences.map(({rehearsal:r}) => `<span class="att-date-chip att-chip-absent">${fmtDate(r.date)}</span>`).join('')}
              </div>` : ''}
            ${lates.length ? `
              <div class="att-date-list">
                <span class="att-date-heading">Late:</span>
                ${lates.map(({rehearsal:r}) => `<span class="att-date-chip att-chip-late">${fmtDate(r.date)}</span>`).join('')}
              </div>` : ''}
          </div>
        </div>
      `;
    })() : ''}

    ${DB.getSongs().length ? `
      <div class="section-title">Songs to Memorize</div>
      <div class="card mb-12" style="padding:8px 12px">
        ${DB.getSongs().map(song => {
          const st         = song.statuses?.[String(num)]?.status || 'not_attempted';
          const statusData = song.statuses?.[String(num)];
          const metaParts  = [];
          if (statusData && st !== 'not_attempted') {
            if (statusData.updatedAt) metaParts.push(fmtDateFromTs(statusData.updatedAt));
            if (statusData.updatedBy) metaParts.push(`by ${dirLabel(statusData.updatedBy)}`);
          }
          const meta     = metaParts.join(' ');
          const failNote = st === 'failed' ? (statusData?.note || '') : '';
          const overdue = song.dueDate && song.dueDate < today() && st !== 'passed';
          return `
          <div class="stu-song-row">
            <div class="song-stu-info">
              <span class="song-stu-name">${esc(song.title)}</span>
              ${song.dueDate ? `<span class="song-row-due ${overdue ? 'song-overdue' : ''}" style="font-size:.72rem">${overdue ? '⚠ ' : ''}Due ${fmtDate(song.dueDate)}</span>` : ''}
              <span class="song-stu-status ${st === 'passed' ? 'sss-pass' : st === 'failed' ? 'sss-fail' : 'sss-na'}">
                ${st === 'passed' ? '✓ Passed' : st === 'failed' ? '✗ Failed' : '— Not Attempted'}
              </span>
              ${meta ? `<span class="song-stu-meta">${esc(meta)}</span>` : ''}
              ${failNote ? `<span class="song-stu-fail-note">${esc(failNote)}</span>` : ''}
            </div>
            <div class="song-stu-btns">
              <button class="ssb ${st === 'passed' ? 'ssb-on-pass' : 'ssb-pass'}"
                      onclick="setSongStatus('${esc(song.id)}','${esc(String(num))}','passed')">✓</button>
              <button class="ssb ${st === 'failed' ? 'ssb-on-fail' : 'ssb-fail'}"
                      onclick="setSongStatus('${esc(song.id)}','${esc(String(num))}','failed')">✗</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    ` : ''}

    ${hist.length ? `
      <div class="section-title">Rehearsal History</div>
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
    ` : `
      <div class="empty-state" style="padding:24px">
        <p>No rehearsal data recorded yet.</p>
      </div>`}
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

  const hasOpen = rehearsals.some(r => !r.ended);
  const startBtn = STATE.isAdmin && !hasOpen
    ? `<button class="start-rehearsal-btn" onclick="showNewRehearsalModal()">+ Start a New Rehearsal</button>`
    : '';

  const grouped = {};
  for (const r of rehearsals) {
    const key = r.date.slice(0,7);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  return startBtn + Object.entries(grouped).map(([key, group]) => {
    const [y, m] = key.split('-').map(Number);
    return `
      <div class="section-title">${MONTHS[m-1]} ${y}</div>
      <div class="rh-cards-grid">${group.map(r => {
        const ents = DB.getRehearsalEntries(r.id);
        const cnt  = Object.keys(ents).length;
        const errs = Object.values(ents).reduce((s,e)=>s+(e.mistakes||0),0);
        const pos  = Object.values(ents).reduce((s,e)=>s+(e.positives||0),0);
        const ended    = !!r.ended;
        const attDone  = !!r.attendanceSubmitted;
        const stateCls = ended ? 'rh-card-ended' : 'rh-card-open';
        const activeR  = getActiveRehearsal();
        const isActive = !ended && activeR && activeR.id === r.id;
        const menuBtn = STATE.isAdmin ? `
          <div class="rh-card-menu-wrap">
            <button class="rh-card-menu-btn" onclick="event.stopPropagation();toggleRhMenu('${esc(r.id)}')" aria-label="More options">⋯</button>
            <div class="rh-card-menu-list hidden" id="rh-menu-${esc(r.id)}">
              <button class="rh-card-menu-item" onclick="showRehearsalEditModal('${esc(r.id)}')">Edit Rehearsal</button>
              <button class="rh-card-menu-item" onclick="showRehearsalPlanModal('${esc(r.id)}')">Rehearsal Plan</button>
              ${ended ? `<button class="rh-card-menu-item" onclick="reopenRehearsal('${esc(r.id)}')">Reopen Rehearsal</button>` : ''}
              <button class="rh-card-menu-item rh-menu-danger" onclick="confirmDeleteRehearsal('${esc(r.id)}')">Delete Rehearsal</button>
            </div>
          </div>` : '';
        if (!ended) {
          return `
            <div class="card rh-card ${stateCls}">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-bold">${fmtDate(r.date)}</div>
                  ${r.label ? `<div class="text-muted text-sm mt-4">${esc(r.label)}</div>` : ''}
                  <div class="rh-status-row">
                    <span class="rh-badge rh-badge-open">Open</span>
                    ${isActive ? `<span class="rh-badge rh-badge-active">Active</span>` : ''}
                    ${featureOn('attendance') && attDone ? `<span class="rh-badge rh-badge-att">Attendance ✓</span>` : ''}
                  </div>
                </div>
                <div class="flex gap-6 items-center">
                  ${featureOn('marks') ? `
                  ${cnt > 0 ? `<span class="badge badge-neutral">${cnt} tracked</span>` : ''}
                  ${errs > 0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
                  ${pos  > 0 ? `<span class="badge badge-success">${pos}✓</span>` : ''}` : ''}
                  ${menuBtn}
                </div>
              </div>
              ${STATE.isAdmin ? `
              ${featureOn('attendance') || featureOn('marks') ? `
              <div class="rh-card-actions">
                ${featureOn('attendance') ? `
                <button class="btn btn-sm ${attDone ? 'btn-success' : 'btn-primary'}"
                  onclick="navigate('attendance',{rid:'${esc(r.id)}',from:'rehearsals'})">
                  ${attDone ? '✓ Attendance Done' : '📋 Take Attendance'}
                </button>` : ''}
                ${featureOn('marks') ? `
                <button class="btn btn-sm btn-secondary"
                  onclick="switchToFeedback('${esc(r.id)}')">
                  ✏️ Student Feedback
                </button>` : ''}
              </div>` : ''}
              <button class="btn btn-sm btn-danger btn-full" style="margin-top:8px"
                onclick="confirmEndRehearsal('${esc(r.id)}')">End Rehearsal</button>` : ''}
            </div>`;
        }
        return `
          <div class="card clickable rh-card ${stateCls}" onclick="showEndedRehearsalOptions('${esc(r.id)}')">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-bold">${fmtDate(r.date)}</div>
                ${r.label ? `<div class="text-muted text-sm mt-4">${esc(r.label)}</div>` : ''}
                <div class="rh-status-row">
                  <span class="rh-badge rh-badge-ended">Ended</span>
                  ${featureOn('attendance') && attDone ? `<span class="rh-badge rh-badge-att">Attendance ✓</span>` : ''}
                </div>
              </div>
              <div class="flex gap-6 items-center">
                ${featureOn('marks') ? `
                ${cnt > 0 ? `<span class="badge badge-neutral">${cnt} tracked</span>` : ''}
                ${errs > 0 ? `<span class="badge badge-danger">${errs}✗</span>` : ''}
                ${pos  > 0 ? `<span class="badge badge-success">${pos}✓</span>` : ''}` : ''}
                ${menuBtn}
              </div>
            </div>
          </div>`;
      }).join('')}</div>`;
  }).join('');
}

// ── View: Attendance Tab ──────────────────────────────────────────────────────

function _attTabFilteredContent() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b) => b.date.localeCompare(a.date));
  const students   = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  if (!rehearsals.length) return '';

  const filterSublist = list =>
    filterAndSortStudents(list, { ..._attTabFilter, sortField: 'name', sortDir: 'asc' }, {});

  // ── Most Recent Rehearsal ─────────────────────────────────────────────────

  const latest        = rehearsals[0];
  const latestEntries = STATE.entries[latest.id] || {};
  const latestAbsent  = filterSublist(students.filter(s => latestEntries[s.number]?.attendance === 'absent'));
  const latestLate    = filterSublist(students.filter(s => latestEntries[s.number]?.attendance === 'late'));
  const latestPresent = students.length
    - students.filter(s => latestEntries[s.number]?.attendance === 'absent').length
    - students.filter(s => latestEntries[s.number]?.attendance === 'late').length;

  const stuMiniRow = s => {
    const meta = [fmtPos(s.column, s.row), normInstrument(s.instrument)].filter(Boolean).join(' · ');
    return `<div class="att-summary-stu-row">
      <span class="att-stu-name">${esc(s.name || `#${s.number}`)}</span>
      ${meta ? `<div class="att-stu-meta">${esc(meta)}</div>` : ''}
    </div>`;
  };

  const stuGroup = (label, list, cls) => list.length ? `
    <div class="att-summary-section-hdr ${cls}">${label} — ${list.length} student${list.length !== 1 ? 's' : ''}</div>
    <div class="att-summary-list">${list.map(stuMiniRow).join('')}</div>` : '';

  const latestSubmitted = !!latest.attendanceSubmitted;
  const recentSection = `
    <div id="att-tab-recent-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-recent')">
      <span class="section-title" style="margin:0">Most Recent — ${esc(fmtDate(latest.date))}${latest.label ? ' · ' + esc(latest.label) : ''}</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-recent">
      ${latestSubmitted ? `
        <div class="att-screen-summary-bar" style="padding:8px 0 10px">
          <span class="att-summary-chip att-chip-absent">${latestAbsent.length} Absent</span>
          <span class="att-summary-chip att-chip-late">${latestLate.length} Late</span>
          <span class="att-summary-chip att-chip-present">${latestPresent} Present</span>
        </div>
        ${stuGroup('Absent', latestAbsent, 'att-summary-hdr-absent')}
        ${stuGroup('Late',   latestLate,   'att-summary-hdr-late')}
        ${!latestAbsent.length && !latestLate.length
          ? `<div class="empty-state" style="padding:12px 0 4px"><p>${_attTabFilter.search || _attTabFilter.instruments.length || _attTabFilter.grades.length || _attTabFilter.sections.length ? 'No matches for current filter.' : 'Everyone was present!'}</p></div>`
          : ''}
      ` : `
        <div class="empty-state" style="padding:12px 0 4px"><p>Attendance not submitted yet.</p></div>
      `}
      <button class="btn btn-secondary" style="width:100%;margin:12px 0 4px"
              onclick="navigate('attendance',{rid:'${esc(latest.id)}',from:'attendance-tab'})">
        View Full Attendance
      </button>
    </div>`;

  // ── Season Absence Summary ────────────────────────────────────────────────

  const submitted = rehearsals.filter(r => r.attendanceSubmitted);
  const seasonMap = {};
  for (const r of submitted) {
    const entries = STATE.entries[r.id] || {};
    for (const s of students) {
      const att = entries[s.number]?.attendance;
      if (att === 'absent' || att === 'late') {
        if (!seasonMap[s.number]) seasonMap[s.number] = { s, absences: 0, lates: 0 };
        if (att === 'absent') seasonMap[s.number].absences++;
        else                  seasonMap[s.number].lates++;
      }
    }
  }

  const seasonScoreMap = {};
  for (const [num, d] of Object.entries(seasonMap)) seasonScoreMap[num] = { absences: d.absences, lates: d.lates };
  const seasonStudents  = Object.values(seasonMap).map(d => d.s);
  const filteredSeason  = filterAndSortStudents(seasonStudents, _attTabFilter, seasonScoreMap);

  const seasonSection = `
    <div id="att-tab-season-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-season')">
      <span class="section-title" style="margin:0">Season Absences</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-season">
      ${!submitted.length
        ? `<div class="empty-state" style="padding:12px 0"><p>No submitted rehearsals yet.</p></div>`
        : !filteredSeason.length
          ? `<div class="empty-state" style="padding:12px 0"><p>${seasonStudents.length ? 'No matches for current filter.' : 'Perfect attendance so far!'}</p></div>`
          : filteredSeason.map(s => {
              const { absences, lates } = seasonMap[s.number];
              const meta = [fmtPos(s.column, s.row), normInstrument(s.instrument)].filter(Boolean).join(' · ');
              return `<div class="att-season-row">
                <div class="att-stu-info">
                  <span class="att-stu-name">${esc(s.name || `#${s.number}`)}</span>
                  ${meta ? `<div class="att-stu-meta">${esc(meta)}</div>` : ''}
                </div>
                <div class="att-season-chips">
                  ${absences ? `<span class="att-summary-chip att-chip-absent">${absences} absent</span>` : ''}
                  ${lates    ? `<span class="att-summary-chip att-chip-late">${lates} late</span>`        : ''}
                </div>
              </div>`;
            }).join('')
      }
    </div>`;

  return recentSection + seasonSection;
}

function viewAttendanceTab() {
  const rehearsals = [...DB.getRehearsals()].sort((a,b) => b.date.localeCompare(a.date));
  const students   = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));

  if (!rehearsals.length) {
    return `<div class="empty-state"><p>No rehearsals yet.</p></div>`;
  }

  // ── Open-rehearsal attendance CTA ─────────────────────────────────────────

  const openReh = STATE.isAdmin ? getActiveRehearsal() : null;
  let attendanceCta = '';
  if (openReh) {
    if (!openReh.attendanceSubmitted) {
      attendanceCta = `<button class="start-rehearsal-btn"
        onclick="navigate('attendance',{rid:'${esc(openReh.id)}',from:'attendance-tab'})">
        📋 Take Attendance — ${esc(fmtDate(openReh.date))}${openReh.label ? ' · ' + esc(openReh.label) : ''}
      </button>`;
    } else {
      attendanceCta = `<button class="start-rehearsal-btn att-modify-att-btn"
        onclick="confirmModifyAttendance('${esc(openReh.id)}')">
        ✏️ Modify Current Rehearsal Attendance
      </button>`;
    }
  }

  // ── Filter bar ────────────────────────────────────────────────────────────

  const filterBar = renderFilterBar('att-tab', _attTabFilter, [
    { value: 'absences',   label: 'Most Absent' },
    { value: 'lates',      label: 'Most Late'   },
    { value: 'name',       label: 'Name'        },
    { value: 'instrument', label: 'Instrument'  },
    { value: 'grade',      label: 'Grade'       },
  ]);

  // ── Rehearsal History (not affected by filter) ────────────────────────────

  const historyRows = rehearsals.map(r => {
    const entries = STATE.entries[r.id] || {};
    const total   = students.length;
    const absent  = Object.values(entries).filter(e => e.attendance === 'absent').length;
    const late    = Object.values(entries).filter(e => e.attendance === 'late').length;
    const present = total - absent - late;
    const attDone = !!r.attendanceSubmitted;
    const summary = total
      ? [absent ? `${absent} absent` : '', late ? `${late} late` : '', `${present} present`].filter(Boolean).join(' · ')
      : 'No students in roster';
    return `
      <div class="card clickable att-tab-row" onclick="navigate('attendance',{rid:'${esc(r.id)}',from:'attendance-tab'})">
        <div class="att-tab-row-top">
          <div>
            <div class="font-bold">${fmtDate(r.date)}</div>
            ${r.label ? `<div class="text-muted text-sm mt-4">${esc(r.label)}</div>` : ''}
          </div>
          ${attDone
            ? `<span class="rh-badge rh-badge-att">Submitted ✓</span>`
            : `<span class="rh-badge rh-badge-open">Not submitted</span>`}
        </div>
        <div class="att-tab-row-summary">${summary}</div>
      </div>`;
  }).join('');

  const historySection = `
    <div id="att-tab-history-hdr" class="sec-hdr sec-hdr-open" onclick="toggleCollapse('att-tab-history')">
      <span class="section-title" style="margin:0">Rehearsal History</span>
      <span class="sec-chevron">▾</span>
    </div>
    <div id="att-tab-history">
      ${historyRows}
    </div>`;

  return attendanceCta + filterBar
    + `<div id="att-tab-filtered">${_attTabFilteredContent()}</div>`
    + historySection;
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
    .sort(([a],[b]) => (students[a]?.name || '').localeCompare(students[b]?.name || ''));

  // Active student card — shared across block and normal modes
  const activeCard = _activeNum ? `
    <div class="active-card">
      <div class="active-card-header">
        <div class="active-card-name">
          ${activeStu ? esc(activeStu.name || `#${_activeNum}`) : `#${esc(_activeNum)}`}
          ${activeStu
            ? `<span class="sub">${esc([fmtPos(activeStu.column,activeStu.row),normInstrument(activeStu.instrument)].filter(Boolean).join(' · '))}</span>`
            : '<span class="sub" style="color:var(--warning)"> Not in roster</span>'}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${activeStu ? `
          <button class="active-card-close" onclick="navigate('student',{num:'${esc(_activeNum)}'})" aria-label="View student profile" title="View student profile">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>` : ''}
          <button class="active-card-close" onclick="clearActive()" aria-label="Dismiss">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:18px;height:18px">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
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
        ${_blockMode ? '← Back to Block Grid' : 'Submit Feedback'}
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
    const suggestions  = isNameSearch ? studentSuggestions(_numSearch, _trackerFilter.instruments[0] || '', _trackerFilter.grades[0] || '') : [];
    const activeFilterCount = _trackerFilter.instruments.length + _trackerFilter.grades.length + _trackerFilter.sections.length;
    // Only show the full student list when a filter is active — not by default
    const showAllForFilter = !_numSearch.trim() && activeFilterCount > 0;
    const allFiltered = showAllForFilter
      ? filterAndSortStudents(Object.values(students), _trackerFilter)
      : [];
    const activeFilterLabel = [
      ..._trackerFilter.instruments,
      ..._trackerFilter.grades.map(g => g + ' Grade')
    ].filter(Boolean).join(', ');

    trackerSection = `
      <div class="tracker-card">
        ${!_activeNum ? `
          <div class="tracker-label">Track a Student</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <div style="flex:1">
              ${renderFilterBar('tracker', _trackerFilter, [
                {value:'name',       label:'Name'},
                {value:'number',     label:'Number'},
                {value:'instrument', label:'Instrument'},
                {value:'section',    label:'Section'},
                {value:'grade',      label:'Grade'}
              ])}
            </div>
            <button class="inst-chip tracker-grid-btn" title="Open Block Grid" onclick="toggleBlockMode('${esc(rid)}')" style="flex-shrink:0;margin-bottom:12px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;display:block">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </button>
          </div>
          <button class="mark-all-btn" onclick="showMarkAllModal('${esc(rid)}')">
            Mark All${activeFilterLabel ? ` (${esc(activeFilterLabel)})` : ''}
          </button>
          <input class="num-input" type="text" inputmode="text"
                 id="num-input" placeholder="Search by name or number…"
                 value="${esc(_numSearch)}"
                 autocomplete="off" autocorrect="off" autocapitalize="off"
                 oninput="onNumInput(this.value,'${esc(rid)}')"
                 onkeydown="onNumKey(event,'${esc(rid)}')">
          <div id="tracker-suggestions" class="student-suggestions">
            ${isNameSearch ? suggestions.map(s => `
              <div class="suggestion-row" onclick="pickStudent('${esc(s.number)}','${esc(rid)}')">
                <span class="suggestion-name">${esc(s.name || `#${s.number}`)}</span>
                <span class="suggestion-detail">${esc([fmtPos(s.column,s.row),normInstrument(s.instrument)].filter(Boolean).join(' · '))}</span>
              </div>`).join('') : ''}
            ${showAllForFilter ? allFiltered.map(s => `
              <div class="suggestion-row" onclick="pickStudent('${esc(s.number)}','${esc(rid)}')">
                <span class="suggestion-name">${esc(s.name || `#${s.number}`)}</span>
                <span class="suggestion-detail">${esc(fmtPos(s.column,s.row))}</span>
              </div>`).join('') : ''}
            ${!isNameSearch && !showAllForFilter ? `
              <div class="tracker-hint">Search by name or number, or use filters to find students.</div>` : ''}
          </div>
        ` : ''}
        ${activeCard}
      </div>`;
  }

  // Attendance summary for the button
  const allEntries  = STATE.entries[rid] || {};
  const attAbsent   = Object.values(allEntries).filter(e => e.attendance === 'absent').length;
  const attLate     = Object.values(allEntries).filter(e => e.attendance === 'late').length;
  const totalRoster = Object.keys(STATE.students).length;
  const attSummary  = (attAbsent || attLate) ? [
    attAbsent ? `${attAbsent} absent` : '',
    attLate   ? `${attLate} late`     : '',
    `${totalRoster - attAbsent - attLate} present`
  ].filter(Boolean).join(' · ') : '';

  const attSubmitted = r?.attendanceSubmitted;
  const showAttBtn   = _view !== 'dashboard' && featureOn('attendance');
  const dashHeading  = _view === 'dashboard' ? `
    <div class="dash-reh-heading">
      Student Feedback for ${esc(fmtDate(r.date))}${r.label ? ` — ${esc(r.label)}` : ''}
    </div>` : '';
  return `
    ${dashHeading}
    ${showAttBtn ? `
    <div class="rehearsal-action-row">
      <button class="att-screen-btn ${attSubmitted ? 'att-screen-btn-done' : ''}" style="flex:1;margin-bottom:0" onclick="navigate('attendance',{rid:'${esc(rid)}'})">
        <div class="att-screen-btn-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          ${attSubmitted ? 'Attendance ✓' : 'Take Attendance'}
        </div>
        ${attSummary ? `<div class="att-screen-btn-summary">${attSummary}</div>` : ''}
      </button>
    </div>` : ''}

    ${trackerSection}

    ${entryList.length ? `
      <div class="section-title">Tracked This Rehearsal (${entryList.length})</div>
      ${entryList.map(([num, entry]) => {
        const stu = students[num];
        return `
          <div class="entry-row ${_activeNum===num?'is-active':''}"
               onclick="pickStudent('${esc(num)}','${esc(rid)}')">
            <div class="entry-header">
              <div class="entry-student">
                ${stu ? esc(stu.name || `#${num}`) : `#${esc(num)}`}
                ${stu ? `<span class="sub">${esc([fmtPos(stu.column,stu.row),normInstrument(stu.instrument)].filter(Boolean).join(' · '))}</span>` : '<span class="sub" style="color:var(--warning)">Not in roster</span>'}
              </div>
              <div class="entry-badges">
                ${entry.attendance==='absent' ? `<span class="badge att-badge-absent">Absent</span>` : ''}
                ${entry.attendance==='late'   ? `<span class="badge att-badge-late">Late</span>`   : ''}
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
      const matches = studentSuggestions(trimmed, _trackerFilter.instruments[0] || '', _trackerFilter.grades[0] || '');
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
      _numSearch = STATE.students[num]?.name || _numSearch;
      reRender(rid);
    }
  }
}

function pickStudent(num, rid) {
  _activeNum = num;
  _numSearch = STATE.students[num]?.name || '';
  document.getElementById('main-content').scrollTop = 0;
  reRender(rid);
}

function clearActive() {
  _activeNum = null;
  _numSearch = '';
  if (!_blockMode) {
    const inp = document.getElementById('num-input');
    if (inp) inp.value = '';
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
  const presets   = isMistake ? STATE.mistakePresets : STATE.positivePresets;
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
  _recalcAutoBonuses(rid, num);
  reRender(rid);
}

function confirmMarkCustom(rid, num, type) {
  const note = document.getElementById('mark-note-input')?.value.trim() || '';
  confirmMark(rid, num, type, note);
}

// ── Attendance Screen ─────────────────────────────────────────────────────────

function viewAttendanceSummary(rid) {
  const students = Object.values(DB.getStudents()).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  const entries  = STATE.entries[rid] || {};

  const absent = students.filter(s => entries[s.number]?.attendance === 'absent');
  const late   = students.filter(s => entries[s.number]?.attendance === 'late');
  const present = students.length - absent.length - late.length;

  const stuRow = s => {
    const meta = [fmtPos(s.column, s.row), normInstrument(s.instrument)].filter(Boolean).join(' · ');
    return `<div class="att-summary-stu-row">
      <span class="att-stu-name">${esc(s.name || `#${s.number}`)}</span>
      ${meta ? `<div class="att-stu-meta">${esc(meta)}</div>` : ''}
    </div>`;
  };

  const section = (label, list, cls) => list.length ? `
    <div class="att-summary-section-hdr ${cls}">${label} — ${list.length} student${list.length !== 1 ? 's' : ''}</div>
    <div class="att-summary-list">${list.map(stuRow).join('')}</div>` : '';

  return `
    <div class="att-submitted-banner">✓ Attendance submitted</div>

    <div class="att-screen-summary-bar">
      <span class="att-summary-chip att-chip-absent">${absent.length} Absent</span>
      <span class="att-summary-chip att-chip-late">${late.length} Late</span>
      <span class="att-summary-chip att-chip-present">${present} Present</span>
    </div>

    <button class="btn btn-secondary" style="width:100%;margin-bottom:20px"
            onclick="enterAttModifyMode('${esc(rid)}')">Edit Attendance</button>

    ${section('Absent', absent, 'att-summary-hdr-absent')}
    ${section('Late',   late,   'att-summary-hdr-late')}

    ${!absent.length && !late.length
      ? `<div class="empty-state"><p>Everyone was present!</p></div>`
      : ''}
  `;
}

function enterAttModifyMode(rid) {
  _attModifyMode = true;
  reRender(rid);
}

function confirmModifyAttendance(rid) {
  showConfirmModal(
    'Modify Submitted Attendance',
    'Attendance for this rehearsal has already been submitted. Are you sure you want to make changes?',
    () => {
      _attModifyMode = true;
      navigate('attendance', { rid, from: 'attendance-tab' });
    },
    'Modify',
    'btn-primary'
  );
}

function viewAttendance(rid) {
  const r        = STATE.rehearsals.find(r => r.id === rid);
  const students = Object.values(DB.getStudents());
  const entries  = STATE.entries[rid] || {};
  if (!students.length) {
    return `<div class="empty-state"><p>No students in the roster yet.</p></div>`;
  }

  const submitted = r?.attendanceSubmitted || false;
  if (submitted && !_attModifyMode) return viewAttendanceSummary(rid);
  const absent   = students.filter(s => entries[s.number]?.attendance === 'absent').length;
  const late     = students.filter(s => entries[s.number]?.attendance === 'late').length;
  const unmarked = students.length - absent - late;

  // Build attMap for status-based sorting
  const attMap = {};
  students.forEach(s => {
    attMap[s.number] = { att: entries[s.number]?.attendance || 'present' };
  });

  return `
    ${submitted ? `
      <div class="att-submitted-banner">
        ✓ Attendance submitted — changes require confirmation
      </div>` : ''}

    <div class="att-screen-summary-bar">
      <span class="att-summary-chip att-chip-absent">${absent} Absent</span>
      <span class="att-summary-chip att-chip-late">${late} Late</span>
      <span class="att-summary-chip att-chip-present">${unmarked} Present</span>
    </div>

    ${renderFilterBar('att', _attFilter, [
      {value:'name',      label:'Name'},
      {value:'number',    label:'Number'},
      {value:'instrument',label:'Instrument'},
      {value:'grade',     label:'Grade'},
      {value:'attStatus', label:'Status'}
    ])}

    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn btn-secondary" style="flex:1" onclick="markAllPresent('${esc(rid)}')">
        ✓ Mark All Present
      </button>
      ${!submitted ? `
        <button class="btn btn-primary" style="flex:1" onclick="showSubmitAttendanceModal('${esc(rid)}')">
          Submit Attendance
        </button>` : ''}
    </div>

    <div class="att-student-list" id="att-student-list">
      ${buildAttBodyHtml(rid, students, entries)}
    </div>
  `;
}


function buildAttBodyHtml(rid, students, entries) {
  const attMap = {};
  students.forEach(s => {
    attMap[s.number] = { att: entries[s.number]?.attendance || 'present' };
  });

  const pool = filterAndSortStudents(students, _attFilter, attMap);

  if (!pool.length) {
    const hasFilter = _attFilter.search || _attFilter.instruments.length || _attFilter.grades.length || _attFilter.sections.length;
    const msg = hasFilter ? 'No students match the current filter.' : 'No students in this group.';
    return `<div class="empty-state" style="padding:24px"><p>${msg}</p></div>`;
  }

  return pool.map(s => attStudentRow(rid, s, entries)).join('');
}

// filterAttendanceList replaced by updateFilter / unified filter bar

function attStudentRow(rid, s, entries) {
  const att  = entries[s.number]?.attendance || null; // null = unmarked = present
  const meta = [fmtPos(s.column, s.row), normInstrument(s.instrument)].filter(Boolean).join(' · ');
  return `
    <div class="att-stu-row ${att === 'absent' ? 'att-stu-absent' : att === 'late' ? 'att-stu-late' : ''}">
      <div class="att-stu-info">
        <span class="att-stu-name">${esc(s.name || `#${s.number}`)}</span>
        ${meta ? `<div class="att-stu-meta">${esc(meta)}</div>` : ''}
      </div>
      <div class="att-stu-btns">
        <button class="att-btn att-late   ${att==='late'   ?'att-on-late':''}"
                onclick="setAttendance('${esc(rid)}','${esc(s.number)}','late')">◷ Late</button>
        <button class="att-btn att-absent ${att==='absent' ?'att-on-absent':''}"
                onclick="setAttendance('${esc(rid)}','${esc(s.number)}','absent')">✗ Absent</button>
      </div>
    </div>`;
}

// setAttendanceFilter replaced by updateFilter / unified filter bar

async function markAllPresent(rid) {
  const entries = STATE.entries[rid] || {};
  const marked  = Object.entries(entries).filter(([, e]) => e.attendance);
  if (!marked.length) { showToast('All students already marked present.'); return; }
  const batch = db.batch();
  for (const [num] of marked) {
    const docId = `${rid}_${num}`;
    batch.update(orgCol('entries').doc(docId), {
      attendance: firebase.firestore.FieldValue.delete()
    });
    STATE.entries[rid][num] = { ...STATE.entries[rid][num], attendance: null };
  }
  await batch.commit();
  showToast(`${marked.length} student${marked.length !== 1 ? 's' : ''} marked present.`);
  reRender(rid);
}

function setAttendance(rid, num, status) {
  const ents = DB.getRehearsalEntries(rid);
  const cur  = ents[num] || { mistakes:0, positives:0, notes:'', events:[] };
  const prev = cur.attendance || null;
  const next = prev === status ? null : status; // tap active = clear

  const apply = () => _applyAttendance(rid, num, cur, next);

  const r = STATE.rehearsals.find(r => r.id === rid);
  if (r?.attendanceSubmitted) {
    const s = STATE.students[String(num)];
    const name = s?.name || `#${num}`;
    const fromLabel = prev === 'absent' ? 'Absent' : prev === 'late' ? 'Late' : 'Present';
    const toLabel   = next === 'absent' ? 'Absent' : next === 'late' ? 'Late' : 'Present';
    showConfirmModal(
      'Attendance Already Submitted',
      `Change ${name} from <strong>${fromLabel}</strong> to <strong>${toLabel}</strong>?`,
      apply,
      'Change',
      'btn-primary'
    );
    return;
  }

  apply();
}

function _recalcAutoBonuses(rid, num) {
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r?.ended) return;
  const entry = STATE.entries[rid]?.[num];
  if (!entry) return;

  const att = entry.attendance || 'present';
  const baseEvents = (entry.events || []).filter(e =>
    e.note !== 'On time to rehearsal' && e.note !== 'No noticeable mistakes'
  );

  const isOnTime   = att !== 'late' && att !== 'absent';
  const noMistakes = att !== 'absent' && baseEvents.filter(e => e.type === 'mistake').length === 0;

  const events = [...baseEvents];
  if (isOnTime)   events.push({ type: 'positive', note: 'On time to rehearsal',   ts: Date.now(), by: 'system', auto: true });
  if (noMistakes) events.push({ type: 'positive', note: 'No noticeable mistakes', ts: Date.now(), by: 'system', auto: true });

  const positives = events.filter(e => e.type === 'positive').length;
  STATE.entries[rid][num] = { ...entry, events, positives };
  fsUpsertEntry(rid, num, {
    mistakes:  entry.mistakes || 0,
    positives,
    notes:     entry.notes   || '',
    events,
    ...(entry.attendance ? { attendance: entry.attendance } : {})
  });
}

function _applyAttendance(rid, num, cur, next) {
  if (!STATE.entries[rid]) STATE.entries[rid] = {};
  STATE.entries[rid][num] = { ...cur, attendance: next };
  const docId = `${rid}_${String(num)}`;
  if (!next) {
    orgCol('entries').doc(docId).update({
      attendance: firebase.firestore.FieldValue.delete()
    }).catch(() => {});
  } else {
    fsUpsertEntry(rid, num, {
      mistakes:  cur.mistakes  || 0,
      positives: cur.positives || 0,
      notes:     cur.notes     || '',
      events:    cur.events    || [],
      attendance: next
    });
  }
  _recalcAutoBonuses(rid, num);
  reRender(rid);
}

function showSubmitAttendanceModal(rid) {
  const stuMap  = DB.getStudents();
  const entries = STATE.entries[rid] || {};
  const nameOf  = num => stuMap[num]?.name || `#${num}`;

  const absentList = Object.entries(entries)
    .filter(([, e]) => e.attendance === 'absent')
    .map(([num]) => nameOf(num));
  const lateList = Object.entries(entries)
    .filter(([, e]) => e.attendance === 'late')
    .map(([num]) => nameOf(num));

  const noMarks = !absentList.length && !lateList.length;

  _pendingConfirm = () => submitAttendance(rid);
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Submit Attendance</div>
    ${noMarks ? `
      <p style="font-size:.9rem;color:var(--text-muted);margin-bottom:16px;line-height:1.5">
        No absences or late arrivals recorded — everyone is marked present.
      </p>` : ''}
    ${absentList.length ? `
      <div class="att-review-section">
        <div class="att-review-hdr att-chip-absent">✗ Absent (${absentList.length})</div>
        ${absentList.map(n => `<div class="att-review-name">${esc(n)}</div>`).join('')}
      </div>` : ''}
    ${lateList.length ? `
      <div class="att-review-section">
        <div class="att-review-hdr att-chip-late">◷ Late (${lateList.length})</div>
        ${lateList.map(n => `<div class="att-review-name">${esc(n)}</div>`).join('')}
      </div>` : ''}
    <p style="font-size:.8rem;color:var(--text-muted);margin-top:12px">
      After submitting, any changes will require confirmation.
    </p>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="runPendingConfirm()">Submit</button>
    </div>
  `);
}

function submitAttendance(rid) {
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  r.attendanceSubmitted = true;
  orgCol('rehearsals').doc(rid).set({ attendanceSubmitted: true }, { merge: true });
  showToast('Attendance submitted.');
  _attModifyMode = false;
  reRender(rid);
}

// ── Group Marks ───────────────────────────────────────────────────────────────

function showMarkAllModal(rid) {
  const instParts  = _trackerFilter.instruments;
  const gradeParts = _trackerFilter.grades;
  const hasFilter  = instParts.length || gradeParts.length;
  // Store filter snapshot so _groupMatches can apply OR-within/AND-across logic
  _pendingMarkAllFilter = hasFilter ? { instruments: [...instParts], grades: [...gradeParts] } : null;
  const groupName  = hasFilter ? '__filtered__' : '__all__';
  const filterLabel = [
    instParts.join(', '),
    gradeParts.map(g => g + ' Grade').join(', ')
  ].filter(Boolean).join(', ') || 'entire band';
  const count = Object.values(STATE.students).filter(s =>
    (!instParts.length  || instParts.includes(normInstrument(s.instrument))) &&
    (!gradeParts.length || gradeParts.includes(s.grade || ''))
  ).length;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Mark All
      <div style="font-size:0.78rem;font-weight:400;color:var(--text-muted);margin-top:2px">${esc(filterLabel)} · ${count} student${count!==1?'s':''}</div>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-mistake" onclick="closeModal();showGroupMarkModal('${esc(rid)}','${esc(groupName)}','mistake')">✗ Mistake</button>
      <button class="btn btn-success" onclick="closeModal();showGroupMarkModal('${esc(rid)}','${esc(groupName)}','positive')">✓ Positive</button>
    </div>
  `);
}

function showGroupPickerModal(rid) {
  const instruments = instrumentsInRoster();
  const sections    = sectionsInRoster();

  const chipRow = (items) => items.map(name =>
    `<button class="seg-chip" onclick="selectGroupChip('${esc(name)}')">${esc(name)}</button>`
  ).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Mark a Group</div>
    <div class="form-group" style="margin-bottom:14px">
      <label class="form-label">Group name</label>
      <input class="form-input" id="group-name-input" type="text"
             placeholder="e.g. Flute, Woodwinds…"
             autocomplete="off" autocapitalize="words">
    </div>
    ${instruments.length ? `
      <div class="form-label" style="margin-bottom:6px">By Instrument</div>
      <div class="seg-chip-row" style="flex-wrap:wrap;margin-bottom:${sections.length ? '14px' : '4px'}">${chipRow(instruments)}</div>` : ''}
    ${sections.length ? `
      <div class="form-label" style="margin-bottom:6px">By Section</div>
      <div class="seg-chip-row" style="flex-wrap:wrap;margin-bottom:4px">${chipRow(sections)}</div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-mistake"   onclick="pickGroupMark('${esc(rid)}','mistake')">✗ Mark</button>
      <button class="btn btn-success"   onclick="pickGroupMark('${esc(rid)}','positive')">✓ Positive</button>
    </div>
  `);
}

function selectGroupChip(name) {
  const inp = document.getElementById('group-name-input');
  if (inp) inp.value = name;
}

function pickGroupMark(rid, type) {
  const groupName = document.getElementById('group-name-input')?.value.trim();
  if (!groupName) { showToast('Enter or select a group name.'); return; }
  showGroupMarkModal(rid, groupName, type);
}

function _groupMatches(s, groupName) {
  if (groupName === '__all__') return true;
  // Multi-select mark-all: uses stored filter snapshot (OR within category, AND across)
  if (groupName === '__filtered__') {
    const f = _pendingMarkAllFilter;
    if (!f) return true;
    return (!f.instruments.length || f.instruments.includes(normInstrument(s.instrument))) &&
           (!f.grades.length      || f.grades.includes(s.grade || ''));
  }
  // Custom group name (from showGroupPickerModal) — pipe-separated, ALL parts must match
  const parts = groupName.split('|');
  return parts.every(part => {
    const p = part.trim().toLowerCase();
    return normInstrument(s.instrument).toLowerCase() === p ||
           (s.section || '').toLowerCase() === p ||
           (s.grade   || '').toLowerCase() === p;
  });
}

function showGroupMarkModal(rid, groupName, type) {
  const isMistake   = type === 'mistake';
  const presets     = isMistake ? STATE.mistakePresets : STATE.positivePresets;
  const btnCls      = isMistake ? 'is-mistake' : 'is-positive';
  const r           = DB.getRehearsals().find(r => r.id === rid);
  const segments    = r?.segments || [];
  const isAll       = groupName === '__all__';
  const displayName = isAll ? 'All Students' : groupName;
  const students    = isAll
    ? Object.values(DB.getStudents())
    : Object.values(DB.getStudents()).filter(s => _groupMatches(s, groupName));

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
    <div class="modal-handle"></div>
    <div class="modal-title">${isMistake ? '✗' : '✓'} ${esc(displayName)}
      <div style="font-size:0.78rem;font-weight:400;color:var(--text-muted);margin-top:2px">${students.length} student${students.length!==1?'s':''}</div>
    </div>
    ${segHtml}
    <div class="quick-note-grid">
      ${presets.map(p => `
        <button class="quick-note-btn ${btnCls}"
          onclick="confirmGroupMark('${esc(rid)}','${esc(groupName)}','${esc(type)}','${esc(p)}')">
          ${esc(p)}
        </button>`).join('')}
    </div>
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">Custom note</label>
      <input class="form-input" id="mark-note-input" type="text"
             placeholder="or type your own…" autocomplete="off"
             onkeydown="if(event.key==='Enter')confirmGroupMarkCustom('${esc(rid)}','${esc(groupName)}','${esc(type)}')">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="confirmGroupMark('${esc(rid)}','${esc(groupName)}','${esc(type)}','')">No Note</button>
      <button class="btn btn-primary" onclick="confirmGroupMarkCustom('${esc(rid)}','${esc(groupName)}','${esc(type)}')">Add Custom</button>
    </div>
  `);
}

function confirmGroupMarkCustom(rid, groupName, type) {
  const note = document.getElementById('mark-note-input')?.value.trim() || '';
  confirmGroupMark(rid, groupName, type, note);
}

async function confirmGroupMark(rid, groupName, type, note) {
  const segment = _pendingSegment;
  closeModal();
  const isAll   = groupName === '__all__';
  const stuList = isAll
    ? Object.values(STATE.students)
    : Object.values(STATE.students).filter(s => _groupMatches(s, groupName));
  if (!stuList.length) { showToast('No students found.'); return; }
  const field   = type === 'mistake' ? 'mistakes' : 'positives';
  const batch   = db.batch();
  const sectionLabel = isAll ? 'All Students' : groupName;
  const evt     = { type, note: note || '', segment, ts: Date.now(), by: STATE.user?.email || '', sectionMark: true, section: sectionLabel };

  for (const stu of stuList) {
    const num    = String(stu.number || stu._id);
    const cur    = STATE.entries[rid]?.[num] || { mistakes: 0, positives: 0, notes: '', events: [] };
    const events = [...(cur.events || []), evt];
    const newVal = (cur[field] || 0) + 1;
    if (!STATE.entries[rid]) STATE.entries[rid] = {};
    STATE.entries[rid][num] = { ...cur, [field]: newVal, events };
    const att = cur.attendance || null;
    batch.set(orgCol('entries').doc(`${rid}_${num}`), {
      rehearsalId: rid, studentNumber: num,
      mistakes:  STATE.entries[rid][num].mistakes,
      positives: STATE.entries[rid][num].positives,
      notes: cur.notes || '', events,
      ...(att ? { attendance: att } : {}),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: STATE.user?.email || ''
    }, { merge: true });
  }

  try {
    await batch.commit();
  } catch (e) {
    showToast('Write failed — check your connection.');
    return;
  }
  showToast(`${type === 'positive' ? 'Positive' : 'Mark'} applied to ${stuList.length} ${esc(sectionLabel)} student${stuList.length!==1?'s':''}.`);
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
  _recalcAutoBonuses(rid, num);
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
        const bcName = num ? (students[num]?.name || `#${num}`) : '';
        gridHtml += `
          <div class="block-cell ${cls}" onclick="${fn}">
            <div class="bc-pos">${esc(pos)}</div>
            ${bcName ? `<div class="bc-num">${esc(bcName)}</div>` : ''}
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
  if (_view === 'student') {
    mc.innerHTML = viewStudent(_params.num);
  } else if (_view === 'attendance') {
    mc.innerHTML = viewAttendance(rid);
  } else if (_view === 'rehearsal' || _view === 'dashboard') {
    mc.innerHTML = viewRehearsal(rid);
    if (_blockMode && !_activeNum) initBlockPinch(rid);
  }
  mc.scrollTop = st;
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
    ${(hasField('column')||hasField('row')) ? `
    <div style="display:grid;grid-template-columns:${hasField('column')&&hasField('row')?'1fr 1fr':'1fr'};gap:12px">
      ${hasField('column') ? `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">Column (A–L)</label>
        <select class="form-select" id="m-column">
          <option value="">—</option>
          ${COLUMNS.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>` : ''}
      ${hasField('row') ? `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">Row (1–12)</label>
        <select class="form-select" id="m-row">
          <option value="">—</option>
          ${ROWS.map(r=>`<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>` : ''}
    </div>` : ''}
    ${hasField('instrument') ? `<div class="form-group">
      <label class="form-label">Instrument</label>
      <select class="form-select" id="m-instrument">
        <option value="">— Select instrument —</option>
        ${STATE.instruments.map(i=>`<option value="${esc(i)}">${esc(i)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('section') ? `<div class="form-group">
      <label class="form-label">Section</label>
      <select class="form-select" id="m-section">
        <option value="">— Select section —</option>
        ${STATE.sections.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('grade') ? `<div class="form-group">
      <label class="form-label">Grade</label>
      <select class="form-select" id="m-grade">
        <option value="">— Select grade —</option>
        ${GRADE_LEVELS.map(g=>`<option value="${g}">${g} Grade</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('notes') ? `<div class="form-group">
      <label class="form-label">Director Notes (optional)</label>
      <textarea class="form-textarea" id="m-notes" placeholder="Any notes about this student…"></textarea>
    </div>` : ''}
    ${(STATE.customStudentFields||[]).map(cf => `<div class="form-group">
      <label class="form-label">${esc(cf.label)}</label>
      <input class="form-input" id="m-cf-${cf.key}" type="text" autocomplete="off">
    </div>`).join('')}
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
    number: num,
    name:   document.getElementById('m-name').value.trim(),
    songs:  []
  };
  if (hasField('column'))     student.column     = document.getElementById('m-column')?.value     || '';
  if (hasField('row'))        student.row        = document.getElementById('m-row')?.value        || '';
  if (hasField('instrument')) student.instrument = document.getElementById('m-instrument')?.value || '';
  if (hasField('section'))    student.section    = document.getElementById('m-section')?.value    || '';
  if (hasField('grade'))      student.grade      = document.getElementById('m-grade')?.value      || '';
  if (hasField('notes'))      student.notes      = document.getElementById('m-notes')?.value?.trim() || '';
  for (const cf of (STATE.customStudentFields || [])) {
    student[cf.key] = document.getElementById(`m-cf-${cf.key}`)?.value?.trim() || '';
  }

  STATE.students[num] = student;
  orgCol('students').doc(num).set(student);
  closeModal();
  showToast(`${student.name || `#${num}`} added`);
  if (_view === 'roster' || _view === 'student') render();
  else navigate('roster');
}

function showEditStudentModal(num) {
  if (!STATE.isAdmin) return;
  const s = DB.getStudents()[num];
  if (!s) return;
  openModal(`
    <div class="modal-title">Edit ${esc(s.name || `#${s.number}`)}</div>
    <div class="form-group">
      <label class="form-label">Name (optional)</label>
      <input class="form-input" id="m-name" type="text" value="${esc(s.name||'')}" autocomplete="off">
    </div>
    ${(hasField('column')||hasField('row')) ? `
    <div style="display:grid;grid-template-columns:${hasField('column')&&hasField('row')?'1fr 1fr':'1fr'};gap:12px">
      ${hasField('column') ? `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">Column (A–L)</label>
        <select class="form-select" id="m-column">
          <option value="">—</option>
          ${COLUMNS.map(c=>`<option value="${c}" ${s.column===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>` : ''}
      ${hasField('row') ? `<div class="form-group" style="margin-bottom:0">
        <label class="form-label">Row (1–12)</label>
        <select class="form-select" id="m-row">
          <option value="">—</option>
          ${ROWS.map(r=>`<option value="${r}" ${String(s.row)===String(r)?'selected':''}>${r}</option>`).join('')}
        </select>
      </div>` : ''}
    </div>` : ''}
    ${hasField('instrument') ? `<div class="form-group">
      <label class="form-label">Instrument</label>
      <select class="form-select" id="m-instrument">
        <option value="">— Select instrument —</option>
        ${STATE.instruments.map(i=>`<option value="${esc(i)}" ${(normInstrument(s.instrument)===i||s.instrument===i)?'selected':''}>${esc(i)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('section') ? `<div class="form-group">
      <label class="form-label">Section</label>
      <select class="form-select" id="m-section">
        <option value="">— Select section —</option>
        ${STATE.sections.map(sec=>`<option value="${esc(sec)}" ${s.section===sec?'selected':''}>${esc(sec)}</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('grade') ? `<div class="form-group">
      <label class="form-label">Grade</label>
      <select class="form-select" id="m-grade">
        <option value="">— Select grade —</option>
        ${GRADE_LEVELS.map(g=>`<option value="${g}" ${s.grade===g?'selected':''}>${g} Grade</option>`).join('')}
      </select>
    </div>` : ''}
    ${hasField('notes') ? `<div class="form-group">
      <label class="form-label">Director Notes</label>
      <textarea class="form-textarea" id="m-notes">${esc(s.notes||'')}</textarea>
    </div>` : ''}
    ${(STATE.customStudentFields||[]).map(cf => `<div class="form-group">
      <label class="form-label">${esc(cf.label)}</label>
      <input class="form-input" id="m-cf-${cf.key}" type="text" value="${esc(s[cf.key]||'')}" autocomplete="off">
    </div>`).join('')}
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
        Delete Student
      </button>
    </div>
  `);
}

function saveEditStudent(num) {
  if (!STATE.students[num]) return;
  const patch = {
    name:         document.getElementById('m-name').value.trim(),
    studentCode:  document.getElementById('m-student-code').value.trim().toUpperCase(),
    studentEmail: document.getElementById('m-student-email').value.trim().toLowerCase(),
  };
  if (hasField('column'))     patch.column     = document.getElementById('m-column')?.value     || '';
  if (hasField('row'))        patch.row        = document.getElementById('m-row')?.value        || '';
  if (hasField('instrument')) patch.instrument = document.getElementById('m-instrument')?.value || '';
  if (hasField('section'))    patch.section    = document.getElementById('m-section')?.value    || '';
  if (hasField('grade'))      patch.grade      = document.getElementById('m-grade')?.value      || '';
  if (hasField('notes'))      patch.notes      = document.getElementById('m-notes')?.value?.trim() || '';
  for (const cf of (STATE.customStudentFields || [])) {
    patch[cf.key] = document.getElementById(`m-cf-${cf.key}`)?.value?.trim() || '';
  }
  STATE.students[num] = { ...STATE.students[num], ...patch };
  orgCol('students').doc(num).set(patch, { merge: true });
  setStudentCodeLookup(patch.studentCode, num);
  closeModal();
  showToast('Student updated');
  render();
}

function confirmDeleteStudent(num) {
  const sName = STATE.students[num]?.name || `#${num}`;
  if (!confirm(`Delete ${sName} and all their rehearsal data?\n\nThis cannot be undone.`)) return;
  delete STATE.students[num];
  orgCol('students').doc(num).delete();
  // Delete all entries for this student
  orgCol('entries').where('studentNumber', '==', String(num)).get().then(snap => {
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    batch.commit();
  });
  closeModal();
  showToast(`${sName} deleted`);
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
  orgCol('rehearsals').doc(id).set(r);
  closeModal();
  _activeRid = id;
  navigate(featureOn('marks') ? 'dashboard' : 'rehearsals', featureOn('marks') ? { rid: id } : {});
}

function showEndedRehearsalOptions(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  const label = fmtDate(r.date) + (r.label ? ` — ${esc(r.label)}` : '');
  openModal(`
    <div class="modal-title">${label}</div>
    <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:20px">What would you like to view?</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${featureOn('attendance') ? `
      <button class="btn btn-primary btn-full" onclick="closeModal();navigate('attendance',{rid:'${esc(rid)}',from:'rehearsals'})">
        📋 View Attendance
      </button>` : ''}
      ${featureOn('marks') ? `
      <button class="btn btn-secondary btn-full" onclick="closeModal();viewHistoricalMarks('${esc(rid)}')">
        ✏️ View Marks
      </button>` : ''}
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-ghost btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function viewHistoricalMarks(rid) {
  _dashRid = rid;
  _dashForceHistory = true;
  navigate('dashboard');
}

function showRehearsalEditModal(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  openModal(`
    <div class="modal-title">Edit Rehearsal</div>
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
  `);
}

function showRehearsalPlanModal(rid) {
  const r = DB.getRehearsals().find(r => r.id === rid);
  if (!r) return;
  const segments = r.segments || [];
  openModal(`
    <div class="modal-title">Rehearsal Plan</div>
    <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">
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
      <div class="flex gap-8" style="margin-top:12px">
        <input class="form-input" id="seg-input" type="text"
               placeholder="e.g. Warmup, Closer drill…" autocomplete="off"
               onkeydown="if(event.key==='Enter')addSegment('${esc(rid)}')">
        <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="addSegment('${esc(rid)}')">+ Add</button>
      </div>` : ''}
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
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
  orgCol('rehearsals').doc(rid).set({ segments }, { merge: true });
  showRehearsalPlanModal(rid);
}

function removeSegment(rid, idx) {
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  const segments = (r.segments || []).filter((_, i) => i !== idx);
  r.segments = segments;
  orgCol('rehearsals').doc(rid).set({ segments }, { merge: true });
  showRehearsalPlanModal(rid);
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
  orgCol('rehearsals').doc(rid).set(patch, { merge: true });
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
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
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
  let onTimeCount     = 0;
  let noMistakeCount  = 0;

  for (const [num] of Object.entries(students)) {
    const entry = entries[num] || { mistakes: 0, positives: 0, notes: '', events: [] };
    const att   = entry.attendance || 'present';

    if (att === 'absent') continue; // absent students receive no auto-marks

    const isOnTime   = att !== 'late';
    const noMistakes = (entry.mistakes || 0) === 0;

    if (!isOnTime && !noMistakes) continue;

    // Strip previous auto-marks so re-ending a rehearsal doesn't duplicate
    let events = (entry.events || []).filter(e =>
      e.note !== 'On time to rehearsal' && e.note !== 'No noticeable mistakes'
    );

    if (isOnTime) {
      events.push({ type: 'positive', note: 'On time to rehearsal', ts: Date.now(), by: 'system', auto: true });
      onTimeCount++;
    }
    if (noMistakes) {
      events.push({ type: 'positive', note: 'No noticeable mistakes', ts: Date.now(), by: 'system', auto: true });
      noMistakeCount++;
    }

    const positives = events.filter(e => e.type === 'positive').length;
    const docRef    = orgCol('entries').doc(`${rid}_${num}`);
    batch.set(docRef, {
      rehearsalId:   rid,
      studentNumber: String(num),
      mistakes:      entry.mistakes  || 0,
      positives,
      notes:         entry.notes     || '',
      events,
      ...(entry.attendance ? { attendance: entry.attendance } : {}),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: STATE.user?.email || ''
    });

    if (!STATE.entries[rid]) STATE.entries[rid] = {};
    STATE.entries[rid][num] = { ...entry, events, positives };
  }

  r.ended = true;
  orgCol('rehearsals').doc(rid).set({ ended: true }, { merge: true });
  await batch.commit();
  // Advance active rehearsal to the next open one if this was the active one
  if (_activeRid === rid || !_activeRid) {
    const next = STATE.rehearsals.find(r2 => !r2.ended && r2.id !== rid);
    _activeRid = next ? next.id : null;
  }
  const parts = [];
  if (onTimeCount)    parts.push(`${onTimeCount} on time`);
  if (noMistakeCount) parts.push(`${noMistakeCount} no-mistake`);
  showToast(`Rehearsal ended — ${parts.length ? parts.join(', ') + ' positives applied.' : 'no auto-positives.'}`);
  render();
}

function reopenRehearsal(rid) {
  closeModal();
  const r = STATE.rehearsals.find(r => r.id === rid);
  if (!r) return;
  const currentActive = getActiveRehearsal();
  if (currentActive && currentActive.id !== rid) {
    const curLabel = fmtDate(currentActive.date) + (currentActive.label ? ` — ${currentActive.label}` : '');
    const newLabel  = fmtDate(r.date)            + (r.label            ? ` — ${r.label}`            : '');
    showConfirmModal(
      'Switch Active Rehearsal?',
      `<strong>${curLabel}</strong> is currently open. Reopening <strong>${newLabel}</strong> will make it the active rehearsal for student feedback. The current rehearsal will remain open and become active again once this one is ended.`,
      () => {
        r.ended = false;
        orgCol('rehearsals').doc(rid).set({ ended: false }, { merge: true });
        _activeRid = rid;
        showToast(`Switched to ${newLabel}`);
        render();
      },
      'Switch Rehearsal',
      'btn-primary'
    );
    return;
  }
  r.ended = false;
  orgCol('rehearsals').doc(rid).set({ ended: false }, { merge: true });
  _activeRid = rid;
  showToast('Rehearsal reopened.');
  render();
}

function confirmDeleteRehearsal(rid) {
  if (!confirm('Delete this rehearsal and all its data?\n\nThis cannot be undone.')) return;
  STATE.rehearsals = STATE.rehearsals.filter(r => r.id !== rid);
  delete STATE.entries[rid];
  orgCol('rehearsals').doc(rid).delete();
  orgCol('entries').where('rehearsalId', '==', rid).get().then(snap => {
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    batch.commit();
  });
  closeModal();
  showToast('Rehearsal deleted');
  navigate('rehearsals');
}

// ── CSV Import ────────────────────────────────────────────────────────────────

// ── Instrument Management ─────────────────────────────────────────────────────

function showManageInstrumentsModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Instruments</div>
    <div class="preset-section">
      <div id="instrument-list">${_renderInstrumentList()}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-instrument-input" type="text"
               placeholder="New instrument…" maxlength="60"
               onkeydown="if(event.key==='Enter')addInstrument()">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addInstrument()">Add</button>
      </div>
    </div>
    <button class="btn btn-secondary" style="width:100%;margin-top:10px;font-size:0.8rem"
            onclick="resetInstrumentsToDefaults()">Reset to defaults</button>
    <div class="modal-actions" style="margin-top:10px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function _renderInstrumentList() {
  if (!STATE.instruments.length) return `<div class="preset-empty">No instruments — add one below.</div>`;
  return STATE.instruments.map((inst, i) => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(inst)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editInstrument(${i})">Edit</button>
        <button class="preset-btn-del"  onclick="deleteInstrument(${i})">×</button>
      </div>
    </div>`).join('');
}

function addInstrument() {
  const input = document.getElementById('add-instrument-input');
  const val = input?.value.trim();
  if (!val) return;
  STATE.instruments = [...STATE.instruments, val];
  _saveInstruments();
  input.value = '';
  document.getElementById('instrument-list').innerHTML = _renderInstrumentList();
}

function deleteInstrument(idx) {
  STATE.instruments = STATE.instruments.filter((_, i) => i !== idx);
  _saveInstruments();
  document.getElementById('instrument-list').innerHTML = _renderInstrumentList();
}

function editInstrument(idx) {
  const current = STATE.instruments[idx];
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Instrument</div>
    <input class="form-input" id="edit-instrument-input" type="text"
           value="${esc(current)}" maxlength="60"
           onkeydown="if(event.key==='Enter')saveEditInstrument(${idx})">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManageInstrumentsModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditInstrument(${idx})">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-instrument-input')?.focus(), 60);
}

function saveEditInstrument(idx) {
  const val = document.getElementById('edit-instrument-input')?.value.trim();
  if (!val) return;
  STATE.instruments[idx] = val;
  _saveInstruments();
  showManageInstrumentsModal();
}

function resetInstrumentsToDefaults() {
  STATE.instruments = [...INSTRUMENTS];
  _saveInstruments();
  document.getElementById('instrument-list').innerHTML = _renderInstrumentList();
}

async function _saveInstruments() {
  try {
    await orgCol('settings').doc('presets').set(
      { instruments: STATE.instruments }, { merge: true }
    );
  } catch(e) {
    console.error('Failed to save instruments:', e);
    showToast('Failed to save instruments.');
  }
}

// filterLb replaced by updateFilter / unified filter bar

async function randomizePseudonyms() {
  const salt = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  try {
    await orgCol('settings').doc('presets').set({ pseudonymSalt: salt }, { merge: true });
    showToast('Leaderboard names reassigned.');
  } catch(e) {
    console.error('Failed to randomize pseudonyms:', e);
    showToast('Failed to randomize names.');
  }
}

async function toggleMarchingLeaderboard() {
  STATE.marchingLeaderboardEnabled = !STATE.marchingLeaderboardEnabled;
  try {
    await orgCol('settings').doc('presets').set(
      { marchingLeaderboardEnabled: STATE.marchingLeaderboardEnabled }, { merge: true }
    );
  } catch(e) {
    console.error('Failed to save leaderboard setting:', e);
    showToast('Failed to save setting.');
    STATE.marchingLeaderboardEnabled = !STATE.marchingLeaderboardEnabled; // revert
  }
  render();
}

// ── Section Management ────────────────────────────────────────────────────────

function showManageSectionsModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Sections</div>
    <div class="preset-section">
      <div id="section-list">${_renderSectionList()}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-section-input" type="text"
               placeholder="New section…" maxlength="60"
               onkeydown="if(event.key==='Enter')addSection()">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addSection()">Add</button>
      </div>
    </div>
    <button class="btn btn-secondary" style="width:100%;margin-top:10px;font-size:0.8rem"
            onclick="resetSectionsToDefaults()">Reset to defaults</button>
    <div class="modal-actions" style="margin-top:10px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function _renderSectionList() {
  if (!STATE.sections.length) return `<div class="preset-empty">No sections — add one below.</div>`;
  return STATE.sections.map((sec, i) => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(sec)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editSection(${i})">Edit</button>
        <button class="preset-btn-del"  onclick="deleteSection(${i})">×</button>
      </div>
    </div>`).join('');
}

function addSection() {
  const input = document.getElementById('add-section-input');
  const val = input?.value.trim();
  if (!val) return;
  STATE.sections = [...STATE.sections, val];
  _saveSections();
  input.value = '';
  document.getElementById('section-list').innerHTML = _renderSectionList();
}

function deleteSection(idx) {
  STATE.sections = STATE.sections.filter((_, i) => i !== idx);
  _saveSections();
  document.getElementById('section-list').innerHTML = _renderSectionList();
}

function editSection(idx) {
  const current = STATE.sections[idx];
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Section</div>
    <input class="form-input" id="edit-section-input" type="text"
           value="${esc(current)}" maxlength="60"
           onkeydown="if(event.key==='Enter')saveEditSection(${idx})">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManageSectionsModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditSection(${idx})">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-section-input')?.focus(), 60);
}

function saveEditSection(idx) {
  const val = document.getElementById('edit-section-input')?.value.trim();
  if (!val) return;
  STATE.sections[idx] = val;
  _saveSections();
  showManageSectionsModal();
}

function resetSectionsToDefaults() {
  STATE.sections = [...SECTIONS];
  _saveSections();
  document.getElementById('section-list').innerHTML = _renderSectionList();
}

async function _saveSections() {
  try {
    await orgCol('settings').doc('presets').set(
      { sections: STATE.sections }, { merge: true }
    );
  } catch(e) {
    console.error('Failed to save sections:', e);
    showToast('Failed to save sections.');
  }
}

// ── Preset Management ─────────────────────────────────────────────────────────

function _renderPresetList(type) {
  const arr = type === 'mistake' ? STATE.mistakePresets : STATE.positivePresets;
  if (!arr.length) return `<div class="preset-empty">No presets — add one below.</div>`;
  return arr.map((p, i) => `
    <div class="preset-item">
      <span class="preset-item-text">${esc(p)}</span>
      <div class="preset-item-btns">
        <button class="preset-btn-edit" onclick="editPreset('${type}',${i})">Edit</button>
        <button class="preset-btn-del"  onclick="deletePreset('${type}',${i})">×</button>
      </div>
    </div>`).join('');
}

function showManagePresetsModal() {
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Mark Presets</div>

    <div class="preset-section">
      <div class="preset-section-hdr preset-mistake-hdr">✗ Mistake Marks</div>
      <div id="preset-list-mistake">${_renderPresetList('mistake')}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-mistake-input" type="text"
               placeholder="New mistake preset…" maxlength="80"
               onkeydown="if(event.key==='Enter')addPreset('mistake')">
        <button class="preset-add-btn preset-add-btn-mistake" onclick="addPreset('mistake')">Add</button>
      </div>
    </div>

    <div class="preset-section" style="margin-top:16px">
      <div class="preset-section-hdr preset-positive-hdr">✓ Positive Marks</div>
      <div id="preset-list-positive">${_renderPresetList('positive')}</div>
      <div class="preset-add-row">
        <input class="preset-add-input" id="add-positive-input" type="text"
               placeholder="New positive preset…" maxlength="80"
               onkeydown="if(event.key==='Enter')addPreset('positive')">
        <button class="preset-add-btn preset-add-btn-positive" onclick="addPreset('positive')">Add</button>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function addPreset(type) {
  const input = document.getElementById(`add-${type}-input`);
  const val = input?.value.trim();
  if (!val) return;
  if (type === 'mistake') STATE.mistakePresets = [...STATE.mistakePresets, val];
  else                    STATE.positivePresets = [...STATE.positivePresets, val];
  _savePresets();
  input.value = '';
  document.getElementById(`preset-list-${type}`).innerHTML = _renderPresetList(type);
}

function deletePreset(type, idx) {
  if (type === 'mistake') STATE.mistakePresets  = STATE.mistakePresets.filter((_,i)  => i !== idx);
  else                    STATE.positivePresets = STATE.positivePresets.filter((_,i) => i !== idx);
  _savePresets();
  document.getElementById(`preset-list-${type}`).innerHTML = _renderPresetList(type);
}

function editPreset(type, idx) {
  const arr     = type === 'mistake' ? STATE.mistakePresets : STATE.positivePresets;
  const current = arr[idx];
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Edit Preset</div>
    <input class="form-input" id="edit-preset-input" type="text"
           value="${esc(current)}" maxlength="80"
           onkeydown="if(event.key==='Enter')saveEditPreset('${type}',${idx})">
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary" onclick="showManagePresetsModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="saveEditPreset('${type}',${idx})">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('edit-preset-input')?.focus(), 60);
}

function saveEditPreset(type, idx) {
  const val = document.getElementById('edit-preset-input')?.value.trim();
  if (!val) return;
  if (type === 'mistake') STATE.mistakePresets[idx]  = val;
  else                    STATE.positivePresets[idx] = val;
  _savePresets();
  showManagePresetsModal();
}

async function _savePresets() {
  try {
    await orgCol('settings').doc('presets').set({
      mistakePresets:  STATE.mistakePresets,
      positivePresets: STATE.positivePresets
    });
  } catch(e) {
    console.error('Failed to save presets:', e);
    showToast('Failed to save presets.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────

let _csvData = null;

function showImportModal() {
  if (!STATE.isAdmin) return;
  _csvData = null;
  openModal(`
    <div class="modal-title">Import Roster from CSV</div>
    <div class="import-hint">
      <strong>Your CSV must have a header row.</strong> The <em>Number</em> column is required; all others are optional. Headers are case-insensitive.
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:10px">
        <thead>
          <tr style="border-bottom:1.5px solid var(--border)">
            <th style="text-align:left;padding:4px 6px 6px;font-weight:700;white-space:nowrap">Field</th>
            <th style="text-align:left;padding:4px 6px 6px;font-weight:700">Description</th>
            <th style="text-align:left;padding:4px 6px 6px;font-weight:700">Accepted column headers</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 6px;font-weight:700;white-space:nowrap;color:var(--primary)">Number ★</td>
            <td style="padding:5px 6px">Unique student ID used for all tracking</td>
            <td style="padding:5px 6px;color:var(--text-muted)">Number, Student #, Student No, Student ID, ID, #, Num</td>
          </tr>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 6px;font-weight:700;white-space:nowrap">Name</td>
            <td style="padding:5px 6px">Student's display name</td>
            <td style="padding:5px 6px;color:var(--text-muted)">Name, Student Name, Full Name, First Name, Last Name</td>
          </tr>
          ${STUDENT_FIELD_DEFS.filter(f => hasField(f.key)).map(f => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 6px;font-weight:700;white-space:nowrap">${f.label}</td>
            <td style="padding:5px 6px">${f.description}</td>
            <td style="padding:5px 6px;color:var(--text-muted)">${f.aliases}</td>
          </tr>`).join('')}
          ${(STATE.customStudentFields||[]).map((cf, i, arr) => `
          <tr${i < arr.length-1 ? ' style="border-bottom:1px solid var(--border)"' : ''}>
            <td style="padding:5px 6px;font-weight:700;white-space:nowrap">${esc(cf.label)}</td>
            <td style="padding:5px 6px">Custom field</td>
            <td style="padding:5px 6px;color:var(--text-muted)">${esc(cf.label)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
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

const STUDENT_FIELD_DEFS = [
  { key: 'instrument', label: 'Instrument',  description: 'Instrument played',                        aliases: 'Instrument, Inst' },
  { key: 'section',    label: 'Section',     description: 'Band section or ensemble group',           aliases: 'Section, Part, Group, Ensemble' },
  { key: 'column',     label: 'Column',      description: 'Marching position — column letter (A–L)',  aliases: 'Column, Col, Letter, Column Letter, File' },
  { key: 'row',        label: 'Row',         description: 'Marching position — row number (1–12)',    aliases: 'Row, Rank, Row Number, Set' },
  { key: 'grade',      label: 'Grade',       description: 'Grade level (9–12)',                       aliases: 'Grade, Grade Level, Year, Class Year' },
  { key: 'notes',      label: 'Notes',       description: 'Private director notes for the student',   aliases: 'Notes, Note, Comments, Director Notes' },
];

const COL_ALIASES = {
  number:     ['number','student number','student #','student no','student id','id','#','num','no.','no'],
  name:       ['name','student name','full name','first name','last name','student'],
  column:     ['column','col','letter','column letter','file'],
  row:        ['row','rank','row number','set'],
  instrument: ['instrument','instruments','inst'],
  section:    ['section','part','group','ensemble'],
  grade:      ['grade','grade level','year','class year'],
  notes:      ['notes','note','comments','comment','director notes']
};

function normalizeGrade(val) {
  const num = val.replace(/[^\d]/g, '');
  const mapped = { '8':'8th','9':'9th','10':'10th','11':'11th','12':'12th' };
  return mapped[num] || val;
}

function detectCols(headers) {
  const norm = headers.map(h => h.toLowerCase().trim());
  const map = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    const idx = norm.findIndex(h => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  for (const cf of (STATE.customStudentFields || [])) {
    const idx = norm.findIndex(h => h === cf.label.toLowerCase().trim());
    if (idx !== -1 && map[cf.key] === undefined) map[cf.key] = idx;
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
  const LABELS    = { number:'Number', name:'Name', column:'Column', row:'Row', instrument:'Instrument', section:'Section', grade:'Grade', notes:'Notes' };
  for (const cf of (STATE.customStudentFields || [])) LABELS[cf.key] = cf.label;
  const customKeys = new Set((STATE.customStudentFields || []).map(cf => cf.key));
  const fields    = Object.keys(colMap).filter(f => f === 'number' || f === 'name' || hasField(f) || customKeys.has(f));

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
    const incoming = { number: num };
    if (colMap.name       !== undefined)              incoming.name       = csvRow[colMap.name].trim();
    if (colMap.column     !== undefined && hasField('column'))     incoming.column     = csvRow[colMap.column].trim().toUpperCase();
    if (colMap.row        !== undefined && hasField('row'))        incoming.row        = csvRow[colMap.row].trim();
    if (colMap.instrument !== undefined && hasField('instrument')) incoming.instrument = csvRow[colMap.instrument].trim();
    if (colMap.section    !== undefined && hasField('section'))    incoming.section    = csvRow[colMap.section].trim();
    if (colMap.grade      !== undefined && hasField('grade'))      incoming.grade      = normalizeGrade(csvRow[colMap.grade].trim());
    if (colMap.notes      !== undefined && hasField('notes'))      incoming.notes      = csvRow[colMap.notes].trim();
    for (const cf of (STATE.customStudentFields || [])) {
      if (colMap[cf.key] !== undefined) incoming[cf.key] = csvRow[colMap[cf.key]]?.trim() || '';
    }
    if (existing[num]) {
      if (strategy === 'overwrite') {
        STATE.students[num] = { ...STATE.students[num], ...incoming };
        batch.set(orgCol('students').doc(num), incoming, { merge: true });
        updated++;
      } else {
        skipped++;
      }
    } else {
      STATE.students[num] = incoming;
      batch.set(orgCol('students').doc(num), incoming);
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

// ── Rehearsal card dropdown menu ──────────────────────────────────────────────

function toggleRhMenu(rid) {
  const target = document.getElementById(`rh-menu-${rid}`);
  if (!target) return;
  const isHidden = target.classList.contains('hidden');
  document.querySelectorAll('.rh-card-menu-list').forEach(el => el.classList.add('hidden'));
  if (isHidden) target.classList.remove('hidden');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.rh-card-menu-list').forEach(el => el.classList.add('hidden'));
});

// ── Boot ──────────────────────────────────────────────────────────────────────

render();
