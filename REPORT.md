# Migration 007 — Grant Audit Report

Branch: `audit-table-grants` (from `fix-prelaunch-bugs`)

## Background

PostgreSQL checks **table-level GRANTs before RLS policies**. If `authenticated`
lacks a table privilege, the write fails with `permission denied` (SQLSTATE
42501) before any RLS policy is evaluated. Bug 1 (fixed in 006) was exactly this
on `branches`. Because the test suite performed writes as `service_role` (which
bypasses BOTH the grant layer and RLS), the gaps were invisible to tests.

## Privilege Audit Table

Ground truth captured via `psql` against the local DB **before** 007.
✓ = granted/needed, ✗ = not granted/not needed.

| Table | auth SELECT | auth INSERT | auth UPDATE | auth DELETE | Needs INSERT | Needs UPDATE | Gap → Fixed in |
|-------|:--:|:--:|:--:|:--:|:--:|:--:|--|
| pickup_events          | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ (append-only) | none |
| audit_log              | ✓ | ✗ | ✗ | ✗ | ✗ (trigger-only) | ✗ | none |
| branches               | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | fixed in **006** |
| **drivers**            | ✓ | **✗** | **✗** | ✗ | **✓** | **✓** | **GAP → 007** |
| **vehicles**           | ✓ | **✗** | **✗** | ✗ | **✓** | **✓** | **GAP → 007** |
| pickup_assignments     | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | none (003) |
| company_transporters   | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | none (004) |
| notifications          | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | none (003) |
| alert_acknowledgements | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | none (003) |
| profiles               | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | none (001) |
| inspection_pdfs        | ✓ | ✓ | ✗ | ✗ | ✓ (service_role) | ✗ | none (001) |
| memberships            | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | none (SELECT-only by design) |
| companies              | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | none (SELECT-only by design) |
| transport_companies    | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | none (SELECT-only by design) |

### The only real gaps: `drivers` and `vehicles`

Migration 001 defined the `drivers_insert`, `drivers_update`, `vehicles_insert`,
`vehicles_update` RLS policies and the app exposes `createDriver`/`updateDriver`/
`createVehicle`/`updateVehicle`, but 001 only granted **SELECT** on those tables.
Every transport owner/manager attempt to add or deactivate a driver/vehicle would
have failed with 42501 — the identical pattern fixed for `branches` in 006.

## What 007 Granted

`supabase/migrations/007_grant_audit.sql`:

- `GRANT INSERT, UPDATE ON public.drivers TO authenticated;`  — the fix
- `GRANT INSERT, UPDATE ON public.vehicles TO authenticated;` — the fix
- Re-states already-correct grants idempotently (GRANT is a no-op when the
  privilege exists), keeping the full authorized write surface in one place.
- Belt-and-suspenders: re-`REVOKE`s UPDATE/DELETE on pickup_events and audit_log,
  and INSERT on audit_log, from authenticated+anon — keeping the immutable ledger
  and trigger-only audit trail append-only. RLS scoping is unchanged.

Post-migration verification confirms `drivers`/`vehicles` now show
`INSERT, SELECT, UPDATE` and `audit_log` shows `SELECT` only.

## Tables where `authenticated` must NOT have write access (confirmed correct)

- **pickup_events** — INSERT only; UPDATE/DELETE revoked (append-only ledger).
- **audit_log** — SELECT only; INSERT trigger-only, UPDATE/DELETE revoked.
- **companies / transport_companies / memberships** — SELECT only; writes via
  service_role (platform onboarding/admin), never the browser.
- **drivers / vehicles** — no DELETE (soft-deactivate via status='inactive' UPDATE).

## Test Harness Change

**Principle:** a test that verifies RLS/grant behavior MUST run as an
`authenticated` user, not `service_role`. service_role bypasses both the grant
layer and RLS, giving false confidence — exactly why the branches/drivers/vehicles
gaps were never caught.

New file `src/lib/__tests__/grant-audit.test.ts` (18 tests). Every INSERT/UPDATE/
DELETE assertion runs through a real signed-in user JWT; service_role (`admin`) is
used ONLY for setup/teardown. Per-test timeout 30s. It provisions its own dedicated
company-manager and transport-owner users (rather than reusing seed users) and
caches one session per email, avoiding GoTrue session rotation that otherwise 401'd
the managerJwt the phase-2 PDF suite captures. Teardown deletes created rows in
FK-safe order via service_role and removes the provisioned auth users.

Coverage: pickup_events (driver INSERT ✓; UPDATE/DELETE rejected), branches
(INSERT+UPDATE), company_transporters (INSERT+UPDATE), pickup_assignments (manager
INSERT+UPDATE, driver UPDATE), profiles (UPDATE own), notifications (INSERT+UPDATE),
alert_acknowledgements (INSERT), **drivers (owner INSERT+UPDATE — 007 fix)**,
**vehicles (owner INSERT — 007 fix)**, audit_log (INSERT rejected).

## Test Results

Full suite with the PDF service running (health 200):

```
Test Files  9 passed (9)
     Tests  62 passed (62)
```

44 pre-existing + 18 new = 62, green twice consecutively (no flakes after the
session-isolation fix). All PDF tests executed and passed.

## Gate Results

| Gate | Result |
|------|--------|
| `npm run typecheck` | **pass** (exit 0) |
| `npm test` (PDF service up) | **pass** — 62 passed, 0 skipped, 0 failed |
| `npm run build` | **pass** (exit 0; pre-existing chunk-size warning only) |
