import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listRequiredDocuments, listDocumentsForOwner, uploadDocument, latestPerDocType,
} from '@/lib/api/documents';
import type { DocumentRow, RequiredDocument } from '@/lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { UploadIcon, CheckCircle2Icon, XCircleIcon, ClockIcon } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/hooks/use-toast';

/**
 * Document checklist for a pending_application, DELIBERATELY NOT the
 * generic DocumentChecklist/owner_document_status() pair. Documents are
 * stored under owner_type='pending_application' (owner_id=applicationId),
 * but the REQUIRED list must come from the application's own tenant_type
 * ('company' or 'transport_company') — required_documents also has a
 * 'pending_application' owner_type row set (migration 037), but that's the
 * UNION of company+transport_company doc types, seeded purely as an upload
 * allowlist so the trigger doesn't reject a doc_type a real UI would never
 * offer. Using it here would show a company applicant a transport-only
 * requirement (or vice versa) and would disagree with
 * submit_application_for_review()'s own completeness gate (migration 041),
 * which explicitly checks `required_documents WHERE owner_type = tenant_type`.
 * So: required list is fetched by tenantType, documents are fetched/uploaded
 * by owner_type='pending_application' — same upload path
 * (uploadDocument/listDocumentsForOwner) as every other owner_type, just two
 * different owner_type values feeding the same component.
 */
export default function ApplicationDocumentChecklist({
  applicationId,
  tenantType,
  isRTL,
  onCompletionChange,
}: {
  applicationId: string;
  tenantType: 'company' | 'transport_company';
  isRTL: boolean;
  onCompletionChange?: (complete: boolean) => void;
}) {
  const { toast } = useToast();
  const [required, setRequired] = useState<RequiredDocument[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pendingDates, setPendingDates] = useState<Record<string, { issue: string; expiry: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [req, docRows] = await Promise.all([
        listRequiredDocuments(tenantType),
        listDocumentsForOwner('pending_application', applicationId),
      ]);
      setRequired(req);
      setDocs(docRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantType, applicationId]);

  useEffect(() => { load(); }, [load]);

  const latest = latestPerDocType(docs);

  // Same completeness rule as submit_application_for_review(): every
  // required doc_type must have a latest row that isn't 'rejected'.
  useEffect(() => {
    if (loading || error) return;
    const complete = required.every((rd) => {
      const doc = latest.get(rd.doc_type);
      return !!doc && doc.status !== 'rejected';
    });
    onCompletionChange?.(complete);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, docs, loading, error]);

  function setDate(docType: string, field: 'issue' | 'expiry', value: string) {
    setPendingDates((p) => ({ ...p, [docType]: { issue: p[docType]?.issue ?? '', expiry: p[docType]?.expiry ?? '', [field]: value } }));
  }

  async function handleUpload(docType: string, file: File | undefined) {
    if (!file) return;
    setUploadingType(docType);
    try {
      const dates = pendingDates[docType];
      await uploadDocument('pending_application', applicationId, docType, file, {
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

  const satisfiedCount = required.filter((rd) => {
    const doc = latest.get(rd.doc_type);
    return !!doc && doc.status !== 'rejected';
  }).length;
  const completionPct = required.length === 0 ? 100 : Math.round((satisfiedCount / required.length) * 100);

  return (
    <div className="space-y-4">
      <Card className="bg-card text-card-foreground border-border">
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {isRTL ? 'نسبة الاكتمال' : 'Completion'}
            </span>
            <span className="text-sm font-semibold text-foreground" dir="ltr">{completionPct}%</span>
          </div>
          <div
            className="w-full h-2.5 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={completionPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={isRTL ? 'نسبة الاكتمال' : 'Completion'}
          >
            <div
              className={`h-full transition-all ${completionPct === 100 ? 'bg-success' : 'bg-warning'}`}
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {required.map((rd) => {
          const doc = latest.get(rd.doc_type);
          return (
            <Card key={rd.doc_type} className="bg-card text-card-foreground border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{isRTL ? rd.label_ar : rd.label_en}</span>
                  {!doc && <Badge variant="secondary">{isRTL ? 'لم يُرفع' : 'Not uploaded'}</Badge>}
                  {doc?.status === 'pending' && (
                    <Badge className="bg-warning/15 text-warning gap-1"><ClockIcon className="w-3 h-3" />{isRTL ? 'قيد المراجعة' : 'Pending Review'}</Badge>
                  )}
                  {doc?.status === 'verified' && (
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

                {(!doc || doc.status === 'rejected') && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground" htmlFor={`${rd.doc_type}-issue`}>{isRTL ? 'تاريخ الإصدار' : 'Issue date'}</Label>
                      <Input id={`${rd.doc_type}-issue`} type="date" dir="ltr" lang={isRTL ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB'} className="mt-1"
                        onChange={(e) => setDate(rd.doc_type, 'issue', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground" htmlFor={`${rd.doc_type}-expiry`}>{isRTL ? 'تاريخ الانتهاء' : 'Expiry date'}</Label>
                      <Input id={`${rd.doc_type}-expiry`} type="date" dir="ltr" lang={isRTL ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB'} className="mt-1"
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
