import { useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function ComplianceMap() {
  const { isRTL } = useAuthStore();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([23.8859, 45.0792], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const cities = [
      { name: 'الرياض', coords: [24.7136, 46.6753], compliance: 92 },
      { name: 'جدة', coords: [21.4858, 39.1925], compliance: 85 },
      { name: 'الدمام', coords: [26.4207, 50.0888], compliance: 78 },
      { name: 'مكة', coords: [21.3891, 39.8579], compliance: 88 },
      { name: 'المدينة', coords: [24.5247, 39.5692], compliance: 90 },
    ];

    cities.forEach((city) => {
      // CP7 design-system pass: these were raw hex (#22C55E/#F59E0B/#EF4444)
      // matching NOTHING in the token file — a coincidental near-match to
      // success/warning/destructive at best. `hsl(var(--x))` is a valid CSS
      // color string Leaflet's SVG path renderer accepts directly (it sets
      // it as the path's style.fill/stroke, which resolves CSS custom
      // properties same as any other CSS), so the map now tracks the actual
      // theme tokens instead of a frozen copy of them.
      const color =
        city.compliance >= 90 ? 'hsl(var(--success))'
        : city.compliance >= 80 ? 'hsl(var(--warning))'
        : 'hsl(var(--destructive))';

      L.circleMarker(city.coords as [number, number], {
        radius: 12,
        fillColor: color,
        // Fixed white border regardless of theme — a map tile layer is
        // always light, independent of the app's light/dark mode, so a
        // theme-reactive border would look wrong against it either way.
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.7,
      })
        .addTo(map)
        .bindPopup(`<b>${city.name}</b><br/>الامتثال: ${city.compliance}%`);
    });

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <Card className="bg-card text-card-foreground border-border">
      <CardHeader>
        <CardTitle className="text-foreground">
          {isRTL ? 'خريطة الامتثال الوطنية' : 'National Compliance Map'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={mapRef} className="h-[500px] rounded-lg overflow-hidden" />
      </CardContent>
    </Card>
  );
}
