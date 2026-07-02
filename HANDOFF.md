# Sanad 360 — Project Handoff

**Sanad 360** (سند 360) is a bilingual (Arabic-first/RTL + English) compliance
SaaS for Saudi food-sector waste. The wedge product: a **verified waste
transfer record** with a closed **chain of custody**, and a one-click Arabic
**Inspection File PDF** that makes a branch inspection-ready.
Sanad 360 is owned and operated by **Maya AI** (Saudi Arabia); the product is
branded "Powered by Maya AI" on the login screen, app sidebar, and both PDFs.

Repo: https://github.com/khalid-karar/sanad360

---

## 1. Stack & repo layout

| Layer | Tech | Where |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, Zustand, Tailwind 3.4, Radix UI, Framer Motion, react-router | `src/` |
| Backend | Supabase: Postgres 15 (RLS everywhere), Auth (GoTrue), Storage | `supabase/` |
| PDF service | Node 20 + Express 4 + Playwright (Chromium) — Arabic PDF rendering, admin onboarding, driver invites | `services/pdf/` |
| Tests | Vitest integration suite — **99 tests**, run against a real local Supabase as real signed-in users | `src/lib/__tests__/` |
| CI/CD | GitHub Actions | `.github/workflows/ci.yml`, `deploy.yml` |
| Scripts | DB promotion + seed guard, screenshot/UX-audit harnesses | `scripts/` |

Key documents: [DEPLOYMENT.md](DEPLOYMENT.md) (environments, secrets, manual
checklist), [UX_ASSESSMENT.md](UX_ASSESSMENT.md) (design review + P2 backlog),
[REPORT.md](REPORT.md) (historical grant audit), `.env.example` files (every
variable documented).

## 2. Domain & data model (migrations 001–014, `supabase/migrations/`)

**Tenants:** `companies` (waste generators: restaurants/food chains) →
`branches` (locations, each with a geofence + a secret `qr_token` for the
printable waste-point QR board). `transport_companies` (licensed carriers) →
`drivers`, `vehicles`. Many-to-many `company_transporters` links (status
active/inactive) gate all cross-tenant visibility. `memberships` bind users to
one tenant with a role: `owner | manager | dispatcher | driver | admin`
(dispatcher is transport-side; admin is platform-level, no tenant).

**The ledger:** `pickup_events` is **append-only** (UPDATE/DELETE revoked at
the privilege layer; corrections are new revisions sharing a `logical_id`).
A `BEFORE INSERT` trigger — the trust boundary — validates FK consistency,
forces `created_by = auth.uid()`, computes `geofence_verified`
(haversine **and** GPS accuracy ≤ branch radius), verifies the scanned QR
against `branches.qr_token`, and runs the **risk engine**: missing photo +25,
missing signature +25, geofence failed +20, driver/vehicle license expiring
+15 each, low GPS accuracy +10, QR mismatch +10, weight anomaly (>5000 kg)
+10 → `compliance_status` compliant / warning (≤39) / non_compliant.
`pickup_events_latest` (security_invoker view) exposes latest revisions.

**Chain of custody:** `disposal_confirmations` — one append-only row per
event, recorded by the driver at the receiving facility (facility identity,
weighbridge ticket photo + SHA-256, GPS). Tenant fields are server-forced from
the referenced event. Both PDFs render the custody state; missing confirmation
= a red bordered warning panel.

**Evidence storage:** private buckets `pickup-photos / pickup-signatures /
pickup-receipts / disposal-tickets / inspection-pdfs`; paths are
`{company_id}/{branch_id}/{event_id}/…`. Policies are **tenant-prefix-scoped**
(company members: own prefix; transport members: prefixes of actively linked
companies; inspection-pdfs: company+admin read-only). Buckets are append-only
(no UPDATE/DELETE for authenticated). Every file's SHA-256 is stored on the
ledger row and **re-verified server-side** by the PDF service.

**Other tables:** `pickup_assignments` (dispatch; drivers scoped to their own
record, transport staff TC-wide, company staff company-wide),
`notifications` (server-trigger-written: new assignment → driver;
completed/cancelled → scheduler), `alert_acknowledgements` (review-queue
acknowledgements, key `pickup_review:<event_id>`), `inspection_pdfs`
(generated reports + hashes), `audit_log` (trigger-only INSERT),
`user_active_tenant` (consultant multi-tenancy: `my_membership()` prefers the
selection, falls back deterministically to the oldest membership).

