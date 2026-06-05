#!/usr/bin/env node
/*
 * backup-firestore.js
 *
 * Dumps every top-level Firestore collection (and its documents) to a single
 * timestamped JSON file. This is a simple, plan-independent backup you can run
 * before the migration — unlike `gcloud firestore export`, it does not require
 * the Blaze plan or a GCS bucket.
 *
 * Usage:
 *   cd scripts
 *   npm install
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node backup-firestore.js
 *
 * Output: ./backup-YYYY-MM-DDTHH-MM-SS.json
 *
 * To restore a single collection later, read the JSON and set() each doc back.
 * (For a full disaster recovery, keep this file somewhere safe.)
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// Use GOOGLE_APPLICATION_CREDENTIALS if set; otherwise auto-load
// service-account.json from the current folder (simpler on Windows).
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

async function main() {
  const cols = await db.listCollections();
  const out  = {};
  let total  = 0;

  for (const col of cols) {
    const snap = await col.get();
    out[col.id] = {};
    snap.forEach(doc => { out[col.id][doc.id] = doc.data(); });
    total += snap.size;
    console.log(`  ${col.id}: ${snap.size} document(s)`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file  = `backup-${stamp}.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${total} document(s) across ${cols.length} collection(s) to ${file}`);
}

main().catch(err => { console.error(err); process.exit(1); });
