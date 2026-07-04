/**
 * Single source of truth for the PDF microservice's base URL.
 *
 * A bare host with no scheme (e.g. a Railway domain pasted into Netlify's
 * VITE_PDF_SERVICE_URL without "https://") is NOT an absolute URL — fetch()
 * then resolves it as a RELATIVE PATH against the current page, producing
 * nonsense requests like
 *   https://sanad360.netlify.app/company/<railway-host>/generate/single-pickup
 * which 404 against the frontend's own origin instead of ever reaching the
 * PDF service. This happened in production. Normalizing here means a future
 * missing-scheme misconfiguration self-heals instead of silently breaking.
 */
function normalize(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export const PDF_SERVICE_URL = normalize(
  (import.meta.env.VITE_PDF_SERVICE_URL as string | undefined) ?? 'http://localhost:3001'
);
