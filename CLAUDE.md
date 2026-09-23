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
   only) by `_applySongStatus()`. Keep both writes in sync. **Per-student field
   spots** follow the same own-doc-mirror pattern: the show maps are
   director/staff-only, so a director client mirrors each student's spots to
   `students/{num}.spots` (`_syncStudentSpotsMirror()` in `js/02-data.js`) for
   the student portal to read. Director/staff views compute spots live from
   `STATE.shows` instead (`studentSpots()`).
5. **The org doc holds the co-director and staff invite codes.** It must stay
   director-only readable (not even staff), or students/staff can escalate to
   directors. The rules also pair invite codes with roles: a `role:'staff'`
   code can only mint a staff membership, and codes without a role only a
   director one. Co-director `members/{uid}` docs also carry the
   director invite code they joined with, so staff may read only their OWN
   membership — they get author names from the director-published
   `settings/directory` instead.
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
  list in `sw.js` (and bump the `CACHE` version there). Deploys publish only
  the files staged in `deploy.yml` ("Stage site files": the root app files
  plus `js/` and `icons/`); a new top-level file or folder the app serves must
  be added to that `cp` line too. The step re-runs `check-precache.js` on the
  staged copy, so a missing precached file fails the deploy instead of
  shipping broken. Deploys also run the `syntax.yml` checks first.
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
  bespoke error UI use their own try/catch. For an `update()` that may hit a
  missing doc, use `.catch(_ignoreNotFound)` (rethrows everything else).
- **Revoking access goes first, and never fails silently.** Switching off a
  login/invite code or removing a membership uses `_retireCode()` /
  `_removeStudentMemberships()` (`js/01-core.js`) BEFORE the rest of the
  change, and the flow stops if they reject — otherwise a failure leaves an
  old code working with nothing in the app pointing at it (can't be retried).
- **Never call `render()` from a Firestore listener or any other code that can
  fire while the user is mid-interaction** (snapshot callbacks, async loads,
  timers) — use `renderFromData()` (`js/03-router.js`) instead. A direct render
  replaces the focused field, so on mobile the keyboard slams shut and the
  focus-restore net pops it back open — "the keyboard opens and closes by
  itself" (regressed and fixed in PR #282). `renderFromData()` parks the
  render while an editable field is focused and flushes it on focusout; STATE
  stays current the whole time, only the DOM update waits. Direct `render()`
  is fine in user-initiated paths (taps, navigation). Enforced in
  `js/02-data.js` by `tests/check-render-calls.js` (part of
  `npm run check:static`): the rare genuinely-immediate render there carries a
  `// direct-render-ok: <why>` tag. Apply the same discipline to listeners
  added in other files (e.g. the drill payload load in `js/12-drill.js`).
- Every `onSnapshot` needs an error callback that goes through
  `_listenerFailed(name, err, { critical })` (`js/02-data.js`): Firestore never
  restarts a failed listener, so an unhandled one leaves the app stuck on the
  spinner or silently stale. It shows the retry screen (critical, during load)
  or a sticky "Live updates stopped — Reconnect" notice, and pauses publishing.
- Entry docs are keyed `{rehearsalId}_{studentNumber}` and must always carry
  `studentNumber` as a **string** (student queries filter on it) plus the
  rehearsal's season via `..._seasonStampFor(rid)` (listeners filter
  `season == activeSeason`; an unstamped doc drops out of view — see
  "Seasons" in `docs/DATA_MODEL.md`). The rules enforce the key shape on
  create (and on any update that touches `rehearsalId`/`studentNumber`).
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
  `sw.js` PRECACHE and every entry exists), `tests/check-handlers.js`
  (every inline `on*=` handler calls a defined top-level global — catches
  renamed/misspelled functions that would only fail at tap time) and
  `tests/check-render-calls.js` (no untagged direct `render()` in
  `js/02-data.js` — listeners must use `renderFromData()`, see the mobile
  keyboard note above).
- `npm run test:unit` — unit tests for the pure logic in `js/00-logic.js`
  (scoring, published stats, auto marks, pseudonyms, CSV parsing, and the
  Pyware `.3dj`/`.3da` drill-file parser). Also runs in CI on every PR. Keep
  `00-logic.js` free of Firebase/STATE/DOM so it stays requireable from Node;
  bind it to STATE via thin wrappers elsewhere. The drill parser lives here
  (pure byte-wrangling); the viewer UI that consumes it is in `js/12-drill.js`.
- `npm run test:rules` — Firestore rules tests against the emulator.
- `npm run test:e2e` — end-to-end smoke test (`tests/e2e/smoke.test.js`, CI:
  `e2e.yml`): the real app in headless Chromium against the Auth + Firestore
  emulators (demo- project, real rules). A director signs in, takes
  attendance and adds a mark; a student claims their code, sees it in the
  portal, and can't read a classmate's entry. Needs Java; set
  `BT_E2E_LOCAL_SDK=1` where the gstatic CDN is blocked. The app reaches the
  emulators only via `window.__BT_EMULATORS__` (set by the test) — keep that
  hook in `js/01-core.js`. If you rename a selector the test uses (login
  fields, `setAttendance`/`pickStudent`/`confirmMark` handlers, portal
  classes), update the test too.
- There is no build step; do not introduce one casually. The one deploy-time
  edit is `deploy.yml` stamping the deploy time into `const APP_BUILD = 0;`
  (`js/01-core.js`) and `const BUILD = 0;` (`sw.js`) — keep those lines
  exactly as written so the stamp's `sed` still matches (the step fails the
  deploy if it doesn't).
