# Phase 3b Report

Branch: `phase3b-onboarding-assignments`

## 1. Admin Onboarding Endpoint
- **Endpoint:** `POST /admin/onboard-company`, added to the existing PDF service
  (`services/pdf/src/routes/onboard.ts`, registered in `services/pdf/src/index.ts`). No new service.
- **Auth model:** read Bearer JWT → validate with the **anon** client `anon.auth.getUser(jwt)`
  (`services/pdf/src/lib/supabase.ts` now exports `admin` + `anon`) → confirm active `admin`
  membership via the service-role client. Any failure → `403 { error: 'Forbidden' }`.
  On success the service-role client: createUser(email_confirm), upsert profile,
  insert into companies OR transport_companies per `tenant_type`, insert `owner` membership,
  return `201 { companyId, userId, profileId }`.
- **Error cases:** 403 (bad JWT / non-admin), 400 (bad tenant_type or missing fields / DB step error),
  500 (anon key missing / unexpected). An `asyncHandler` wrapper turns thrown errors into 500s
  instead of crashing the process.
- **Env:** new `services/pdf/src/lib/env.ts` loads `services/pdf/.env` then root `.env`;
  `supabase.ts` accepts `SUPABASE_URL`/`SUPABASE_ANON_KEY` or the `VITE_` fallbacks.
- **Frontend:** `src/components/admin/OnboardCompanyForm.tsx` (bilingual modal, tenant-type radio,
  all fields). Submits to `${VITE_PDF_SERVICE_URL ?? 'http://localhost:3001'}/admin/onboard-company`
  with `Authorization: Bearer ${session.access_token}`. Shows created company ID on success and
  bilingual errors (403 → "ليس لديك صلاحية / Not authorized"). Wired via a "+ Add Company" button in
  `src/components/admin/CompaniesTable.tsx`. No service-role key client-side.

## 2. Assignment Scheduling UI
- **Dispatcher/Manager:** `src/components/schedule/PickupSchedulePage.tsx` (route `/company/schedule`,
  owner/manager/dispatcher; sidebar link added). Lists `listAssignments({companyId})`, bilingual
  status badges (`statusBadge.tsx`: pending=yellow, accepted=blue, in_progress=orange,
  completed=green, cancelled=grey). "+ Schedule Pickup" modal with Branch/Driver/Vehicle dropdowns,
  datetime-local + notes → `createAssignment`. Managers cancel pending; assigned driver shown.
  Driver/vehicle dropdowns resolve the transport company from the company's latest pickup_event via
  `getTransportCompanyForCompany` (schema has no direct company→transport link).
- **Driver:** `src/components/schedule/MySchedulePage.tsx` (route `/driver/schedule`; sidebar link).
  Filters by `user.driver_record_id`. Transitions: accept, start, complete (mini-form: weight_kg,
  waste_types, optional photo_path/signature_path/GPS → `createPickupEvent` then
  `completeAssignment`), and cancel (pending/accepted).
- **RLS visibility:** documented as a header comment in `src/lib/api/assignments.ts` — company members
  see all of their company's assignments; drivers see only assignments for their transport company's
  drivers; admins see all. Enforced by `pickup_assignments_select` in `003_phase3.sql`; verified by
  phase3.test.ts test 2 (passing).

## 3. TypeScript Gate
- **TypeScript installed:** 6.0.3 (+ @types/react, @types/react-dom, @types/node).
- **Script:** `"typecheck": "tsc -p tsconfig.app.json --noEmit"` (root tsconfig uses project refs with
  `files: []`; the app project is the one that includes `src` and is already `strict`).
- **Errors fixed: 61 → 0.** Categories:
  - Typed-client collapse (~16): `Database` lacked `Insert/Update/Relationships` and `Row` interfaces
    didn't satisfy the `GenericSchema` constraint → all inserts were `never[]`. Fixed with
    `TableShape<Row>` + `Indexed<Row>` mapped type + Functions/Enums/CompositeTypes in database.types.ts.
  - `import.meta.env` untyped (4): added `src/vite-env.d.ts` (typed env, CSS/asset modules, Background
    Sync typing).
  - Wrong DB column names (4): AlertActionModal camelCase → snake_case real columns.
  - Unused imports/locals (~30) removed across many components.
  - MemberRole re-exported from api/auth.ts.
  - Real fixes: IndexedDB getAll(false) → read+filter; ComplianceStatus casts; registration.sync?
    guards; removed unused src/i18n.ts (imported uninstalled i18next). No @ts-ignore used.
- **`npm run typecheck` exit code: 0** (PDF service `tsc --noEmit` also 0).

## 4. PDF Tests
- **Start:** `cd services/pdf && npm run dev` (`tsx watch src/index.ts`), port **3001**. Deps installed;
  chromium installed.
- **Root cause fixed:** the `inspection-pdfs` storage bucket did not exist, crashing the service on the
  first render. Created the 4 buckets via the service-role storage API; hardened with `asyncHandler`.
- **Test fixes:** `vite.config.ts` `testTimeout/hookTimeout: 30000` (cold Chromium + Arabic render > 5s);
  `phase2-acceptance.test.ts` updated to the installed `pdf-parse@2` `PDFParse` class API
  (was `pdfParse is not a function`).
- **Results (service up): 31 passed, 0 skipped.**
  - risk-engine: 8 passed
  - ledger-immutability: 5 passed
  - phase3: 4 passed
  - inspection-pdf: 3 passed (was 3 skip) — single PDF+sha256, hash round-trip, cross-tenant 403
  - phase2-acceptance: 11 passed incl. 3 PDF subtests (3b 403, 4+5+6a, 4+6b) (was 3 skip)
- **Sample PDFs (test-output/):** `single-pickup-sample.pdf` (286,145 bytes),
  `monthly-2026-06-sample.pdf` (290,167 bytes). These are the test's canonical filenames; they are the
  same artifacts the checklist calls single_pickup_sample.pdf / monthly_report_sample.pdf.

## 5. Assumptions & Gaps
- Company↔transport link derived from latest pickup_event; a brand-new company with no history yet gets
  empty driver/vehicle lists until its first event. A future migration could add
  companies.default_transport_company_id.
- Driver completion mini-form takes storage paths + optional GPS (matches CreatePickupEventInput); full
  camera/signature capture+upload was out of scope.
- Storage buckets are environment setup (documented in SETUP.md); created at runtime here. Service now
  returns 500 instead of crashing if a bucket is missing.
- testTimeout 30000 is global and does not mask hangs (cold renders ~8-10s); PDF subtests still skip
  cleanly if the service is down.
