import { useAuthStore } from '../../stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangleIcon, TrendingUpIcon, CalendarIcon } from 'lucide-react';

interface TransportKPIsProps {
  pendingTasks: number;
  complianceRate: number;
  todayPickups: { planned: number; completed: number };
}

export default function TransportKPIs({ pendingTasks, complianceRate, todayPickups }: TransportKPIsProps) {
  const { isRTL } = useAuthStore();

  const kpis = [
    {
      title: isRTL ? 'المهام العالقة' : 'Pending Tasks',
      value: pendingTasks.toString(),
      icon: AlertTriangleIcon,
      color: pendingTasks > 0 ? 'text-warning' : 'text-success',
      bgColor: pendingTasks > 0 ? 'bg-warning/5 border-warning/20' : 'bg-success/5 border-success/20',
    },
    {
      title: isRTL ? 'معدل الامتثال' : 'Compliance Rate',
      value: `${complianceRate}%`,
      icon: TrendingUpIcon,
      color: complianceRate >= 90 ? 'text-success' : complianceRate >= 80 ? 'text-warning' : 'text-destructive',
      bgColor: complianceRate >= 90 ? 'bg-success/5 border-success/20' : complianceRate >= 80 ? 'bg-warning/5 border-warning/20' : 'bg-destructive/5 border-destructive/20',
    },
    {
      title: isRTL ? 'الالتقاطات اليوم' : 'Pickups Today',
      value: `${todayPickups.completed}/${todayPickups.planned}`,
      icon: CalendarIcon,
      color: 'text-primary',
      bgColor: 'bg-primary/5 border-primary/20',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {kpis.map((kpi) => (
        <Card key={kpi.title} className={`border-2 ${kpi.bgColor}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {kpi.title}
            </CardTitle>
            <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
