// Static CI check: every inline event handler resolves to a defined global.
//
// The app's interactivity is wired through inline attributes (onclick=…)
// rendered from template literals, which reference GLOBAL functions resolved
// at tap time. `node --check` can't catch a renamed or misspelled function —
// it only surfaces as a ReferenceError in production when someone taps the
// button. This script closes that gap:
//   1. collect every top-level (column-0) function/const/let/var name across
//      the ordered plain scripts in js/ (they share one global scope);
//   2. extract every on*="…" handler attribute from js/*.js and index.html;
//   3. assert every function CALLED inside a handler is a defined global.
//
// No dependencies — runs with plain `node tests/check-handlers.js`.

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const root    = path.resolve(__dirname, '..');
const jsFiles = fs.readdirSync(path.join(root, 'js'))
  .filter(f => f.endsWith('.js'))
  .map(f => path.join('js', f));
const sources = [...jsFiles, 'index.html'];

// ── 1. Defined globals ────────────────────────────────────────────────────────
// Plain scripts: anything declared at column 0 is a global. Nested declarations
// are indented, so anchoring at line start keeps them out (an indented function
// is NOT reachable from an inline handler — that's the point of the check).
const globals = new Set();
for (const file of jsFiles) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const line of text.split('\n')) {
    let m;
    if ((m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/))) globals.add(m[1]);
    else if ((m = line.match(/^(?:const|let|var)\s+(.+)/))) {
      // Handle comma lists: let a = 1, b = 2;
      for (const dm of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) globals.add(dm[1]);
    }
  }
}

// Host/builtin identifiers legitimately callable from a handler.
const BUILTINS = new Set([
  'if', 'for', 'while', 'switch', 'return', 'typeof', 'new', 'catch',
  'alert', 'confirm', 'prompt', 'setTimeout', 'setInterval', 'requestAnimationFrame',
  'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'Promise', 'RegExp',
  'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent',
]);

// ── 2 + 3. Extract handlers and verify their calls ────────────────────────────
const problems = [];
let handlerCount = 0, callCount = 0;

for (const file of sources) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  // on…="…" attributes, whether in raw HTML or inside a JS template literal.
  for (const m of text.matchAll(/\bon[a-z]+\s*=\s*"([^"]*)"/g)) {
    // Drop ${…} template interpolations: they execute at RENDER time in normal
    // JS scope (lexical, checked by node --check), not at tap time in global
    // scope. Only what remains is evaluated when the handler fires.
    const body = m[1].replace(/\$\{[^}]*\}/g, '');
    handlerCount++;
    const line = text.slice(0, m.index).split('\n').length;
    // Identifiers directly followed by '(' — i.e., calls. Skip method calls
    // (preceded by '.') and template interpolation openings ('${').
    for (const call of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = call[1];
      const prev = body[call.index - 1];
      if (prev === '.') continue;               // obj.method()
      if (BUILTINS.has(name)) continue;
      callCount++;
      if (!globals.has(name)) {
        problems.push(`${file}:${line} handler calls ${name}(…) but no top-level function/var '${name}' is defined in js/`);
      }
    }
  }
}

if (problems.length) {
  console.error('check-handlers: FAILED\n');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\nEither the function was renamed/removed, or it is defined nested (not at column 0) and is not actually reachable from an inline handler.');
  process.exit(1);
}
console.log(`check-handlers: OK — ${handlerCount} inline handlers, ${callCount} calls, all resolve against ${globals.size} globals.`);
