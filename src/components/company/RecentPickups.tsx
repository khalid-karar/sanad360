import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import type { RecentPickup } from '../../stores/companyStore';
import { generateSinglePickupPdf } from '../../lib/api/inspection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CalendarIcon, Trash2Icon, WeightIcon, UserIcon,
  ArrowRightIcon, FileTextIcon, Loader2Icon,
} from 'lucide-react';
import InteractiveButton from '../animations/InteractiveButton';

interface RecentPickupsProps {
  pickups: RecentPickup[];
}

const COMPLIANCE_COLORS: Record<string, string> = {
  compliant:     'bg-green-100 text-green-800 border-green-200',
  warning:       'bg-yellow-100 text-yellow-800 border-yellow-200',
  non_compliant: 'bg-red-100 text-red-800 border-red-200',
};

const COMPLIANCE_LABELS_AR: Record<string, string> = {
  compliant:     'ممتثل',
  warning:       'تحذير',
  non_compliant: 'غير ممتثل',
};

const COMPLIANCE_LABELS_EN: Record<string, string> = {
  compliant:     'Compliant',
  warning:       'Warning',
  non_compliant: 'Non-Compliant',
};

export default function RecentPickups({ pickups }: RecentPickupsProps) {
  const { isRTL } = useAuthStore();
  const navigate = useNavigate();
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleViewAll = () => navigate('/transport/pickups');

  async function handleGeneratePdf(pickup: RecentPickup) {
    setGeneratingId(pickup.id);
    setErrors((prev) => ({ ...prev, [pickup.id]: '' }));
    try {
      const result = await generateSinglePickupPdf(pickup.id);
      window.open(result.signed_url, '_blank', 'noopener');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل إنشاء الملف';
      setErrors((prev) => ({ ...prev, [pickup.id]: msg }));
    } finally {
      setGeneratingId(null);
    }
  }

  return (
    <Card className="bg-card text-card-foreground border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-foreground">
          {isRTL ? 'الالتقاطات الأخيرة' : 'Recent Pickups'}
        </CardTitle>
        <InteractiveButton
          variant="ghost"
          size="sm"
          onClick={handleViewAll}
          className="text-primary hover:text-primary/80"
          hapticFeedback
        >
          <span className="font-medium text-sm">
            {isRTL ? 'عرض الكل' : 'View All'}
          </span>
          {/* ms-2 (logical) instead of the previous manual mr-2/ml-2 ternary —
              this icon TRAILS the text, so the gap is on the icon's
              INLINE-START side (the side facing the text before it); ms-2
              already resolves to ml-2 in LTR / mr-2 in RTL, exactly what
              the ternary did manually. rotate-180 in RTL: the arrow should
              point toward "continue reading" (start-to-end), which is
              visually leftward in RTL. */}
          <ArrowRightIcon className={`w-4 h-4 ms-2 ${isRTL ? 'rotate-180' : ''}`} />
        </InteractiveButton>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[480px] pr-4">
          <div className="space-y-4">
            {pickups.map((pickup) => (
              <Card key={pickup.id} className="bg-muted/30 border-border p-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-foreground font-medium">{pickup.date}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-foreground">{pickup.driver}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Trash2Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-foreground">{pickup.wasteType}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <WeightIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-foreground">{pickup.weight}</span>
                  </div>
                </div>

                {/* Compliance badge + risk score */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Badge
                    variant="outline"
                    className={`text-xs ${COMPLIANCE_COLORS[pickup.complianceStatus] ?? ''}`}
                  >
                    {isRTL
                      ? COMPLIANCE_LABELS_AR[pickup.complianceStatus]
                      : COMPLIANCE_LABELS_EN[pickup.complianceStatus]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {isRTL ? 'درجة الخطورة' : 'Risk'}: {pickup.riskScore}/100
                  </span>
                </div>

                {/* Generate inspection file button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs mt-1"
                  disabled={generatingId === pickup.id}
                  onClick={() => handleGeneratePdf(pickup)}
                >
                  {generatingId === pickup.id
                    ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" />
                    : <FileTextIcon className="w-3.5 h-3.5" />}
                  {isRTL ? 'إنشاء ملف التفتيش' : 'Generate Inspection File'}
                </Button>

                {errors[pickup.id] && (
                  <p className="text-xs text-destructive mt-1 text-center">
                    {errors[pickup.id]}
                  </p>
                )}
              </Card>
            ))}
            {pickups.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                {isRTL ? 'لا توجد التقاطات حديثة.' : 'No recent pickups.'}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
