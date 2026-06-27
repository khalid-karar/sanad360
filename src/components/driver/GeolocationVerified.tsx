import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPinIcon, CheckCircle2Icon, AlertTriangleIcon, LoaderIcon } from 'lucide-react';

type GpsStatus = 'acquiring' | 'success' | 'error' | 'denied';

export default function GeolocationVerified() {
  const { isRTL } = useAuthStore();
  const { currentPickup, setPickupState, updateManifestData } = useDriverStore();

  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('acquiring');
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (currentPickup) {
      updateManifestData({
        location: currentPickup.address,
        generator: currentPickup.company,
      });
    }

    if (!navigator.geolocation) {
      setGpsStatus('error');
      setErrorMsg(isRTL ? 'المتصفح لا يدعم تحديد الموقع' : 'Browser does not support geolocation');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        setCoords({ lat, lng, accuracy });
        setGpsStatus('success');
        updateManifestData({
          gps_lat: lat,
          gps_lng: lng,
          gps_accuracy_m: accuracy,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus('denied');
          setErrorMsg(
            isRTL
              ? 'تم رفض إذن الموقع. يرجى السماح للتطبيق بالوصول إلى الموقع.'
              : 'Location permission denied. Please allow location access.'
          );
        } else {
          setGpsStatus('error');
          setErrorMsg(
            isRTL ? 'تعذّر الحصول على الموقع.' : 'Could not acquire location.'
          );
        }
        // Geofence will be computed as false server-side — allow the driver to continue
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContinue = () => setPickupState('manifest');

  const handleRetry = () => {
    setGpsStatus('acquiring');
    setErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        setCoords({ lat, lng, accuracy });
        setGpsStatus('success');
        updateManifestData({ gps_lat: lat, gps_lng: lng, gps_accuracy_m: accuracy });
      },
      () => {
        setGpsStatus('error');
        setErrorMsg(isRTL ? 'تعذّر الحصول على الموقع.' : 'Could not acquire location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Card className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-foreground">
            {isRTL ? 'التحقق من الموقع' : 'Location Verification'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Status icon */}
          <div className="flex justify-center">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center ${
              gpsStatus === 'success'
                ? 'bg-success/10'
                : gpsStatus === 'acquiring'
                ? 'bg-primary/10'
                : 'bg-destructive/10'
            }`}>
              {gpsStatus === 'acquiring' && (
                <LoaderIcon className="w-12 h-12 text-primary animate-spin" />
              )}
              {gpsStatus === 'success' && (
                <CheckCircle2Icon className="w-12 h-12 text-success" />
              )}
              {(gpsStatus === 'error' || gpsStatus === 'denied') && (
                <AlertTriangleIcon className="w-12 h-12 text-destructive" />
              )}
            </div>
          </div>

          {/* Facility info */}
          <div className="space-y-2 text-center">
            <div className="flex items-center justify-center gap-3">
              <MapPinIcon className="w-6 h-6 text-primary" />
              <p className="text-lg font-medium text-foreground">{currentPickup?.company}</p>
            </div>
            <p className="text-muted-foreground text-sm">{currentPickup?.address}</p>
          </div>

          {/* GPS result */}
          {gpsStatus === 'acquiring' && (
            <p className="text-center text-sm text-muted-foreground">
              {isRTL ? 'جارٍ الحصول على الموقع...' : 'Acquiring location...'}
            </p>
          )}
          {gpsStatus === 'success' && coords && (
            <div className="rounded-md bg-success/10 border border-success/20 p-3 text-sm text-center">
              <p className="text-success font-medium">
                {isRTL ? 'تم تحديد الموقع بنجاح' : 'Location acquired'}
              </p>
              <p className="text-muted-foreground mt-1" dir="ltr">
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                {' — '}±{Math.round(coords.accuracy)} m
              </p>
            </div>
          )}
          {(gpsStatus === 'error' || gpsStatus === 'denied') && errorMsg && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-center">
              <p className="text-destructive">{errorMsg}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {isRTL
                  ? 'سيتم تعيين التحقق من الموقع الجغرافي على "خطأ" في السجل'
                  : 'Geofence verification will be recorded as failed'}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {gpsStatus === 'error' && (
              <Button
                variant="outline"
                onClick={handleRetry}
                className="flex-1 bg-background text-foreground border-border hover:bg-accent"
              >
                {isRTL ? 'إعادة المحاولة' : 'Retry'}
              </Button>
            )}
            <Button
              onClick={handleContinue}
              disabled={gpsStatus === 'acquiring'}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isRTL ? 'المتابعة إلى البيان الرقمي' : 'Continue to Digital Manifest'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
