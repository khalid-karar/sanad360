import { useAuthStore } from '../../stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, ComposedChart, Legend, PieChart, Pie, Cell
} from 'recharts';
import { Separator } from '@/components/ui/separator';
import FadeInUp from '../animations/FadeInUp';

// Mock data for Waste Volume Over Time
const wasteVolumeData = [
  { month: 'يناير', monthEn: 'Jan', totalWaste: 1200, organic: 500, plastic: 300, other: 400, target: 1300 },
  { month: 'فبراير', monthEn: 'Feb', totalWaste: 1400, organic: 600, plastic: 400, other: 400, target: 1300 },
  { month: 'مارس', monthEn: 'Mar', totalWaste: 1100, organic: 450, plastic: 250, other: 400, target: 1300 },
  { month: 'أبريل', monthEn: 'Apr', totalWaste: 1600, organic: 700, plastic: 500, other: 400, target: 1300 },
  { month: 'مايو', monthEn: 'May', totalWaste: 1350, organic: 550, plastic: 350, other: 450, target: 1300 },
  { month: 'يونيو', monthEn: 'Jun', totalWaste: 1500, organic: 650, plastic: 450, other: 400, target: 1300 },
];

// Mock data for Waste Composition
const wasteCompositionData = [
  { name: 'نفايات عضوية', nameEn: 'Organic Waste', value: 3350, color: 'hsl(var(--success))' },
  { name: 'نفايات بلاستيكية', nameEn: 'Plastic Waste', value: 2250, color: 'hsl(var(--secondary))' },
  { name: 'نفايات أخرى', nameEn: 'Other Waste', value: 2450, color: 'hsl(var(--muted-foreground))' },
];

export default function WastePerformance() {
  const { isRTL } = useAuthStore();

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card p-3 border border-border rounded-lg shadow-md text-sm">
          <p className="font-bold text-foreground mb-1">{isRTL ? `الشهر: ${label}` : `Month: ${payload[0].payload.monthEn}`}</p>
          {payload.map((entry: any, index: number) => (
            <p key={`item-${index}`} style={{ color: entry.color }}>
              {isRTL ? entry.name : entry.nameEn || entry.name}: {entry.value} كجم
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const PieCustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-card p-3 border border-border rounded-lg shadow-md text-sm">
          <p className="font-bold text-foreground mb-1" style={{ color: data.color }}>
            {isRTL ? data.name : data.nameEn}
          </p>
          <p className="text-muted-foreground">{data.value} كجم</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="bg-card text-card-foreground border-border">
      <CardHeader>
        <CardTitle className="text-foreground">
          {isRTL ? 'أداء إدارة النفايات' : 'Waste Performance'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Waste Volume Over Time with Target */}
        <FadeInUp delay={0.1}>
          <h3 className="text-lg font-semibold text-foreground mb-4">
            {isRTL ? 'حجم النفايات الشهري (كجم)' : 'Monthly Waste Volume (kg)'}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={wasteVolumeData}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey={isRTL ? "month" : "monthEn"} stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="totalWaste" name={isRTL ? "إجمالي النفايات" : "Total Waste"} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="target" name={isRTL ? "الهدف" : "Target"} stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </FadeInUp>

        <Separator className="bg-border" />

        {/* Waste Composition */}
        <FadeInUp delay={0.2}>
          <h3 className="text-lg font-semibold text-foreground mb-4">
            {isRTL ? 'تركيب النفايات حسب النوع' : 'Waste Composition by Type'}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={wasteCompositionData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
                nameKey={isRTL ? "name" : "nameEn"}
                label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
              >
                {wasteCompositionData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<PieCustomTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </FadeInUp>
      </CardContent>
    </Card>
  );
}
