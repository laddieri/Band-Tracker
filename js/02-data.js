// Band Tracker — js/02-data.js — Firestore listeners (director + student), settings/public publisher, auth state.
// Plain script sharing global scope; load order is set in index.html.

// ── Pending-sync indicator ────────────────────────────────────────────────────
// Director clients queue writes locally when offline (attendance on a field
// with bad reception is the core use case), and Firestore gives no visible
// signal that they haven't reached the server yet. Each director listener
// reports its snapshot's hasPendingWrites here; the header shows a "Saving…"
// pill while anything is still unacknowledged. The pill only appears when a
// write stays pending for over a second — online acks land faster than that
// and shouldn't flash it.

let _pendingSync   = {};
let _syncPillTimer = null;

function _notePendingWrites(key, pending) {
  if (!!_pendingSync[key] === !!pending) return;
  _pendingSync[key] = !!pending;
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  const any = Object.values(_pendingSync).some(Boolean);
  clearTimeout(_syncPillTimer);
  if (any) _syncPillTimer = setTimeout(() => el.classList.remove('hidden'), 1200);
  else     el.classList.add('hidden');
}

function _resetPendingWrites() {
  _pendingSync = {};
  clearTimeout(_syncPillTimer);
  document.getElementById('sync-indicator')?.classList.add('hidden');
}

// ── Season scoping ────────────────────────────────────────────────────────────
// Rehearsals and entries accumulate forever, so their listeners are bounded to
// the active season (see "Seasons" in docs/DATA_MODEL.md): docs are stamped
// with a season label at write time and the queries filter on it. Bands that
// haven't started a season yet ('' active) keep the unbounded legacy queries.
// Directors can temporarily view an archived season; that's a local override
// that re-scopes the two listeners without touching what students see.

let _seasonView = null;          // director-local view override: null = follow the
                                 // active season · '*' = all time · other = that label
let _restartSeasonScoped = null; // rebinds the scoped listeners (set by startListeners)
let _scopedReady = null;         // {reh, ent} first-emission flags — the publisher
                                 // must not run between a re-scope and fresh data

function _effectiveSeason() {
  if (_seasonView === '*') return '';
  return _seasonView || STATE.activeSeason || '';
}

// The Band Settings season selector ('' = back to the current season).
function setSeasonView(v) {
  _seasonView = v || null;
  closeModal();
  if (typeof _restartSeasonScoped === 'function') _restartSeasonScoped();
  navigate('rehearsals');
}

// ── Firestore listeners ───────────────────────────────────────────────────────

