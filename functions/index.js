// Band Tracker Cloud Functions — custom-claims membership mirror.
//
// Mirrors /members/{uid} into auth custom claims ({orgId, role,
// studentNumber?}) so the security rules can authorize from the token instead
// of get()-ing the member doc on every request (the doc fallback in
// firestore.rules stays for tokens minted before the claims existed).
//
// Deploying is OPTIONAL and deferred: until these run, no tokens carry claims
// and the rules behave exactly as before. Activation steps + the revocation
// tradeoff are documented in docs/MULTI_TENANCY_RUNBOOK.md. Requires the
// Blaze plan (Cloud Functions v2).
//
// Membership docs are create/delete only (rules: `allow update: if false`),
// so two triggers cover the whole lifecycle.

const { onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

exports.syncMemberClaims = onDocumentCreated('members/{uid}', async (event) => {
  const m = event.data && event.data.data();
  if (!m || !m.orgId || !m.role) {
    console.error(`members/${event.params.uid} missing orgId/role — no claims set`, m);
    return;
  }
  const claims = { orgId: m.orgId, role: m.role };
  if (m.studentNumber) claims.studentNumber = String(m.studentNumber);
  try {
    await admin.auth().setCustomUserClaims(event.params.uid, claims);
  } catch (e) {
    // A members doc can outlive its auth user (e.g. cleanup scripts). Claims
    // just won't exist; the rules' doc fallback keeps the account working.
    console.error(`setCustomUserClaims failed for ${event.params.uid}:`, e);
  }
});

exports.clearMemberClaims = onDocumentDeleted('members/{uid}', async (event) => {
  const uid = event.params.uid;
  try {
    await admin.auth().setCustomUserClaims(uid, null);
    // Their current ID token stays valid for up to ~1h; revoking refresh
    // tokens stops new ones from being minted with the stale claims.
    await admin.auth().revokeRefreshTokens(uid);
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') return; // account already deleted
    console.error(`clearing claims failed for ${uid}:`, e);
  }
});
