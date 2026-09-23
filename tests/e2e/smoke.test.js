// End-to-end smoke test: the real app in a real browser against the local
// Firebase emulators (Auth + Firestore, with the real firestore.rules).
//
// Covers the path every rehearsal depends on:
//   1. a director signs in, takes attendance and adds a mark — and the writes
//      land in Firestore with the shape the rules and listeners expect;
//   2. a student claims their code, sets a PIN, and their portal shows that
//      attendance and mark — and their browser can't read another student's
//      entry (the rules, not the UI, are the privacy boundary).
// It also fails on any uncaught page error, the "Can't reach the server"
// screen, or the "Live updates stopped" notice.
//
// Run:  npm run test:e2e   (starts the emulators; needs Java, like test:rules)
// The app loads the Firebase SDK from the gstatic CDN as in production. Where
// that CDN is unreachable, BT_E2E_LOCAL_SDK=1 serves the SDK from the npm
// `firebase` package instead (may be a slightly newer 10.x than index.html's).

'use strict';

const { before, after, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const http   = require('node:http');
const path   = require('node:path');
const { chromium } = require('playwright');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

const ROOT       = path.resolve(__dirname, '..', '..');
const PROJECT    = 'demo-band-tracker';            // demo- ids never reach a real project
const AUTH_URL   = 'http://127.0.0.1:9099';
const FS_HOST    = '127.0.0.1';
const FS_PORT    = 8080;
const ORG        = 'smokeorg';
const RID        = 'r1';
const DIRECTOR   = { email: 'director@smoke.test', password: 'smoke-pass-1' };
const STUDENT    = { num: '42', name: 'Sam Smoke', code: 'SMOKE42', pin: '482913' };
const OTHER      = { num: '7',  name: 'Riley Other', code: 'OTHER7' };
const TIMEOUT    = 20000;

let testEnv, server, baseUrl, browser;

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.png': 'image/png' };

// Minimal static server for the repo root (the app has no build step).
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel  = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Create an email/password account in the Auth emulator; returns its uid.
async function createAuthUser(email, password) {
  const res = await fetch(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`auth emulator signUp failed: ${JSON.stringify(body)}`);
  return body.localId;
}

// Read a doc as an admin (rules bypassed).
async function adminGet(docPath) {
  let data;
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const snap = await ctx.firestore().doc(docPath).get();
    data = snap.exists ? snap.data() : null;
  });
  return data;
}

// Poll until check(doc) passes — writes from the page are asynchronous.
async function waitForDoc(docPath, check, what) {
  const deadline = Date.now() + TIMEOUT;
  let last;
  while (Date.now() < deadline) {
    last = await adminGet(docPath);
    if (last && check(last)) return last;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.fail(`timed out waiting for ${what} (${docPath}); last value: ${JSON.stringify(last)}`);
}

// A fresh browser context wired to the emulators, collecting page errors.
async function newAppPage() {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.addInitScript(cfg => { window.__BT_EMULATORS__ = cfg; },
    { projectId: PROJECT, auth: AUTH_URL, firestore: { host: FS_HOST, port: FS_PORT } });
  if (process.env.BT_E2E_LOCAL_SDK === '1') {
    const sdkDir = path.join(ROOT, 'node_modules', 'firebase');
    await context.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({
      path: path.join(sdkDir, path.basename(new URL(route.request().url()).pathname)),
      contentType: 'text/javascript',
    }));
  }
  const page   = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(TIMEOUT);
  return { context, page, errors };
}

// Fail on anything that means the app is broken even if the flow "worked".
async function assertHealthy(page, errors) {
  assert.deepEqual(errors, [], 'uncaught page errors');
  assert.equal(await page.locator('text=Can\'t reach the server').count(), 0, 'connection-error screen shown');
  assert.equal(await page.locator('[data-notice="live-error"]').count(), 0, '"Live updates stopped" notice shown');
}

