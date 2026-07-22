import { useAuthStore } from '../stores/authStore';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

interface FAQModalProps {
  onClose: () => void;
}

export default function FAQModal({ onClose }: FAQModalProps) {
  const { isRTL } = useAuthStore();

  return (
    <Modal
      open
      onClose={onClose}
      isRTL={isRTL}
      maxWidth="max-w-lg"
      title={isRTL ? 'الأسئلة الشائعة' : 'Frequently Asked Questions'}
    >
      <div className="space-y-4 text-sm text-muted-foreground">
        <div>
          <p className="font-medium text-foreground">
            {isRTL ? 'كيف يعمل النظام؟' : 'How does the system work?'}
          </p>
          <p className="mt-1">
            {isRTL
              ? 'يمكّن نظام سند 360 منشآت قطاع الغذاء من تسجيل عمليات نقل النفايات والامتثال للوائح NCWM.'
              : 'Sanad 360 enables food-sector businesses to record waste transfers and comply with NCWM regulations.'}
          </p>
        </div>
        <div>
          <p className="font-medium text-foreground">
            {isRTL ? 'كيف يسجّل السائق دخوله؟' : 'How does a driver log in?'}
          </p>
          <p className="mt-1">
            {/* CP5 replaced the old tabbed login with a single form that
                server-resolves the role — this answer described the
                removed "Driver" tab and was stale. */}
            {isRTL
              ? 'يدخل السائق رقم هاتفه وكلمة المرور في نموذج الدخول نفسه المستخدم لجميع الأدوار — يحدد النظام دور المستخدم تلقائياً.'
              : 'A driver enters their phone number and password into the same login form used for every role — the system resolves the role automatically.'}
          </p>
        </div>
        <Button onClick={onClose} className="w-full mt-4">
          {isRTL ? 'إغلاق' : 'Close'}
        </Button>
      </div>
    </Modal>
  );
}
