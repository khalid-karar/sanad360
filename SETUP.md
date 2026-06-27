# Tadweer360 – Phase 1 Setup Guide

## Prerequisites

- Node.js 18+
- Docker Desktop (for local Supabase)
- Git

---

## 1. Install the Supabase CLI

**macOS (Homebrew):**
```bash
brew install supabase/tap/supabase
```

**Windows (Scoop):**
```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

**Windows / Linux (npm):**
```bash
npm install -g supabase
```

**Verify:**
```bash
supabase --version   # should print 1.x or 2.x
```

---

## 2. Start local Supabase

```bash
cd tadweer360_saas_8a286r
supabase start
```

This pulls Docker images and starts:
- Postgres on `localhost:54322`
- API (PostgREST) on `localhost:54321`
- Studio (dashboard) on `localhost:54323`
- Auth server on `localhost:54321/auth/v1`
- Storage on `localhost:54321/storage/v1`

At the end you'll see output like:

```
API URL: http://localhost:54321
anon key: eyJh...
service_role key: eyJh...
```

Copy those values.

---

## 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase start output>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start output>
```

> **Never commit `.env` to git.** It is in `.gitignore`.

---

## 4. Apply the schema migration

```bash
supabase db reset
```

This runs `supabase/migrations/001_initial_schema.sql` followed by `supabase/seed.sql`.
It creates all tables, RLS policies, triggers, privilege revocations, and seed data.

> If you only want to run the migration without resetting data: `supabase migration up`

---

## 5. Create Storage buckets

Supabase Storage buckets are not created by SQL migrations. Create them once via the CLI:

```bash
supabase storage buckets create pickup-photos    --public=false
supabase storage buckets create pickup-receipts  --public=false
supabase storage buckets create pickup-signatures --public=false
supabase storage buckets create inspection-pdfs  --public=false
```

Or via the local Studio at `http://localhost:54323` → Storage → New bucket.

---

## 6. Install JavaScript dependencies

```bash
npm install
```

---

## 7. Run the dev server

```bash
npm run dev
```

Open `http://localhost:5173`.

---

## 8. Dev seed credentials

These are created by `supabase/seed.sql` and exist only in the local dev database:

| Role | Email | Password |
|---|---|---|
| Company manager | `manager@tadweer360.dev` | `DevPass1234!` |
| Driver | `0501234567@driver.tadweer360.com` | `DevPass1234!` |

**Driver tab:** enter phone `0501234567` and password `DevPass1234!`.  
The app converts the phone to the synthetic email format internally.

---

## 9. Run the immutability tests

With local Supabase running:

```bash
npm test
```

Vitest will run `src/lib/__tests__/ledger-immutability.test.ts`.

To watch / re-run on file changes:
```bash
npm run test:watch
```

To open the visual Vitest UI:
```bash
npm run test:ui
```

---

## 10. Manual end-to-end verification

