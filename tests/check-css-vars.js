// Static CI check: every CSS custom property the app reads is defined.
//
// A var(--x) that nothing defines silently falls back — to its fallback value
// if it has one, else to the property's initial value. That hid real bugs:
// light-only fallbacks (var(--surface-2,#eee), var(--card,#fff)…) made text
// unreadable in dark mode, and var(--r-md) without a fallback dropped rounded
// corners. So a variable must be declared in app.css (`--x:`) or set from JS
// (style.setProperty('--x', …)); a fallback alone doesn't count.
//
// No dependencies — runs with plain `node tests/check-css-vars.js`.

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const root  = path.resolve(__dirname, '..');
const read  = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
const files = ['app.css', 'index.html', ...jsFiles];

const css = read('app.css');
const defined = new Set([...css.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map(m => m[1]));
for (const f of jsFiles) {
  for (const m of read(f).matchAll(/setProperty\(\s*['"](--[A-Za-z0-9-]+)['"]/g)) defined.add(m[1]);
}

const problems = [];
for (const f of files) {
  read(f).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)) {
      if (!defined.has(m[1])) problems.push(`${f}:${i + 1} uses ${m[1]}, which is never defined`);
    }
  });
}

if (problems.length) {
  console.error('check-css-vars: FAILED\n');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\nDeclare the variable in app.css (in :root, and in the dark theme if it is a colour), or use an existing token.');
  process.exit(1);
}
console.log(`check-css-vars: OK — ${defined.size} custom properties defined, every var() resolves.`);
