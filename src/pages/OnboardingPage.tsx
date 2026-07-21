import { useAuthStore } from '../stores/authStore';
import AppShell from '../components/AppShell';
import DocumentChecklist from '../components/documents/DocumentChecklist';
import { EmptyState } from '@/components/ui/states';
import { FileWarningIcon } from 'lucide-react';
import type { DocumentOwnerType } from '../lib/database.types';

interface OnboardingPageProps {
  ownerType: DocumentOwnerType;
  ownerId: string | null;
  shellRole: 'company' | 'transport' | 'recycler' | 'driver';
}

/**
 * Per-tenant onboarding screen: document checklist + the server-computed
 * completion bar (migration 021's owner_document_status). Thin role-specific
 * wrappers below resolve ownerId from the signed-in user's own membership.
 */
export default function OnboardingPage({ ownerType, ownerId, shellRole }: OnboardingPageProps) {
  const { isRTL } = useAuthStore();

  return (
    <AppShell role={shellRole}>
      <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {isRTL ? 'المستندات والتأسيس' : 'Onboarding & Documents'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL
              ? 'لا يصبح الحساب نشطاً إلا بعد اكتمال المستندات المطلوبة وتوثيقها'
              : 'This entity is only ACTIVE once every required document is uploaded and verified'}
          </p>
        </div>

        {ownerId ? (
          <DocumentChecklist ownerType={ownerType} ownerId={ownerId} isRTL={isRTL} />
        ) : (
          <EmptyState
            icon={<FileWarningIcon />}
            title={isRTL ? 'لا يوجد كيان مرتبط بحسابك' : 'No entity linked to your account'}
          />
        )}
      </div>
    </AppShell>
  );
}
