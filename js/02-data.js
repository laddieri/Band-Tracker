// Band Tracker — js/02-data.js — Firestore listeners (director + student), settings/public publisher, auth state.
// Plain script sharing global scope; load order is set in index.html.

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
  _restartSeasonScoped = null;
  _scopedReady = null;
  // Drop any drill state from a previous session/org; listeners repopulate it.
  STATE.drills = {}; STATE.shows = {}; STATE.spotHistory = {}; STATE.activeDrillId = null; _activeDrillLoadedId = null;
  STATE.anticipatedAbsences = []; _absencesMirrorReady = false;
  _drillData = null; _drillPages = null; _drillFileName = null; _drillFlipV = false;

  // Resolve the user's org before reading any data; bail if redirected.
  if (!await resolveMembership()) return;

  // Students get a restricted set of listeners matching what the security
  // rules let them read: own student doc, own entries, rehearsal metadata and
  // the director-published settings/public snapshot. Staff share the director
  // listeners below, minus the director-only org doc and drill library.
  if (!canRecord()) {
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
      render(); // direct-render-ok: loading→ready swap; only the spinner is on screen
    } else if (!STATE.loading) {
      renderFromData();
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
      rehQ.onSnapshot(snap => {
        _scopedReady.reh = true;
        STATE.rehearsals = snap.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .sort(compareRehearsalsDesc);
        tick('rehearsals');
        schedulePublishPublicStats();
      }),

      entQ.onSnapshot(snap => {
        _scopedReady.ent = true;
        const changes = snap.docChanges();
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
  _restartSeasonScoped = () => { rescopeIfNeeded(); render(); }; // direct-render-ok: user just picked a season in settings

  const listeners = [
    // Org metadata (name, plan, invite codes) — kept live for the settings UI.
    // Director-only: the rules deny staff this doc (it carries the invite
    // codes, which would let staff escalate to director).
    ...(STATE.isAdmin ? [
      db.collection('orgs').doc(STATE.orgId).onSnapshot(doc => {
        STATE.org = doc.exists ? { id: doc.id, ...doc.data() } : null;
        if (!STATE.loading) renderFromData();
      }),

      // Spot-assignment history, one doc per show (see _spotHistoryRecord in
      // js/12-drill.js). Director-ONLY — the rules deny staff and students, so
      // this must not move into the canRecord() block below.
      orgCol('spotHistory').onSnapshot(snap => {
        STATE.spotHistory = {};
        snap.docs.forEach(d => { STATE.spotHistory[d.id] = { id: d.id, ...d.data() }; });
        if (!STATE.loading) renderFromData();
      }, err => console.error('spot history listener error:', err)),
    ] : []),

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
        tasks:      d.features?.tasks      === true,  // opt-in (default off)
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
        tasks:      d.portalVisible?.tasks      !== false,
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
      if (!STATE.loading) renderFromData();
      schedulePublishPublicStats();
    }, err => {
      console.error('settings/presets listener error:', err);
      // Still bind the rehearsals/entries listeners (unbounded) so the app
      // isn't stuck on the loading spinner if only the settings read failed.
      rescopeIfNeeded();
    }),

    orgCol('students').onSnapshot(snap => {
      // Rebuild the whole map from the snapshot rather than applying docChanges
      // deltas. A resumed/rebound listener (startListeners re-runs on every auth
      // refresh) delivers only current docs as 'added' — a student deleted while
      // this client was disconnected produces no 'removed' event, so an
      // incremental map would keep the ghost until a full reload. Rebuilding
      // self-heals like the songs/rehearsals/tasks listeners. Pending local
      // writes (add-student, the spot/task mirrors) already appear in snap.docs
      // via latency compensation, so a rebuild never drops them.
      STATE.students = {};
      snap.docs.forEach(d => { STATE.students[d.id] = { ...d.data(), _id: d.id }; });
      tick('students');
      _purgeBlockSpots();        // director-only: drop obsolete roster column/row
      _syncStudentSpotsMirror(); // director-only: keep each student's spot mirror current
      _syncTaskMirror();         // director-only: keep each student's task mirror current
      _syncAbsenceMirror();      // director-only: keep each student's notice mirror current
      schedulePublishPublicStats();
    }),

    orgCol('songs').onSnapshot(snap => {
      STATE.songs = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      _overlaySongStatusBuf(); // marks still coalescing locally (js/07-songs-portal.js)
      tick('songs');
      schedulePublishPublicStats();
    }, err => {
      console.error('songs listener error:', err);
      tick('songs'); // don't hang the app — songs will be empty
    }),

    // Check-off tasks (forms, fees…). Directors+staff read; only directors write
    // the task docs, but staff may record completion (statuses). Each snapshot
    // re-syncs the per-student taskStatuses mirror (director-only) so the portal
    // stays current. See js/14-tasks.js.
    orgCol('tasks').onSnapshot(snap => {
      STATE.tasks = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (a.dueDate || 'z').localeCompare(b.dueDate || 'z')
                        || (a.title || '').localeCompare(b.title || ''));
      if (typeof _overlayTaskStatusBuf === 'function') _overlayTaskStatusBuf();
      _tasksMirrorReady = true;    // safe to reconcile mirrors now that tasks have loaded
      tick('tasks');
      _syncTaskMirror();           // director-only: keep each student's task mirror current
      schedulePublishPublicStats();
    }, err => {
      console.error('tasks listener error:', err);
      tick('tasks'); // don't hang the app — tasks will be empty
    }),

    // Anticipated absences (advance notices). Directors + staff read (staff see
    // the "reported" badge while recording attendance); only directors write.
    // Each snapshot re-syncs the per-student anticipatedAbsences mirror
    // (director-only) so the student portal stays current. Not part of the
    // loading gate — the app is fully usable before notices load. See
    // js/16-absences.js.
    orgCol('anticipatedAbsences').onSnapshot(snap => {
      STATE.anticipatedAbsences = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _absencesMirrorReady = true; // safe to reconcile mirrors now that notices have loaded
      _syncAbsenceMirror();        // director-only: keep each student's notice mirror current
      if (!STATE.loading) renderFromData();
    }, err => console.error('anticipated-absences listener error:', err)),

    // Drill library — one small metadata doc per drill (the heavy position
    // payload lives in each drill's data/main subdoc, loaded on demand for the
    // active drill only). See _drillSyncActive() in js/12-drill.js. Directors AND
    // staff read drills (staff view the chart to record marks); only directors
    // write — the legacy migration below is director-only.
    ...(canRecord() ? [
      orgCol('drills').onSnapshot(snap => {
        STATE.drills = {};
        snap.docs.forEach(d => { STATE.drills[d.id] = { id: d.id, ...d.data() }; });
        _migrateDrillShows(); // director-only: group ungrouped drills into shows
        _drillSyncActive();
        if (!STATE.loading) renderFromData();
      }, err => console.error('drills listener error:', err)),

      // Shows group drills that share one spot map (see js/12-drill.js). Directors
      // and staff read them; only directors write. Kept in STATE.shows so the
      // resolver can look up the active drill's shared mapping.
      orgCol('shows').onSnapshot(snap => {
        STATE.shows = {};
        snap.docs.forEach(d => { STATE.shows[d.id] = { id: d.id, ...d.data() }; });
        _syncStudentSpotsMirror(); // director-only: publish spots onto student docs
        if (!STATE.loading) renderFromData();
      }, err => console.error('shows listener error:', err)),

      // School-wide active-drill pointer. Also performs the one-time migration of
      // the legacy single-drill doc into the library (directors only — it writes).
      orgCol('settings').doc('drill').onSnapshot(doc => {
        const d = doc.exists ? doc.data() : {};
        if (STATE.isAdmin && d.drillSections?.length && d.drillPages?.length) { _migrateLegacyDrill(d); return; }
        STATE.activeDrillId = d.activeId || null;
        _drillSyncActive();
        if (!STATE.loading) renderFromData();
      }, err => console.error('active-drill listener error:', err)),
    ] : []),

    // Directors + staff of this org, for resolving mark-author uids to names
    // via dirLabel(). Mark events store uids — never emails — because students
    // can read their own entries. Not part of the loading gate.
    db.collection('members')
      .where('orgId', '==', STATE.orgId)
      .where('role', 'in', ['director', 'staff'])
      .onSnapshot(snap => {
        STATE.dirNames = {};
        snap.docs.forEach(d => { STATE.dirNames[d.id] = d.data().email || ''; });
        if (!STATE.loading) renderFromData();
      }, err => console.error('directors listener error:', err))
  ];

  // push, not assign: subscribeScoped adds the season-scoped unsubs to
  // STATE._unsubs as they (re)bind — don't replace the array out from under it.
  STATE._unsubs.push(...listeners);
}

