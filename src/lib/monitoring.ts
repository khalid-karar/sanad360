import * as Sentry from '@sentry/react';

/**
 * Error tracking (launch-critical item 1).
 *
 * No-op unless VITE_SENTRY_DSN is set — local dev and CI run without any
 * external calls; staging/production get their DSN from the GitHub
 * Environment secrets at build time (see DEPLOYMENT.md).
 *
 * Privacy posture (PDPL): no PII is attached to events — sendDefaultPii is
 * off, and we scrub URL query strings which may carry signed storage tokens.
 */
export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENV as string | undefined) ?? 'staging',
    sendDefaultPii: false,
    // Errors are the product here; keep performance sampling cheap.
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Signed storage URLs carry access tokens in the query — never ship them.
      if (event.request?.url) {
        event.request.url = event.request.url.split('?')[0];
      }
      return event;
    },
  });
}

/** Manual capture for handled-but-notable failures (e.g. offline replay giving up). */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
