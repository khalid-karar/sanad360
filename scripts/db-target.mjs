#!/usr/bin/env node
/**
 * Migration promotion + seeding with production safety rails.
 *
 * Usage (env vars documented in .env.example / DEPLOYMENT.md):
 *   node scripts/db-target.mjs push staging      # link + supabase db push
 *   node scripts/db-target.mjs push production   # link + supabase db push
 *   node scripts/db-target.mjs seed staging      # psql seed.sql (FAKE data)
 *   node scripts/db-target.mjs seed local        # supabase db reset (local stack)
 *
 * HARD RULES enforced here, not by convention:
 *   • `seed production` and `reset production` do not exist — any attempt
 *     aborts before touching the network.
 *   • If the resolved staging ref/URL matches SUPABASE_PROD_PROJECT_REF,
 *     the script aborts: a mis-pasted secret cannot seed production.
 *   • Remote targets only ever get `db push` (migrations forward), never reset.
 */
import { execSync } from 'node:child_process';

const [, , action, target] = process.argv;

const usage = 'usage: node scripts/db-target.mjs <push|seed> <local|staging|production>';
if (!['push', 'seed'].includes(action) || !['local', 'staging', 'production'].includes(target)) {
  console.error(usage);
  process.exit(1);
}

const PROD_REF = process.env.SUPABASE_PROD_PROJECT_REF ?? '';

function die(msg) {
  console.error(`\n✗ ABORTED: ${msg}\n`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd.replace(/(-p\s+)\S+/g, '$1***')}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

// ── SAFETY RAIL 1: production is NEVER seeded, NEVER reset ──────────────────
if (action === 'seed' && target === 'production') {
  die('Seeding production is forbidden. Production holds real client data only.');
}

if (action === 'seed') {
  if (target === 'local') {
    // Local stack: full reset re-applies migrations 001-012 + seed.sql.
    run('npx supabase db reset');
    process.exit(0);
  }

  // staging: run seed.sql against the staging DB via direct Postgres URL.
  //
  // Prefer building the URL ourselves from SUPABASE_STAGING_PROJECT_REF +
  // SUPABASE_STAGING_DB_PASSWORD (the same two secrets `push staging` already
  // uses successfully) with the password percent-encoded. A hand-copied full
  // SUPABASE_STAGING_DB_URL is a classic footgun: Supabase-generated DB
  // passwords commonly contain $, @, !, # etc., and an unencoded special
  // character in a pasted connection string breaks URI parsing or gets
  // mangled by shell interpolation — it then fails with an opaque
  // "process completed with exit code 1" that looks like an auth problem.
  // SUPABASE_STAGING_DB_URL is kept as an explicit override/fallback for
  // anyone who still wants to set the full string directly.
  const stagingRef = process.env.SUPABASE_STAGING_PROJECT_REF;
  const stagingPassword = process.env.SUPABASE_STAGING_DB_PASSWORD;
  let url = process.env.SUPABASE_STAGING_DB_URL;

  if (stagingRef && stagingPassword) {
    url = `postgresql://postgres:${encodeURIComponent(stagingPassword)}@db.${stagingRef}.supabase.co:5432/postgres`;
  } else if (!url) {
    die(
      'Set SUPABASE_STAGING_PROJECT_REF + SUPABASE_STAGING_DB_PASSWORD (preferred), ' +
      'or SUPABASE_STAGING_DB_URL directly (see .env.example).'
    );
  }

  // ── SAFETY RAIL 2: the staging URL must not point at production ──
  if (PROD_REF && url.includes(PROD_REF)) {
    die(`The resolved staging DB URL contains the PRODUCTION project ref (${PROD_REF}).`);
  }
  run(`psql "${url}" -v ON_ERROR_STOP=1 -f supabase/seed.sql`, {
    env: { ...process.env },
  });
  process.exit(0);
}

// action === 'push' — migrations only, no reset, for remote targets.
if (target === 'local') {
  run('npx supabase migration up');
  process.exit(0);
}

const refVar = target === 'staging' ? 'SUPABASE_STAGING_PROJECT_REF' : 'SUPABASE_PROD_PROJECT_REF';
const pwVar  = target === 'staging' ? 'SUPABASE_STAGING_DB_PASSWORD' : 'SUPABASE_PROD_DB_PASSWORD';
const ref = process.env[refVar];
const password = process.env[pwVar];

if (!ref) die(`${refVar} is not set (see .env.example / DEPLOYMENT.md).`);
if (!password) die(`${pwVar} is not set.`);
if (!process.env.SUPABASE_ACCESS_TOKEN) die('SUPABASE_ACCESS_TOKEN is not set.');

// ── SAFETY RAIL 3: staging push must not silently target production ──
if (target === 'staging' && PROD_REF && ref === PROD_REF) {
  die('SUPABASE_STAGING_PROJECT_REF equals SUPABASE_PROD_PROJECT_REF.');
}

run(`npx supabase link --project-ref ${ref} -p ${password}`);
run('npx supabase db push -p ' + password);
console.log(`\n✓ Migrations pushed to ${target} (${ref}). No seed, no reset.`);
