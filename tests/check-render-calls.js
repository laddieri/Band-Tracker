// Static CI check: Firestore listener code must not call render() directly.
//
// js/02-data.js is where every Firestore snapshot lands. A snapshot can fire
// at any moment — including the echo of this client's own debounced saves —
// and a direct render() from there replaces the DOM out from under whatever
// field the user has the mobile keyboard open in: the keyboard slams shut and
// the focus-restore net pops it back open, so the keyboard appears to open and
// close by itself (fixed in PR #282). Data-driven re-renders must go through
// renderFromData() (js/03-router.js), which parks the render while an editable
// field is focused and flushes it once focus moves on.
//
// Enforcement: every `render()` call in js/02-data.js must either be
// renderFromData(), or carry a `// direct-render-ok: <why>` tag on the same
// line. The tag is reserved for renders that genuinely must be immediate
// (loading-state transitions, sign-out) because no field can be focused when
// they run — write the reason into the tag.
//
// No dependencies — runs with plain `node tests/check-render-calls.js`.

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const FILE = 'js/02-data.js';
const src  = fs.readFileSync(path.resolve(__dirname, '..', FILE), 'utf8');

const problems = [];
let calls = 0, tagged = 0, deferred = 0;

src.split('\n').forEach((line, i) => {
  if (line.trim().startsWith('//')) return; // comment-only line
  deferred += (line.match(/renderFromData\(\)/g) || []).length;
  // Bare render() calls: strip renderFromData() first so it can't shadow-match.
  const bare = (line.replace(/renderFromData\(\)/g, '').match(/\brender\(\)/g) || []).length;
  if (!bare) return;
  calls += bare;
  if (line.includes('direct-render-ok')) { tagged += bare; return; }
  problems.push(`${FILE}:${i + 1} calls render() directly: ${line.trim()}`);
});

if (problems.length) {
  console.error('check-render-calls: FAILED\n');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error(`
Snapshot listeners must use renderFromData() — a direct render() destroys the
focused field and makes the mobile keyboard open/close at random (PR #282).
If this render truly must be immediate (no field can be focused when it runs),
tag the line:  render(); // direct-render-ok: <why>`);
  process.exit(1);
}
console.log(`check-render-calls: OK — ${FILE}: ${deferred} renderFromData() calls, ${tagged} tagged direct render() calls, 0 untagged.`);
