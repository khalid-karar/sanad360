# Sanad 360 — UI/UX Assessment (ux-assessment branch)

**Method.** Walked all four seeded roles (Admin, Company Manager, Transport
Dispatcher, Driver) against the live local stack at 1280×800 and 375×812, in
Arabic (RTL, default) and English. ~60 screenshots captured by
[scripts/ux-audit.mjs](scripts/ux-audit.mjs) into `test-output/ux-audit/`
(before) and `test-output/ux-audit-after/` (after fixes). Code cross-checked
for every visual finding. Suite baseline: **99 tests green** before and after.

**Overall verdict.** The bones are good: RTL is genuinely first-class (mirrored
sidebar, correct chevrons, Arabic-Indic numerals), the driver CTAs are already
large, and compliance states use color + text, not color alone. The failures
cluster in exactly the places the product can least afford them: one dead-end
in the driver's no-camera path, a "where do I go?" gap in the driver schedule,
two different Arabic words for "compliant" across manager surfaces, and a
near-total absence of loading/empty/error affordances and accessibility labels.

---

## Findings (ranked)

### P0 — blocks or embarrasses

| # | Finding | Evidence | Fix |
|---|---|---|---|
| P0-1 | **Manual QR entry dead-ends when the camera fails** — the exact field case it exists for (no permission / gloves / broken cam). `handleResult` calls `scannerRef.current?.stop()`, which throws **synchronously** when the scanner never started, so `setPickupState('geolocation-verified')` never runs. The driver taps تأكيد and nothing happens, no error. | `driver-gps-ar-mobile.png` (harness stuck on the QR step after confirming TEST-QR); [QRScanner.tsx:55-59](src/components/driver/QRScanner.tsx) | Wrap scanner shutdown in a sync-safe guard; advance state regardless. **Fixed.** |
| P0-2 | **Driver schedule cards don't say WHERE the pickup is.** جدولي shows date, note, status — no company or branch. A field driver's first question is the destination; the card can't answer it. | `driver-schedule-ar-mobile.png` — card shows only "٢٠٢٦/٧/٢ ٦:٥٣ م / الوردية الصباحية / قيد التنفيذ"; [MySchedulePage.tsx](src/components/schedule/MySchedulePage.tsx) rendered raw assignment rows | Enrich cards with company — branch + address (same linked-transporter read the dashboard flow uses; display-only). **Fixed.** |
| P0-3 | **Two different Arabic terms for compliance across manager surfaces.** Pickup log + Recent Pickups say متوافق/غير متوافق; the dashboard, review queue and the official PDF say ممتثل/غير ممتثل. In a compliance product the compliance word itself must be one word. | `company-pickups-ar-desktop.png` KPI "غير متوافقة 1" vs `company-dashboard-ar-desktop.png` "غير ممتثلة"; [PickupLogPage.tsx](src/pages/PickupLogPage.tsx), [RecentPickups.tsx](src/components/company/RecentPickups.tsx) | Standardize on ممتثل (matches the PDF and MWAN phrasing). **Fixed.** |

### P1 — hurts

