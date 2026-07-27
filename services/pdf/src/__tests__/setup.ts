// Loads services/pdf/.env (falling back to the repo-root .env) into
// process.env BEFORE any test imports lib/supabase.ts — same load order
// index.ts uses in production, just triggered explicitly here since tests
// import route handlers directly rather than booting the whole app.
import '../lib/env.js';
