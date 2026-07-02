# PDPL Erasure Design — Sanad 360

**Problem.** PDPL grants data subjects deletion rights, but `pickup_events` /
`disposal_confirmations` / `audit_log` are append-only by design — they are the
compliance product. This document defines how both are satisfied at once.

## The PII partition

Personal identity lives **only in mutable tables**; the immutable ledger
references it by opaque UUID:

| Data | Where | Mutable? | Erasure treatment |
|---|---|---|---|
| Driver name, license number, Absher flag | `drivers` | ✅ | anonymized in place (tombstone) |
| Account name, phone | `profiles` | ✅ | anonymized in place — row **survives** because `pickup_events.created_by` references it |
| Login (synthetic email, password) | `auth.users` (GoTrue) | ✅ | disabled + credentials scrambled by the operator script |
| Tenant linkage | `memberships`, `user_active_tenant` | ✅ | deleted |
| Notification feed | `notifications` | ✅ | deleted |
| Ledger rows (weights, GPS of the *branch visit*, timestamps, `driver_id` UUID) | `pickup_events`, `disposal_confirmations`, `audit_log` | ❌ append-only | **retained** under the legal-obligation basis (waste-transfer compliance records); after erasure they are pseudonymous — the UUID no longer resolves to a person |
| Evidence files (waste photo, weighbridge ticket, branch-rep signature) | Storage buckets | append-only for clients | retained with the record — they document the *waste transfer*, not the driver's identity; the signature is the receiving branch representative's |

## Legal posture (to confirm with counsel)

- **Retention basis:** legal obligation — MWAN-aligned waste-transfer records.
  Retention period should be set in the customer DPA (suggested: regulatory
  minimum + 1 year, then hard-delete the ledger partition).
- **Erasure result:** all direct identifiers destroyed; remaining records are
  pseudonymous under PDPL because the linking key (the tombstoned rows) no
  longer contains identity.
- **Accountability:** every erasure writes an append-only `erasure_log` row
  (who/when/why) — service-role visible only.

## How to erase (operator runbook)

```bash
# Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL in the environment
# (production: run from a trusted operator machine against the prod project).
node scripts/pdpl-erase.mjs <driver_id> "<reason / ticket reference>"
```

The script (1) calls `erase_driver_pii()` — migration 015, service-role-only —
which tombstones `drivers` + `profiles`, deletes memberships/tenant-selection/
notifications, and logs the erasure; then (2) disables the GoTrue account:
scrambled email + random password + permanent ban. It is **idempotent** —
re-running on an already-erased driver is safe.

## What is deliberately NOT deleted, and why

Ledger rows, evidence objects, and their hashes stay. Deleting them would
falsify the compliance history the customer is legally required to keep —
and PDPL's erasure right yields to legal-obligation retention. The design
makes the retained data non-personal instead of destroying it.

## Company-level offboarding (future)

Erasing a whole tenant (company churn + data return/destruction per DPA) is a
separate runbook: export ledger + PDFs to the customer, then hard-delete the
tenant partition after the contractual retention window. Not yet implemented.