// Students can't read the director-only `shows` collection, so a director client
// MIRRORS each student's field-spot assignments onto that student's own doc
// (students/{num}.spots = { showId: {show, label, shared} }) — the same pattern
// as the songStatuses mirror. Directors and staff render spots live from
// STATE.shows; students read this mirror. Diff-based and idempotent: it writes
// only students whose spots actually changed, so steady state is a no-op and it
// self-heals after any spot edit (the shows/students listeners re-run it).
function _syncStudentSpotsMirror() {
  if (!STATE.isAdmin || !STATE.students) return; // only directors write student docs
  const desired = {}; // studentNumber → { showId: {show, label, shared} }
  Object.values(STATE.shows || {}).forEach(show => {
    const mapping = show.mapping || {};
    Object.keys(mapping).forEach(label => {
      const nums = drillSpotNums(mapping[label]);
      const shared = nums.length > 1;
      nums.forEach(num => {
        (desired[num] = desired[num] || {})[show.id] = { show: show.name || 'Show', label, shared };
      });
    });
  });

  const del = firebase.firestore.FieldValue.delete();
  const pending = [];
  Object.values(STATE.students).forEach(s => {
    const num  = String(s.number);
    const want = desired[num] || {};
    if (_studentSpotsKey(want) === _studentSpotsKey(s.spots || {})) return;
    // No optimistic `s.spots = want`: the students listener rebuilds from
    // snap.docs, and this commit's pending write is already reflected there via
    // latency compensation, so the next snapshot converges without churn.
    if (Object.keys(want).length) pending.push([num, { spots: want }]);
    else pending.push([num, { spots: del }]);
  });
  if (!pending.length) return;

  for (let i = 0; i < pending.length; i += 400) {
    const batch = db.batch();
    pending.slice(i, i + 400).forEach(([num, data]) => batch.update(orgCol('students').doc(num), data));
    batch.commit().catch(e => console.error('student spot mirror sync failed:', e));
  }
}

