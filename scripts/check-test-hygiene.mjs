#!/usr/bin/env node
/**
 * CP8 Slice I — test-hygiene CI gate. Fails the build (not just a warning)
 * on either of two classes of bug this repo has already hit for real:
 *
 * 1. .skip(/.only(/.todo(/.fixme( anywhere in a test file — a silently
 *    skipped or accidentally-scoped-to-.only suite reports green while
 *    testing nothing (or only one thing). Zero-skip is the whole point of
 *    CP8.
 *
 * 2. A `.signOut(` call that doesn't explicitly pass `{ scope: 'local' }`.
 *    supabase-js's signOut() defaults to `scope: 'global'`, which revokes
 *    EVERY session for whichever user the calling client currently holds —
 *    not just that call's own session. Many test files sign in as the same
 *    shared seed accounts (manager@sanad360.dev, the seeded driver, etc.);
 *    an unscoped signOut in one file can invalidate a JWT another
 *    concurrently-running file already captured. This is exactly what
 *    caused cp3-branch-qr-issue.test.ts's real, reproducing #3 flake
 *    (diagnosed via @supabase/auth-js source + a live local repro, not
 *    guessed) — grant-audit.test.ts and ledger-immutability.test.ts were
 *    the two offenders, both fixed. This gate is what keeps a THIRD one
 *    from ever landing silently. Plain concurrent sign-ins against a
 *    shared seed credential are NOT the problem (proven empirically) —
 *    only an unscoped signOut is, so this gate targets exactly that, not
 *    shared-credential usage in general.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/lib/__tests__', 'services/pdf/src/__tests__', 'services/pdf/src/lib', 'e2e'];
const TEST_FILE_RE = /\.test\.ts$|\.spec\.ts$/;

const FORBIDDEN_RE = /\b(describe|it|test)\.(skip|only|todo|fixme)\s*\(/g;

/**
 * Lightweight comment stripper (not a real parser — good enough for this
 * gate). Replaces // and block-comment content with spaces, preserving line
 * counts and string positions, so a `.signOut(` mentioned only in prose
 * (like this very file's own header comment) is never mistaken for a real
 * call, while line numbers reported for genuine violations stay accurate.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      while (i < n && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (two === '/*') {
      out += '  ';
      i += 2;
      while (i < n && text.slice(i, i + 2) !== '*/') {
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      walk(full, out);
    } else if (TEST_FILE_RE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function checkSkipsAndOnly(file, text) {
  const violations = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    FORBIDDEN_RE.lastIndex = 0;
    const match = FORBIDDEN_RE.exec(line);
    if (match) {
      violations.push(`${file}:${i + 1}: forbidden \`${match[0]}\` — zero-skip gate (CP8)`);
    }
  });
  return violations;
}

/** Scans for every `.signOut(` call and requires an explicit local scope.
 *  Two distinct real signatures exist and each needs its own shape:
 *    - client API (`supabase.auth.signOut(...)`): scope is a PROPERTY on an
 *      options object — `signOut({ scope: 'local' })`.
 *    - admin API (`admin.auth.admin.signOut(jwt, scope)`): scope is a
 *      POSITIONAL second argument — `signOut(jwt, 'local')`, no object at
 *      all. Both default to 'global' (revoke every session for that user)
 *      if the scope is omitted. */
function checkSignOutScope(file, text) {
  const violations = [];
  const re = /\.signOut\s*\(/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const windowEnd = Math.min(text.length, match.index + 200);
    const window = text.slice(match.index, windowEnd);
    // Only inspect up to the matching close-paren of THIS call, not whatever
    // comes after it (a later, unrelated signOut's scope shouldn't count).
    let depth = 0;
    let closeIdx = -1;
    for (let i = window.indexOf('('); i < window.length; i++) {
      if (window[i] === '(') depth++;
      if (window[i] === ')') {
        depth--;
        if (depth === 0) { closeIdx = i; break; }
      }
    }
    const callText = closeIdx === -1 ? window : window.slice(0, closeIdx + 1);
    // Two distinct signatures need two distinct acceptable shapes:
    //   client API   — signOut({ scope: 'local' })        (an options object)
    //   admin API    — signOut(jwt, 'local')               (scope is POSITIONAL,
    //                  not an object property — admin.auth.admin.signOut(jwt, scope))
    // Both default to 'global' if the scope is omitted entirely.
    const isAdminSignOut = text.slice(Math.max(0, match.index - 6), match.index) === '.admin';
    const hasClientScope = /scope\s*:\s*['"]local['"]/.test(callText);
    const hasAdminScope = /,\s*['"]local['"]\s*\)/.test(callText);
    if (!hasClientScope && !(isAdminSignOut && hasAdminScope)) {
      const lineNumber = text.slice(0, match.index).split('\n').length;
      violations.push(
        `${file}:${lineNumber}: \`.signOut(\` without an explicit local scope (client API: ` +
        `{ scope: 'local' }; admin API: signOut(jwt, 'local')) — the default (global) scope ` +
        `revokes EVERY session for that user, which can invalidate another concurrently-running ` +
        `test file's already-captured JWT for a shared seed account.`
      );
    }
  }
  return violations;
}

const files = ROOTS.flatMap((root) => walk(root));
let allViolations = [];
for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const text = stripComments(raw);
  allViolations = allViolations.concat(checkSkipsAndOnly(file, text), checkSignOutScope(file, text));
}

if (allViolations.length > 0) {
  console.error('Test hygiene gate failed:\n');
  for (const v of allViolations) console.error('  ' + v);
  console.error(`\n${allViolations.length} violation(s) found.`);
  process.exit(1);
}

console.log(`Test hygiene gate passed (${files.length} test files scanned).`);
