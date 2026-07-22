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

- **`cp3-branch-qr-issue.test.ts` test 3 ("a driver-role caller is rejected with 403") is a
  concurrency/isolation flake, not a code defect.** Passes reliably in isolation (confirmed across
  multiple standalone runs); fails under full-suite concurrent load with `401` instead of the expected
  `403` — the PDF service's `authMiddleware` calls `admin.auth.getUser(jwt)` to validate the bearer
  token, and any error from that call (including a transient one under load, not just a genuinely
  invalid/expired token) is conflated into a blanket 401 (`services/pdf/src/lib/auth.ts`). Under the
  full suite's concurrent load against the local GoTrue/auth stack, this occasionally surfaces as a
  false 401 for a token that is actually still valid.
  **Why it matters now:** the growing test suite (CP5 alone added ~8 files) increases concurrent load
  on the local auth service, and this is exactly the kind of test that will read as a random,
  unreproducible failure in CI once one exists — which erodes trust in the whole suite.
  **MUST be fixed or quarantined-with-reason before CP8's zero-skip CI gate** — either (a) make
  `authMiddleware` distinguish a genuinely invalid/expired token from a transient validation error
  (e.g. retry once, or surface a 5xx instead of a 401 for non-auth errors), or (b) add a bounded retry
  to the test itself if the transient failure turns out to be inherent to the local dev stack rather
  than fixable server-side. Do not let this quietly become an ignored/skipped test without a recorded
  reason — track it here until resolved.

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
