import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix the default marker icon (Leaflet + bundler issue: the CSS-referenced
// image URLs don't resolve through the bundler without this).
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Riyadh (Al-Olaya) — sensible default center for new branches.
const RIYADH: [number, number] = [24.6877, 46.6876];
const MIN_RADIUS = 50;
const MAX_RADIUS = 2000;
const RADIUS_STEP = 50;

interface GeofenceMapPickerProps {
  lat: number | null;
  lng: number | null;
  radiusM: number;
  onChange: (lat: number, lng: number, radiusM: number) => void;
  isRTL?: boolean;
}

export default function GeofenceMapPicker({
  lat,
  lng,
  radiusM,
  onChange,
  isRTL = false,
}: GeofenceMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  // Keep latest onChange without re-running the init effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const center: [number, number] =
      lat != null && lng != null ? [lat, lng] : RIYADH;

    const map = L.map(containerRef.current).setView(center, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker(center, { draggable: true }).addTo(map);
    const circle = L.circle(center, { radius: radiusM, color: '#16a34a', fillOpacity: 0.1 }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      circle.setLatLng(pos);
      onChangeRef.current(pos.lat, pos.lng, radiusMRef.current);
    });

    // Click on the map to reposition the marker.
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      circle.setLatLng(e.latlng);
      onChangeRef.current(e.latlng.lat, e.latlng.lng, radiusMRef.current);
    });

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    // Leaflet needs a size recalculation when rendered inside a freshly shown
    // container (e.g. a card that was display:none a tick ago).
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track radius in a ref so the marker/click handlers always read the latest.
  const radiusMRef = useRef(radiusM);
  radiusMRef.current = radiusM;

  // Redraw circle when radius changes.
  useEffect(() => {
    circleRef.current?.setRadius(radiusM);
  }, [radiusM]);

  // Sync marker/circle/center when lat/lng change from outside (e.g. manual inputs).
  useEffect(() => {
    if (lat == null || lng == null) return;
    const pos: [number, number] = [lat, lng];
    markerRef.current?.setLatLng(pos);
    circleRef.current?.setLatLng(pos);
    mapRef.current?.panTo(pos);
  }, [lat, lng]);

  const effLat = lat ?? RIYADH[0];
  const effLng = lng ?? RIYADH[1];

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div
        ref={containerRef}
        className="w-full h-72 rounded-xl overflow-hidden border border-border z-0"
        style={{ minHeight: '18rem' }}
      />

      <div>
        <label className="text-sm font-medium text-foreground">
          {isRTL ? 'نطاق الجيوفنس' : 'Geofence Radius'}: {radiusM}m
        </label>
        <input
          type="range"
          min={MIN_RADIUS}
          max={MAX_RADIUS}
          step={RADIUS_STEP}
          value={radiusM}
          onChange={(e) => onChange(effLat, effLng, Number(e.target.value))}
          className="w-full mt-2 accent-primary"
          dir="ltr"
        />
      </div>

      {/* Manual lat/lng fallback inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground">
            {isRTL ? 'خط العرض' : 'Latitude'}
          </label>
          <input
            type="number"
            step="any"
            value={lat ?? ''}
            onChange={(e) =>
              onChange(e.target.value ? Number(e.target.value) : effLat, effLng, radiusM)
            }
            className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            dir="ltr"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground">
            {isRTL ? 'خط الطول' : 'Longitude'}
          </label>
          <input
            type="number"
            step="any"
            value={lng ?? ''}
            onChange={(e) =>
              onChange(effLat, e.target.value ? Number(e.target.value) : effLng, radiusM)
            }
            className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            dir="ltr"
          />
        </div>
      </div>
    </div>
  );
}
