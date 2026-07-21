import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import {
  listPendingDocuments, describeDocumentOwner, reviewDocument, getDocumentSignedUrl,
} from '../lib/api/documents';
import type { DocumentRow } from '../lib/database.types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2Icon, XCircleIcon, ExternalLinkIcon, Loader2Icon } from 'lucide-react';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { Modal } from '@/components/ui/modal';

const OWNER_TYPE_LABEL: Record<string, { ar: string; en: string }> = {
  company:            { ar: 'منشأة',        en: 'Company' },
  branch:              { ar: 'فرع',           en: 'Branch' },
  transport_company:  { ar: 'شركة نقل',      en: 'Transport Co.' },
  driver:              { ar: 'سائق',          en: 'Driver' },
  vehicle:             { ar: 'مركبة',         en: 'Vehicle' },
  facility:            { ar: 'منشأة إعادة تدوير', en: 'Facility' },
};

interface QueueRow {
  doc: DocumentRow;
  ownerLabel: string;
}

/**
 * System-side reviewer queue (document_reviewer / admin). Reviewer can only
 * verify/reject with a mandatory reason on rejection — RLS + the
 * documents_before_update trigger enforce this is the only thing this role
 * can do to a document; they have no path here (or anywhere) to create
 * tenants or users.
 */
export default function DocumentReviewQueuePage() {
  const { isRTL } = useAuthStore();
  const { toast } = useToast();

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<DocumentRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const docs = await listPendingDocuments();
      const withLabels = await Promise.all(
        docs.map(async (doc) => ({ doc, ownerLabel: await describeDocumentOwner(doc.owner_type, doc.owner_id) }))
      );
      setRows(withLabels);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openPreview(path: string) {
    try {
      setPreviewUrl(await getDocumentSignedUrl(path));
    } catch (err) {
      toast({ title: isRTL ? 'تعذر فتح الملف' : 'Could not open file', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    }
  }

  async function handleVerify(doc: DocumentRow) {
    setBusyId(doc.id);
    try {
      await reviewDocument(doc.id, 'verified');
      toast({ title: isRTL ? 'تم التوثيق' : 'Verified' });
      await load();
    } catch (err) {
      toast({ title: isRTL ? 'فشل' : 'Failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject() {
    if (!rejecting || !rejectReason.trim()) return;
    setBusyId(rejecting.id);
    try {
      await reviewDocument(rejecting.id, 'rejected', rejectReason.trim());
      toast({ title: isRTL ? 'تم الرفض' : 'Rejected' });
      setRejecting(null);
      setRejectReason('');
      await load();
    } catch (err) {
      toast({ title: isRTL ? 'فشل' : 'Failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell role="reviewer">
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {isRTL ? 'قائمة مراجعة المستندات' : 'Document Review Queue'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL ? 'توثيق أو رفض المستندات المعلّقة' : 'Verify or reject pending documents'}
          </p>
        </div>

        {error && <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />}

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : rows.length === 0 && !error ? (
          <EmptyState title={isRTL ? 'لا توجد مستندات بانتظار المراجعة' : 'No documents awaiting review'} />
        ) : (
          <div className="space-y-3">
            {rows.map(({ doc, ownerLabel }) => (
              <Card key={doc.id} className="bg-card text-card-foreground border-border">
                <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{isRTL ? OWNER_TYPE_LABEL[doc.owner_type]?.ar : OWNER_TYPE_LABEL[doc.owner_type]?.en}</Badge>
                      <span className="font-medium text-foreground">{ownerLabel}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1" dir="ltr">{doc.doc_type}</p>
                    {doc.expiry_date && (
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {isRTL ? 'ينتهي: ' : 'Expires: '}{doc.expiry_date}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => openPreview(doc.file_path)}>
                      <ExternalLinkIcon className="w-4 h-4" />
                      {isRTL ? 'عرض الملف' : 'View file'}
                    </Button>
                    <Button size="sm" className="gap-1 bg-success text-success-foreground hover:bg-success/90" disabled={busyId === doc.id} onClick={() => handleVerify(doc)}>
                      {busyId === doc.id ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <CheckCircle2Icon className="w-4 h-4" />}
                      {isRTL ? 'توثيق' : 'Verify'}
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1" disabled={busyId === doc.id} onClick={() => { setRejecting(doc); setRejectReason(''); }}>
                      <XCircleIcon className="w-4 h-4" />
                      {isRTL ? 'رفض' : 'Reject'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {previewUrl && (
        <Modal open onClose={() => setPreviewUrl(null)} isRTL={isRTL} title={isRTL ? 'معاينة الملف' : 'File Preview'}>
          <div className="space-y-4">
            <iframe src={previewUrl} className="w-full h-[70vh] rounded-md border border-border" title="document-preview" />
            <Button variant="outline" className="w-full" onClick={() => setPreviewUrl(null)}>{isRTL ? 'إغلاق' : 'Close'}</Button>
          </div>
        </Modal>
      )}

      {rejecting && (
        <Modal open onClose={() => setRejecting(null)} isRTL={isRTL} title={isRTL ? 'سبب الرفض' : 'Reject Reason'}>
          <div className="space-y-4">
            <Label className="text-foreground">{isRTL ? 'السبب (إلزامي)' : 'Reason (required)'} *</Label>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="bg-background text-foreground border-input" />
            <div className="flex gap-3">
              <Button variant="destructive" disabled={!rejectReason.trim() || busyId === rejecting.id} onClick={handleReject} className="gap-2">
                {busyId === rejecting.id && <Loader2Icon className="w-4 h-4 animate-spin" />}
                {isRTL ? 'تأكيد الرفض' : 'Confirm Reject'}
              </Button>
              <Button variant="outline" onClick={() => setRejecting(null)}>{isRTL ? 'إلغاء' : 'Cancel'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
