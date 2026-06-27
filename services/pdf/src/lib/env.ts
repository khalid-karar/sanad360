/**
 * Lightweight .env loader (no dotenv dependency).
 *
 * The PDF service can be started from either services/pdf/ or the repo root, so
 * we look for a .env in services/pdf/ first, then the repo root two levels up.
 * Values already present in the OS environment are never overwritten.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function load(path: string): boolean {
  try {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
    return true;
  } catch {
    return false;
  }
}

// services/pdf/.env  (here = services/pdf/src/lib → ../../ = services/pdf)
load(resolve(here, '../../.env'));
// repo root .env       (here = services/pdf/src/lib → ../../../../ = repo root)
load(resolve(here, '../../../../.env'));