// Order-independent signature of a spots map, for change detection.
function _studentSpotsKey(obj) {
  return Object.keys(obj || {}).sort()
    .map(k => `${k}=${obj[k].label}|${obj[k].show}|${obj[k].shared ? 1 : 0}`).join(';');
}

// Students can't read the director-only `tasks` collection, so a director client
// MIRRORS each student's task assignments onto their own doc
// (students/{num}.taskStatuses = { taskId: {done, updatedAt} }) — same pattern as
// the spots/songStatuses mirrors. A mirror ENTRY EXISTS iff the task applies to
// that student (so the portal knows which tasks to show); its `done` flag is the
// student's status. Diff-based and idempotent: writes only students whose task
// set or done-flags changed, so steady state is a no-op and it self-heals after
// any task/roster edit (the tasks/students listeners re-run it).
let _tasksMirrorReady = false; // don't reconcile mirrors before the tasks listener's first load

function _syncTaskMirror() {
  if (!STATE.isAdmin || !STATE.students) return; // only directors write student docs
  // Before tasks have loaded STATE.tasks is [], which would delete every
  // student's mirror; wait for the first tasks snapshot (or a local create,
  // which sets the flag too via the listener) so we never transiently wipe them.
  if (!_tasksMirrorReady) return;
  const desired = {}; // studentNumber → { taskId: {done, updatedAt} }
  (STATE.tasks || []).forEach(task => {
    Object.values(STATE.students).forEach(s => {
      if (!taskAppliesToStudent(s, task)) return;
      const st = task.statuses?.[String(s.number)];
      (desired[String(s.number)] = desired[String(s.number)] || {})[task.id] =
        { done: !!st?.done, updatedAt: st?.updatedAt || 0 };
    });
  });

  const del = firebase.firestore.FieldValue.delete();
  const pending = [];
  Object.values(STATE.students).forEach(s => {
    const num  = String(s.number);
    const want = desired[num] || {};
    if (_studentTasksKey(want) === _studentTasksKey(s.taskStatuses || {})) return;
    // No optimistic `s.taskStatuses = want`: the students listener rebuilds from
    // snap.docs, and this commit's pending write is already reflected there via
    // latency compensation, so the next snapshot converges without churn.
    if (Object.keys(want).length) pending.push([num, { taskStatuses: want }]);
    else pending.push([num, { taskStatuses: del }]);
  });
  if (!pending.length) return;

  for (let i = 0; i < pending.length; i += 400) {
    const batch = db.batch();
    pending.slice(i, i + 400).forEach(([num, data]) => batch.update(orgCol('students').doc(num), data));
    batch.commit().catch(e => console.error('student task mirror sync failed:', e));
  }
}

