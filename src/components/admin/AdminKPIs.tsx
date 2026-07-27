import { useAuthStore } from '../../stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2Icon, TrendingUpIcon, AlertTriangleIcon } from 'lucide-react';

export default function AdminKPIs() {
  const { isRTL } = useAuthStore();

  const kpis = [
    {
      title: isRTL ? 'إجمالي المنشآت' : 'Total Companies',
      value: '1,247',
      icon: Building2Icon,
      color: 'text-primary',
    },
    {
      title: isRTL ? 'الامتثال الوطني' : 'National Compliance',
      value: '87.3%',
      icon: TrendingUpIcon,
      color: 'text-success',
    },
    {
      title: isRTL ? 'تنبيهات عالية المخاطر' : 'High-Risk Alerts',
      value: '23',
      icon: AlertTriangleIcon,
      color: 'text-warning',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {kpis.map((kpi) => (
        <Card key={kpi.title} className="bg-card text-card-foreground border-border" role="group" aria-label={`${kpi.title}: ${kpi.value}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {kpi.title}
            </CardTitle>
            <kpi.icon className={`w-6 h-6 ${kpi.color}`} aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{kpi.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
