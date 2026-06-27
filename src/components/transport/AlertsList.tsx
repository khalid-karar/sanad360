import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useTransportStore, Alert } from '../../stores/transportStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangleIcon, XCircleIcon, UploadIcon, MessageSquareIcon, UserCheckIcon } from 'lucide-react';
import AlertActionModal from './AlertActionModal';

interface AlertsListProps {
  alerts: Alert[];
}

export default function AlertsList({ alerts }: AlertsListProps) {
  const { isRTL } = useAuthStore();
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [actionType, setActionType] = useState<'upload' | 'message' | 'assign' | null>(null);

  const getAlertIcon = (type: Alert['type']) => {
    return type === 'critical' ? (
      <XCircleIcon className="w-5 h-5 text-destructive" />
    ) : (
      <AlertTriangleIcon className="w-5 h-5 text-warning" />
    );
  };

  const getAlertBadge = (alert: Alert) => {
    const variants = {
      pending: 'destructive',
      corrected: 'secondary',
      resolved: 'default',
    } as const;

    const labels = {
      pending: isRTL ? 'بانتظار التصحيح' : 'Pending Correction',
      corrected: isRTL ? 'تم التصحيح، بانتظار المراجعة' : 'Corrected, Awaiting Review',
      resolved: isRTL ? 'تم الحل' : 'Resolved',
    };

    return (
      <Badge variant={variants[alert.status]} className="text-xs">
        {labels[alert.status]}
      </Badge>
    );
  };

  const getAlertHeader = (alert: Alert) => {
    if (alert.type === 'critical') {
      return isRTL ? 'حرج: ممنوع الإرسال' : 'Critical: Submission Blocked';
    }
    return isRTL ? 'تحذير: يحتاج إلى تصحيح' : 'Warning: Needs Correction';
  };

  const handleAction = (alert: Alert, action: 'upload' | 'message' | 'assign') => {
    setSelectedAlert(alert);
    setActionType(action);
  };

  const renderActionButtons = (alert: Alert) => {
    if (alert.status !== 'pending') return null;

    if (alert.type === 'critical') {
      return (
        <div className="flex gap-2 mt-4">
          <Button
            size="sm"
            onClick={() => handleAction(alert, 'assign')}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <UserCheckIcon className="w-4 h-4 mr-2" />
            {isRTL ? 'تعيين سائق/مركبة بديلة' : 'Assign Alternate'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction(alert, 'message')}
            className="flex-1"
          >
            <MessageSquareIcon className="w-4 h-4 mr-2" />
            {isRTL ? 'إرسال رسالة' : 'Send Message'}
          </Button>
        </div>
      );
    }

    return (
      <div className="flex gap-2 mt-4">
        <Button
          size="sm"
          onClick={() => handleAction(alert, 'upload')}
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <UploadIcon className="w-4 h-4 mr-2" />
          {isRTL ? 'إضافة وثيقة' : 'Upload Document'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleAction(alert, 'message')}
          className="flex-1"
        >
          <MessageSquareIcon className="w-4 h-4 mr-2" />
          {isRTL ? 'إرسال رسالة' : 'Send Message'}
        </Button>
      </div>
    );
  };

  return (
    <>
      <Card className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-3">
            <AlertTriangleIcon className="w-6 h-6 text-warning" />
            {isRTL ? 'الإشعارات والتنبيهات' : 'Notifications & Alerts'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-4">
              {alerts.map((alert) => (
                <Card
                  key={alert.id}
                  className={`border-2 ${
                    alert.type === 'critical'
                      ? 'bg-destructive/5 border-destructive/20'
                      : 'bg-warning/5 border-warning/20'
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getAlertIcon(alert.type)}
                        <CardTitle className="text-lg text-foreground">
                          {getAlertHeader(alert)}
                        </CardTitle>
                      </div>
                      {getAlertBadge(alert)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium text-foreground">
                          {isRTL ? 'المنشأة:' : 'Facility:'}
                        </span>
                        <p className="text-muted-foreground">{alert.facility}</p>
                      </div>
                      <div>
                        <span className="font-medium text-foreground">
                          {isRTL ? 'التاريخ والوقت:' : 'Date & Time:'}
                        </span>
                        <p className="text-muted-foreground">{alert.date} - {alert.time}</p>
                      </div>
                    </div>
                    
                    <div>
                      <span className="font-medium text-foreground text-sm">
                        {isRTL ? 'المشكلة:' : 'Issue:'}
                      </span>
                      <p className="text-muted-foreground text-sm mt-1">
                        {isRTL ? alert.issue : alert.issueEn}
                      </p>
                    </div>

                    {renderActionButtons(alert)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {selectedAlert && actionType && (
        <AlertActionModal
          alert={selectedAlert}
          actionType={actionType}
          onClose={() => {
            setSelectedAlert(null);
            setActionType(null);
          }}
        />
      )}
    </>
  );
}
