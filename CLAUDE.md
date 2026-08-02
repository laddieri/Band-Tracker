# Band Tracker — guidance for AI coding sessions

Multi-tenant PWA for tracking marching-band rehearsal attendance, marks and
song memorization. Vanilla JS (no build step): `index.html` + `app.js` +
`app.css`, Firebase Auth + Firestore, deployed to GitHub Pages on merge to
`main`. Directors and staff sign in with email/password (staff join via a
role-tagged invite code and can only record — attendance, marks, song
results — no admin control; gate UI with `canRecord()` vs `STATE.isAdmin`);
students sign in anonymously with a student code and see only their own
portal.

## Privacy invariants — do not break these

The security rules (`firestore.rules`), not the UI, are the privacy boundary.
Students can talk to Firestore directly with their own credentials, so "the
app doesn't show it" is never a justification. Full model:
`docs/DATA_MODEL.md` → "Student data visibility".

1. **Students can only read:** their own `students/{num}` doc, their own
   `entries` (queries must filter `studentNumber == <own>`), `rehearsals`
   metadata, and `settings/public`. Everything else — the org doc, the
   roster, other students' entries, `songs`, `settings/presets` — is
   director/staff-only (the org doc stays director-only even from staff; staff
   can READ `drills` and `shows` to view the field chart and its spot map but
   only directors WRITE them, and staff writes elsewhere are limited to
   recording — see the staff section in `docs/DATA_MODEL.md`).
2. **Never store emails or other director PII in entries or student docs.**
   Stamp `STATE.user.uid` in `updatedBy`/`by` fields. For display, resolve
   uids with `dirLabel()` via `STATE.dirNames` (director clients build this
   map from the org's memberships). Author labels appear only in
   director-only views. (This was regressed once — PR #189 — and fixed; don't
   "fix" raw-uid display by storing emails again.)
3. **Student-visible data flows through the published snapshot.** Director
   clients publish `settings/public` (`schedulePublishPublicStats()` /
   `computePublicStats()`). If you add a setting or stat that students need,
   thread it through BOTH the publisher and `studentListeners()` — never read
   `settings/presets` or raw collections in student-facing code paths.
4. **Per-student song results** live in the director-only song docs AND are
   mirrored to `students/{num}.songStatuses.{songId}` (status/note/updatedAt
   only) by `_applySongStatus()`. Keep both writes in sync.
5. **The org doc holds the co-director and staff invite codes.** It must stay
   director-only readable (not even staff), or students/staff can escalate to
   directors. The rules also pair invite codes with roles: a `role:'staff'`
   code can only mint a staff membership, and codes without a role only a
   director one.
6. **Any `firestore.rules` change requires matching tests** in
   `tests/firestore.test.js`. Run them with `npm run test:rules` (needs Java
   for the emulator). CI deploys rules only after tests pass.

## Architecture notes

- The app is split into ordered plain scripts in `js/` (see `index.html`):
  `01-core` (state/Firebase/DB) → `02-data` (listeners + publisher) →
  `03-router` → `04-render` → view files (`05`–`12`) → `13-boot`. They share
  one global scope — this is NOT ES modules, because interactivity is global
  functions wired via inline `onclick`. Define things before (file-order) any
  top-level code that calls them; cross-file calls inside functions are fine.
- When adding a script file, add it to BOTH `index.html` and the `PRECACHE`
  list in `sw.js` (and bump the `CACHE` version there).
- Views are template-literal HTML rendered into `#main-content`.
- All Firestore access goes through `orgCol(name)` (scoped to
  `orgs/{STATE.orgId}/...`). Role split happens in `startListeners()`:
  directors get full-collection listeners, students get `studentListeners()`.
- Always escape user data with `esc()` when interpolating into HTML.
- Keyboard access for clickable non-button elements is retrofitted at render
  time (`_a11yRetrofit` in `js/13-boot.js` stamps `role="button"` +
  `tabindex`; Enter/Space activate). Still prefer real `<button>`s for new
  UI, and keep `aria-label`s on icon-only buttons.
- Firestore writes may be fire-and-forget: a global `unhandledrejection`
  handler (`js/13-boot.js`) toasts rejected writes via `_toastSaveError()`.
  Don't add `.catch(() => {})` unless a failure is genuinely best-effort —
  that swallows the error before the safety net sees it. Writes needing
  bespoke error UI use their own try/catch. Director listeners also feed the
  header "Saving…" pill from `hasPendingWrites` (`_notePendingWrites()` in
  `js/02-data.js`).
- Entry docs are keyed `{rehearsalId}_{studentNumber}` and must always carry
  `studentNumber` as a **string** (student queries filter on it) plus the
  rehearsal's season via `..._seasonStampFor(rid)` (listeners filter
  `season == activeSeason`; an unstamped doc drops out of view — see
  "Seasons" in `docs/DATA_MODEL.md`).
- Drill files are grouped into **shows** so all drills of one production share
  one `label→student` spot map (`orgs/{orgId}/shows/{showId}.mapping`; each
  drill doc carries a `showId`). Assign a spot once and every drill in the show
  — including files uploaded later — inherits it. Spot edits go through
  `_saveActiveMapping()` (writes the show doc when grouped, the drill doc when
  not); the resolver is `drillStudentNumsByLabel()`. See "Drill shows and spot
  maps" in `docs/DATA_MODEL.md`. Don't reintroduce per-drill spot re-entry.
- One-off admin scripts live in `scripts/` (run locally with a service
  account, never in CI). `service-account.json` and `backup-*.json` are
  gitignored — keep it that way.

## Checks

- `node --check` on every JS file — CI runs this on every PR (`syntax.yml`).
- `npm run check:static` — dependency-free consistency checks, also in
  `syntax.yml`: `tests/check-precache.js` (every index.html asset is in the
  `sw.js` PRECACHE and every entry exists) and `tests/check-handlers.js`
  (every inline `on*=` handler calls a defined top-level global — catches
  renamed/misspelled functions that would only fail at tap time).
- `npm run test:unit` — unit tests for the pure logic in `js/00-logic.js`
  (scoring, published stats, auto marks, pseudonyms, CSV parsing, and the
  Pyware `.3dj`/`.3da` drill-file parser). Also runs in CI on every PR. Keep
  `00-logic.js` free of Firebase/STATE/DOM so it stays requireable from Node;
  bind it to STATE via thin wrappers elsewhere. The drill parser lives here
  (pure byte-wrangling); the viewer UI that consumes it is in `js/12-drill.js`.
- `npm run test:rules` — Firestore rules tests against the emulator.
- There is no build step; do not introduce one casually.
