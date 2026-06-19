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
  ├─ settings/public                  # director-published student-safe snapshot
  ├─ settings/drill                   # pointer: { activeId } — the school-wide active drill
  ├─ students/{studentNumber}         # was: /students/{studentNumber}
  ├─ rehearsals/{rehearsalId}         # was: /rehearsals/{rehearsalId}
  ├─ entries/{rehearsalId}_{number}   # was: /entries/{...}
  ├─ songs/{songId}                   # was: /songs/{songId}
  └─ drills/{drillId}                 # drill library (director-only): metadata
       └─ data/main                   #   heavy Pyware position payload (loaded on demand)

members/{uid}                         # who belongs to which org, and as what
  └─ (fields) orgId, role, email?, studentNumber?, joinCode?

studentCodes/{CODE}                   # lookup so anonymous students find their org
  └─ (fields) orgId, studentNumber

inviteCodes/{CODE}                    # lookup so a co-director can join an org
  └─ (fields) orgId

accessCodes/{CODE}                    # controlled-rollout gate for creating a band
  └─ (no fields needed — existence is the check)
```

## Controlled rollout: gating new-band creation

During the private rollout, creating a *new* band requires a valid access code.
The org-create rule checks `exists(/accessCodes/{code})`. These docs are never
read or written by clients (`allow read, write: if false`) — Firestore rule
`exists()`/`get()` can read any document regardless of its rules, so the codes
stay secret while still being verifiable.

To manage signups, go to **Firebase Console → Firestore → Data**:

- **Open a code:** create a collection `accessCodes`, then add a document whose
  **ID is the code** (uppercase, e.g. `BETA2026`). Leave its fields empty.
  Anyone you give that code to can create a band.
- **Close signups again:** delete the `accessCodes` document(s).
- **Open fully later:** remove the `accessCodes` existence check from the
  `orgs` create rule and redeploy.

Joining an *existing* band (co-director invite codes, student codes) is not
gated by this — those are already controlled by an existing director.

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
  `role: "director"`, then seeds `orgs/{orgId}/settings/presets`. Rules allow the
  director member doc if that org's `createdBy` matches the caller.
- **Join as a co-director:** an existing director generates an
  `inviteCodes/{CODE}` → `{ orgId }` (Band Settings). Another signed-in director
  enters the code; the client reads it to resolve the org and writes
  `members/{uid}` = `{ orgId, role: "director", inviteCode: CODE }`. Rules allow
  this only when a matching `inviteCodes/{CODE}` exists for that org.

New directors self-register (email/password) from the login screen; a freshly
created account has no membership, so the app routes it to the onboarding screen
(create or join a band).

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

## Student data visibility (privacy model)

Students must not be able to see other students' data, even though the app's
UI never showed it: the security rules — not the UI — are the boundary, since
any student can talk to Firestore directly with their own credentials.

What a **student** can read (everything else is director-only):

| Data                          | Student access                                     |
|-------------------------------|----------------------------------------------------|
| `orgs/{orgId}` (org doc)      | ❌ — carries the co-director **invite code**; a student who read it could join as a director |
| `settings/presets`            | ❌ — pseudonym salt, score weights, drill data, presets |
| `settings/public`             | ✅ — director-published, student-safe (see below)  |
| `students/{num}`              | own doc only (`members/{uid}.studentNumber == num`) |
| `entries/{id}`                | own entries only; queries must filter `studentNumber == <own>` |
| `rehearsals/*`                | ✅ — schedule metadata (dates/labels)              |
| `songs/*`                     | ❌ — embeds every student's pass/fail + fail notes |
| `drills/*` (+ `drills/*/data/*`) | ❌ — Pyware field-chart library is director-only |

### `settings/public` — the published snapshot

Because students can't read the raw data, **director clients publish a
sanitized snapshot** to `orgs/{orgId}/settings/public` (debounced, deduped by
content hash): band name/logo, feature flags, song categories, the
memorization-exclusion list (instruments/sections that skip song memorization,
e.g. majorettes), plus derived stats — per-rehearsal absence counts, per-song
passed/remaining aggregates (computed over only the students who memorize
music), and the pseudonymized leaderboard (`{num, pseudonym, score}`, only
while the leaderboard is enabled).

This needs no Cloud Functions: all band data is director-written, so a
director's client is online whenever the data changes and the snapshot stays
fresh by construction.

Known tradeoff: published leaderboard rows include the student number so each
student can find their own row. A student who knows a classmate's number can
map it to a pseudonym + aggregate score (comparable to a score sheet posted by
ID number). Names, notes, emails and per-event details are never published.

### Per-student song results

Song docs keep the director-facing `statuses` map, but each write also mirrors
that student's own result to `students/{num}.songStatuses.{songId}`
(`status`, `note`, `updatedAt` — no director identity). The portal reads the
mirror; the song catalog and aggregate progress come from `settings/public`.

Director identity in student-readable data: entries stamp `updatedBy`/`by`
with the director's **uid**, never their email.

### Deploy order for this change

1. Run `scripts/backfill-student-privacy.js` (mirrors song statuses, seeds
   `settings/public` for every org).
2. Deploy the app (new `app.js` works under the old rules too).
3. Deploy the rules.

Old clients listen to collections the new rules deny to students, so
deploying rules first would break live student sessions.

## What replaces the old `admins` collection

The old top-level `admins/{email}` collection (used to flag directors) is
replaced by `members/{uid}` with `role: "director"`. The migration script
backfills it.

## Deploy ordering (important)

These changes are coupled. Deploying the new rules before the data and app are
migrated will break the live app. See `docs/MULTI_TENANCY_RUNBOOK.md` for the
safe order: **migrate data → ship org-scoped `app.js` → deploy rules**.
