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
