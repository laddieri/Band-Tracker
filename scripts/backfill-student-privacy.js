#!/usr/bin/env node
/*
 * backfill-student-privacy.js
 *
 * One-time backfill for the student privacy model (see "Student data
 * visibility" in docs/DATA_MODEL.md). After this change, students can no
 * longer read song docs or the raw roster/entries, so:
 *
 *   1. Each student's song results are mirrored onto their own student doc:
 *        orgs/{orgId}/songs/{sid}.statuses.{num}
 *          -> orgs/{orgId}/students/{num}.songStatuses.{sid}
 *      (status + note + updatedAt only — no director identity).
 *
 *   2. orgs/{orgId}/settings/public is seeded with the student-safe snapshot:
 *      branding, feature flags, song catalog/aggregates and per-rehearsal
 *      absence counts. The pseudonymized leaderboard is left null — the next
 *      director who opens the app publishes it (the app keeps this doc fresh
 *      from then on).
 *
 * All writes are additive/idempotent: nothing is deleted, and re-running the
 * script overwrites the same destinations. Run it BEFORE deploying the new
 * rules — see the deploy order in docs/DATA_MODEL.md.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node backfill-student-privacy.js [--org-id=<id>] [--dry-run]
 *
 *   --org-id     Optional. Backfill a single org; default is every org.
 *   --dry-run    Print what would happen without writing anything.
 */

const admin = require('firebase-admin');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);

const ORG_ID  = args['org-id'] && args['org-id'] !== true ? args['org-id'] : null;
const DRY_RUN = !!args['dry-run'];

// ── Init ──────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp();
} else if (fs.existsSync('service-account.json')) {
  admin.initializeApp({ credential: admin.credential.cert(require(path.resolve('service-account.json'))) });
} else {
  console.error('No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS, or place');
  console.error('service-account.json in this folder (scripts/).');
  process.exit(1);
}
const db = admin.firestore();

const log = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[backfill]', ...a);

async function backfillOrg(orgId) {
  log(`── org ${orgId} ──`);
  const orgRef = db.collection('orgs').doc(orgId);

  const [studentsSnap, songsSnap, rehearsalsSnap, entriesSnap, presetsSnap] = await Promise.all([
    orgRef.collection('students').get(),
    orgRef.collection('songs').get(),
    orgRef.collection('rehearsals').get(),
    orgRef.collection('entries').get(),
    orgRef.collection('settings').doc('presets').get(),
  ]);
  const presets = presetsSnap.exists ? presetsSnap.data() : {};

  // 1. Mirror song statuses onto student docs.
  const mirrors = {}; // num -> { sid: { status, note, updatedAt } }
  for (const songDoc of songsSnap.docs) {
    const statuses = songDoc.data().statuses || {};
    for (const [num, st] of Object.entries(statuses)) {
      if (!st || !st.status || st.status === 'not_attempted') continue;
      (mirrors[num] = mirrors[num] || {})[songDoc.id] = {
        status:    st.status,
        note:      st.note || '',
        updatedAt: st.updatedAt || Date.now(),
      };
    }
  }
  const studentIds = new Set(studentsSnap.docs.map(d => d.id));
  let mirrored = 0, skipped = 0;
  let batch = db.batch(), n = 0;
  for (const [num, songStatuses] of Object.entries(mirrors)) {
    if (!studentIds.has(String(num))) { skipped++; continue; } // status for a deleted student
    if (!DRY_RUN) batch.set(orgRef.collection('students').doc(String(num)), { songStatuses }, { merge: true });
    mirrored++;
    if (++n % 400 === 0 && !DRY_RUN) { await batch.commit(); batch = db.batch(); }
  }
  if (!DRY_RUN && n % 400 !== 0) await batch.commit();
  log(`  songStatuses mirrored onto ${mirrored} student doc(s)`
      + (skipped ? ` (${skipped} orphaned status(es) for deleted students skipped)` : ''));

  // 2. Seed settings/public.
  const students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const total    = students.length;

  const entriesByRehearsal = {};
  for (const e of entriesSnap.docs) {
    const d = e.data();
    if (!d.rehearsalId) continue;
    (entriesByRehearsal[d.rehearsalId] = entriesByRehearsal[d.rehearsalId] || []).push(d);
  }
  const rehearsals = rehearsalsSnap.docs
    .map(r => {
      const d = r.data();
      return {
        date:   d.date || '',
        label:  d.label || '',
        absent: (entriesByRehearsal[r.id] || []).filter(e => e.attendance === 'absent').length,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const songs = songsSnap.docs.map(s => {
    const d = s.data();
    const passed = students.filter(st => d.statuses?.[String(st.number ?? st.id)]?.status === 'passed').length;
    return {
      id: s.id, title: d.title || '', dueDate: d.dueDate || '',
      category: d.category || '', passed, remaining: Math.max(0, total - passed),
    };
  });

  const pub = {
    bandName:                   presets.bandName || '',
    bandLogo:                   presets.bandLogo || '',
    features: {
      attendance: presets.features?.attendance !== false,
      marks:      presets.features?.marks      !== false,
      songs:      presets.features?.songs      !== false,
      stats:      presets.features?.stats      !== false,
    },
    marchingLeaderboardEnabled: !!presets.marchingLeaderboardEnabled,
    hideNegativeFromPortal:     !!presets.hideNegativeFromPortal,
    songCategories:             presets.songCategories || [],
    // Leaderboard scoring + pseudonyms live in the app; the first director
    // visit after deploy publishes them (and keeps this whole doc fresh).
    stats: { rehearsals, songs, leaderboard: null },
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  log(`  settings/public: ${rehearsals.length} rehearsal row(s), ${songs.length} song row(s)`);
  if (!DRY_RUN) await orgRef.collection('settings').doc('public').set(pub);
}

async function main() {
  const orgIds = ORG_ID
    ? [ORG_ID]
    : (await db.collection('orgs').get()).docs.map(d => d.id);
  if (!orgIds.length) { log('No orgs found.'); return; }
  log(`Backfilling ${orgIds.length} org(s)${ORG_ID ? '' : ' (all)'}`);
  for (const id of orgIds) await backfillOrg(id);
  log('Done.');
  if (DRY_RUN) log('No writes were made (dry run). Re-run without --dry-run to apply.');
}

main().catch(err => { console.error(err); process.exit(1); });