**Security philosophy (do not regress):**
1. Postgres checks **GRANTs before RLS** — every new table needs both
   (migrations 006/007/014 fixed三 such gaps; 014 was the *view* variant).
2. All security tests run as **real signed-in users** (anon key + JWT);
   `service_role` is setup/teardown only.
3. `SECURITY DEFINER` functions always pin `search_path = ''`.
4. Clients never write `created_by`, risk fields, geofence, QR verdicts, or
   custody tenant fields — triggers overwrite them.
5. "Verified" claims state exactly what is server-verified (hashes, QR) vs
   device-reported (GPS) — in the UI **and** the PDF.

## 3. Application surfaces

**Driver (field, mobile-first):** bottom tab nav (Tasks / Schedule /
Deliveries), 5-step evidence flow with progress stepper — QR scan (manual
fallback works with no camera) → GPS capture → digital manifest (waste types,
weight keypad, photo/receipt) → signature pad → submit. **Offline-first**:
network failures persist the whole submission (incl. Blobs) to IndexedDB
(`src/lib/offline/pickupQueue.ts`) and replay idempotently on reconnect.
Deliveries page closes the custody chain at the facility.

**Company manager (desktop dashboard):** compliance manifest widget, branches
(geofence map picker + printable QR board), pickup log (filters, CSV,
StatusPill), **review queue** (`/company/review`: risk-gauge cards for flagged
or custody-open events, evidence one click away, acknowledge), scheduling,
approved transporters, inspection PDFs (single + monthly).

**Transport dispatcher:** fleet drivers/vehicles CRUD (soft-deactivate),
**driver invites** (creates the auth account `{phone}@driver.sanad360.com` via
the PDF service), scheduling for linked companies, alerts.

**Admin:** company/transporter onboarding (via PDF-service endpoint),
companies/users/analytics.

**PDF service endpoints** (`services/pdf/src/`): `POST
/generate/single-pickup`, `/generate/monthly-summary` (two-pass render so the
PDF displays its own hash; server-side evidence re-hash verdicts; custody
section), `POST /admin/onboard-company` (admin-gated), `POST
/transport/invite-driver` (transport-staff-gated), `GET /health`. Ops: one
shared Chromium, concurrency-2 render queue, per-IP rate limiting, request
timeouts, structured `{error, code}` responses. PDFs upload with
content-versioned filenames (`upsert:false`) so stored hashes stay valid
forever.

## 4. Design system (frontend conventions)

- **Fonts:** IBM Plex Sans Arabic (primary) + Inter, loaded in `index.html`,
  wired in `tailwind.config.js`. Tabular numerals globally.
- **Formatting policy:** `src/lib/format.ts` — Gregorian calendar + Latin
  digits pinned in both languages; measurements/IDs always LTR Latin.
- **Compliance visuals:** `StatusPill` (one lexicon: ممتثل/تحذير/غير ممتثل)
  and `RiskGauge` (arc, server thresholds) — use these, never ad-hoc badges.
- **States:** `LoadingState / EmptyState / ErrorState` (`ui/states.tsx`) on
  every key view; empty states must answer "what do I do next".
- **RTL:** logical properties only (`me-*/ms-*/start/end`), never `mr-/ml-`
  in flex rows. `aria-label` mandatory on icon-only buttons.
- **Motion:** global `prefers-reduced-motion` kill-switch in `tailwind.css`.
- **Elevation:** cards are border-only; shadows reserved for overlays.
- The chat UI is a **quarantined dev mock** (DEV builds only) — not a feature.

## 5. Environments & deployment (full detail: DEPLOYMENT.md)

Config-only environments; `main` is the source of truth.
- **local** — `supabase start` (Docker) + seeded fixtures.
- **staging/demo** — its own hosted Supabase project, FAKE data, safe to
  reset; deployed by `deploy.yml` on every green `main` push.
- **production** — Dammam **CNTXT** Supabase (not provisioned yet); wired in
  `deploy.yml` behind the GitHub `production` Environment's **required
  reviewers**; **never seeded, never reset** — enforced by
  `scripts/db-target.mjs` (a prod seed path does not exist; staging refs/URLs
  containing the prod ref abort).

