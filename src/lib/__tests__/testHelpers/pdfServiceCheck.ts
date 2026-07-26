/**
 * CP8 Slice I — replaces the "soft skip" pattern every PDF-service-dependent
 * test file used to have (`if (!serviceUp) { console.log('SKIP...');
 * return; }` inside individual `it()` blocks). A skipped test reports as
 * neither pass nor fail in most runners' summaries — easy to miss for
 * weeks if the service quietly stops starting in CI. Call this once from
 * each file's own `beforeAll()`; if the service isn't reachable, it THROWS,
 * which fails every test in that file loudly instead of skipping them.
 */
export async function assertPdfServiceUp(pdfServiceUrl: string): Promise<void> {
  let reachable = false;
  try {
    const res = await fetch(`${pdfServiceUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    throw new Error(
      `PDF service not reachable at ${pdfServiceUrl}/health — start it with ` +
      `\`cd services/pdf && npm run dev\` (or confirm CI's "Start PDF service" step ` +
      `succeeded). This is a hard failure, not a skip: CP8 Slice I removed the ` +
      `soft-skip pattern this test file used to have.`
    );
  }
}
