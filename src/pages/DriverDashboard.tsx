import { useAuthStore } from '../stores/authStore';
import { useDriverStore } from '../stores/driverStore';
import AppShell from '../components/AppShell';
import AwaitingPickup from '../components/driver/AwaitingPickup';
import QRScanner from '../components/driver/QRScanner';
import GeolocationVerified from '../components/driver/GeolocationVerified';
import DigitalManifest from '../components/driver/DigitalManifest';
import SignaturePad from '../components/driver/SignaturePad';
import PickupConfirmation from '../components/driver/PickupConfirmation';
import FlowStepper from '../components/driver/FlowStepper';
import RestrictionBanner from '../components/documents/RestrictionBanner';

export default function DriverDashboard() {
  const { isRTL, user } = useAuthStore();
  const { pickupState } = useDriverStore();

  const renderContent = () => {
    switch (pickupState) {
      case 'awaiting':            return <AwaitingPickup />;
      case 'qr-scan':             return <QRScanner />;
      case 'geolocation-verified':return <GeolocationVerified />;
      case 'manifest':            return <DigitalManifest />;
      case 'signature':           return <SignaturePad />;
      case 'confirmation':        return <PickupConfirmation />;
      default:                    return <AwaitingPickup />;
    }
  };

  return (
    <AppShell role="driver">
      <div className={isRTL ? 'rtl' : 'ltr'}>
        {user?.driver_record_id && (
          <div className="mb-4">
            <RestrictionBanner ownerType="driver" ownerId={user.driver_record_id} isRTL={isRTL} />
          </div>
        )}
        {/* Field flow progress — glanceable "step N of 5" (P1-2) */}
        <FlowStepper current={pickupState} />
        {renderContent()}
      </div>
    </AppShell>
  );
}