### Driver pickup flow
1. Log in with the driver credentials above → select the **Driver** tab
2. Click **Start Pickup** on the seeded branch entry
3. **QR scan screen**: tap "Skip (No QR)" if no physical QR code is available  
   (or enter any code manually — it's stored but not validated in Phase 1)
4. **Location screen**: allow location permission → wait for GPS → click Continue
5. **Digital Manifest**: select one waste type, enter a weight, optionally take a photo / upload a receipt
6. **Signature**: draw a signature → Confirm Signature
7. **Confirmation screen**: a spinner appears while the record is uploaded, then a success tick

### Verify persistence
Open Supabase Studio → `http://localhost:54323` → Table Editor → `pickup_events`.
The row should appear with:
- `company_id` = `a0000000-0000-0000-0000-000000000001`
- `signature_path`, `photo_path` (if photo taken) populated
- `geofence_verified` = `true` if your GPS coords are within 150 m of `(24.6877, 46.6876)`;  
  `false` otherwise (expected if you're not in Riyadh)
- `created_by` = the driver user's UUID

Refresh the browser — the pick-up is marked completed in the UI and the `recentPickups`
list on the Company Dashboard will show the new record.

### Verify append-only
In Studio → SQL Editor:
```sql
-- This should fail with "permission denied"
UPDATE pickup_events SET notes = 'hack' WHERE revision = 1;

-- This should also fail
DELETE FROM pickup_events WHERE revision = 1;
```

---

## 11. Stop Supabase

```bash
supabase stop
```

Data is persisted in Docker volumes and restored on the next `supabase start`.

To wipe all data:
```bash
supabase stop --no-backup
supabase db reset
```

---

---

## Phase 2 Setup

### 12. Apply the risk-engine migration

```bash
supabase db reset        # re-runs 001 + 002 + seed (recommended for clean dev state)
# OR incremental:
supabase migration up    # applies only 002_risk_and_inspection.sql if 001 is already applied
```

Migration 002 replaces `pickup_events_before_insert()` in-place. No new tables.
After applying, every new pickup_event will have `risk_score`, `risk_flags`, and
`compliance_status` computed server-side by the trigger.

### 13. Start the PDF service

```bash
cd services/pdf
cp .env.example .env
# Fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (same values as root .env)
npm install
npm run install-chromium    # downloads Chromium for Playwright (one-time ~170 MB)
npm run dev                 # starts on http://localhost:3001
```

Verify it is running:
```bash
curl http://localhost:3001/health
# {"status":"ok","service":"tadweer360-pdf","ts":"..."}
```

In a separate terminal, keep the Vite dev server running:
```bash
# in the repo root:
npm run dev
```

### 14. Add `VITE_PDF_SERVICE_URL` to root `.env`

```
VITE_PDF_SERVICE_URL=http://localhost:3001
```

### 15. Generate a single-pickup PDF (manual test)

1. Log in as `manager@tadweer360.dev` / `DevPass1234!`
2. Complete one driver pickup so a `pickup_events` row exists (or use the seed data after
   creating one via the driver flow)
3. On the Company Dashboard, find the event under **Recent Pickups**
4. Click **إنشاء ملف التفتيش** (Generate Inspection File)
5. A spinner appears while the PDF service renders the Arabic PDF (~3–5 s)
6. The PDF opens in a new tab — check for Arabic RTL layout, all sections, and footer hash line
7. In Supabase Studio → `inspection_pdfs`: a row appears with `sha256_hash` and `pdf_path`

### 16. Generate a monthly summary PDF (manual test)

1. On the Company Dashboard, select the current year-month in the **Monthly Inspection Report** card
2. Click **إنشاء التقرير الشهري** (Generate Monthly Report)
3. The monthly summary PDF opens — check totals, compliance breakdown table, and footer

### 17. Run Phase 2 tests

With Supabase running AND the PDF service running:

```bash
npm test
```

This runs all three test files:
- `ledger-immutability.test.ts`  — 5 tests (Phase 1)
- `risk-engine.test.ts`          — 8 tests (Phase 2A)
- `inspection-pdf.test.ts`       — 3 tests (Phase 2B, skipped if PDF service is down)

Expected output with both services running:
```
✓ Ledger immutability – pickup_events (5)
✓ Risk engine — pickup_events_before_insert() (8)
✓ Inspection PDF generation (3)
Test Files: 3 passed (3)
Tests: 16 passed (16)
```

If only Supabase is running (PDF service not started):
```
✓ Ledger immutability – pickup_events (5)
✓ Risk engine — pickup_events_before_insert() (8)
· Inspection PDF generation (3 skipped)
Test Files: 3 passed (3)
Tests: 13 passed, 3 skipped (16)
```

---

## Project structure (Phase 1 additions)

```
supabase/
  migrations/
    001_initial_schema.sql            Schema, RLS, triggers, privilege revocations
    002_risk_and_inspection.sql       Risk engine (replaces before_insert trigger in-place)
  seed.sql                            Dev seed (1 company, 1 driver, 2 users)

services/pdf/                         ── Phase 2: PDF microservice ──
  package.json                        Express + Playwright + @supabase/supabase-js
  src/
    index.ts                          Express server (port 3001)
    lib/
      auth.ts                         JWT validation + tenant authorization helper
      supabase.ts                     Service-role Supabase client
      renderer.ts                     Playwright headless Chromium → PDF bytes
      storage.ts                      Supabase Storage upload + SHA-256 + signed URL
    templates/
      base.ts                         Shared CSS, Arabic font import, helper functions
      single-pickup.ts                Single-event HTML template (Arabic RTL)
      monthly-summary.ts              Monthly summary HTML template (Arabic RTL)
    routes/
      single.ts                       POST /generate/single-pickup
      monthly.ts                      POST /generate/monthly-summary

src/lib/
  supabase.ts                         Typed Supabase client
  database.types.ts                   TypeScript types matching the schema
  api/
    auth.ts                           signIn, signOut, fetchMyProfile
    companies.ts                      getMyCompany, getMyBranches, getBranch
    drivers.ts                        listDrivers, createDriver, updateDriver
    vehicles.ts                       listVehicles, createVehicle, updateVehicle
    pickups.ts                        createPickupEvent, createRevision, listPickups
    storage.ts                        uploadSignature, uploadPhoto, uploadReceipt, getSignedUrl
    inspection.ts                     generateSinglePickupPdf, generateMonthlyPdf, listInspectionPdfs
  __tests__/
    ledger-immutability.test.ts       5 assertions (Phase 1)
    risk-engine.test.ts               8 assertions — risk flags, score cap, thresholds (Phase 2)
    inspection-pdf.test.ts            3 assertions — hash match, DB row, cross-tenant 403 (Phase 2)

src/stores/
  authStore.ts                        Real Supabase Auth (was mock role toggle)
  driverStore.ts                      completePickup() → real API + Storage upload
  transportStore.ts                   loadDrivers/loadVehicles → real API
  companyStore.ts                     RecentPickup now includes complianceStatus + riskScore

src/components/
  driver/
    QRScanner.tsx                     html5-qrcode camera scanner + manual fallback
    GeolocationVerified.tsx           Real GPS capture via navigator.geolocation
    DigitalManifest.tsx               File inputs for photo + receipt
    PickupConfirmation.tsx            Async submit with loading/error/success states
    AwaitingPickup.tsx                Start pickup → qr-scan (new first step)
  company/
    RecentPickups.tsx                 Per-row "إنشاء ملف التفتيش" button + compliance badge
    InspectionPdfsList.tsx            List + re-download of previous inspection files

src/pages/
  LoginPage.tsx                       Real email/password fields + error display
  DriverDashboard.tsx                 Added qr-scan case to state machine
  CompanyDashboard.tsx                Monthly report card + InspectionPdfsList
  TransportDashboard.tsx              Loads drivers + vehicles on mount
  App.tsx                             onAuthStateChange session guard
```
