# Known Limitations

Deliberate scope boundaries — not bugs — decided during implementation and documented here so they
aren't mistaken for oversights or rediscovered from scratch later. Distinct from
`PRODUCTION_HARDENING.md`, which tracks deferred *operational* hardening tasks (scheduled jobs, etc.)
for things that already work correctly at pilot scale.

## CP5 — Auth/Roles Overhaul

- **Consultant portfolio is a tenant-switch launchpad, not simultaneous cross-company KPIs.**
  `/consultant` (`src/pages/ConsultantPortfolioPage.tsx`) lists every company a consultant is engaged
  with (`memberships` where `role='consultant'`, readable via the existing "own row only" SELECT
  policy regardless of which membership is currently active). Each card **switches the active tenant**
  (migration 012's existing `user_active_tenant` mechanism) and lands on that company's real dashboard
  — it does not fetch and render all engaged companies' compliance numbers side-by-side in one view.
  **Why:** `pickup_events`/`companies` RLS still scopes reads to the caller's single ACTIVE membership
  (`my_membership()`); migration 025's header explicitly deferred "consultant's engagement-scope
  restrictions in RLS" pending a design decision ("no policy surface to write yet"). Building a true
  simultaneous multi-company view would require widening that RLS bypass — a change that hasn't been
  reviewed and shouldn't be made unilaterally inside an app-code phase.
  **Where this resurfaces:** if a future request asks for "compare compliance across my clients at a
  glance" or a portfolio-wide KPI rollup, that's this exact gap — it needs an explicit RLS design
  (e.g. a `SECURITY DEFINER` rollup function scoped to `memberships WHERE user_id = auth.uid() AND
  role = 'consultant'`, analogous to `gov_rollup()`) reviewed and migrated before the UI can show it.

- **`gov_rollup()` temporal differencing** (residual risk, not yet mitigated).
  Complementary suppression (migration 031) defeats differencing *within* one snapshot, but a
  region+industry cell that crosses the `min_companies` threshold between two snapshots taken at
  different times can still leak the boundary company by diffing before/after results. See
  `PRODUCTION_HARDENING.md`'s "`gov_rollup()` temporal differencing" entry for the full writeup and
  the two mitigation options (query logging vs. noise injection) — logged there rather than duplicated
  here since it's an operational hardening item with a concrete task, not a scope boundary.
  **Where this resurfaces:** before onboarding more than a handful of `gov_viewer` accounts, or before
  any external/regulatory party gets standing query access to `gov_rollup()`.

## CP6 — P0/P1 Fixes

- **RESOLVED (CP8 Task 0).** `cp3-branch-qr-issue.test.ts` test 3 ("a driver-role caller is rejected
  with 403") was previously flagged as a concurrency/isolation flake under full-suite load (false `401`
  instead of `403`). Investigated properly before trusting a "clean run" as the answer:
  - **Actual root cause**: this local dev machine had accumulated 39 leaked processes across many past
    sessions — orphaned `tsx watch` (services/pdf dev server) and `vite.js` (frontend dev server)
    instances going back days, plus one live Chromium tree spawned by one of them. `tsx watch` doesn't
    drain its child Playwright browser on an abrupt kill the way `services/pdf/src/index.ts`'s own
    SIGTERM/SIGINT handler does (that handler only runs when launched as `node dist/index.js`, which is
    exactly what CI does — CI never runs `npm run dev`, so this accumulation pattern is structurally
    local-machine-only and cannot occur on an ephemeral CI runner).
  - **Verification**: after killing the leaked processes, ran the full suite (default parallel Vitest
    pool, all 44 files) 5 times. Test 3 passed 5/5; all 44 files green every run. No genuine
    test-isolation or DB-state bug was found — 5 consecutive clean runs under normal concurrent load is
    strong evidence against an ordering/leak bug (those reproduce consistently, not vanish).
  - **Decision**: kept parallel CI (did not adopt `--singleFork`, which would have serialized the suite
    and masked real isolation bugs rather than exposed them).
  - **Defense-in-depth fix shipped anyway**, rather than relying solely on "the environment happened to
    be clean": `authMiddleware` (`services/pdf/src/lib/auth.ts`) now distinguishes a genuinely
    invalid/expired token (GoTrue responds with a 4xx — `AuthError.status` in the 400s) from a
    transient/upstream failure validating it (`AuthError.status` undefined — error occurred before any
    response was received — or a 5xx). The former still returns `401`; the latter now returns a
    retry-safe `503` instead of masquerading as an invalid token. Covered by
    `services/pdf/src/__tests__/auth-middleware.test.ts`.

## CP7 — UI/UX Overhaul

- **Several admin/company dashboard widgets render hardcoded placeholder numbers, not real data —
  must be wired to real queries or hidden before pilot.** Found while reskinning (tokens/a11y only;
  the underlying mock-data wiring is out of CP7's scope):
  - `src/components/transport/TransportKPIs.tsx` — all three metrics (`pendingTasks`,
    `complianceRate`, `todayPickups`) come from hardcoded literals in `transportStore.ts`
    (`complianceRate: 87.5`, `todayPickups: { planned: 8, completed: 6 }`, `pendingTasks` derived
    from a static `mockAlerts` array dated 2024-03-15). Confirmed live via Playwright — the dashboard
    renders exactly `87.5%` / `6/8` regardless of the signed-in transport company's real data.
  - `src/components/admin/AdminKPIs.tsx` — all three metrics are literal strings (`'1,247'`,
    `'87.3%'`, `'23'`) with no store, prop, or API call at all — not even wrong-shaped real data,
    just static JSX.
  - `src/components/admin/ComplianceMap.tsx` — the five city markers and their compliance
    percentages (Riyadh 92%, Jeddah 85%, Dammam 78%, Mecca 88%, Medina 90%) are a hardcoded array
    with no data fetch; the map never reflects real company/branch compliance data. The Leaflet
    popup text (`` `<b>${city.name}</b><br/>الامتثال: ${city.compliance}%` ``) is also Arabic-only
    regardless of `isRTL` — a bilingual bug, left as-is pending the real-data wiring since fixing the
    copy of a popup for numbers that are about to be replaced wastes the string-review effort twice.
  - `src/components/admin/CompaniesTable.tsx` — **partially real**: company name and registration
    date (`created_at`) come from the real `listAllCompanies()` API. But the per-row "compliance
    status" column is hardcoded to `'low'` for every single company (`status: 'low' as const` at
    load time, never varies), and the expanded-row detail panel's "Registration Date: 2023-06-15" /
    "Total Manifests: 156" are literal strings shown identically for every company regardless of
    which row is expanded — not derived from `company.id` or any real field. The "View Full Details"
    button in that panel has no `onClick` at all.
  **Why this matters:** these are exactly the kind of thing a pilot user or auditor takes at face
  value — a KPI card or map doesn't visually announce "this number is fake." Shipping them to a real
  admin/gov/transport-manager user without fixing or hiding them risks someone acting on stale/wrong
  numbers.
  **Where this resurfaces:** before any external pilot user gets an admin, gov_viewer, or transport
  manager account, each of the four widgets above needs either (a) a real query wired in (compliance
  rate from `pickup_events`/`compliance_status` aggregates, city markers from `branches`/`companies`
  geolocation + compliance rollup, per-row company status from real risk data, expanded-row stats
  from real `pickup_events`/document counts), or (b) to be hidden/removed from the dashboard until
  that query exists. Do not let a future pass reskin around these again without addressing the
  underlying data gap.

- **A real bilingual date picker (`src/components/ui/date-picker.tsx`) exists and is used in
  PickupSchedulePage.tsx, but 5 remaining native `<input type="date">` fields (`DocumentChecklist.tsx`
  ×2, `DriverManagementPage.tsx`, `VehicleManagementPage.tsx`, `TransportTripsPage.tsx`'s New Trip
  form) were deliberately left as native inputs this pass** (decided: defer full migration) — only
  pinned their `lang` attribute to `ar-SA-u-ca-gregory-nu-latn`/`en-GB` for calendar/digit consistency
  with the rest of the app, since native date-input CHROME (the actual calendar popup) is controlled
  by the browser/OS locale and cannot be fully forced to match the page language from HTML/CSS alone —
  the same limitation that motivated building the custom picker in the first place.
  **Where this resurfaces:** if these 5 fields need the same fully-controlled bilingual UX as
  PickupSchedulePage.tsx (numeric field order independent of OS locale, in-app calendar), migrate them
  onto `DatePicker`/`DateTimePicker` — same component, no new build needed.

- **`--primary`/`--secondary`/`--success`/`--tertiary` fail AA as plain TEXT color in dark mode
  (`.dark.theme-default`), even though they pass cleanly as button-fill backgrounds.** Confirmed dark
  mode is genuinely reachable in production — `themeStore.ts` defaults `theme: 'system'` and applies
  automatically from the OS's `prefers-color-scheme`, independent of the in-app toggle removed this
  phase (see the theme-picker-removal entry above). Computed via the WCAG relative-luminance formula
  for each token used directly as `text-*` (not through its own `*-foreground` pairing, which is
  separately verified and fine):
  - `text-primary` on `--card`: 3.16:1 (large-text only)
  - `text-secondary` on `--card`: 2.33:1 (fails even the 3:1 large-text floor)
  - `text-success` on `--card`: 3.16:1 (large-text only)
  - `text-tertiary` on `--card`: 4.09:1 (large-text only, marginal)
  All four pass cleanly in light mode (6.32:1 / 8.57:1 / 6.32:1 / 4.88:1) — this is a dark-mode-only
  gap. One concrete instance was found and fixed this phase: `StatusPill`'s `compliant`/
  `pending_confirmation` tones (which use `--success`/`--secondary` as text) — see the CP7 commit
  fixing `status-pill.tsx`. A grep found roughly 65 other `text-primary`/`text-secondary`/
  `text-success`/`text-tertiary` usages across the app; most are colored icons (non-text, governed by
  the lower 3:1 non-text-contrast rule, which primary/success/tertiary already pass) rather than actual
  text, but a full per-usage audit to separate icon color from real body/label text — and fix any
  further real hits — was not completed this pass given the size of that sweep.
  **Where this resurfaces:** before shipping dark mode as a fully-supported, audited experience (rather
  than "happens to work because the underlying tokens are close"), grep every remaining `text-primary`/
  `text-secondary`/`text-success`/`text-tertiary` usage, classify icon vs. real text, and apply the same
  StatusPill-style scoped dark-mode override (explicit HSL, not a global token change — the shared
  tokens' button-fill pairings are already correct and a global lightness change would risk breaking
  those) to any real text usage that fails.

## CP8 — Comprehensive Automated Testing

- **Member/consultant offboarding has no UI surface — `revokeMembership()` (services/pdf, migration
  032) has no frontend caller.** Found while adding RLS test coverage for `memberships` (CP8 Slice D,
  gap 7): the table has exactly two SELECT policies — `memberships_select` (own row only) and
  `memberships_select_maya_role` (super_admin viewing other Maya-side rows only) — and neither grants a
  tenant admin (owner/manager) visibility into their OWN tenant-mates' membership rows, active or
  revoked. There is consequently no "team members" list anywhere in the product to revoke someone
  from; `revokeMembership()` is only ever called by its own test file
  (`src/lib/__tests__/cp5-membership-soft-revoke.test.ts`), never by real UI.
  **Why this is a feature gap, not an RLS bug:** the current behavior is fail-closed (under-grants, not
  over-grants) — no cross-member visibility leaks anywhere, revoked or not. It was never wrong, just
  never built on top of.
  **Where this resurfaces:** before building a "team management" / "remove member" UI for company or
  transport-company owners/managers, this needs a new, REVIEWED policy or `SECURITY DEFINER` RPC
  granting tenant-mate visibility — scoped strictly to a tenant admin seeing their OWN tenant's members
  (mirroring `my_membership()`'s existing company_id/transport_company_id scoping), never cross-tenant,
  and never surfacing Maya-side or applicant rows. Do not widen `memberships_select` itself to do this;
  add a narrowly-scoped sibling policy or function instead, same pattern as
  `memberships_select_maya_role`.
