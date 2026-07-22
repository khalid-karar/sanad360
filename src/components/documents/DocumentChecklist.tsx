import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listRequiredDocuments, listDocumentsForOwner, getOwnerDocumentStatus,
  uploadDocument, latestPerDocType,
} from '@/lib/api/documents';
import type {
  DocumentOwnerType, DocumentRow, RequiredDocument, OwnerDocumentStatus,
} from '@/lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { UploadIcon, CheckCircle2Icon, XCircleIcon, ClockIcon, AlertTriangleIcon } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/hooks/use-toast';

/**
 * Reusable document checklist + completion bar for any owner_type. The bar
 * and every status shown come straight from owner_document_status() —
 * migration 021's server-computed function — never computed here.
 */
export default function DocumentChecklist({
  ownerType,
  ownerId,
  isRTL,
  onStatusChange,
}: {
  ownerType: DocumentOwnerType;
  ownerId: string;
  isRTL: boolean;
  onStatusChange?: (status: OwnerDocumentStatus) => void;
}) {
  const { toast } = useToast();
  const [required, setRequired] = useState<RequiredDocument[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [status, setStatus] = useState<OwnerDocumentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pendingDates, setPendingDates] = useState<Record<string, { issue: string; expiry: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [req, docRows, st] = await Promise.all([
        listRequiredDocuments(ownerType),
        listDocumentsForOwner(ownerType, ownerId),
        getOwnerDocumentStatus(ownerType, ownerId),
      ]);
      setRequired(req);
      setDocs(docRows);
      setStatus(st);
      onStatusChange?.(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerType, ownerId]);

  useEffect(() => { load(); }, [load]);

  const latest = latestPerDocType(docs);

  function setDate(docType: string, field: 'issue' | 'expiry', value: string) {
    setPendingDates((p) => ({ ...p, [docType]: { issue: p[docType]?.issue ?? '', expiry: p[docType]?.expiry ?? '', [field]: value } }));
  }

  async function handleUpload(docType: string, file: File | undefined) {
    if (!file) return;
    setUploadingType(docType);
    try {
      const dates = pendingDates[docType];
      await uploadDocument(ownerType, ownerId, docType, file, {
        issueDate: dates?.issue || undefined,
        expiryDate: dates?.expiry || undefined,
      });
      toast({ title: isRTL ? 'تم الرفع' : 'Uploaded', description: isRTL ? 'بانتظار مراجعة الفريق المختص' : 'Awaiting reviewer approval' });
      await load();
    } catch (err) {
      toast({
        title: isRTL ? 'فشل الرفع' : 'Upload failed',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setUploadingType(null);
    }
  }

  if (loading) return <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />;
  if (error) return <ErrorState message={error} retry={load} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />;
  if (!status) return null;

  const barColor =
    status.activation_status === 'active' ? 'bg-success'
    : status.activation_status === 'restricted' ? 'bg-destructive'
    : 'bg-warning';

  return (
    <div className="space-y-4">
      <Card className="bg-card text-card-foreground border-border">
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {isRTL ? 'نسبة الاكتمال' : 'Completion'}
            </span>
            <span className="text-sm font-semibold text-foreground" dir="ltr">{status.completion_pct}%</span>
          </div>
          <div
            className="w-full h-2.5 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={status.completion_pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={isRTL ? 'نسبة الاكتمال' : 'Completion'}
          >
            <div className={`h-full ${barColor} transition-all`} style={{ width: `${status.completion_pct}%` }} />
          </div>
          <div>
            {status.activation_status === 'active' && (
              <Badge className="bg-success text-success-foreground hover:bg-success">{isRTL ? 'نشط' : 'Active'}</Badge>
            )}
            {status.activation_status === 'onboarding' && (
              <Badge className="bg-warning/15 text-warning">{isRTL ? 'قيد التأسيس' : 'Onboarding'}</Badge>
            )}
            {status.activation_status === 'restricted' && (
              <Badge variant="destructive">{isRTL ? 'مقيّد' : 'Restricted'}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {required.map((rd) => {
          const doc = latest.get(rd.doc_type);
          const expiring = status.expiring_soon.find((e) => e.doc_type === rd.doc_type);
          return (
            <Card key={rd.doc_type} className="bg-card text-card-foreground border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{isRTL ? rd.label_ar : rd.label_en}</span>
                  {!doc && <Badge variant="secondary">{isRTL ? 'لم يُرفع' : 'Not uploaded'}</Badge>}
                  {doc?.status === 'pending' && (
                    <Badge className="bg-warning/15 text-warning gap-1"><ClockIcon className="w-3 h-3" />{isRTL ? 'قيد المراجعة' : 'Pending Review'}</Badge>
                  )}
                  {doc?.status === 'verified' && doc.expiry_date && new Date(doc.expiry_date) < new Date() && (
                    <Badge variant="destructive" className="gap-1"><XCircleIcon className="w-3 h-3" />{isRTL ? 'منتهي' : 'Expired'}</Badge>
                  )}
                  {doc?.status === 'verified' && (!doc.expiry_date || new Date(doc.expiry_date) >= new Date()) && (
                    <Badge className="bg-success text-success-foreground hover:bg-success gap-1"><CheckCircle2Icon className="w-3 h-3" />{isRTL ? 'موثّق' : 'Verified'}</Badge>
                  )}
                  {doc?.status === 'rejected' && (
                    <Badge variant="destructive" className="gap-1"><XCircleIcon className="w-3 h-3" />{isRTL ? 'مرفوض' : 'Rejected'}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {doc?.status === 'rejected' && doc.reject_reason && (
                  <p className="text-sm text-destructive" role="alert">{isRTL ? 'سبب الرفض: ' : 'Reject reason: '}{doc.reject_reason}</p>
                )}
                {expiring && (
                  <p className={`text-sm flex items-center gap-2 ${expiring.level === 'critical' ? 'text-destructive' : 'text-warning'}`}>
                    <AlertTriangleIcon className="w-4 h-4" />
                    {isRTL
                      ? `تنتهي الصلاحية خلال ${expiring.days_remaining} يوم`
                      : `Expires in ${expiring.days_remaining} day${expiring.days_remaining === 1 ? '' : 's'}`}
                  </p>
                )}
                {doc && doc.status !== 'rejected' && (
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {doc.expiry_date ? `${isRTL ? 'ينتهي: ' : 'Expires: '}${doc.expiry_date}` : (isRTL ? 'بدون تاريخ انتهاء' : 'No expiry date')}
                  </p>
                )}

                {(!doc || doc.status === 'rejected') && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground" htmlFor={`${rd.doc_type}-issue`}>{isRTL ? 'تاريخ الإصدار' : 'Issue date'}</Label>
                      <Input id={`${rd.doc_type}-issue`} type="date" dir="ltr" className="mt-1"
                        onChange={(e) => setDate(rd.doc_type, 'issue', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground" htmlFor={`${rd.doc_type}-expiry`}>{isRTL ? 'تاريخ الانتهاء' : 'Expiry date'}</Label>
                      <Input id={`${rd.doc_type}-expiry`} type="date" dir="ltr" className="mt-1"
                        onChange={(e) => setDate(rd.doc_type, 'expiry', e.target.value)} />
                    </div>
                  </div>
                )}

                {(!doc || doc.status === 'rejected') && (
                  <>
                    <input
                      ref={(el) => { fileInputs.current[rd.doc_type] = el; }}
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      aria-label={isRTL ? rd.label_ar : rd.label_en}
                      onChange={(e) => handleUpload(rd.doc_type, e.target.files?.[0])}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full gap-2"
                      disabled={uploadingType === rd.doc_type}
                      onClick={() => fileInputs.current[rd.doc_type]?.click()}
                    >
                      <UploadIcon className="w-4 h-4" />
                      {doc?.status === 'rejected'
                        ? (isRTL ? 'إعادة الرفع' : 'Re-upload')
                        : (isRTL ? 'رفع المستند' : 'Upload document')}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