// Order-independent signature of a taskStatuses map, for change detection.
// Keyed on taskId + done only (updatedAt is cosmetic and would churn).
function _studentTasksKey(obj) {
  return Object.keys(obj || {}).sort()
    .map(k => `${k}=${obj[k].done ? 1 : 0}`).join(';');
}

// Students can't read the director/staff-only `anticipatedAbsences` collection,
// so a director client MIRRORS each student's own advance notices onto their own
// doc (students/{num}.anticipatedAbsences = [{ id, type, date, endDate?, time?,
// note? }]) — same own-doc-mirror pattern as spots/taskStatuses. The mirror
// carries no PII (no author uid). Diff-based and idempotent: writes only students
// whose notice set changed, so steady state is a no-op and it self-heals after
// any notice/roster edit (the absences/students listeners re-run it).
let _absencesMirrorReady = false; // don't reconcile before the first notices snapshot

function _syncAbsenceMirror() {
  if (!STATE.isAdmin || !STATE.students) return; // only directors write student docs
  // Before notices have loaded STATE.anticipatedAbsences is [], which would
  // delete every student's mirror; wait for the first snapshot (or a local
  // create, which sets the flag via the listener) so we never transiently wipe.
  if (!_absencesMirrorReady) return;
  const desired = {}; // studentNumber → [ {id, type, date, endDate?, time?, note?} ]
  (STATE.anticipatedAbsences || []).forEach(a => {
    const num = String(a.studentNumber);
    const rec = { id: a.id, type: a.type, date: a.date };
    if (a.endDate) rec.endDate = a.endDate;
    if (a.time)    rec.time    = a.time;
    if (a.note)    rec.note    = a.note;
    (desired[num] = desired[num] || []).push(rec);
  });

  const del = firebase.firestore.FieldValue.delete();
  const pending = [];
  Object.values(STATE.students).forEach(s => {
    const num  = String(s.number);
    const want = desired[num] || [];
    if (_studentAbsencesKey(want) === _studentAbsencesKey(s.anticipatedAbsences || [])) return;
    if (want.length) pending.push([num, { anticipatedAbsences: want }]);
    else pending.push([num, { anticipatedAbsences: del }]);
  });
  if (!pending.length) return;

  for (let i = 0; i < pending.length; i += 400) {
    const batch = db.batch();
    pending.slice(i, i + 400).forEach(([num, data]) => batch.update(orgCol('students').doc(num), data));
    batch.commit().catch(e => console.error('student anticipated-absence mirror sync failed:', e));
  }
}

// Order-independent signature of a student's notice list, for change detection.
function _studentAbsencesKey(list) {
  return (list || []).map(a => `${a.id}=${a.type}|${a.date}|${a.endDate || ''}|${a.time || ''}|${a.note || ''}`)
    .sort().join(';');
}

