import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { listInspectionPdfs, refreshPdfUrl } from '../../lib/api/inspection';
import type { InspectionPdf } from '../../lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileTextIcon, DownloadIcon, RefreshCwIcon } from 'lucide-react';

const REPORT_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  single_pickup:   { ar: 'عملية واحدة',    en: 'Single Pickup' },
  monthly_summary: { ar: 'ملخص شهري',      en: 'Monthly Summary' },
  monthly_company: { ar: 'ملخص شهري للمنشأة', en: 'Monthly Company Summary' },
};

export default function InspectionPdfsList() {
  const { isRTL } = useAuthStore();
  const [pdfs, setPdfs] = useState<InspectionPdf[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    listInspectionPdfs({ limit: 20 })
      .then(setPdfs)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  async function handleDownload(pdf: InspectionPdf) {
    setDownloadingId(pdf.id);
    try {
      const url = await refreshPdfUrl(pdf.pdf_path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      console.error('Failed to get PDF URL', err);
    } finally {
      setDownloadingId(null);
    }
  }

  if (isLoading) {
    return (
      <Card className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle>{isRTL ? 'ملفات التفتيش السابقة' : 'Previous Inspection Files'}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
            {isRTL ? 'جارٍ التحميل...' : 'Loading...'}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card text-card-foreground border-border">
      <CardHeader className="flex flex-row items-center gap-2">
        <FileTextIcon className="w-5 h-5 text-primary" />
        <CardTitle>{isRTL ? 'ملفات التفتيش السابقة' : 'Previous Inspection Files'}</CardTitle>
      </CardHeader>
      <CardContent>
        {pdfs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {isRTL ? 'لم يتم إنشاء ملفات تفتيش بعد.' : 'No inspection files generated yet.'}
          </div>
        ) : (
          <div className="space-y-2">
            {pdfs.map((pdf) => {
              // Falls back to the raw value for any report_type not in the
              // lookup table above — an unconditional lookup here threw
              // "Cannot read properties of undefined (reading 'ar')" whenever
              // a PDF record had an unrecognized report_type.
              const typeLabel = REPORT_TYPE_LABELS[pdf.report_type] ?? {
                ar: pdf.report_type,
                en: pdf.report_type,
              };
              const dateStr = new Date(pdf.created_at).toLocaleDateString(
                isRTL ? 'ar-SA' : 'en-GB',
                { year: 'numeric', month: 'short', day: 'numeric' }
              );
              return (
                <div
                  key={pdf.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-muted/20"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileTextIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {isRTL ? typeLabel.ar : typeLabel.en}
                        </Badge>
                        {pdf.period_month && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(pdf.period_month + 'T00:00:00Z').toLocaleDateString(
                              isRTL ? 'ar-SA' : 'en-GB',
                              { year: 'numeric', month: 'long', timeZone: 'UTC' }
                            )}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {isRTL ? 'صدر في' : 'Generated'} {dateStr}
                      </div>
                      <div
                        className="text-xs font-mono text-muted-foreground/60 truncate mt-0.5"
                        title={pdf.sha256_hash}
                        dir="ltr"
                      >
                        SHA-256: {pdf.sha256_hash.substring(0, 16)}…
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(pdf)}
                    disabled={downloadingId === pdf.id}
                    className="flex-shrink-0 gap-1.5"
                  >
                    {downloadingId === pdf.id
                      ? <RefreshCwIcon className="w-3.5 h-3.5 animate-spin" />
                      : <DownloadIcon className="w-3.5 h-3.5" />}
                    {isRTL ? 'تنزيل' : 'Download'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
