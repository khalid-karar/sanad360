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
