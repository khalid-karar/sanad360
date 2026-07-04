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

// Masks both `-p <password>` (supabase link/db push) and a password embedded
// in a postgres:// URI's userinfo (the psql seed command) before echoing —
// this line is the ONLY thing that previously printed the raw seed command,
// and a postgres://user:PASSWORD@host URL was NOT covered by the -p regex,
// so every past `seed staging` run leaked the staging DB password verbatim
// into the GitHub Actions log.
function maskSecrets(cmd) {
  return cmd
    .replace(/(-p\s+)\S+/g, '$1***')
    .replace(/(:\/\/[^:/\s]+:)([^@\s]+)(@)/g, '$1***$3');
}

function run(cmd, opts = {}) {
  console.log(`\n$ ${maskSecrets(cmd)}`);
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
  // SUPABASE_STAGING_DB_URL, if set, is an EXPLICIT OVERRIDE and always wins —
  // this matters because GitHub Actions runners have NO IPv6 egress, and
  // Supabase's direct connection host (db.<ref>.supabase.co:5432) is
  // IPv6-only unless the project has the paid IPv4 add-on. The fix in that
  // case is to set SUPABASE_STAGING_DB_URL to the project's SESSION POOLER
  // connection string instead (Supabase dashboard → Project Settings →
  // Database → Connection string → "Session pooler" tab), which is
  // IPv4-reachable — NOT the "URI"/direct tab.
  //
  // If no override is set, we build the direct-host URL from
  // SUPABASE_STAGING_PROJECT_REF + SUPABASE_STAGING_DB_PASSWORD (the same
  // two secrets `push staging` already uses) with the password
  // percent-encoded — avoiding the OTHER classic footgun, where a hand-pasted
  // URL contains an un-encoded special character ($, @, !, # are common in
  // Supabase-generated passwords) and silently breaks URI parsing.
  let url = process.env.SUPABASE_STAGING_DB_URL;
  if (!url) {
    const stagingRef = process.env.SUPABASE_STAGING_PROJECT_REF;
    const stagingPassword = process.env.SUPABASE_STAGING_DB_PASSWORD;
    if (!stagingRef || !stagingPassword) {
      die(
        'Set SUPABASE_STAGING_DB_URL (recommended: the Session pooler string), ' +
        'or SUPABASE_STAGING_PROJECT_REF + SUPABASE_STAGING_DB_PASSWORD (see .env.example).'
      );
    }
    url = `postgresql://postgres:${encodeURIComponent(stagingPassword)}@db.${stagingRef}.supabase.co:5432/postgres`;
  }

  // ── SAFETY RAIL 2: the staging URL must not point at production ──
  if (PROD_REF && url.includes(PROD_REF)) {
    die(`The resolved staging DB URL contains the PRODUCTION project ref (${PROD_REF}).`);
  }

  let psqlVersion;
  try {
    psqlVersion = execSync('psql --version').toString().trim();
  } catch {
    psqlVersion = 'NOT FOUND on PATH — install postgresql-client';
  }
  console.log(`\n$ psql <staging DB, host redacted> -v ON_ERROR_STOP=1 -f supabase/seed.sql`);
  console.log(`  psql version: ${psqlVersion}`);
  console.log(`  host: ${new URL(url).hostname}`); // hostname only, never the password
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
