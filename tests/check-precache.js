// Static CI check: the service-worker precache list stays in sync with the app.
//
// CLAUDE.md requires that every script/asset referenced by index.html also be
// listed in sw.js's PRECACHE (or offline mode silently breaks for that file).
// This script mechanizes that invariant:
//   1. every local <script src>, stylesheet, manifest and icon referenced by
//      index.html must appear in PRECACHE;
//   2. every https:// script in index.html (Firebase CDN) must appear too;
//   3. every local PRECACHE entry must exist as a file in the repo.
//
// No dependencies — runs with plain `node tests/check-precache.js`.

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw   = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

// ── Parse PRECACHE out of sw.js ───────────────────────────────────────────────
const precacheMatch = sw.match(/const\s+PRECACHE\s*=\s*\[([\s\S]*?)\]/);
if (!precacheMatch) {
  console.error('check-precache: could not find a PRECACHE array in sw.js');
  process.exit(1);
}
const precache = [...precacheMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)]
  .map(m => m[1] ?? m[2]);

// ── Collect the assets index.html references ──────────────────────────────────
const refs = [];
for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g))            refs.push(m[1]);
for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*\bhref="([^"]+)"/g)) refs.push(m[1]);
for (const m of html.matchAll(/<link[^>]*rel="manifest"[^>]*\bhref="([^"]+)"/g))   refs.push(m[1]);
for (const m of html.matchAll(/<link[^>]*rel="(?:icon|apple-touch-icon)"[^>]*\bhref="([^"]+)"/g)) refs.push(m[1]);

const normalize = p => p.startsWith('http') ? p : '/' + p.replace(/^\.?\//, '');
const precacheSet = new Set(precache);

const problems = [];

// 1 + 2. Everything index.html loads must be precached.
for (const ref of refs) {
  const key = normalize(ref);
  if (!precacheSet.has(key)) {
    problems.push(`index.html references ${ref} but sw.js PRECACHE has no entry '${key}'`);
  }
}

// 3. Every local PRECACHE entry must exist on disk ('/' → index.html).
for (const entry of precache) {
  if (entry.startsWith('http')) continue;
  const rel = entry === '/' ? 'index.html' : entry.replace(/^\//, '');
  if (!fs.existsSync(path.join(root, rel))) {
    problems.push(`sw.js PRECACHE lists '${entry}' but ${rel} does not exist`);
  }
}

if (problems.length) {
  console.error('check-precache: FAILED\n');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\nAdd the file to the PRECACHE list in sw.js (and bump the CACHE version), or remove the stale entry.');
  process.exit(1);
}
console.log(`check-precache: OK — ${refs.length} index.html assets covered, ${precache.length} precache entries all resolve.`);
