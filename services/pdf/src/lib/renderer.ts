import { chromium } from 'playwright';
import type { Browser } from 'playwright';

// ─────────────────────────────────────────────────────────────
// Shared browser + bounded render queue.
//
// Previously every request launched (and tore down) a full Chromium — two
// launches per report thanks to the two-pass hash render. A burst of monthly
// reports could exhaust memory. Now: ONE persistent browser, each render in
// its own short-lived context, at most RENDER_CONCURRENCY renders in flight;
// excess renders queue FIFO.
// ─────────────────────────────────────────────────────────────

const RENDER_CONCURRENCY = 2;
const RENDER_TIMEOUT_MS = 45_000;

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--no-sandbox'] });
  }
  return browserPromise;
}

// Minimal FIFO semaphore — avoids a dependency for one counter.
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < RENDER_CONCURRENCY) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function release(): void {
  active--;
  waiters.shift()?.();
}

// Renders an HTML string to a PDF Buffer using the shared headless Chromium.
// Uses waitUntil: 'networkidle' so web fonts (Google Fonts CDN) fully load
// before printing. The resulting bytes are ready for SHA-256 and upload.
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  await acquire();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS });

      // Confirm the Arabic web font is ready before printing.
      await page.evaluate(() =>
        (document as Document & { fonts: FontFaceSet }).fonts.ready
      );

      const pdfBytes = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdfBytes);
    } finally {
      await context.close();
    }
  } catch (err) {
    // If the browser itself died, drop the cached instance so the next render
    // relaunches instead of failing forever.
    const msg = err instanceof Error ? err.message : String(err);
    if (/browser has been closed|target closed|browser closed/i.test(msg)) {
      browserPromise = null;
    }
    throw err;
  } finally {
    release();
  }
}
