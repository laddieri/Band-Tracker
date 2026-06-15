// Band Tracker — js/01-core.js — Constants, theme, Firebase init, STATE, DB layer, org scoping, membership.
// Plain script sharing global scope; load order is set in index.html.

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

// Pseudonym for the current band's salt (pure core lives in 00-logic.js).
function fakeAnimalName(id) {
  return pseudonymFor(id, STATE.pseudonymSalt);
}

const INSTRUMENTS = [
  'Majorette',
  'Piccolo','Flute','Clarinet','Bass Clarinet',
  'Alto Saxophone','Tenor Saxophone','Baritone Saxophone',
  'Trumpet','Mellophone','French Horn',
  'Trombone','Bass Trombone','Baritone/Euphonium','Tuba',
  'Snare Drum','Tenor Drums','Bass Drum','Cymbals',
  'Marimba','Xylophone','Vibraphone',
  'Color Guard','Drum Major','Other'
];

// Score order: groups of names that all share the same rank position.
// Includes full names, abbreviations, and plurals to handle any stored variant.
const _SCORE_ORDER = [
  ['Majorette','Majorettes'],
  ['Piccolo'],
  ['Flute','Flutes'],
  ['Oboe'],
  ['Bassoon'],
  ['Clarinet','Clarinets'],
  ['Bass Clarinet'],
  ['Sax','Saxophone','Saxophones','Alto Sax','Alto Saxophone','Tenor Sax','Tenor Saxophone','Bari Sax','Bari Saxophone','Baritone Sax','Baritone Saxophone'],
  ['Trumpet','Trumpets'],
  ['Mellophone','Mello','Mellos','French Horn','Horn','Horns'],
  ['Trombone','Trombones'],
  ['Bass Trombone'],
  ['Baritone','Baritone/Euphonium','Euphonium','Baritones'],
  ['Tuba','Tubas'],
  ['Snare Drum','Snare','Tenor Drums','Tenors','Tenor','Bass Drum','Cymbals','Marimba','Xylophone','Vibraphone','Percussion','Perc','Pit'],
  ['Color Guard','Guard'],
  ['Drum Major','Drum Majors'],
  ['Other'],
];
const _INSTR_IDX = new Map();
_SCORE_ORDER.forEach((names, i) => names.forEach(n => _INSTR_IDX.set(n.toLowerCase(), i)));
function instrOrder(name) {
  return _INSTR_IDX.get((normInstrument(name) || '').toLowerCase()) ?? _SCORE_ORDER.length;
}

const SECTIONS = ['Woodwinds','Brass','Percussion','Front Ensemble','Color Guard','Leadership'];

const MISTAKE_PRESETS  = ['Out of step','Missed turn','Poor posture','Late to mark','Wrong direction','Dress/cover issue','Instrument angle','Off the line'];
const POSITIVE_PRESETS = ['Snappy turns','Great marching style','Good posture','Strong presence','Perfect timing','Excellent dress/cover','High energy','Great recovery'];

const DEFAULT_AUTO_MARKS = [
  { id: 'am-default-1', note: 'On time to rehearsal',   type: 'positive', when: 'end', condition: 'on_time'    },
  { id: 'am-default-2', note: 'No noticeable mistakes', type: 'positive', when: 'end', condition: 'no_mistakes' },
];

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
  // Instrument/section names excluded from song memorization (e.g. majorettes).
  // Director-configured in the Songs tab; published to students via settings/public.
  memorizationExclusions:     [],
  bandName:                   '',
  bandLogo:                   '',
  // Band-wide feature toggles (default on; missing = on, so existing bands keep
  // everything). 'stats' also requires 'marks' — see featureOn().
  features: { attendance: true, marks: true, songs: true, stats: true },
  activeStudentFields:        null,
  customStudentFields:        [],
  autoMarks:                  null,
  lbWeights:                  {},
  pywareMapping:              {},
  // Per-feature student portal visibility (independent of whether the feature is
  // enabled for directors). Default true = visible; false = hidden from portal.
  portalVisible: { attendance: true, marks: true, songs: true, stats: true },
  // Student clients: the director-published snapshot from settings/public
  // (per-rehearsal absence counts, song progress, pseudonymized leaderboard).
  // Students cannot read the raw roster/entries/songs — see firestore.rules.
  publicStats:  null,
  // uid → email for this org's directors (director clients only; used by
  // dirLabel to show mark authors without storing emails in entries).
  dirNames:     {},
  _unsubs:      []
};

function hasField(key) {
  const af = STATE.activeStudentFields;
  return !af || af.includes(key);
}

// Whether a student is excluded from song memorization (bound to STATE; pure
// core lives in 00-logic.js). Excluded students drop out of the memorization
// lists, song progress and the student portal's "Songs to Memorize".
function memExcluded(student) {
  return isMemorizationExcluded(student, STATE.memorizationExclusions);
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
    // uid, not email: entries are readable by their own student, and director
    // emails should not be exposed there.
    updatedBy: STATE.user?.uid || ''
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
