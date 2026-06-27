import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useTransportStore, Alert } from '../../stores/transportStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { XIcon, UploadIcon, MessageSquareIcon, UserCheckIcon } from 'lucide-react';

interface AlertActionModalProps {
  alert: Alert;
  actionType: 'upload' | 'message' | 'assign';
  onClose: () => void;
}

export default function AlertActionModal({ alert, actionType, onClose }: AlertActionModalProps) {
  const { isRTL } = useAuthStore();
  const { uploadDocument, sendMessage, assignAlternate, drivers, vehicles } = useTransportStore();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [selectedDriver, setSelectedDriver] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState('');

  const handleSubmit = () => {
    switch (actionType) {
      case 'upload':
        if (selectedFile) {
          uploadDocument(alert.id, selectedFile);
        }
        break;
      case 'message':
        if (message.trim()) {
          sendMessage(alert.id, message);
        }
        break;
      case 'assign':
        if (selectedDriver && selectedVehicle) {
          assignAlternate(alert.id, selectedDriver, selectedVehicle);
        }
        break;
    }
    onClose();
  };

  const getModalTitle = () => {
    switch (actionType) {
      case 'upload':
        return isRTL ? 'إضافة وثيقة' : 'Upload Document';
      case 'message':
        return isRTL ? 'إرسال رسالة' : 'Send Message';
      case 'assign':
        return isRTL ? 'تعيين سائق/مركبة بديلة' : 'Assign Alternate Driver/Vehicle';
      default:
        return '';
    }
  };

  const getModalIcon = () => {
    switch (actionType) {
      case 'upload':
        return <UploadIcon className="w-6 h-6 text-primary" />;
      case 'message':
        return <MessageSquareIcon className="w-6 h-6 text-primary" />;
      case 'assign':
        return <UserCheckIcon className="w-6 h-6 text-primary" />;
      default:
        return null;
    }
  };

  const renderContent = () => {
    switch (actionType) {
      case 'upload':
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-foreground">
                {isRTL ? 'اختر الملف' : 'Select File'}
              </Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {isRTL ? 'الملفات المدعومة: PDF, JPG, PNG' : 'Supported files: PDF, JPG, PNG'}
              </p>
            </div>
          </div>
        );
      
      case 'message':
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-foreground">
                {isRTL ? 'الرسالة' : 'Message'}
              </Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={isRTL ? 'اكتب رسالتك هنا...' : 'Type your message here...'}
                className="mt-2 min-h-[120px]"
              />
            </div>
          </div>
        );
      
      case 'assign':
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-foreground">
                {isRTL ? 'اختر السائق' : 'Select Driver'}
              </Label>
              <Select value={selectedDriver} onValueChange={setSelectedDriver}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder={isRTL ? 'اختر السائق' : 'Select Driver'} />
                </SelectTrigger>
                <SelectContent>
                  {drivers.filter(d => d.status === 'active').map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name_ar} - {driver.license_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label className="text-foreground">
                {isRTL ? 'اختر المركبة' : 'Select Vehicle'}
              </Label>
              <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder={isRTL ? 'اختر المركبة' : 'Select Vehicle'} />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.filter(v => v.status === 'active').map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate_number} - {vehicle.type} ({vehicle.waste_license_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  const isSubmitDisabled = () => {
    switch (actionType) {
      case 'upload':
        return !selectedFile;
      case 'message':
        return !message.trim();
      case 'assign':
        return !selectedDriver || !selectedVehicle;
      default:
        return true;
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card text-card-foreground border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div className="flex items-center gap-3">
            {getModalIcon()}
            <CardTitle className="text-xl text-foreground">
              {getModalTitle()}
            </CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon className="w-5 h-5" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm font-medium text-foreground mb-1">
              {isRTL ? 'المنشأة:' : 'Facility:'} {alert.facility}
            </p>
            <p className="text-xs text-muted-foreground">
              {isRTL ? alert.issue : alert.issueEn}
            </p>
          </div>

          {renderContent()}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              {isRTL ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitDisabled()}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isRTL ? 'إرسال' : 'Submit'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
