import { chromium } from 'playwright';

// Renders an HTML string to a PDF Buffer using headless Chromium.
// Uses waitUntil: 'networkidle' so web fonts (Google Fonts CDN) fully load
// before printing. The resulting bytes are ready for SHA-256 and upload.
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30_000 });

    // Evaluate CSS font loading API to confirm Arabic font is ready
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
    await browser.close();
  }
}
