#!/usr/bin/env node
/*
 * migrate-to-orgs.js
 *
 * Migrates the legacy flat Band Tracker data into the per-org subcollection
 * model described in docs/DATA_MODEL.md.
 *
 * What it does (all additive — it never deletes legacy data):
 *   1. Creates  orgs/{orgId}                with metadata from /settings/presets
 *   2. Copies   /settings/presets       -> orgs/{orgId}/settings/presets
 *   3. Copies   /students/*             -> orgs/{orgId}/students/*
 *   4. Copies   /rehearsals/*           -> orgs/{orgId}/rehearsals/*
 *   5. Copies   /entries/*              -> orgs/{orgId}/entries/*
 *   6. Copies   /songs/*               -> orgs/{orgId}/songs/*
 *   7. Creates  members/{uid}            for every email in /admins (role: director)
 *   8. Creates  studentCodes/{CODE}      for every student that has a studentCode
 *
 * The legacy top-level collections are left in place so you can roll back by
 * simply re-deploying the old rules. Delete them only after you have verified
 * the migrated app works.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node migrate-to-orgs.js --org-id=<id> --org-name="<name>" [--dry-run]
 *
 *   --org-id     Required. The id for the org to create (e.g. a school slug).
 *   --org-name   Optional. Defaults to bandName from /settings/presets, else --org-id.
 *   --dry-run    Print what would happen without writing anything.
 *
 * The script is idempotent: re-running it overwrites the same destination docs.
 */

const admin = require('firebase-admin');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);

const ORG_ID  = args['org-id'];
const DRY_RUN = !!args['dry-run'];

if (!ORG_ID || ORG_ID === true) {
  console.error('ERROR: --org-id=<id> is required.');
  console.error('Example: node migrate-to-orgs.js --org-id=lincoln-hs --org-name="Lincoln HS Band"');
  process.exit(1);
}

// ── Init ──────────────────────────────────────────────────────────────────────
admin.initializeApp(); // uses GOOGLE_APPLICATION_CREDENTIALS
const db   = admin.firestore();
const auth = admin.auth();

const log = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[migrate]', ...a);

// Copy every doc from a top-level collection into a subcollection of the org.
async function copyCollection(name) {
  const snap = await db.collection(name).get();
  log(`${name}: ${snap.size} document(s)`);
  let n = 0;
  let batch = db.batch();
  for (const doc of snap.docs) {
    const dest = db.collection('orgs').doc(ORG_ID).collection(name).doc(doc.id);
    if (!DRY_RUN) batch.set(dest, { ...doc.data(), orgId: ORG_ID });
    if (++n % 400 === 0) { if (!DRY_RUN) { await batch.commit(); batch = db.batch(); } }
  }
  if (!DRY_RUN && n % 400 !== 0) await batch.commit();
  return n;
}

async function main() {
  log(`Target org: ${ORG_ID}`);

  // 1. Org metadata (from settings/presets).
  const presetsSnap = await db.collection('settings').doc('presets').get();
  const presets = presetsSnap.exists ? presetsSnap.data() : {};
  const orgName = (args['org-name'] && args['org-name'] !== true)
    ? args['org-name']
    : (presets.bandName || ORG_ID);

  // Best-effort: attribute the org to the first admin, if any.
  const adminsSnap = await db.collection('admins').get();
  let createdBy = null;
  for (const a of adminsSnap.docs) {
    try {
      const u = await auth.getUserByEmail(a.id);
      createdBy = u.uid;
      break;
    } catch { /* no auth user for this email yet */ }
  }

  log(`Creating orgs/${ORG_ID} name="${orgName}" createdBy=${createdBy || '(none)'} plan=free`);
  if (!DRY_RUN) {
    await db.collection('orgs').doc(ORG_ID).set({
      name:      orgName,
      plan:      'free',
      createdBy: createdBy,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // 2-6. Copy data collections into the org subtree.
  for (const c of ['settings', 'students', 'rehearsals', 'entries', 'songs']) {
    await copyCollection(c);
  }

  // 7. Members: every admin email -> members/{uid} (role: director).
  log(`admins: ${adminsSnap.size} email(s)`);
  let memberCount = 0, missingUids = [];
  for (const a of adminsSnap.docs) {
    const email = a.id;
    try {
      const u = await auth.getUserByEmail(email);
      log(`  director ${email} -> members/${u.uid}`);
      if (!DRY_RUN) {
        await db.collection('members').doc(u.uid).set({
          orgId: ORG_ID, role: 'director', email,
        }, { merge: true });
      }
      memberCount++;
    } catch {
      missingUids.push(email);
    }
  }
  if (missingUids.length) {
    log(`  WARNING: no Auth user found for: ${missingUids.join(', ')}`);
    log('  These directors must sign in once, then re-run the migration (or add their members doc manually).');
  }

  // 8. Student codes: studentCodes/{CODE} -> { orgId, studentNumber }.
  const studentsSnap = await db.collection('students').get();
  let codeCount = 0;
  let batch = db.batch();
  for (const s of studentsSnap.docs) {
    const code = s.data().studentCode;
    if (!code) continue;
    const dest = db.collection('studentCodes').doc(String(code).toUpperCase());
    if (!DRY_RUN) batch.set(dest, { orgId: ORG_ID, studentNumber: s.id }, { merge: true });
    if (++codeCount % 400 === 0) { if (!DRY_RUN) { await batch.commit(); batch = db.batch(); } }
  }
  if (!DRY_RUN && codeCount % 400 !== 0) await batch.commit();
  log(`studentCodes: ${codeCount} code(s)`);

  log('Done.');
  log(`Summary: org=${ORG_ID}, directors=${memberCount}, studentCodes=${codeCount}`);
  if (DRY_RUN) log('No writes were made (dry run). Re-run without --dry-run to apply.');
}

main().catch(err => { console.error(err); process.exit(1); });
