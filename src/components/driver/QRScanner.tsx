import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QrCodeIcon, KeyboardIcon } from 'lucide-react';

const QR_ELEMENT_ID = 'tadweer-qr-reader';

export default function QRScanner() {
  const { isRTL } = useAuthStore();
  const { updateManifestData, setPickupState } = useDriverStore();

  const [scannerReady, setScannerReady] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [showManual, setShowManual] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    // Small delay so the DOM element is mounted before Html5Qrcode tries to find it
    const timer = setTimeout(() => {
      const scanner = new Html5Qrcode(QR_ELEMENT_ID, { verbose: false });
      scannerRef.current = scanner;

      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            handleResult(decodedText);
          },
          () => {
            // scan error (frame without QR) — ignore, not a failure
          }
        )
        .then(() => setScannerReady(true))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setScanError(msg);
          setShowManual(true);
        });
    }, 100);

    return () => {
      clearTimeout(timer);
      try {
        scannerRef.current?.stop().catch(() => null);
      } catch {
        /* scanner was never running */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Html5Qrcode.stop() THROWS SYNCHRONOUSLY when the scanner never started
  // (camera denied/absent — precisely the field case where manual entry is
  // used). A bare .catch() only covers the async path, so the sync throw was
  // killing the state transition and dead-ending the flow. Always advance.
  const stopScannerSafely = () => {
    try {
      scannerRef.current?.stop().catch(() => null);
    } catch {
      /* scanner was never running — nothing to stop */
    }
  };

  const handleResult = (code: string) => {
    stopScannerSafely();
    updateManifestData({ qr_code_value: code });
    setPickupState('geolocation-verified');
  };

  const handleManualSubmit = () => {
    if (!manualCode.trim()) return;
    handleResult(manualCode.trim());
  };

  const handleSkip = () => {
    stopScannerSafely();
    // qr_code_value stays undefined — allowed; geofence_verified will be false
    setPickupState('geolocation-verified');
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          {isRTL ? 'مسح رمز QR' : 'Scan QR Code'}
        </h1>
        <p className="text-muted-foreground">
          {isRTL
            ? 'امسح رمز QR الموجود على لوحة المنشأة لتأكيد موقعك'
            : 'Scan the QR code at the facility board to confirm your location'}
        </p>
      </div>

      {!showManual && (
        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <QrCodeIcon className="w-5 h-5 text-primary" />
              {isRTL ? 'الكاميرا' : 'Camera'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* html5-qrcode mounts the video feed into this div */}
            <div
              id={QR_ELEMENT_ID}
              className="w-full rounded-lg overflow-hidden bg-muted"
              style={{ minHeight: 300 }}
            />
            {!scannerReady && !scanError && (
              <p className="text-sm text-muted-foreground text-center mt-4">
                {isRTL ? 'جارٍ تشغيل الكاميرا...' : 'Starting camera...'}
              </p>
            )}
            {scanError && (
              <p className="text-sm text-destructive text-center mt-4">
                {isRTL ? 'تعذّر تشغيل الكاميرا.' : 'Could not start camera.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Manual entry fallback */}
      {showManual && (
        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <KeyboardIcon className="w-5 h-5 text-primary" />
              {isRTL ? 'إدخال الرمز يدوياً' : 'Enter Code Manually'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-foreground">
                {isRTL ? 'رمز المنشأة' : 'Facility Code'}
              </Label>
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder={isRTL ? 'أدخل الرمز...' : 'Enter code...'}
                className="bg-background text-foreground border-input"
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              />
            </div>
            <Button
              onClick={handleManualSubmit}
              disabled={!manualCode.trim()}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isRTL ? 'تأكيد' : 'Confirm'}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        {!showManual && (
          <Button
            variant="outline"
            onClick={() => setShowManual(true)}
            className="flex-1 bg-background text-foreground border-border hover:bg-accent"
          >
            <KeyboardIcon className="w-4 h-4 me-2" />
            {isRTL ? 'إدخال يدوي' : 'Manual Entry'}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={handleSkip}
          className="flex-1 bg-background text-muted-foreground border-border hover:bg-accent"
        >
          {isRTL ? 'تخطي (بدون QR)' : 'Skip (No QR)'}
        </Button>
      </div>
    </div>
  );
}
