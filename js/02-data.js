// Band Tracker — js/02-data.js — Firestore listeners (director + student), settings/public publisher, auth state.
// Plain script sharing global scope; load order is set in index.html.

// ── Firestore listeners ───────────────────────────────────────────────────────

async function startListeners() {
  STATE._unsubs.forEach(u => u());
  STATE._unsubs = [];
  STATE.loading = true;
  _lastPublishedJson = '';

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
    }),

    orgCol('students').onSnapshot({ includeMetadataChanges: true }, snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') delete STATE.students[ch.doc.id];
        else STATE.students[ch.doc.id] = { ...ch.doc.data(), _id: ch.doc.id };
      });
      tick('students');
      schedulePublishPublicStats();
    }),

    orgCol('rehearsals').onSnapshot(snap => {
      STATE.rehearsals = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => b.date.localeCompare(a.date));
      tick('rehearsals');
      schedulePublishPublicStats();
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
      schedulePublishPublicStats();
    }),

    orgCol('songs').onSnapshot(snap => {
      STATE.songs = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      tick('songs');
      schedulePublishPublicStats();
    }, err => {
      console.error('songs listener error:', err);
      tick('songs'); // don't hang the app — songs will be empty
    }),

    // Drill (Pyware) data — its own doc so a large file can't bloat presets.
    orgCol('settings').doc('drill').onSnapshot(doc => {
      const d = doc.exists ? doc.data() : {};
      if (d.drillSections?.length && d.drillPages?.length) {
        _drillData     = d.drillSections;
        _drillPages    = d.drillPages;
        _drillFlipV    = !!d.drillFlipV;
        _drillFileName = d.drillFileName || null;
      }
    }, err => console.error('drill settings listener error:', err)),

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

  STATE._unsubs = listeners;
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

  return [
    // Director-published, student-safe settings + derived stats.
    orgCol('settings').doc('public').onSnapshot(doc => {
      const d = doc.exists ? doc.data() : {};
      STATE.bandName                   = d.bandName || '';
      STATE.bandLogo                   = d.bandLogo || '';
      STATE.marchingLeaderboardEnabled = !!d.marchingLeaderboardEnabled;
      STATE.hideNegativeFromPortal     = !!d.hideNegativeFromPortal;
      STATE.songCategories             = d.songCategories || [];
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
      tick('settings');
    }, err => {
      console.error('public settings listener error:', err);
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

    // Rehearsal metadata (dates/labels) for the portal history.
    orgCol('rehearsals').onSnapshot(snap => {
      STATE.rehearsals = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => b.date.localeCompare(a.date));
      tick('rehearsals');
    }, err => {
      console.error('rehearsals listener error:', err);
      tick('rehearsals');
    }),

    // Own entries only — the where() clause is required by the security rules.
    orgCol('entries').where('studentNumber', '==', num).onSnapshot(snap => {
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
  const students = Object.values(STATE.students);
  const total    = students.length;

  const rehearsals = STATE.rehearsals.map(r => ({
    date:   r.date,
    label:  r.label || '',
    absent: Object.values(STATE.entries[r.id] || {}).filter(e => e.attendance === 'absent').length,
  }));

  const songs = (featureOn('songs') ? STATE.songs : []).map(song => {
    const passed = students.filter(s => song.statuses?.[String(s.number)]?.status === 'passed').length;
    return {
      id: song.id, title: song.title || '', dueDate: song.dueDate || '',
      category: song.category || '', passed, remaining: Math.max(0, total - passed),
    };
  });

  // Pseudonymized ranking — published only while the leaderboard is enabled.
  // Rows carry the student number so each student can find their own row;
  // names and per-event details are never included.
  const leaderboard = (STATE.marchingLeaderboardEnabled && featureOn('stats'))
    ? _scoreStudents()
        .sort((a, b) => b.score - a.score)
        .map(({ docId, name, score }) => ({ num: docId, name, score }))
    : null;

  return { rehearsals, songs, leaderboard };
}

function schedulePublishPublicStats() {
  if (!STATE.isAdmin || !STATE.orgId || STATE.loading) return;
  clearTimeout(_publishTimer);
  _publishTimer = setTimeout(() => {
    if (!STATE.isAdmin || !STATE.orgId) return;
    const pub = {
      bandName:                   STATE.bandName,
      bandLogo:                   STATE.bandLogo,
      features:                   STATE.features,
      portalVisible:              STATE.portalVisible,
      marchingLeaderboardEnabled: STATE.marchingLeaderboardEnabled,
      hideNegativeFromPortal:     !!STATE.hideNegativeFromPortal,
      songCategories:             STATE.songCategories,
      stats:                      computePublicStats(),
    };
    const json = JSON.stringify(pub);
    if (json === _lastPublishedJson) return;
    _lastPublishedJson = json;
    orgCol('settings').doc('public')
      .set({ ...pub, publishedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(e => {
        _lastPublishedJson = ''; // retry on the next data change
        console.error('publishing settings/public failed:', e);
      });
  }, 1500);
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
    STATE.publicStats = null;
    STATE.dirNames   = {};
    _lastPublishedJson = '';
    _authMode        = 'signin';
    render();
  }
});