async function startListeners() {
  STATE._unsubs.forEach(u => u());
  STATE._unsubs = [];
  STATE.loading = true;
  _lastPublishedJson = '';
  _resetPendingWrites();
  _restartSeasonScoped = null;
  _scopedReady = null;
  // Drop any drill state from a previous session/org; listeners repopulate it.
  STATE.drills = {}; STATE.activeDrillId = null; _activeDrillLoadedId = null;
  _drillData = null; _drillPages = null; _drillFileName = null; _drillFlipV = false;

  // Resolve the user's org before reading any data; bail if redirected.
  if (!await resolveMembership()) return;

  // Students get a restricted set of listeners matching what the security
  // rules let them read: own student doc, own entries, rehearsal metadata and
  // the director-published settings/public snapshot.
  if (!STATE.isAdmin) {
    if (!STATE.studentNum) {
      // Member with a student role but no student number — nothing we can
      // show. Should not happen via any join flow; bail to login.
      showToast('Your account isn’t linked to a student. Ask your director for a new code.');
      auth.signOut();
      return;
    }
    STATE._unsubs = studentListeners();
    return;
  }

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

  // Rehearsals + entries subscribe season-bounded, so they can only start once
  // the first settings snapshot delivers activeSeason — and they re-subscribe
  // when the effective season changes (a new season started, or the director
  // picked an archived season to view). Everything else subscribes right away.
  let scopedSeason; // undefined until the first subscribe
  const subscribeScoped = () => {
    scopedSeason = _effectiveSeason();
    STATE.rehearsals = [];
    STATE.entries    = {};
    _scopedReady     = { reh: false, ent: false };
    const rehQ = scopedSeason ? orgCol('rehearsals').where('season', '==', scopedSeason) : orgCol('rehearsals');
    const entQ = scopedSeason ? orgCol('entries').where('season', '==', scopedSeason)    : orgCol('entries');

    const unsubs = [
      rehQ.onSnapshot({ includeMetadataChanges: true }, snap => {
        _scopedReady.reh = true;
        _notePendingWrites('rehearsals', snap.metadata.hasPendingWrites);
        if (!snap.docChanges().length && !STATE.loading) return; // metadata-only
        STATE.rehearsals = snap.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .sort((a, b) => b.date.localeCompare(a.date));
        tick('rehearsals');
        schedulePublishPublicStats();
      }),

      entQ.onSnapshot({ includeMetadataChanges: true }, snap => {
        _scopedReady.ent = true;
        _notePendingWrites('entries', snap.metadata.hasPendingWrites);
        const changes = snap.docChanges();
        if (!changes.length && !STATE.loading) return; // metadata-only
        changes.forEach(ch => {
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
        schedulePublishPublicStats();
      }),
    ];
    // Old-scope unsubs stay in STATE._unsubs; calling an unsubscribe twice is a
    // safe no-op, so tearing them down here and again at sign-out is fine.
    STATE._unsubs.push(...unsubs);
    return unsubs;
  };
  let scopedUnsubs = [];
  const rescopeIfNeeded = () => {
    if (scopedSeason !== undefined && _effectiveSeason() === scopedSeason) return;
    scopedUnsubs.forEach(u => u());
    scopedUnsubs = subscribeScoped();
  };
  _restartSeasonScoped = () => { rescopeIfNeeded(); render(); };

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
      STATE.memorizationExclusions     = Array.isArray(d.memorizationExclusions) ? d.memorizationExclusions : [];
      STATE.bandName                   = d.bandName || '';
      STATE.bandLogo                   = d.bandLogo || '';
      STATE.bandColor                  = d.bandColor || '';
      try { localStorage.setItem('bandColor', STATE.bandColor); } catch {}
      STATE.features = {
        attendance: d.features?.attendance !== false,
        marks:      d.features?.marks      !== false,
        songs:      d.features?.songs      !== false,
        stats:      d.features?.stats      !== false,
        drill:      d.features?.drill      !== false,
      };
      STATE.activeStudentFields        = Array.isArray(d.activeStudentFields) ? d.activeStudentFields : null;
      STATE.customStudentFields        = Array.isArray(d.customStudentFields)  ? d.customStudentFields  : [];
      STATE.hideNegativeFromPortal     = !!d.hideNegativeFromPortal;
      STATE.countNegativeInScore       = d.countNegativeInScore !== false;
      STATE.portalVisible = {
        attendance: d.portalVisible?.attendance !== false,
        marks:      d.portalVisible?.marks      !== false,
        songs:      d.portalVisible?.songs      !== false,
        stats:      d.portalVisible?.stats      !== false,
      };
      STATE.autoMarks                  = Array.isArray(d.autoMarks) ? d.autoMarks : null;
      STATE.lbWeights                  = d.lbWeights || {};
      STATE.pywareMapping              = d.pywareMapping || {};
      STATE.activeSeason               = d.activeSeason || '';
      STATE.seasons                    = Array.isArray(d.seasons) ? d.seasons : [];
      // First settings snapshot starts the season-bounded rehearsals/entries
      // listeners; later snapshots re-scope them if the active season changed.
      rescopeIfNeeded();
      // One-time migration: drill data used to live in this doc, where a large
      // Pyware file could push it toward Firestore's 1 MB doc limit and break
      // every settings save. Move it to its own settings/drill doc.
      if (d.drillSections?.length && d.drillPages?.length) {
        const del = firebase.firestore.FieldValue.delete();
        orgCol('settings').doc('drill').set({
          drillFileName: d.drillFileName || null,
          drillSections: d.drillSections,
          drillPages:    d.drillPages,
          drillFlipV:    !!d.drillFlipV,
        }).then(() => orgCol('settings').doc('presets').set(
          { drillFileName: del, drillSections: del, drillPages: del, drillFlipV: del },
          { merge: true }
        )).catch(e => console.error('drill data migration failed:', e));
      }
      if (!STATE.loading) render();
      schedulePublishPublicStats();
    }, err => {
      console.error('settings/presets listener error:', err);
      // Still bind the rehearsals/entries listeners (unbounded) so the app
      // isn't stuck on the loading spinner if only the settings read failed.
      rescopeIfNeeded();
    }),

    // High-churn collections listen with metadata so the "Saving…" pill can
    // track unacknowledged local writes. docChanges() excludes metadata-only
    // emissions by default, so the `changes.length` guards keep write acks
    // from triggering full re-renders — only the pill updates. (Rehearsals and
    // entries follow the same pattern inside subscribeScoped above.)
    orgCol('students').onSnapshot({ includeMetadataChanges: true }, snap => {
      _notePendingWrites('students', snap.metadata.hasPendingWrites);
      const changes = snap.docChanges();
      if (!changes.length && !STATE.loading) return; // metadata-only
      changes.forEach(ch => {
        if (ch.type === 'removed') delete STATE.students[ch.doc.id];
        else STATE.students[ch.doc.id] = { ...ch.doc.data(), _id: ch.doc.id };
      });
      tick('students');
      schedulePublishPublicStats();
    }),

    orgCol('songs').onSnapshot({ includeMetadataChanges: true }, snap => {
      _notePendingWrites('songs', snap.metadata.hasPendingWrites);
      if (!snap.docChanges().length && !STATE.loading) return; // metadata-only
      STATE.songs = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      tick('songs');
      schedulePublishPublicStats();
    }, err => {
      console.error('songs listener error:', err);
      tick('songs'); // don't hang the app — songs will be empty
    }),

    // Drill library — one small metadata doc per drill (the heavy position
    // payload lives in each drill's data/main subdoc, loaded on demand for the
    // active drill only). See _drillSyncActive() in js/12-drill.js.
    orgCol('drills').onSnapshot(snap => {
      STATE.drills = {};
      snap.docs.forEach(d => { STATE.drills[d.id] = { id: d.id, ...d.data() }; });
      _drillSyncActive();
      if (!STATE.loading) render();
    }, err => console.error('drills listener error:', err)),

    // School-wide active-drill pointer. Also performs the one-time migration of
    // the legacy single-drill doc into the library.
    orgCol('settings').doc('drill').onSnapshot(doc => {
      const d = doc.exists ? doc.data() : {};
      if (d.drillSections?.length && d.drillPages?.length) { _migrateLegacyDrill(d); return; }
      STATE.activeDrillId = d.activeId || null;
      _drillSyncActive();
      if (!STATE.loading) render();
    }, err => console.error('active-drill listener error:', err)),

    // Directors of this org, for resolving mark-author uids to names via
    // dirLabel(). Mark events store uids — never emails — because students can
    // read their own entries. Not part of the loading gate.
    db.collection('members')
      .where('orgId', '==', STATE.orgId)
      .where('role', '==', 'director')
      .onSnapshot(snap => {
        STATE.dirNames = {};
        snap.docs.forEach(d => { STATE.dirNames[d.id] = d.data().email || ''; });
        if (!STATE.loading) render();
      }, err => console.error('directors listener error:', err))
  ];

  // push, not assign: subscribeScoped adds the season-scoped unsubs to
  // STATE._unsubs as they (re)bind — don't replace the array out from under it.
  STATE._unsubs.push(...listeners);
}

