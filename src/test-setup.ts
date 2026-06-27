/**
 * Vitest global setup — loads .env into process.env.
 *
 * Vitest's automatic env loading exposes only VITE_-prefixed vars.
 * Integration tests also need un-prefixed vars like SUPABASE_SERVICE_ROLE_KEY.
 * This setup file reads .env directly so all vars are available regardless of prefix.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const content = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    // Don't overwrite vars already set in the OS environment
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
} catch {
  // No .env file — vars must be injected externally (CI, etc.)
}
