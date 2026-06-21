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

// Students sign in with Firebase email/password using a synthetic address
// derived from their (non-secret) student code; the PIN is the password, which
// Firebase verifies and rate-limits server-side. No real email is collected —
// the address is never used to contact anyone. See docs/DATA_MODEL.md.
const STUDENT_EMAIL_DOMAIN = 'students.bandtracker.app';
function studentEmailFor(code) {
  return `${String(code).trim().toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
}
// The student code for the current user: from their synthetic email (new model)
// or a legacy anonymous session's stored code (back-compat).
function _studentCodeForUser() {
  const email = (STATE.user.email || '').toLowerCase();
  if (email.endsWith('@' + STUDENT_EMAIL_DOMAIN)) return email.split('@')[0].toUpperCase();
  if (STATE.user.isAnonymous) return (_pendingStudentCode || localStorage.getItem('bandStudentCode') || '').toUpperCase();
  return '';
}
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// Keep directors/students signed in across app restarts. LOCAL is already the
// web SDK default, but set it explicitly so the session is never downgraded to
// in-memory/session persistence (which would log users out when the PWA is
// closed). Must resolve before the first sign-in attempt.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(e => console.error('auth setPersistence failed:', e));

// Ask the browser to make our storage durable. Firebase Auth keeps the login
// session (and Firestore its cache) in IndexedDB; without a persistence grant
// Chrome treats it as "best-effort" and may evict it under storage pressure,
// which silently logs the user out — the common cause of installed-PWA logouts.
// Safe no-op where unsupported; never throws into app code.
if (navigator.storage?.persist) {
  navigator.storage.persisted()
    .then(already => already ? true : navigator.storage.persist())
    .then(granted => { if (!granted) console.warn('Persistent storage not granted; session may be evicted under storage pressure.'); })
    .catch(() => {});
}

// Distinguish a deliberate logout from an unexpected session loss. Inline
// "Sign out" actions go through userSignOut() so onAuthStateChanged can tell
// the difference and record diagnostics only for the unexpected case.
let _userInitiatedSignOut = false;
function userSignOut() {
  _userInitiatedSignOut = true;
  try { localStorage.removeItem('bandLastAuth'); } catch {} // deliberate — don't flag as a loss
  try { auth.signOut(); } catch (e) { console.error('signOut failed:', e); }
}


// ── State ─────────────────────────────────────────────────────────────────────

const STATE = {
  user:         null,
  authChecking: true,
  loading:      true,
  orgId:        null,
  org:          null,
  needsOnboarding: false,
  connError:    false, // a transient backend read failed — show a retry, never sign-out/onboarding
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
  features: { attendance: true, marks: true, songs: true, stats: true, drill: true },
  activeStudentFields:        null,
  customStudentFields:        [],
  autoMarks:                  null,
  lbWeights:                  {},
  pywareMapping:              {},
  // Drill library: id → metadata ({name, fileName, setCount, performerCount,
  // flipV, …}). The heavy position payload is loaded on demand for the active
  // drill only. activeDrillId is the school-wide selected drill (settings/drill).
  drills:                     {},
  activeDrillId:              null,
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

  // Read the caller's membership, retrying transient failures with backoff. A
  // *thrown* read (offline cold-start, an App Check token hiccup, Firestore
  // briefly unreachable) must NEVER be mistaken for "no membership" — doing so
  // bounced signed-in directors to the onboarding screen and looked exactly
  // like a random logout. We only treat the user as new when the read SUCCEEDS
  // and the doc genuinely doesn't exist.
  let snap = null, readFailed = false, lastErr = null;
  for (let attempt = 0; ; attempt++) {
    try {
      snap = await db.collection('members').doc(uid).get();
      readFailed = false;
      break;
    } catch (e) {
      readFailed = true;
      lastErr = e;
      console.error(`membership lookup failed (attempt ${attempt + 1}):`, e);
      if (attempt >= 3) break;
      await new Promise(r => setTimeout(r, 600 * 2 ** attempt)); // 0.6s, 1.2s, 2.4s
    }
  }

  if (snap && snap.exists) {
    const m = snap.data();
    STATE.orgId     = m.orgId;
    STATE.isAdmin   = m.role === 'director';
    if (m.studentNumber) STATE.studentNum = String(m.studentNumber);
    STATE.connError = false;
    STATE.connErrorDetail = '';
    return true;
  }

  // Couldn't reach the backend at all — keep the user signed in and offer a
  // retry instead of pretending they have no band. Capture the error so the
  // screen can show what actually went wrong (e.g. App Check rejection).
  if (readFailed) {
    STATE.connError = true;
    STATE.connErrorDetail = lastErr ? (lastErr.code || lastErr.message || String(lastErr)) : '';
    STATE.loading   = false;
    render();
    return false;
  }

  // Student with no membership yet — bind it from their code (taken from the
  // synthetic student email, or a legacy anonymous session). Works for both a
  // first-time claim and a returning student whose member doc was never written.
  const studentCode = _studentCodeForUser();
  if (studentCode) {
    let codeSnap;
    try {
      codeSnap = await db.collection('studentCodes').doc(studentCode).get();
    } catch (e) {
      // A thrown lookup is a transient backend failure, not an invalid code —
      // keep the user signed in and offer a retry.
      console.error('student code lookup failed:', e);
      STATE.connError = true; STATE.loading = false; render();
      return false;
    }
    if (codeSnap.exists) {
      const { orgId, studentNumber } = codeSnap.data();
      await db.collection('members').doc(uid).set({
        orgId, studentNumber: String(studentNumber), role: 'student', joinCode: studentCode
      });
      // Mark the code claimed so the sign-in wizard can route returning students
      // straight to the PIN screen. Best-effort (legacy anonymous users can't,
      // and it's only a UX hint — the wizard cross-corrects regardless).
      if (!codeSnap.data().claimed) {
        db.collection('studentCodes').doc(studentCode).set({ claimed: true }, { merge: true }).catch(() => {});
      }
      STATE.orgId      = orgId;
      STATE.isAdmin    = false;
      STATE.studentNum = String(studentNumber);
      STATE.connError  = false;
      localStorage.setItem('bandStudentNum', String(studentNumber));
      _pendingStudentCode = '';
      return true;
    }
    // Code no longer maps to a student (e.g., the director regenerated it).
    localStorage.removeItem('bandStudentCode');
    localStorage.removeItem('bandStudentNum');
    showToast('That student code is no longer valid — ask your director for your new one.');
    userSignOut();
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
