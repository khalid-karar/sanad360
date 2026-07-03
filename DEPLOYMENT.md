# Sanad 360 — Environments & Deployment

One repo, multiple deployment targets. **Environments differ only by
config/secrets — never by code or long-lived branches.** `main` is the source
of truth; short-lived feature branches PR into it; the same commit that passes
CI is what deploys to staging and (after manual approval) production.

## Environment matrix

| | **local** | **staging / demo** | **production** |
|---|---|---|---|
| Supabase project | local Docker stack (`supabase start`) | dedicated hosted project *(create manually — see checklist)* | Dammam **CNTXT-operated** Supabase project *(not provisioned yet)* |
| Region | developer machine | any (no real PII → not KSA-bound) | **KSA (Dammam)** — PDPL data residency |
| Data | seed.sql fixtures | realistic **FAKE** Saudi data — safe to reset; sales demos + pre-prod migration test bed | **real client data only** |
| Seed policy | seeded (`npm run db:seed:local`) | seeded (`npm run db:seed:staging`) | **NEVER seeded, NEVER reset** — enforced by `scripts/db-target.mjs` (no prod seed path exists) and by the CD pipeline (no seed step) |
| Migrations | `supabase db reset` / `migration up` | `supabase db push` (forward-only) | `supabase db push` (forward-only), behind manual approval |
| Deploys from | developer machine | every `main` push that passes CI | same commit, gated by GitHub Environment **required reviewers** |

## Secrets — exact names

Secrets live in **GitHub Environments** (`staging`, `production`) — never in
the repo. Developer machines hold only local-stack values in an untracked
`.env` (templates: [.env.example](.env.example),
[services/pdf/.env.example](services/pdf/.env.example)).

Per GitHub Environment (values differ per environment; names identical except
the `STAGING`/`PROD` pair used by the promotion script):

| Secret | Used by | Notes |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | `supabase link/db push` | CLI token from supabase.com → Account → Access Tokens |
| `SUPABASE_STAGING_PROJECT_REF` / `SUPABASE_PROD_PROJECT_REF` | promotion script | Settings → General → Reference ID |
| `SUPABASE_STAGING_DB_PASSWORD` / `SUPABASE_PROD_DB_PASSWORD` | `supabase db push` | Settings → Database |
| `SUPABASE_STAGING_DB_URL` | **staging seeding only** | direct Postgres URL; there is deliberately no PROD equivalent |
| `VITE_SUPABASE_URL` | frontend build | the environment's Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | frontend build | the environment's anon/publishable key |
| `VITE_PDF_SERVICE_URL` | frontend build | the environment's PDF service URL |
| `PDF_SERVICE_SUPABASE_SERVICE_ROLE_KEY` | PDF service deploy | goes into the PDF host's secret store, never the frontend |
| `CORS_ORIGIN` | PDF service deploy | the environment's frontend URL |
| `NETLIFY_AUTH_TOKEN` | Netlify CLI deploy | Netlify → User settings → Applications → New access token |
| `NETLIFY_SITE_ID` | Netlify CLI deploy | this environment's Netlify **site** (staging and production are two separate sites, each with its own token/ID pair) |
| `RAILWAY_TOKEN` | Railway CLI deploy | a Railway **project** token scoped to this environment's project (Railway → Project → Settings → Tokens) |
| `RAILWAY_SERVICE_ID` | Railway CLI deploy | the PDF service's ID within that Railway project |

### Observability & gating (launch-critical additions)

| Name | Kind | Purpose |
|---|---|---|
| `VITE_SENTRY_DSN` / `SENTRY_DSN` | Environment secret | error tracking, frontend / PDF service (no-op when unset) |
| `SENTRY_ENV` | Environment secret | `staging` or `production` tag on events |
| `DEPLOY_STAGING` | repo **variable** | set to `true` to activate the deploy pipeline (skipped-and-green until then) |
| `STAGING_APP_URL`, `STAGING_PDF_HEALTH_URL`, `PROD_APP_URL`, `PROD_PDF_HEALTH_URL` | repo **variables** | targets for the 15-minute [uptime workflow](.github/workflows/uptime.yml) |

