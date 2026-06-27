import { useAuthStore } from '../stores/authStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface FAQModalProps {
  onClose: () => void;
}

export default function FAQModal({ onClose }: FAQModalProps) {
  const { isRTL } = useAuthStore();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-lg bg-card text-card-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader>
          <CardTitle>{isRTL ? 'الأسئلة الشائعة' : 'Frequently Asked Questions'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">
              {isRTL ? 'كيف يعمل النظام؟' : 'How does the system work?'}
            </p>
            <p className="mt-1">
              {isRTL
                ? 'يمكّن نظام تدوير 360 منشآت قطاع الغذاء من تسجيل عمليات نقل النفايات والامتثال للوائح NCWM.'
                : 'Tadweer360 enables food-sector businesses to record waste transfers and comply with NCWM regulations.'}
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">
              {isRTL ? 'كيف يسجّل السائق دخوله؟' : 'How does a driver log in?'}
            </p>
            <p className="mt-1">
              {isRTL
                ? 'يختار السائق تبويب "سائق" ويدخل رقم هاتفه وكلمة المرور.'
                : 'Select the "Driver" tab and enter your phone number and password.'}
            </p>
          </div>
          <Button onClick={onClose} className="w-full mt-4">
            {isRTL ? 'إغلاق' : 'Close'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