// Listeners for student accounts — limited to exactly what the rules allow.
function studentListeners() {
  const num = String(STATE.studentNum);
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

  // Rehearsals + own entries are season-bounded like the director listeners,
  // so they wait for the first settings/public snapshot (which carries the
  // active season) and re-subscribe if a director starts a new season.
  let scopedSeason; // undefined until the first subscribe
  let scopedUnsubs = [];
  const subscribeScoped = () => {
    scopedUnsubs.forEach(u => u());
    scopedSeason     = STATE.activeSeason || '';
    STATE.rehearsals = [];
    STATE.entries    = {};
    const rehQ = scopedSeason ? orgCol('rehearsals').where('season', '==', scopedSeason) : orgCol('rehearsals');
    let entQ   = orgCol('entries').where('studentNumber', '==', num); // required by the rules
    if (scopedSeason) entQ = entQ.where('season', '==', scopedSeason);

    scopedUnsubs = [
      // Rehearsal metadata (dates/labels) for the portal history.
      rehQ.onSnapshot(snap => {
        STATE.rehearsals = snap.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .sort((a, b) => b.date.localeCompare(a.date));
        tick('rehearsals');
      }, err => {
        console.error('rehearsals listener error:', err);
        tick('rehearsals');
      }),

      // Own entries only.
      entQ.onSnapshot(snap => {
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
      }, err => {
        console.error('entries listener error:', err);
        tick('entries');
      }),
    ];
    STATE._unsubs.push(...scopedUnsubs);
  };

  return [
    // Director-published, student-safe settings + derived stats.
    orgCol('settings').doc('public').onSnapshot(doc => {
      const d = doc.exists ? doc.data() : {};
      STATE.bandName                   = d.bandName || '';
      STATE.bandLogo                   = d.bandLogo || '';
      STATE.bandColor                  = d.bandColor || '';
      try { localStorage.setItem('bandColor', STATE.bandColor); } catch {}
      STATE.marchingLeaderboardEnabled = !!d.marchingLeaderboardEnabled;
      STATE.hideNegativeFromPortal     = !!d.hideNegativeFromPortal;
      STATE.songCategories             = d.songCategories || [];
      STATE.memorizationExclusions     = Array.isArray(d.memorizationExclusions) ? d.memorizationExclusions : [];
      STATE.activeSeason               = d.activeSeason || '';
      STATE.features = {
        attendance: d.features?.attendance !== false,
        marks:      d.features?.marks      !== false,
        songs:      d.features?.songs      !== false,
        stats:      d.features?.stats      !== false,
      };
      STATE.portalVisible = {
        attendance: d.portalVisible?.attendance !== false,
        marks:      d.portalVisible?.marks      !== false,
        songs:      d.portalVisible?.songs      !== false,
        stats:      d.portalVisible?.stats      !== false,
      };
      STATE.publicStats = d.stats || null;
      if (scopedSeason === undefined || (STATE.activeSeason || '') !== scopedSeason) subscribeScoped();
      tick('settings');
    }, err => {
      console.error('public settings listener error:', err);
      // Still bind the data listeners (unbounded) so the portal isn't blank if
      // only the settings read failed.
      if (scopedSeason === undefined) subscribeScoped();
      tick('settings');
    }),

    // Own roster doc only (includes the songStatuses mirror for the portal).
    orgCol('students').doc(num).onSnapshot(doc => {
      STATE.students = doc.exists ? { [num]: { ...doc.data(), _id: num } } : {};
      tick('students');
    }, err => {
      console.error('student doc listener error:', err);
      tick('students');
    }),
  ];
}

