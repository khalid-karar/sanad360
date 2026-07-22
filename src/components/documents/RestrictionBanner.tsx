import { useCallback, useEffect, useState } from 'react';
import { getOwnerDocumentStatus } from '@/lib/api/documents';
import type { DocumentOwnerType, OwnerDocumentStatus } from '@/lib/database.types';
import { Button } from '@/components/ui/button';
import { AlertTriangleIcon, XIcon } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import DocumentChecklist from './DocumentChecklist';

const DOC_TYPE_LABELS_AR: Record<string, string> = {
  commercial_registration: 'السجل التجاري',
  vat_certificate: 'شهادة ضريبة القيمة المضافة',
  municipal_license: 'الرخصة البلدية',
  ncwm_license: 'ترخيص NCWM',
  iqama: 'الإقامة',
  driving_license: 'رخصة القيادة',
  vehicle_registration: 'استمارة تسجيل المركبة',
  operating_license: 'ترخيص التشغيل',
};
const DOC_TYPE_LABELS_EN: Record<string, string> = {
  commercial_registration: 'Commercial Registration',
  vat_certificate: 'VAT Certificate',
  municipal_license: 'Municipal License',
  ncwm_license: 'NCWM License',
  iqama: 'Iqama',
  driving_license: 'Driving License',
  vehicle_registration: 'Vehicle Registration',
  operating_license: 'Operating License',
};

/**
 * Shows nothing when active. When onboarding/restricted, states the exact
 * reason (which doc_types are missing/expired/unverified — straight from
 * owner_document_status(), never guessed client-side) and offers a resolve
 * flow: opens the same DocumentChecklist used for onboarding, re-fetches on
 * close so the banner clears itself the moment the entity goes active.
 */
export default function RestrictionBanner({
  ownerType,
  ownerId,
  isRTL,
}: {
  ownerType: DocumentOwnerType;
  ownerId: string;
  isRTL: boolean;
}) {
  const [status, setStatus] = useState<OwnerDocumentStatus | null>(null);
  const [showResolve, setShowResolve] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getOwnerDocumentStatus(ownerType, ownerId));
    } catch {
      // Fail quiet — a banner that can't load shouldn't block the rest of the page.
      setStatus(null);
    }
  }, [ownerType, ownerId]);

  useEffect(() => { load(); }, [load]);

  if (!status || status.activation_status === 'active') return null;

  const label = (t: string) => (isRTL ? DOC_TYPE_LABELS_AR[t] ?? t : DOC_TYPE_LABELS_EN[t] ?? t);
  const problems = [
    ...status.expired_doc_types.map((t) => (isRTL ? `${label(t)} (منتهي)` : `${label(t)} (expired)`)),
    ...status.missing_doc_types.map((t) => (isRTL ? `${label(t)} (لم يُرفع)` : `${label(t)} (not uploaded)`)),
    ...status.unverified_doc_types.map((t) => (isRTL ? `${label(t)} (قيد المراجعة/مرفوض)` : `${label(t)} (pending/rejected)`)),
  ];

  const isRestricted = status.activation_status === 'restricted';

  return (
    <>
      <div
        role="alert"
        className={`rounded-lg border p-4 flex flex-wrap items-start gap-3 ${isRestricted ? 'bg-destructive/10 border-destructive/30' : 'bg-warning/10 border-warning/30'}`}
      >
        <AlertTriangleIcon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isRestricted ? 'text-destructive' : 'text-warning'}`} />
        <div className="flex-1 min-w-[200px]">
          <p className={`text-sm font-semibold ${isRestricted ? 'text-destructive' : 'text-warning'}`}>
            {isRestricted
              ? (isRTL ? 'مقيّد — مستند مطلوب منتهي أو مرفوض' : 'Restricted — a required document expired or was rejected')
              : (isRTL ? 'قيد التأسيس — بعض المستندات المطلوبة غير مكتملة' : 'Onboarding — some required documents are incomplete')}
          </p>
          {problems.length > 0 && (
            <p className="text-sm text-foreground mt-1">{problems.join(isRTL ? '، ' : ', ')}</p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowResolve(true)}>
          {isRTL ? 'اضغط هنا للحل' : 'Click here to resolve'}
        </Button>
      </div>

      {showResolve && (
        <Modal
          open
          onClose={() => { setShowResolve(false); void load(); }}
          isRTL={isRTL}
          title={isRTL ? 'حل القيد' : 'Resolve Restriction'}
        >
          <div className="space-y-4">
            <DocumentChecklist ownerType={ownerType} ownerId={ownerId} isRTL={isRTL} onStatusChange={setStatus} />
            <Button variant="outline" className="w-full gap-2" onClick={() => { setShowResolve(false); void load(); }}>
              <XIcon className="w-4 h-4" />
              {isRTL ? 'إغلاق' : 'Close'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
