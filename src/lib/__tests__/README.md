# Test conventions (`src/lib/__tests__`, `services/pdf/src/__tests__`)

These tests run against a **real local Supabase stack** (Postgres + RLS +
GoTrue + Storage) — nothing here is mocked at the database layer. Several
tests also hit the real PDF service over HTTP. Both facts drive the
conventions below; violating them has caused real, hard-to-diagnose CI
flakes in the past (see `scripts/check-test-hygiene.mjs`'s own header for
the incident this file exists to prevent).

## `signOut()` must always be `scope: 'local'`

Many test files sign in as the same hardcoded **shared seed accounts**
(`manager@sanad360.dev`, `0501234567@driver.sanad360.com`, etc.) because
setting up a dedicated user per test is unnecessary ceremony for tests that
only need to *read* as that role. Signing in concurrently as the same
shared account from multiple test files running in parallel is fine —
Supabase does not invalidate one sign-in when another one happens.

**`signOut()` is different.** Both call shapes default to a **global**
scope, which revokes **every session for that user**, not just the caller's
own:

```ts
// Client API — object form
await anon.auth.signOut();                     // BAD: revokes every session for this user
await anon.auth.signOut({ scope: 'local' });    // GOOD: revokes only this client's session

// Admin API — positional form (note: NOT an options object)
await admin.auth.admin.signOut(jwt);            // BAD
await admin.auth.admin.signOut(jwt, 'local');   // GOOD
```

If file A calls a global `signOut()` on a shared seed account while file B
is mid-test using a JWT it captured earlier for that same account, B's
requests start failing auth — this is exactly what caused the
`cp3-branch-qr-issue.test.ts` #3 flake (401 where 403 was expected). The
fix in that incident was two-fold: closing the two offending files
(`grant-audit.test.ts`, `ledger-immutability.test.ts`) and adding
`scripts/check-test-hygiene.mjs`'s `signOut` scope check to the CI test
hygiene gate, so a **third** file can never reintroduce the same bug
silently — the build fails immediately if it does.

**Convention going forward:**
- Shared seed sign-ins (`signInWithPassword` as `manager@sanad360.dev` etc.)
  are fine and expected — don't create a dedicated account just to read.
- Any `signOut()` call **must** carry an explicit local scope (`{ scope:
  'local' }` for the client API, `(jwt, 'local')` for the admin API). The
  CI hygiene gate fails the build otherwise.
- A test that needs to **mutate session/auth state itself** in a way a
  concurrent file could observe (revoking a membership, changing a
  password, anything beyond a plain sign-in/sign-out pair) should use a
  **dedicated per-run account** (e.g. `` `branch-qr-driver-${RUN}@driver.sanad360.dev` ``),
  not a shared seed account — matching the pattern already used throughout
  `cp3-branch-qr-issue.test.ts` and the `cp5-membership-soft-revoke.test.ts`
  fixtures.

## PDF-service-dependent tests hard-fail, never soft-skip

Tests that call the real PDF service over HTTP used to guard themselves
with a soft-skip: `if (!serviceUp) { console.log('SKIP...'); return; }`.
A skipped test reports as neither pass nor fail in most runners' summaries
— if the service silently stopped starting in CI, this could go unnoticed
for weeks. That pattern has been removed everywhere in favor of a hard
failure via `testHelpers/pdfServiceCheck.ts`'s `assertPdfServiceUp()`,
which **throws** if the service isn't reachable at `/health`.

- If **every** test in a file depends on the PDF service, call
  `await assertPdfServiceUp(PDF_SERVICE_URL)` once in that file's
  `beforeAll` (see `inspection-pdf.test.ts`, `onboarding.test.ts`).
- If **only some** tests in a file depend on it (most of the file is pure
  RLS/Postgres), keep the file's own `serviceUp` boolean and `beforeAll`
  as-is, but change each dependent test's own guard from a soft-skip to
  `if (!serviceUp) throw new Error(...)` (see
  `cp8-recycler-manager-rls.test.ts`, `week5-dispatch.test.ts`,
  `phase2-acceptance.test.ts`). Do **not** hard-fail the whole file's
  `beforeAll` in this case — that would incorrectly break the independent
  tests that never needed the PDF service at all.

## CI enforcement

`npm run test:hygiene` (`scripts/check-test-hygiene.mjs`) runs as its own
CI step, before Supabase/the PDF service/E2E spin up, and fails the build
if it finds: any `.skip`/`.only`/`.todo`/`.fixme` on `describe`/`it`/`test`,
or any `signOut()` call without an explicit local scope.
