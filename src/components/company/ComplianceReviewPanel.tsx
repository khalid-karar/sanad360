import { useAuthStore } from '../../stores/authStore';
import { useCompanyStore, ComplianceData, ComplianceIssue } from '../../stores/companyStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2Icon, AlertTriangleIcon, XCircleIcon, XIcon } from 'lucide-react';

interface ComplianceReviewPanelProps {
  data: ComplianceData;
  onClose: () => void;
}

export default function ComplianceReviewPanel({ data, onClose }: ComplianceReviewPanelProps) {
  const { isRTL } = useAuthStore();
  const { overrideAndApprove, requestCorrection, alertTransporter } = useCompanyStore();

  const handleOverrideAndApprove = () => {
    overrideAndApprove();
    onClose();
  };

  const handleRequestCorrection = (issueId: string) => {
    requestCorrection(issueId);
    onClose();
  };

  const handleAlertTransporter = () => {
    alertTransporter();
    onClose();
  };

  const getIssueIcon = (issue: ComplianceIssue) => {
    if (issue.type === 'error') {
      return <XCircleIcon className="w-5 h-5 text-destructive flex-shrink-0" />;
    }
    return <AlertTriangleIcon className="w-5 h-5 text-warning flex-shrink-0" />;
  };

  const getIssueTitle = (issue: ComplianceIssue) => {
    return isRTL ? issue.titleAr : issue.titleEn;
  };

  const getIssueDescription = (issue: ComplianceIssue) => {
    return isRTL ? issue.descriptionAr : issue.descriptionEn;
  };

  const renderYellowScenarioActions = () => (
    <div className="flex gap-3">
      <Button
        variant="outline"
        onClick={() => handleRequestCorrection(data.issues[0]?.id)}
        className="flex-1 bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground"
      >
        {isRTL ? 'طلب تصحيح' : 'Request Correction'}
      </Button>
      <Button
        onClick={handleOverrideAndApprove}
        className="flex-1 bg-warning text-warning-foreground hover:bg-warning/90"
      >
        {isRTL ? 'تجاهل والموافقة' : 'Override & Approve'}
      </Button>
    </div>
  );

  const renderRedScenarioActions = () => (
    <Button
      onClick={handleAlertTransporter}
      className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
    >
      {isRTL ? 'إبلاغ الشركة الناقلة' : 'Alert Transporter Company'}
    </Button>
  );

  const renderValidChecks = () => {
    const validChecksCount = 8 - data.issues.length;
    if (validChecksCount > 0) {
      return (
        <div className="mt-4 p-4 bg-success/5 border border-success/20 rounded-lg">
          <div className="flex items-center gap-3">
            <CheckCircle2Icon className="w-5 h-5 text-success flex-shrink-0" />
            <span className="text-sm text-success font-medium">
              {isRTL 
                ? `✅ ${validChecksCount} فحوصات أخرى سليمة` 
                : `✅ ${validChecksCount} other checks are valid`}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl bg-card text-card-foreground border-border max-h-[90vh] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-xl text-foreground">
            {isRTL ? 'تفاصيل المراجعة' : 'Review Details'}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon className="w-5 h-5" />
          </Button>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden">
          <ScrollArea className="h-full pe-4">
            <div className="space-y-6">
              {/* Compliance Score Display */}
              <div className="text-center p-6 bg-muted rounded-lg">
                <div className="text-4xl font-bold text-foreground mb-2">
                  {data.percentage}%
                </div>
                <p className="text-sm text-muted-foreground">
                  {isRTL ? 'نسبة الامتثال' : 'Compliance Rate'}
                </p>
              </div>

              {/* Issues List */}
              {data.issues.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">
                    {data.level === 'red' 
                      ? (isRTL ? 'الأخطاء المكتشفة:' : 'Detected Errors:')
                      : (isRTL ? 'التحذيرات المكتشفة:' : 'Detected Warnings:')}
                  </h3>
                  
                  {data.issues.map((issue, index) => (
                    <div key={issue.id}>
                      <div className={`p-4 rounded-lg border ${
                        issue.type === 'error' 
                          ? 'bg-destructive/5 border-destructive/20' 
                          : 'bg-warning/5 border-warning/20'
                      }`}>
                        <div className="flex items-start gap-3">
                          {getIssueIcon(issue)}
                          <div className="flex-1">
                            <h4 className="font-medium text-foreground mb-1">
                              {getIssueTitle(issue)}
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              {getIssueDescription(issue)}
                            </p>
                          </div>
                        </div>
                      </div>
                      {index < data.issues.length - 1 && <Separator className="my-4 bg-border" />}
                    </div>
                  ))}
                </div>
              )}

              {/* Valid Checks */}
              {renderValidChecks()}

              {/* Action Buttons */}
              <div className="pt-4">
                {data.level === 'yellow' && renderYellowScenarioActions()}
                {data.level === 'red' && renderRedScenarioActions()}
              </div>

              {/* Additional Info for Red Scenario */}
              {data.level === 'red' && (
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {isRTL 
                      ? 'لا يمكن إرسال البيان حتى يتم حل جميع الأخطاء الحرجة. سيتم تسجيل جميع الإجراءات لأغراض المراجعة.'
                      : 'Cannot submit manifest until all critical errors are resolved. All actions will be logged for audit purposes.'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