// ── Published student-safe stats (settings/public) ───────────────────────────
// Students cannot read the raw roster, entries or songs, so director clients
// publish a sanitized snapshot instead: branding, feature flags, per-rehearsal
// absence counts, song progress aggregates and the pseudonymized leaderboard.
// All band data is director-written, so a director's client is online whenever
// the data changes and the snapshot stays fresh by construction.

let _publishTimer      = null;
let _lastPublishedJson = '';

function computePublicStats() {
  return buildPublicStats({
    students:   STATE.students,
    entries:    STATE.entries,
    rehearsals: STATE.rehearsals,
    songs:      STATE.songs,
    weights:    _lbW(),
    salt:       STATE.pseudonymSalt,
    memExclusions: STATE.memorizationExclusions,
    flags: {
      songsOn:            featureOn('songs'),
      statsOn:            featureOn('stats'),
      marksOn:            featureOn('marks'),
      attendanceOn:       featureOn('attendance'),
      countNegative:      STATE.countNegativeInScore,
      leaderboardEnabled: STATE.marchingLeaderboardEnabled,
    },
  });
}

// True when local rehearsal/entry state doesn't reflect the live season —
// mid-re-scope or while a director is viewing an archived season. Publishing
// then would push stale/partial stats to every student.
function _publishBlocked() {
  return _seasonView !== null
    || (_scopedReady && (!_scopedReady.reh || !_scopedReady.ent));
}

