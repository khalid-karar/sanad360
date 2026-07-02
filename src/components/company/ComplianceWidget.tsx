import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useCompanyStore } from '../../stores/companyStore';
import type { ComplianceData } from '../../stores/companyStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2Icon, AlertCircleIcon, SearchIcon } from 'lucide-react';
import ComplianceReviewPanel from './ComplianceReviewPanel';
import InteractiveButton from '../animations/InteractiveButton';
import ScaleIn from '../animations/ScaleIn';

interface ComplianceWidgetProps {
  data: ComplianceData;
}

export default function ComplianceWidget({ data }: ComplianceWidgetProps) {
  const { isRTL } = useAuthStore();
  const { approveCompliance } = useCompanyStore();
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  // Reflects real compliance data passed from the store (no mock scenarios).
  const testingData = data;

  const getStatusColor = () => {
    if (testingData.percentage >= 95) return 'text-success';
    if (testingData.percentage >= 80) return 'text-warning';
    return 'text-destructive';
  };

  const getStatusIcon = () => {
    if (testingData.percentage >= 95) return <CheckCircle2Icon className="w-8 h-8" />;
    return <AlertCircleIcon className="w-8 h-8" />;
  };

  const getStatusLevel = () => {
    if (testingData.percentage >= 95) return 'green';
    if (testingData.percentage >= 80) return 'yellow';
    return 'red';
  };

  const handleMainAction = () => {
    const level = getStatusLevel();
    if (level === 'green') {
      approveCompliance();
    } else {
      setShowReviewPanel(true);
    }
  };

  const getMainButtonText = () => {
    const level = getStatusLevel();
    if (level === 'green') {
      return isRTL ? 'الموافقة والإرسال إلى NCWM' : 'Approve & Submit to NCWM';
    } else {
      return isRTL ? 'مراجعة التفاصيل' : 'Review Details';
    }
  };

  const getMainButtonIcon = () => {
    const level = getStatusLevel();
    if (level === 'green') {
      return <CheckCircle2Icon className="w-5 h-5 me-2" />;
    } else {
      return <SearchIcon className="w-5 h-5 me-2" />;
    }
  };

  const getMainButtonClass = () => {
    const level = getStatusLevel();
    if (level === 'green') {
      return "w-full bg-success text-white hover:bg-success/90 shadow-medium hover:shadow-strong";
    } else if (level === 'yellow') {
      return "w-full bg-warning text-white hover:bg-warning/90 shadow-medium hover:shadow-strong";
    } else {
      return "w-full bg-destructive text-white hover:bg-destructive/90 shadow-medium hover:shadow-strong";
    }
  };

  return (
    <>
      <Card variant="elevated" className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle className="text-heading text-foreground">
            {isRTL ? 'بيان الامتثال اليومي' : 'Daily Compliance Manifest'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <p className="text-caption">
                {isRTL ? 'تاريخ البيان' : 'Manifest Date'}
              </p>
              <p className="text-subheading font-medium text-foreground">{testingData.date}</p>
            </div>
            <div className="text-center space-y-2">
              <div className={`text-6xl font-bold ${getStatusColor()}`}>{testingData.percentage}%</div>
              <p className="text-caption">
                {isRTL ? 'نسبة الامتثال' : 'Compliance Rate'}
              </p>
            </div>
            <div className={`${getStatusColor()} opacity-80`}>{getStatusIcon()}</div>
          </div>

        {testingData.status === 'pending' && (
          <ScaleIn>
            <InteractiveButton
              onClick={handleMainAction}
              size="lg"
              className={getMainButtonClass()}
              // NEVER disable on red: a non-compliant day is exactly when the
              // manager must be able to open the review (was disabled → the
              // washed-out, unreachable CTA in the audit screenshot).
              hapticFeedback
              soundFeedback
            >
              {getMainButtonIcon()}
              {getMainButtonText()}
            </InteractiveButton>
          </ScaleIn>
        )}

          {testingData.status === 'submitted' && (
            <Button
              disabled
              size="lg"
              className="w-full bg-muted text-muted-foreground"
            >
              <CheckCircle2Icon className="w-5 h-5 me-2" />
              {isRTL ? 'تم الإرسال بنجاح' : 'Successfully Submitted'}
            </Button>
          )}

        </CardContent>
      </Card>

      {showReviewPanel && (
        <ComplianceReviewPanel
          data={testingData}
          onClose={() => setShowReviewPanel(false)}
        />
      )}
    </>
  );
}
