// Firestore security-rules tests for Band Tracker.
//
// These run against the local Firestore emulator and exercise firestore.rules
// directly — no cloud, no real data. They prove the things that matter:
// tenant isolation, role permissions, the access-code gate, the join flows,
// and owner-protected member deletion.
//
// Run locally:   npm run test:rules     (needs Java for the emulator)
// In CI:         see .github/workflows/rules.yml

const { before, after, beforeEach, describe, it } = require('node:test');
const fs   = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');

let testEnv;

// Auth context helpers.
const director = (uid) => testEnv.authenticatedContext(uid).firestore();        // password user → not anonymous
const anon     = (uid) => testEnv.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'anonymous' },
}).firestore();
const guest    = ()    => testEnv.unauthenticatedContext().firestore();

// Seed a known world with admin privileges (bypasses rules).
//   org "a"  owned by dirA, with co-director coA, student studA, and a roster doc
//   org "b"  owned by dirB (separate tenant)
//   org "x"  owned by founderX, with NO member yet (to test create-membership)
//   lookups: accessCodes/GOOD, studentCodes/SCODE→a, inviteCodes/ICODE→a
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('orgs/a').set({ createdBy: 'dirA', name: 'Org A' });
    await db.doc('members/dirA').set({ orgId: 'a', role: 'director', email: 'dir@a.com' });
    await db.doc('members/coA').set({ orgId: 'a', role: 'director', email: 'co@a.com' });
    await db.doc('members/studA').set({ orgId: 'a', role: 'student', studentNumber: '42' });
    await db.doc('orgs/a/students/42').set({ name: 'Sam' });
    await db.doc('orgs/a/settings/presets').set({ bandName: 'Org A' });

    await db.doc('orgs/b').set({ createdBy: 'dirB', name: 'Org B' });
    await db.doc('members/dirB').set({ orgId: 'b', role: 'director', email: 'dir@b.com' });
    await db.doc('orgs/b/students/1').set({ name: 'Pat' });

    await db.doc('orgs/x').set({ createdBy: 'founderX', name: 'Org X' });

    await db.doc('accessCodes/GOOD').set({ active: true });
    await db.doc('studentCodes/SCODE').set({ orgId: 'a', studentNumber: '42' });
    await db.doc('inviteCodes/ICODE').set({ orgId: 'a' });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-band-tracker',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

describe('tenant isolation', () => {
  it('a director reads their own org data', async () => {
    await assertSucceeds(director('dirA').doc('orgs/a/students/42').get());
  });
  it('a director CANNOT read another org data', async () => {
    await assertFails(director('dirA').doc('orgs/b/students/1').get());
  });
  it('a director CANNOT write another org data', async () => {
    await assertFails(director('dirA').doc('orgs/b/students/1').set({ name: 'x' }));
  });
  it('an unauthenticated user cannot read org data', async () => {
    await assertFails(guest().doc('orgs/a/students/42').get());
  });
});

describe('roles within an org', () => {
  it('a director can write a student', async () => {
    await assertSucceeds(director('dirA').doc('orgs/a/students/99').set({ name: 'New' }));
  });
  it('a student can read org data', async () => {
    await assertSucceeds(director('studA').doc('orgs/a/students/42').get());
  });
  it('a student CANNOT write org data', async () => {
    await assertFails(director('studA').doc('orgs/a/students/42').set({ name: 'hacked' }));
  });
});

describe('membership visibility', () => {
  it('a user can read their own membership', async () => {
    await assertSucceeds(director('dirA').doc('members/dirA').get());
  });
  it('a director can read another member of their org', async () => {
    await assertSucceeds(director('dirA').doc('members/coA').get());
  });
  it('a director CANNOT read a member of another org', async () => {
    await assertFails(director('dirA').doc('members/dirB').get());
  });
});

describe('creating a band (access-code gate)', () => {
  it('succeeds with a valid access code', async () => {
    await assertSucceeds(
      director('newDir').doc('orgs/new1').set({ createdBy: 'newDir', accessCode: 'GOOD' })
    );
  });
  it('fails with an invalid access code', async () => {
    await assertFails(
      director('newDir').doc('orgs/new2').set({ createdBy: 'newDir', accessCode: 'NOPE' })
    );
  });
  it('fails for an anonymous user even with a valid code', async () => {
    await assertFails(
      anon('anonDir').doc('orgs/new3').set({ createdBy: 'anonDir', accessCode: 'GOOD' })
    );
  });
  it('access codes are not readable by clients', async () => {
    await assertFails(director('dirA').doc('accessCodes/GOOD').get());
  });
});

describe('joining an org', () => {
  it('the org creator can create their own director membership', async () => {
    await assertSucceeds(
      director('founderX').doc('members/founderX').set({ orgId: 'x', role: 'director' })
    );
  });
  it('a co-director can join with a valid invite code', async () => {
    await assertSucceeds(
      director('coDir').doc('members/coDir').set({ orgId: 'a', role: 'director', inviteCode: 'ICODE' })
    );
  });
  it('a student can join with a valid student code', async () => {
    await assertSucceeds(
      anon('newStud').doc('members/newStud').set({ orgId: 'a', role: 'student', joinCode: 'SCODE' })
    );
  });
  it('joining as director with no code/ownership fails', async () => {
    await assertFails(
      director('intruder').doc('members/intruder').set({ orgId: 'a', role: 'director' })
    );
  });
  it('a student join with a bad code fails', async () => {
    await assertFails(
      anon('badStud').doc('members/badStud').set({ orgId: 'a', role: 'student', joinCode: 'WRONG' })
    );
  });
  it('you cannot create a membership for someone else', async () => {
    await assertFails(
      director('coDir').doc('members/someoneElse').set({ orgId: 'a', role: 'director', inviteCode: 'ICODE' })
    );
  });
});

describe('removing directors (owner protection)', () => {
  it('a director can remove a non-owner member of their org', async () => {
    await assertSucceeds(director('dirA').doc('members/coA').delete());
  });
  it('the owner cannot be removed', async () => {
    await assertFails(director('coA').doc('members/dirA').delete());
  });
  it('a director CANNOT remove a member of another org', async () => {
    await assertFails(director('dirA').doc('members/dirB').delete());
  });
});