function schedulePublishPublicStats() {
  if (!STATE.isAdmin || !STATE.orgId || STATE.loading || _publishBlocked()) return;
  clearTimeout(_publishTimer);
  _publishTimer = setTimeout(() => {
    if (!STATE.isAdmin || !STATE.orgId || _publishBlocked()) return;
    const pub = {
      bandName:                   STATE.bandName,
      bandLogo:                   STATE.bandLogo,
      bandColor:                  STATE.bandColor,
      features:                   STATE.features,
      portalVisible:              STATE.portalVisible,
      marchingLeaderboardEnabled: STATE.marchingLeaderboardEnabled,
      hideNegativeFromPortal:     !!STATE.hideNegativeFromPortal,
      songCategories:             STATE.songCategories,
      memorizationExclusions:     STATE.memorizationExclusions,
      activeSeason:               STATE.activeSeason || '',
      stats:                      computePublicStats(),
    };
    const json = JSON.stringify(pub);
    if (json === _lastPublishedJson) return;
    _lastPublishedJson = json;
    orgCol('settings').doc('public')
      .set({ ...pub, publishedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(e => {
        _lastPublishedJson = ''; // retry on the next data change
        // Not silent: if publishing breaks (rules regression, doc too large),
        // students quietly stop getting portal updates — the director needs to
        // know. Rate-capped inside _toastSaveError.
        _toastSaveError(e, 'The student portal update');
      });
  }, 1500);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

// When Firebase drops a session unexpectedly (not a deliberate logout), capture
// *why* so an intermittent bug becomes diagnosable: was the device offline, was
// durable storage lost (eviction), or did App Check fail to mint a token (a
// common cause of refresh failures → forced sign-out)? Appended to a rolling log
// in localStorage and surfaced on the login screen + the account menu. Also
// catches sessions lost while the app was CLOSED (see the bandLastAuth marker).
// Never throws.
async function _recordAuthLoss() {
  let marker = null;
  try { marker = JSON.parse(localStorage.getItem('bandLastAuth') || 'null'); } catch {}
  const diag = {
    at:       new Date().toISOString(),
    online:   navigator.onLine,
    email:    (STATE.user && STATE.user.email) || marker?.email || null,
    lastSeen: marker?.lastSeen ? new Date(marker.lastSeen).toISOString() : null,
    persisted: 'pending',
    appCheck:  'pending',
  };
  // Save the entry BEFORE the async probes below. A hung App Check getToken()
  // (itself a likely cause of forced sign-outs) previously swallowed the entire
  // diagnostic, so nothing showed on the login screen. Write first, enrich after.
  const _persist = () => {
    try {
      const log = JSON.parse(localStorage.getItem('authLossLog') || '[]');
      if (log[0] && log[0].at === diag.at) log[0] = diag; else log.unshift(diag);
      localStorage.setItem('authLossLog', JSON.stringify(log.slice(0, 8)));
    } catch {}
  };
  _persist();
  if (!STATE.user) render(); // show the note immediately, before the slow probes

  // Enrich with the slower probes, each capped by a timeout so a hang turns
  // into data ("timeout"/"FAILED:timeout") instead of losing the whole entry.
  try {
    diag.persisted = await Promise.race([
      Promise.resolve(navigator.storage?.persisted?.() ?? null),
      new Promise(res => setTimeout(() => res('timeout'), 3000)),
    ]);
  } catch { diag.persisted = 'err'; }
  if (typeof RECAPTCHA_V3_SITE_KEY !== 'undefined' && RECAPTCHA_V3_SITE_KEY && firebase.appCheck) {
    try {
      diag.appCheck = await Promise.race([
        firebase.appCheck().getToken().then(() => 'ok'),
        new Promise(res => setTimeout(() => res('FAILED:timeout'), 5000)),
      ]);
    } catch (e) { diag.appCheck = 'FAILED:' + (e?.code || e?.message || 'err'); }
  } else { diag.appCheck = 'off'; }
  _persist();
  console.warn('Unexpected sign-out diagnostics:', diag);
  if (!STATE.user) render();
}

auth.onAuthStateChanged(user => {
  const prev = STATE.user;
  STATE.user = user;
  STATE.authChecking = false;
  if (user) {
    if (!user.isAnonymous) {
      // Durable "we had a session" marker: survives app restarts (unless storage
      // is evicted) so a sign-out that happens while the app is closed can still
      // be detected on next launch. lastSeen refreshes every open.
      try {
        const prevMark = JSON.parse(localStorage.getItem('bandLastAuth') || 'null');
        localStorage.setItem('bandLastAuth', JSON.stringify({
          email: user.email || '', firstAt: prevMark?.firstAt || Date.now(), lastSeen: Date.now(),
        }));
      } catch {}
    }
    if (user.isAnonymous) {
      // Legacy pre-PIN anonymous student sessions are no longer supported (the
      // rules no longer accept anonymous student joins). Sign the session out;
      // the wizard prefills their remembered code, so they just set a PIN.
      localStorage.removeItem('bandStudentNum'); // legacy key, no longer read
      showToast('Student sign-in has changed — enter your code again to set up a PIN.');
      auth.signOut();
      return;
    }
    startListeners();
  } else {
    // Unexpected sign-out if we had a session this run OR a marker from a prior
    // run says we did (i.e. dropped while the app was closed) — and it wasn't a
    // deliberate logout.
    let hadSession = !!(prev && !prev.isAnonymous);
    try { hadSession = hadSession || !!localStorage.getItem('bandLastAuth'); } catch {}
    if (hadSession && !_userInitiatedSignOut) _recordAuthLoss();
    try { localStorage.removeItem('bandLastAuth'); } catch {} // consumed
    _userInitiatedSignOut = false;
    STATE._unsubs.forEach(u => u());
    STATE._unsubs = [];
    _resetPendingWrites();
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
    STATE.publicStats = null;
    STATE.dirNames   = {};
    STATE.activeSeason = '';
    STATE.seasons      = [];
    _seasonView          = null;
    _restartSeasonScoped = null;
    _scopedReady         = null;
    _lastPublishedJson = '';
    _authMode        = 'signin';
    _studentStep     = null;
    render();
  }
});
