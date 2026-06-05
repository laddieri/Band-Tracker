# Multi-Tenancy Runbook

This is the safe, ordered procedure for taking Band Tracker from a single shared
data pool to isolated per-org (per-school) data. Read `docs/DATA_MODEL.md` first.

> **Why order matters.** The new security rules deny any access to the legacy
> flat collections and require the per-org subcollection layout plus a
> `members/{uid}` doc. If you deploy the rules before the data is migrated and
> the app is updated, the live app breaks for everyone. Do the steps in order.

## 0. Back up first

Export the whole Firestore database before touching anything:

```bash
gcloud firestore export gs://band-tracker-ae9b4-backups/$(date +%F)
```

(or use the Firestore console "Export" — any restorable backup is fine.)

## 1. Migrate the data (additive, reversible)

Creates the `orgs/{orgId}` subtree, `members/{uid}` for current directors, and
the `studentCodes` lookup. **It does not delete the legacy collections**, so
this step alone changes nothing for the running app.

```bash
cd scripts
npm install
# Download a service-account key from Firebase console → Project settings →
# Service accounts → Generate new private key. Save as scripts/service-account.json
# (already git-ignored).

# Preview:
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node migrate-to-orgs.js --org-id=<your-org-id> --org-name="<Your Band>" --dry-run

# Apply:
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node migrate-to-orgs.js --org-id=<your-org-id> --org-name="<Your Band>"
```

If a director has never signed in, the script can't find their Auth `uid` and
will warn. Have them sign in once, then re-run (it's idempotent).

## 2. Update the app to read/write the org subtree — DONE

`app.js` has been scoped to the org subtree:

- `resolveMembership()` runs at startup, reading the current user's `orgId` and
  role from `members/{uid}`.
- A small `orgCol(name)` helper returns
  `db.collection('orgs').doc(orgId).collection(name)`; every `students`,
  `rehearsals`, `entries`, `songs`, and `settings` access now goes through it.
- Anonymous students resolve their org via `studentCodes/{CODE}` and create
  their own `members/{uid}` doc on first sign-in.
- When a director generates or edits a student code, the top-level
  `studentCodes` lookup is kept in sync (`setStudentCodeLookup`).
- A signed-in user with no membership sees a "No band linked yet" screen
  (`STATE.needsOnboarding`) instead of a blank app, until the onboarding
  milestone lands.

Deploy the updated `app.js` (push to GitHub Pages) **after** step 1 and verify
it works while the **old rules are still live** (old rules are permissive, so
the new subtree reads/writes are allowed). Then proceed to step 3.

> Known follow-ups (not blockers): if a student's code is *changed*, the old
> `studentCodes/{OLD}` doc is left behind (the old code still resolves);
> clean-up can be added with the onboarding milestone. Email-only student logins
> require a `members` doc — handled by the onboarding flow.

## 3. Deploy the new security rules (the lockdown)

Only after steps 1–2 are verified:

```bash
firebase deploy --only firestore:rules
```

This enforces tenant isolation. Test immediately:

- A director sees only their org's data and can write it.
- A student (anonymous, via code) can read only their org and cannot write.
- A second test org cannot see the first org's data.

If anything is wrong, roll back the rules (re-deploy the previous version from
git history) — the legacy data is still intact.

## 4. Clean up (later, once stable)

After a safe period with the new model verified in production:

- Delete the legacy top-level collections (`students`, `rehearsals`, `entries`,
  `songs`, `settings`, `admins`).
- Build the self-serve onboarding flow (create band / join with code), which
  creates `orgs`, `members`, and `studentCodes` docs through the rules above.

## 5. Future: move membership to custom claims (cost/perf)

The interim rules call `get(/members/{uid})` on every request (one extra read).
To remove that cost at scale, add a Cloud Function that stamps `orgId` and
`role` as custom auth claims, and change the rule helpers (`member()`,
`belongsTo`, `isDirectorOf`) to read `request.auth.token` instead of `get()`.
The collection layout does not change.
