import { useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ReceiptIcon, CheckIcon } from 'lucide-react';
import CameraCapture from '../camera/CameraCapture';

const wasteTypes = [
  { id: 'industrial', labelAr: 'نفايات صناعية',   labelEn: 'Industrial Waste' },
  { id: 'plastic',    labelAr: 'نفايات بلاستيكية', labelEn: 'Plastic Waste'  },
  { id: 'chemical',   labelAr: 'نفايات كيميائية',  labelEn: 'Chemical Waste' },
  { id: 'organic',    labelAr: 'نفايات عضوية',     labelEn: 'Organic Waste'  },
  { id: 'electronic', labelAr: 'نفايات إلكترونية', labelEn: 'Electronic Waste'},
  { id: 'medical',    labelAr: 'نفايات طبية',      labelEn: 'Medical Waste'  },
];

export default function DigitalManifest() {
  const { isRTL } = useAuthStore();
  const { manifestData, updateManifestData, setPickupState } = useDriverStore();
  const [weight, setWeight] = useState('');

  const receiptInputRef = useRef<HTMLInputElement>(null);

  const toggleWasteType = (type: string) => {
    const current = manifestData.wasteType || [];
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    updateManifestData({ wasteType: updated });
  };

  const handleNumberInput = (num: string) => {
    if (num === 'clear') {
      setWeight('');
    } else if (num === 'backspace') {
      setWeight((prev) => prev.slice(0, -1));
    } else {
      // Prevent multiple decimal points
      if (num === '.' && weight.includes('.')) return;
      setWeight((prev) => prev + num);
    }
  };

  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) updateManifestData({ receiptFile: file });
  };

  const handleComplete = () => {
    // Plain numeric string — parsed with parseFloat() at submit time.
    updateManifestData({ weight });
    setPickupState('signature');
  };

  const canProceed = manifestData.wasteType?.length > 0 && weight !== '' && parseFloat(weight) > 0;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          {isRTL ? 'البيان الرقمي' : 'Digital Manifest'}
        </h1>
        <p className="text-muted-foreground">
          {isRTL ? 'أدخل تفاصيل الالتقاط' : 'Enter pickup details'}
        </p>
      </div>

      {/* Pickup info */}
      <Card className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle className="text-foreground">
            {isRTL ? 'معلومات الالتقاط' : 'Pickup Information'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label className="text-foreground">{isRTL ? 'التاريخ والوقت' : 'Date & Time'}</Label>
              <p className="text-sm text-muted-foreground mt-1">
                {new Date().toLocaleString(isRTL ? 'ar-SA' : 'en-GB')}
              </p>
            </div>
            <div className="col-span-2">
              <Label className="text-foreground">{isRTL ? 'الموقع' : 'Location'}</Label>
              <p className="text-sm text-muted-foreground mt-1">{manifestData.location}</p>
            </div>
            <div className="col-span-2">
              <Label className="text-foreground">{isRTL ? 'المنشأة' : 'Generator'}</Label>
              <p className="text-sm text-muted-foreground mt-1">{manifestData.generator}</p>
            </div>
            {manifestData.qr_code_value && (
              <div className="col-span-2">
                <Label className="text-foreground">{isRTL ? 'رمز QR' : 'QR Code'}</Label>
                <p className="text-sm text-muted-foreground mt-1 font-mono">{manifestData.qr_code_value}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Waste type */}
      <Card className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle className="text-foreground">
            {isRTL ? 'نوع النفايات' : 'Waste Type'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {wasteTypes.map((type) => (
              <Button
                key={type.id}
                variant={manifestData.wasteType?.includes(type.id) ? 'default' : 'outline'}
                onClick={() => toggleWasteType(type.id)}
                aria-pressed={manifestData.wasteType?.includes(type.id) ?? false}
                className={
                  manifestData.wasteType?.includes(type.id)
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground'
                }
              >
                {isRTL ? type.labelAr : type.labelEn}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Weight keypad */}
      <Card className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle className="text-foreground">
            {isRTL ? 'الوزن (كجم)' : 'Weight (kg)'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center p-6 bg-muted rounded-lg">
            <p className="text-4xl font-bold text-foreground" aria-live="polite">
              {weight || '0'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {['1','2','3','4','5','6','7','8','9','clear','0','backspace'].map((num) => (
              <Button
                key={num}
                variant="outline"
                onClick={() => handleNumberInput(num)}
                // Only the backspace key is icon-only (⌫, no accessible visible
                // text) — digits and "Clear" already render real text.
                aria-label={num === 'backspace' ? (isRTL ? 'حذف آخر رقم' : 'Backspace') : undefined}
                className="h-16 text-lg bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground"
              >
                {num === 'clear'
                  ? (isRTL ? 'مسح' : 'Clear')
                  : num === 'backspace' ? '⌫'
                  : num}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Evidence uploads */}
      <Card className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle className="text-foreground">
            {/* Honest framing: skipping evidence costs 25 risk points per item —
                never present it as harmless "optional" (P1-1). */}
            {isRTL ? 'الأدلة — تؤثر على درجة الامتثال' : 'Evidence — affects compliance score'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Photo — in-app camera capture only (no gallery), evidence integrity */}
          <CameraCapture
            isRTL={isRTL}
            label={isRTL ? 'التقاط صورة' : 'Take Photo'}
            capturedLabel={isRTL ? 'تم التقاط الصورة' : 'Photo captured'}
            capturedFile={manifestData.photoFile}
            onCapture={(file) => updateManifestData({ photoFile: file })}
            fileNameBase="pickup-photo"
          />

          {/* Scale display: evidences the typed weight (migration 016) */}
          <CameraCapture
            isRTL={isRTL}
            label={isRTL ? 'تصوير شاشة الميزان' : 'Photograph the Scale Display'}
            capturedLabel={isRTL ? 'تم تصوير الميزان' : 'Scale photo captured'}
            capturedFile={manifestData.scalePhotoFile}
            onCapture={(file) => updateManifestData({ scalePhotoFile: file })}
            fileNameBase="scale-photo"
          />

          {/* Receipt */}
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleReceiptChange}
          />
          <Button
            variant="outline"
            className={`w-full ${manifestData.receiptFile ? 'border-success text-success' : 'bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground'}`}
            onClick={() => receiptInputRef.current?.click()}
          >
            {manifestData.receiptFile
              ? <><CheckIcon className="w-4 h-4 me-2" />{isRTL ? 'تم رفع الإيصال' : 'Receipt uploaded'}</>
              : <><ReceiptIcon className="w-4 h-4 me-2" />{isRTL ? 'رفع إيصال' : 'Upload Receipt'}</>
            }
          </Button>
        </CardContent>
      </Card>

      {/* Field mode: the step's single primary action stays in the thumb zone,
          floating above the bottom nav — the driver never scrolls to proceed. */}
      <div className="sticky bottom-20 lg:bottom-4 z-30 bg-background/95 backdrop-blur-sm rounded-xl pt-2">
        <Button
          onClick={handleComplete}
          disabled={!canProceed}
          className="w-full h-12 text-base bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isRTL ? 'إكمال الالتقاط' : 'Complete Pickup'}
        </Button>
      </div>
    </div>
  );
}
