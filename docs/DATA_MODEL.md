# Band Tracker — Multi-Tenant Data Model

This document describes the data model used to make Band Tracker safe for
multiple independent schools ("orgs") to share one Firebase project.

## Why we changed the model

Before multi-tenancy, all data lived in flat top-level collections
(`students`, `rehearsals`, `entries`, `songs`, `settings`, `admins`) with **no
isolation between schools**. Two problems:

1. **No tenant isolation.** The security rules only checked that a user was
   authenticated. Any authenticated director could read/write *every* school's
   data, and any anonymous student could *read* all data across all schools.
2. **Document-ID collisions.** Documents are keyed by values that are only
   unique *within* a school, not globally:
   - `students/{studentNumber}` — student #42 exists at every school
   - `settings/presets` — a single global singleton
   - `entries/{rehearsalId}_{studentNumber}`

   A flat "add an `orgId` field to each doc" approach **does not fix this** —
   two schools would fight over the same document IDs. We would have had to
   rewrite every document ID anyway.

The fix for both is **per-org subcollections**.

## Collection layout

```
orgs/{orgId}                          # org metadata
  ├─ (fields) name, plan, createdAt, createdBy
  ├─ settings/presets                 # was: /settings/presets
  ├─ students/{studentNumber}         # was: /students/{studentNumber}
  ├─ rehearsals/{rehearsalId}         # was: /rehearsals/{rehearsalId}
  ├─ entries/{rehearsalId}_{number}   # was: /entries/{...}
  └─ songs/{songId}                   # was: /songs/{songId}

members/{uid}                         # who belongs to which org, and as what
  └─ (fields) orgId, role, email?, studentNumber?, joinCode?

studentCodes/{CODE}                   # lookup so anonymous students find their org
  └─ (fields) orgId, studentNumber
```

Everything that used to be a top-level collection now lives under
`orgs/{orgId}/…`. Because each org has its own subtree, document IDs only need
to be unique within an org — exactly what they already are.

## Auth / membership model (interim: Firestore membership)

We are **not** standing up Cloud Functions yet. Instead, membership is stored
in Firestore and checked by the security rules with `get()`:

- `members/{uid}` holds `{ orgId, role }` for every signed-in user.
  - `role: "director"` — full read/write within their org.
  - `role: "student"` — read-only within their org.
- Rules resolve the caller's org via `get(/members/{uid}).data.orgId` and
  compare it to the `{orgId}` in the document path.

**Cost note:** this adds one document read per request (the `members` lookup).
That is fine for launch. The migration target is to move `orgId` and `role`
into **custom auth claims** (set by a Cloud Function) so the rules can read
them from the JWT for free. The collection layout above does not change when we
do that — only the rule helper functions do. See the runbook.

### How directors get an org

- **Create a band:** the client creates `orgs/{orgId}` with
  `createdBy == request.auth.uid`, then creates its own `members/{uid}` doc with
  `role: "director"`. Rules only allow the director member doc if that org's
  `createdBy` matches the caller (so you can only become director of an org you
  just created). Joining an *existing* org as a co-director will use an invite
  code — added with the onboarding milestone.

### How anonymous students get an org

Students sign in anonymously and type a **student code**. The code maps to an
org:

1. Client reads `studentCodes/{CODE}` → `{ orgId, studentNumber }`.
2. Client writes its own `members/{uid}` = `{ orgId, studentNumber, role:
   "student", joinCode: CODE }`.
3. Rules allow that member doc only if a matching `studentCodes/{CODE}` exists
   and its `orgId` agrees — so a student can only join an org they hold a valid
   code for.

After that, the student's reads are scoped to `orgs/{orgId}/…` like everyone
else. `studentCodes` is the only collection readable before a membership
exists, and it exposes nothing sensitive (just an org id + a number).

## What replaces the old `admins` collection

The old top-level `admins/{email}` collection (used to flag directors) is
replaced by `members/{uid}` with `role: "director"`. The migration script
backfills it.

## Deploy ordering (important)

These changes are coupled. Deploying the new rules before the data and app are
migrated will break the live app. See `docs/MULTI_TENANCY_RUNBOOK.md` for the
safe order: **migrate data → ship org-scoped `app.js` → deploy rules**.
