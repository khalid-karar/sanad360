import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useCompanyStore, ComplianceData } from '../../stores/companyStore';
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
  const [testingData, setTestingData] = useState<ComplianceData>(data);

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

  const handleGreenScenario = () => {
    setTestingData({
      ...data,
      percentage: 98,
      level: 'green',
      issues: [],
      status: 'pending'
    });
  };

  const handleYellowScenario = () => {
    setTestingData({
      ...data,
      percentage: 88,
      level: 'yellow',
      issues: [
        {
          id: '1',
          type: 'warning',
          titleAr: 'رخصة السائق تنتهي قريباً',
          titleEn: 'Driver License Expiring Soon',
          descriptionAr: 'رخصة السائق أحمد تنتهي خلال 30 يوماً',
          descriptionEn: "Driver Ahmed's license expires in 30 days"
        },
        {
          id: '2',
          type: 'warning',
          titleAr: 'وزن النفايات أعلى من المتوسط',
          titleEn: 'Waste Weight Above Average',
          descriptionAr: 'وزن النفايات أعلى من المتوسط بنسبة 15%',
          descriptionEn: 'Waste weight is 15% above average'
        }
      ],
      status: 'pending'
    });
  };

  const handleRedScenario = () => {
    setTestingData({
      ...data,
      percentage: 45,
      level: 'red',
      issues: [
        {
          id: '1',
          type: 'error',
          titleAr: 'شركة النقل غير مرخصة',
          titleEn: 'Transporter Not Licensed',
          descriptionAr: 'شركة النقل غير مرخصة لنقل النفايات الطبية',
          descriptionEn: 'Transporter not licensed for medical waste'
        },
        {
          id: '2',
          type: 'error',
          titleAr: 'موقع الالتقاط خارج النطاق',
          titleEn: 'Pickup Location Outside Range',
          descriptionAr: 'موقع الالتقاط خارج النطاق الجغرافي المسجل',
          descriptionEn: 'Pickup location outside registered geofence'
        }
      ],
      status: 'pending'
    });
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
      return <CheckCircle2Icon className="w-5 h-5 ml-2" />;
    } else {
      return <SearchIcon className="w-5 h-5 ml-2" />;
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
              disabled={getStatusLevel() === 'red'}
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
              <CheckCircle2Icon className="w-5 h-5 ml-2" />
              {isRTL ? 'تم الإرسال بنجاح' : 'Successfully Submitted'}
            </Button>
          )}

          {/* Testing Controls */}
          <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-4 bg-muted/20">
            <div className="text-center mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                {isRTL ? 'للاختبار' : 'For Testing'}
              </p>
            </div>
            <div className="flex gap-3">
              <InteractiveButton
                onClick={handleGreenScenario}
                size="sm"
                className="flex-1 bg-success text-white hover:bg-success/90"
                hapticFeedback
              >
                {isRTL ? 'أخضر (98%)' : 'Green (98%)'}
              </InteractiveButton>
              <InteractiveButton
                onClick={handleYellowScenario}
                size="sm"
                className="flex-1 bg-warning text-white hover:bg-warning/90"
                hapticFeedback
              >
                {isRTL ? 'أصفر (88%)' : 'Yellow (88%)'}
              </InteractiveButton>
              <InteractiveButton
                onClick={handleRedScenario}
                size="sm"
                className="flex-1 bg-destructive text-white hover:bg-destructive/90"
                hapticFeedback
              >
                {isRTL ? 'أحمر (45%)' : 'Red (45%)'}
              </InteractiveButton>
            </div>
          </div>
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
