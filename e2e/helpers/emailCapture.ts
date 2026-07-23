import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Reads the JSONL file services/pdf/src/lib/email.ts's capture gate writes
 * to (E2E_CAPTURE_EMAIL=1 + NODE_ENV=test/ci — see that file for the full
 * triple-gate). Must resolve to the SAME path the PDF service process
 * resolves (both default to `${cwd}/.e2e-captured-emails.jsonl`, and both
 * processes are started from the repo root in CI and in local dev) — set
 * E2E_CAPTURE_EMAIL_FILE explicitly on both sides if that ever changes.
 */
const CAPTURE_FILE = process.env.E2E_CAPTURE_EMAIL_FILE ?? path.resolve(process.cwd(), '.e2e-captured-emails.jsonl');

interface CapturedEmail {
  to: string;
  template: 'verify' | 'approved' | 'rejected';
  locale: 'ar' | 'en';
  vars: Record<string, string>;
  subject: string;
  text: string;
  capturedAt: string;
}

/**
 * Polls the capture file for the newest entry matching (to, template).
 * send() is awaited before the triggering HTTP response returns (both in
 * public-signup.ts and admin-notify-application-decision.ts), so in practice
 * the entry is already on disk by the time the caller's request resolves —
 * the poll loop is defense-in-depth against fs write-visibility timing, not
 * a real race in the app's own control flow.
 */
export async function waitForCapturedEmail(
  to: string,
  template: CapturedEmail['template'],
  timeoutMs = 10_000
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(CAPTURE_FILE, 'utf8');
      const entries = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CapturedEmail);
      const match = [...entries].reverse().find((e) => e.to === to && e.template === template);
      if (match) return match;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `No captured '${template}' email found for ${to} within ${timeoutMs}ms (capture file: ${CAPTURE_FILE}). ` +
      `Is the PDF service running with E2E_CAPTURE_EMAIL=1 and NODE_ENV=test|ci?`
  );
}

/** Pulls the `token` query param out of a captured verify-email link. */
export function extractVerifyToken(link: string): string {
  const token = new URL(link).searchParams.get('token');
  if (!token) throw new Error(`No 'token' query param in captured verify link: ${link}`);
  return token;
}