| # | Finding | Evidence | Fix |
|---|---|---|---|
| P1-1 | **Evidence labelled "optional" (اختياري)** in the driver manifest, while the risk engine docks 25 points per missing item. The UI invites the driver to skip the exact evidence the product sells. | [DigitalManifest.tsx](src/components/driver/DigitalManifest.tsx) "الأدلة (اختياري)" | Relabel: "الأدلة — تؤثر على درجة الامتثال / Evidence — affects compliance score". **Fixed.** |
| P1-2 | **No step indicator in the 5-step driver flow.** QR→GPS→manifest→signature→submit gives no sense of progress or "how much is left" — costly when a queue of trucks is waiting. | `driver-qr-ar-mobile.png` etc. — headers only | New `FlowStepper` (top of every flow step): "الخطوة ٢ من ٥" + dots. **Fixed.** |
| P1-3 | **Loading/empty states are missing or dead-ends.** BranchesPage fetches silently (blank flash), empty says "لا توجد فروع" with no CTA; MySchedule/Deliveries/Review empties are bare one-liners with no "what next". | [BranchesPage.tsx](src/pages/BranchesPage.tsx) `load()` | Shared `LoadingState`/`EmptyState`/`ErrorState` components; every key view now has all three, and each role's empty state says what to do next. **Fixed.** |
| P1-4 | **Icon-only buttons are unlabeled for screen readers** — 2 `aria-label`s in the whole app. Deactivate (Power), QR board, modal ✕, notification bell, theme, menu are all nameless. | grep: `aria-label` ×2 across `src/` | aria-labels added on every icon-only control touched (deactivate, QR, close, bell, theme, menu). **Fixed.** |
| P1-5 | **No `prefers-reduced-motion` handling** — Framer Motion staggers, pulses and floats run unconditionally. | [tailwind.css](tailwind.css), animations/* | Global reduced-motion CSS kill-switch. **Fixed.** |
| P1-6 | **Physical margins (`mr-*`/`ml-*`) inside RTL buttons** (15 occurrences in driver/review surfaces alone): icon gaps sit on the wrong side in Arabic, spacing subtly inconsistent vs EN. | e.g. `تصدير CSV` icon spacing in `company-pickups-ar-desktop.png` | Swapped to logical `me-*`/`ms-*` (Tailwind 3.4) in all touched surfaces. **Fixed.** |
| P1-7 | **Date filter inputs render `mm/dd/yyyy` LTR-English inside the Arabic pickup log** (native date inputs, untranslated placeholder look). | `company-pickups-ar-desktop.png` filter row | `dir="ltr"` + `lang` on the inputs so the picker localizes; cosmetic containment (full custom date-picker deferred to P2). **Fixed (contained).** |
| P1-8 | **PDF trust section readability**: 64-char hashes at 7-8pt with no wrap control; the incomplete-custody warning is a bare red line that reads like body text. This is the artifact an inspector sees. | [base.ts](services/pdf/src/templates/base.ts), single-pickup custody section | Hash cells: monospace, `word-break`, +0.5pt; custody warning: bordered red panel with background. **Fixed.** |
| P1-9 | **Compliance % "0%" hero with a pale washed-out CTA** — the daily statement number is right, but the "مراجعة التفاصيل" button on the red state is low-contrast pink-on-pink (borderline WCAG AA). | `company-dashboard-ar-desktop.png` | Solid destructive button variant on non-compliant state. **Fixed.** |

### P2 — polish backlog (documented, not done)

1. Notification panel is a full-screen sheet on mobile with no backdrop dismiss affordance beyond ✕ (`driver-manifest-filled-ar-mobile.png` shows it swallowing the flow).
2. Native date inputs → proper bilingual date-picker component (Radix Popover + calendar).
3. Login page: brand block uses a dark gradient tile that clips the recycle mark; language toggle overlaps the card top edge at 375px (`login-ar-mobile.png`).
4. Dark-mode contrast audit (tokens exist; unaudited).
5. Focus-visible ring audit across custom `InteractiveButton` (motion wrapper may swallow outline).
6. Transport/Admin dashboards still show placeholder KPI copy in places; align to live data queries.
7. Chat bubble (dev-only mock) overlaps bottom-start action areas in RTL at 375px — fine for dev, remove when real messaging lands.
8. Driver flow on mobile keeps the full app chrome (topbar/sidebar); a focused "field mode" shell would reduce mis-taps.
9. `ar-SA` date formatting relies on browser defaults; pin `numberingSystem`/calendar explicitly for consistency across devices.

---

## Design-system consolidation (what was introduced)

Tokens already existed (`--success`, `--warning`, `--destructive`, `--primary`
+ dark variants) but had no shared *state* layer — every page hand-rolled
spinners and empty text. Introduced [src/components/ui/states.tsx](src/components/ui/states.tsx):

- **`<LoadingState/>`** — centered spinner, consistent py, `role="status"` + SR label.
- **`<EmptyState/>`** — icon + title + hint + optional action button; used for every role's "what do I do next".
- **`<ErrorState/>`** — destructive-toned panel with retry action.
- **`<FlowStepper/>`** ([driver/FlowStepper.tsx](src/components/driver/FlowStepper.tsx)) — bilingual step N-of-M indicator for the field flow.
- **Conventions codified**: logical properties (`me-*/ms-*`, never `mr-*/ml-*` in flex rows), `aria-label` mandatory on icon-only buttons, one compliance lexicon (ممتثل), reduced-motion kill-switch in [tailwind.css](tailwind.css).

## Verification

- `npm run typecheck` ✓ `npm test` ✓ (**99/99**), frontend + PDF service builds ✓
- After-screenshots in `test-output/ux-audit-after/` — see per-fix references above.
