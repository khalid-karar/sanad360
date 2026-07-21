# Production Hardening Backlog

Concrete, deferred tasks that are fine to leave as-is at pilot scale but must not be forgotten before
a real production rollout. Each item names the table/mechanism, why it's safe today, and what breaks
it if ignored.

## CP10 — Production Hardening

- [ ] **`branch_qr_used_tokens` unbounded growth** (added migration 022, CP3).
  One row is inserted per successfully-validated branch QR scan, forever — there is no cleanup job.
  Fine at pilot scale (a handful of pickups/day per branch keeps the table tiny), but every future
  `pickup_events` INSERT still has to probe this table by primary key (`signature`), so it becomes a
  real cost once pickup volume grows across many branches.
  **Task:** add a scheduled job (pg_cron, or an external cron hitting a `service_role`-only RPC) that
  runs periodically (e.g. hourly) and does:
  ```sql
  DELETE FROM public.branch_qr_used_tokens WHERE expires_at < now() - interval '1 day';
  ```
  The `branch_qr_used_tokens_expires_at_idx` index (already created in migration 022) makes this
  cheap. Keep the `- interval '1 day'` buffer rather than deleting exactly at `expires_at` so there's
  no race with a request that arrives right at the boundary.

- [ ] **`sweep_expired_pickup_confirmations()` not scheduled** (added migration 030, CP5).
  A pickup whose evidence policy requires a branch confirmation sits as `compliance_status =
  'pending_confirmation'` until either a confirmation lands (promotes/demotes via
  `recompute_pickup_compliance()`) or the configurable window (`confirmation_window_policy`, default
  24h) elapses. Nothing currently calls `sweep_expired_pickup_confirmations()` to catch the
  window-elapsed case — without it, a pickup with no confirmation at all stays `pending_confirmation`
  forever instead of demoting to `non_compliant`.
  **Task:** add a scheduled job (pg_cron, or an external cron hitting a `service_role`-only RPC) that
  runs at least daily and does:
  ```sql
  SELECT public.sweep_expired_pickup_confirmations();
  ```
  Safe to run more often than daily — the function is idempotent (a no-op for any row not currently
  `pending_confirmation`, and a no-op for a still-within-window row).
