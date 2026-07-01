#!/usr/bin/env node
/*
 * backfill-claims.js
 *
 * One-time backfill for the custom-claims membership migration (see
 * docs/MULTI_TENANCY_RUNBOOK.md). The syncMemberClaims Cloud Function mirrors
 * NEW /members/{uid} docs into auth custom claims; this script does the same
 * for members that already existed before the function was deployed:
 *
 *   members/{uid} { orgId, role, studentNumber? }
 *     -> auth custom claims { orgId, role, studentNumber? }
 *
 * Idempotent: re-running overwrites the same claims. Users pick the claims up
 * on their next ID-token refresh (up to ~1h, or next sign-in); until then the
 * rules' member-doc fallback keeps working, so ordering doesn't matter.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node backfill-claims.js [--dry-run]
 *
 *   --dry-run    Print what would happen without writing anything.
 */

const admin = require('firebase-admin');

const DRY = process.argv.includes('--dry-run');

admin.initializeApp();
const db = admin.firestore();

(async () => {
  const snap = await db.collection('members').get();
  console.log(`${snap.size} member docs`);
  let ok = 0, skipped = 0, failed = 0;

  for (const doc of snap.docs) {
    const uid = doc.id;
    const m   = doc.data();
    if (!m.orgId || !m.role) {
      console.warn(`  SKIP ${uid}: missing orgId/role`, m);
      skipped++;
      continue;
    }
    const claims = { orgId: m.orgId, role: m.role };
    if (m.studentNumber) claims.studentNumber = String(m.studentNumber);

    if (DRY) {
      console.log(`  would set ${uid}:`, claims);
      ok++;
      continue;
    }
    try {
      await admin.auth().setCustomUserClaims(uid, claims);
      ok++;
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        console.warn(`  SKIP ${uid}: no auth user (orphaned member doc)`);
        skipped++;
      } else {
        console.error(`  FAIL ${uid}:`, e.message);
        failed++;
      }
    }
  }

  console.log(`${DRY ? '[dry-run] ' : ''}done: ${ok} set, ${skipped} skipped, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