// ── Setup ─────────────────────────────────────────────────────────────────────

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'), host: FS_HOST, port: FS_PORT },
  });
  await testEnv.clearFirestore();
  await fetch(`${AUTH_URL}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

  const dirUid = await createAuthUser(DIRECTOR.email, DIRECTOR.password);
  const today  = new Date().toISOString().slice(0, 10);
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.doc(`orgs/${ORG}`).set({ name: 'Smoke Band', createdBy: dirUid, plan: 'free' });
    await db.doc(`members/${dirUid}`).set({ orgId: ORG, role: 'director', email: DIRECTOR.email });
    await db.doc(`orgs/${ORG}/settings/presets`).set({ bandName: 'Smoke Band' });
    for (const s of [STUDENT, OTHER]) {
      await db.doc(`orgs/${ORG}/students/${s.num}`).set({ number: s.num, name: s.name, studentCode: s.code });
      await db.doc(`studentCodes/${s.code}`).set({ orgId: ORG, studentNumber: s.num });
    }
    await db.doc(`orgs/${ORG}/rehearsals/${RID}`).set({ date: today, label: 'Smoke Rehearsal', startedAt: Date.now() });
    // Another student's entry — the student's browser must NOT be able to read it.
    await db.doc(`orgs/${ORG}/entries/${RID}_${OTHER.num}`).set(
      { rehearsalId: RID, studentNumber: OTHER.num, attendance: 'late', mistakes: 1, positives: 0, notes: '', events: [] });
  });

  server  = await startServer();
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  await testEnv?.cleanup();
});

// ── Flows (sequential: the student checks what the director recorded) ───────

describe('smoke: director records, student sees it', () => {
  it('director signs in, takes attendance and adds a mark', async () => {
    const { context, page, errors } = await newAppPage();
    try {
      await page.goto(baseUrl);
      await page.fill('#auth-email', DIRECTOR.email);
      await page.fill('#auth-password', DIRECTOR.password);
      await page.click('text=Director Sign In');

      // Signed in and loaded: the bottom nav appears.
      await page.locator('.nav-tab[data-view="attendance-tab"]').click();
      await page.locator('button.start-rehearsal-btn', { hasText: 'Take Attendance' }).click();
      await page.locator(`[onclick="setAttendance('${RID}','${STUDENT.num}','absent')"]`).click();

      const afterAtt = await waitForDoc(`orgs/${ORG}/entries/${RID}_${STUDENT.num}`,
        d => d.attendance === 'absent', 'absent attendance');
      assert.equal(afterAtt.studentNumber, STUDENT.num, 'studentNumber stored as a string');
      assert.equal(afterAtt.rehearsalId, RID);

      // Marks: open the rehearsal's tracker (the Events card menu leads here),
      // pick the student and add a positive with no note.
      await page.evaluate(rid => navigate('rehearsal', { rid }), RID);
      await page.locator(`.suggestion-row[onclick="pickStudent('${STUDENT.num}','${RID}')"]`).click();
      await page.locator('button.count-btn.add-positive').click();
      await page.locator(`[onclick="confirmMark('${RID}','${STUDENT.num}','positive','')"]`).click();

      const afterMark = await waitForDoc(`orgs/${ORG}/entries/${RID}_${STUDENT.num}`,
        d => d.positives === 1, 'positive mark');
      assert.equal(afterMark.attendance, 'absent', 'adding a mark kept the attendance');
      assert.equal(afterMark.events.length, 1);
      assert.equal(afterMark.events[0].type, 'positive');
      assert.ok(!JSON.stringify(afterMark).includes(DIRECTOR.email), 'no director email stored in the entry');

      // The director client publishes the student-safe snapshot, build-stamped.
      const pub = await waitForDoc(`orgs/${ORG}/settings/public`, d => d.bandName === 'Smoke Band', 'settings/public');
      assert.equal(pub.appBuild, 0, 'unstamped local build publishes appBuild 0');

      await assertHealthy(page, errors);
    } finally {
      await context.close();
    }
  });

  it('student claims their code, sees their record, and cannot read a classmate\'s', async () => {
    const { context, page, errors } = await newAppPage();
    try {
      await page.goto(baseUrl);
      await page.click('text=Students — tap here');
      await page.fill('#wiz-code', STUDENT.code);
      await page.click('button:has-text("Next")');
      // Unclaimed code → set a PIN (creates the account + membership via the rules).
      await page.fill('#wiz-pin1', STUDENT.pin);
      await page.fill('#wiz-pin2', STUDENT.pin);
      await page.click('text=Create PIN & Sign In');

      await page.locator('.portal-name', { hasText: STUDENT.name }).waitFor();
      await page.locator('.att-summary-chip.att-chip-absent', { hasText: '1 Absence' }).waitFor({ state: 'attached' });
      await page.locator('.portal-stat-value.portal-stat-positive', { hasText: '1' }).waitFor({ state: 'attached' });

      // The join flow wrote a student membership and marked the code claimed.
      const uid = await page.evaluate(() => auth.currentUser.uid);
      const member = await adminGet(`members/${uid}`);
      assert.deepEqual({ orgId: member.orgId, role: member.role, studentNumber: member.studentNumber },
                       { orgId: ORG, role: 'student', studentNumber: STUDENT.num });
      await waitForDoc(`studentCodes/${STUDENT.code}`, d => d.claimed === true, 'code marked claimed');

      // Privacy: straight from the student's own authenticated browser, the
      // rules refuse a classmate's entry and the roster.
      const denied = await page.evaluate(async ({ org, rid, other }) => {
        const tryRead = p => db.doc(p).get({ source: 'server' }).then(() => 'allowed', e => e.code);
        return {
          otherEntry: await tryRead(`orgs/${org}/entries/${rid}_${other}`),
          otherStudent: await tryRead(`orgs/${org}/students/${other}`),
          orgDoc: await tryRead(`orgs/${org}`),
        };
      }, { org: ORG, rid: RID, other: OTHER.num });
      assert.deepEqual(denied, { otherEntry: 'permission-denied', otherStudent: 'permission-denied', orgDoc: 'permission-denied' });

      await assertHealthy(page, errors);
    } finally {
      await context.close();
    }
  });
});