// Retire the legacy block-spot fields: positions are assigned per show now, so
// the roster's column/row are obsolete. A director client deletes them from any
// student doc that still carries either. Idempotent (once cleared, a no-op) and
// director-only, so it self-limits after the first pass.
function _purgeBlockSpots() {
  if (!STATE.isAdmin || !STATE.students) return;
  const del = firebase.firestore.FieldValue.delete();
  const targets = Object.values(STATE.students).filter(s => s.column !== undefined || s.row !== undefined);
  if (!targets.length) return;
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    targets.slice(i, i + 400).forEach(s => {
      batch.update(orgCol('students').doc(String(s.number)), { column: del, row: del });
      delete s.column; delete s.row; // optimistic; the listener will confirm
    });
    batch.commit().catch(e => console.error('block-spot purge failed:', e));
  }
}

// Listeners for student accounts — limited to exactly what the rules allow.
function studentListeners() {
  const num = String(STATE.studentNum);

  // Stamp this student's last portal login on their own roster doc so directors
  // can see login activity (Band Settings → Student Login Activity). The rules
  // allow the matching student a single-field 'lastLogin' update on their own
  // doc; it's best-effort telemetry (the doc always exists — a director created
  // it to mint the code), so a failure must never surface to the student.
  orgCol('students').doc(num).update({ lastLogin: Date.now() }).catch(() => {});

  const loaded = new Set();
  function tick(key) {
    loaded.add(key);
    if (loaded.size >= 4 && STATE.loading) {
      STATE.loading = false;
      render(); // direct-render-ok: loading→ready swap; only the spinner is on screen
    } else if (!STATE.loading) {
      renderFromData();
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
          .sort(compareRehearsalsDesc);
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
        tasks:      d.features?.tasks      === true,  // opt-in (default off)
      };
      STATE.portalVisible = {
        attendance: d.portalVisible?.attendance !== false,
        marks:      d.portalVisible?.marks      !== false,
        songs:      d.portalVisible?.songs      !== false,
        stats:      d.portalVisible?.stats      !== false,
        tasks:      d.portalVisible?.tasks      !== false,
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
// Students cannot read the raw roster, entries or songs, so director/staff
// clients publish a sanitized snapshot instead: branding, feature flags,
// per-rehearsal absence counts, song progress aggregates and the pseudonymized
// leaderboard. All band data is director- or staff-written, so a recording
// client is online whenever the data changes and the snapshot stays fresh by
// construction.

let _publishTimer      = null;
let _lastPublishedJson = '';

function computePublicStats() {
  return buildPublicStats({
    students:   STATE.students,
    entries:    STATE.entries,
    rehearsals: STATE.rehearsals,
    songs:      STATE.songs,
    tasks:      STATE.tasks,
    weights:    _lbW(),
    salt:       STATE.pseudonymSalt,
    memExclusions: STATE.memorizationExclusions,
    flags: {
      songsOn:            featureOn('songs'),
      tasksOn:            featureOn('tasks'),
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
  // Staff publish too: they write the data the snapshot derives from, so a
  // staff-only session (e.g. an instructor taking attendance) must keep the
  // student portal fresh. The rules let staff write ONLY settings/public.
  if (!canRecord() || !STATE.orgId || STATE.loading || _publishBlocked()) return;
  clearTimeout(_publishTimer);
  _publishTimer = setTimeout(() => {
    if (!canRecord() || !STATE.orgId || _publishBlocked()) return;
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
  // renderFromData, not render: this fires while the login screen is up, and a
  // full render mid-typing would rebuild the form (closing the keyboard and
  // re-firing the wizard's autofocus).
  if (!STATE.user) renderFromData(); // show the note immediately, before the slow probes

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
  if (!STATE.user) renderFromData();
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
    STATE.loading    = false;
    STATE.orgId      = null;
    STATE.org        = null;
    STATE.needsOnboarding = false;
    STATE.isAdmin    = false;
    STATE.isStaff    = false;
    STATE.studentNum = null;
    STATE.students   = {};
    STATE.rehearsals = [];
    STATE.entries    = {};
    STATE.songs      = [];
    STATE.tasks      = [];
    _tasksMirrorReady = false;
    STATE.anticipatedAbsences = [];
    _absencesMirrorReady = false;
    STATE.spotHistory = {};
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
    render(); // direct-render-ok: signed out — the whole UI must swap to login now
  }
});