The frontend deploys via the **Netlify CLI** (publishes the already-built
`./dist` — see [netlify.toml](netlify.toml) for the SPA redirect + caching
rules); the PDF service deploys via the **Railway CLI**, which builds
[services/pdf/Dockerfile](services/pdf/Dockerfile) (Playwright base image,
/health HEALTHCHECK, graceful SIGTERM drain) on Railway's own infrastructure —
[docker-compose.yml](services/pdf/docker-compose.yml) remains the reference
for running that same image on any other single-host Docker target.
PDPL erasure runbook: [PDPL_ERASURE.md](PDPL_ERASURE.md).

## Manual checklist (a human must do these — an agent cannot)

**Now (staging):**
1. Create the staging Supabase project in the dashboard (any region; suggest
   Frankfurt for latency). Note its Reference ID and DB password.
2. Create a Supabase access token (Account → Access Tokens).
3. Create the staging Netlify site and a personal access token; create the
   staging Railway project + PDF service (set its **root directory** to
   `services/pdf` so Railway builds from the Dockerfile there), and a project
   token. In the Railway service's own Variables tab, set the vars from
   [services/pdf/.env.example](services/pdf/.env.example) (`SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN` = the
   Netlify site URL, optionally `SENTRY_DSN`/`SENTRY_ENV`) — these live on
   Railway itself, the deploy workflow never pushes them.
4. In GitHub → repo → Settings → Environments: create **`staging`** and add
   the secrets from the table above (staging values, including the Netlify
   and Railway ones from step 3). Create a (free) Sentry project and add its
   DSNs. Then set the repo variable `DEPLOY_STAGING=true` and the
   `STAGING_APP_URL` / `STAGING_PDF_HEALTH_URL` uptime variables (the Netlify
   site URL and `<railway-service-url>/health`).
5. If the Netlify site also has GitHub-native auto-deploy enabled, disable
   auto-publishing (Site settings → Build & deploy → Stop builds) so this
   workflow — which keeps DB migrations, frontend, and the PDF service in
   lockstep — is the single deploy path. Leaving it on is harmless (same
   commit gets built twice) but redundant.

**Later (production):**
6. Provision the Dammam Supabase project through **CNTXT** (KSA region).
7. Create a separate production Netlify site and Railway project (never
   reuse the staging ones) and their tokens.
8. Create the **`production`** GitHub Environment, add the prod-valued
   secrets, and — critically — enable **Required reviewers** on it so every
   production deploy blocks on human approval.

## Day-to-day commands

```bash
npm run db:seed:local       # local: full reset (migrations + seed)
npm run db:push:staging     # staging: forward-only migrations
npm run db:seed:staging     # staging: (re)load FAKE demo data
npm run db:push:production  # prod: forward-only migrations (CI does this, gated)
# npm run db:seed:production  ← does not exist, by design
```

`scripts/db-target.mjs` hard-aborts if: a seed targets production, the staging
DB URL/ref contains the production project ref, or any required secret is
missing. Remote targets only ever receive `db push` — reset is local-only.

## Pipelines

- **[ci.yml](.github/workflows/ci.yml)** — every push/PR: fresh local Supabase
  stack, typecheck, the full integration test suite (real RLS), both builds.
  Unchanged by the deployment setup.
- **[deploy.yml](.github/workflows/deploy.yml)** — runs on `main` only after
  CI succeeds: `deploy-staging` (push migrations → seed demo data → build →
  deploy frontend to Netlify + PDF service to Railway → smoke check), then
  `deploy-production` (same commit; **blocks on the `production`
  Environment's required reviewers**; push migrations → deploy → smoke check;
  **no seed step exists in the job**). Smoke checks poll the PDF service's
  `/health` and the frontend URL from the `STAGING_*`/`PROD_*` repo variables;
  if those variables aren't set yet, the checks warn and skip rather than
  fail, so the pipeline stays usable while you're still wiring it up.
