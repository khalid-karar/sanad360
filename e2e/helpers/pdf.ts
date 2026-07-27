/**
 * Mirrors src/lib/__tests__/phase2-acceptance.test.ts's version-robust
 * pdf-parse usage exactly: v2 exposes a `PDFParse` class
 * (new PDFParse({data}).getText()); v1 exposed a default callable.
 * pdf-parse extracts text in PDF logical order, which may differ from
 * visual RTL order for Arabic — assert PRESENCE of tokens, not order.
 */
export async function extractPdfText(bytes: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParseModule = (await import('pdf-parse')) as any;
  if (typeof pdfParseModule.PDFParse === 'function') {
    const parser = new pdfParseModule.PDFParse({ data: bytes });
    const result = (await parser.getText()) as { text: string };
    return result.text;
  }
  const pdfParse = pdfParseModule.default ?? pdfParseModule;
  const parsed = (await pdfParse(bytes)) as { text: string };
  return parsed.text;
}