npm scripts: `db:push:staging|production` (forward-only migrations),
`db:seed:local|staging`. Secrets live in GitHub Environments — never the repo
(`.env` is untracked; only `.env.example` templates are committed).

**Manual steps only a human can do** (DEPLOYMENT.md checklist): create the
staging Supabase project + access token, fill the GitHub `staging`
Environment, choose frontend/PDF hosts and replace the `TODO(host)` steps;
later: provision Dammam via CNTXT + create the gated `production` Environment.

## 6. Local development quickstart

```bash
npm ci && npm ci --prefix services/pdf
npx supabase start                 # applies migrations 001-014 + seed
cp .env.example .env               # fill from `npx supabase status`
npm run dev                        # frontend :5173
cd services/pdf && npm run install-chromium && npm run dev   # PDF svc :3001
npm test                           # 99 integration tests (needs both up)
```

Seeded logins (password `DevPass1234!`): manager@sanad360.dev (company),
dispatcher@sanad360.dev (transport), admin@sanad360.dev (platform), driver
phone `0501234567` (→ 0501234567@driver.sanad360.com).

Useful harnesses: `scripts/ux-audit.mjs` (full-app screenshots, run from
`services/pdf`, `AUDIT_OUT=` to redirect), `scripts/screenshots.mjs`.

## 7. Branch / PR state at handoff

`main` = pre-hardening baseline (migrations 001–007). Stacked work, all
verified (99/99, typecheck, both builds):

| Branch | Contents | Merge order |
|---|---|---|
| `week1-security-ci` | storage tenant scoping (008), onboarding fix, server re-hash, versioned PDFs, CI, driver flow rewiring (009), custody leg (010), offline queue, notifications/dispatch/invites (011), multi-tenancy (012), evidence hardening (013) | 1 → `main` |
| `finish-line` | printable QR board, monthly custody, review queue, PDF-service ops hardening, honest-claims, chat quarantine, view grant (014) | 2 → after week1 |
| `ux-assessment` | UX audit + P0/P1 fixes, design-system layer, typography/mobile/brand pass, **Maya AI branding**, this handoff | 3 → after finish-line |
| `setup-environments` | env hygiene (.env untracked), DEPLOYMENT.md, promotion scripts + prod-seed guard, deploy.yml | 4 → after the stack (rebase/retarget to main) |

CI note: `ci.yml` lives on the branches; PR runs use the head branch's
workflow, so CI validates each PR before `main` has it.

## 8. Known gaps & prioritized next steps

**Operability (biggest gap):** no error tracking (add Sentry/GlitchTip), no
uptime monitoring, no verified backup/restore drill, PDF service needs a
Dockerfile + supervisor. **Offline custody:** disposal confirmations are not
yet offline-queued (pickups are) — same IndexedDB pattern applies, and
`UNIQUE(pickup_event_id)` gives idempotency free. **UX P2 backlog**
(UX_ASSESSMENT.md): bilingual date-picker, Radix Dialog migration for
hand-rolled modals, dark-mode/contrast audit, focus-visible on
InteractiveButton, driver "field mode" shell refinements. **PDPL:** design the
PII-partition/crypto-shred erasure strategy now (PII lives in mutable
`drivers`/`profiles`; the immutable ledger references IDs) + a data-map doc;
physical KSA residency lands with the CNTXT project. **Deliberately deferred:**
NCWM/Absher/Nafath integrations (no public API contract; placeholder fields
exist), ML anomaly detection (rule engine is explainable), native apps (PWA
unfalsified). **Test infra:** one rare cross-file flake (storage isolation
test 7) under cold-start contention — twice-green achieved; deflake by giving
it a dedicated link fixture if it recurs.

## 9. Scorecards at handoff

Product review (engineer/product/investor composite): **5.5 → 8.3** overall —
architecture 9, security 9, workflow 9, market fit 8, GTM 5.5 (GTM points live
in Riyadh meetings, not the repo). UI/UX: **6.2 → 8.4** overall — typography
8.5, mobile 8.5, trust communication 9. Remaining UI points need a designer's
brand assets and the P2 structural items.

---
*Handoff prepared by Claude (Maya AI engineering support). All claims above
are backed by migrations, tests, or screenshots in this repository.*
