import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  lastSubmission: string;
  riskScore: number;
  status: 'low' | 'medium' | 'high';
}

const companies: Company[] = [
  { id: '1', name: 'شركة النخيل للصناعات', lastSubmission: '2024-01-15', riskScore: 92, status: 'low' },
  { id: '2', name: 'مصنع الخليج للبلاستيك', lastSubmission: '2024-01-14', riskScore: 85, status: 'low' },
  { id: '3', name: 'شركة الصحراء للكيماويات', lastSubmission: '2024-01-10', riskScore: 78, status: 'medium' },
  { id: '4', name: 'مصنع الرياض للمعادن', lastSubmission: '2024-01-08', riskScore: 65, status: 'high' },
  { id: '5', name: 'شركة جدة للإلكترونيات', lastSubmission: '2024-01-13', riskScore: 88, status: 'low' },
];

export default function CompaniesTable() {
  const { isRTL } = useAuthStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const filteredCompanies = companies.filter((company) =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'low':
        return 'text-success';
      case 'medium':
        return 'text-warning';
      case 'high':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusLabel = (status: string) => {
    if (!isRTL) {
      return status.charAt(0).toUpperCase() + status.slice(1);
    }
    switch (status) {
      case 'low':
        return 'منخفض';
      case 'medium':
        return 'متوسط';
      case 'high':
        return 'عالي';
      default:
        return '';
    }
  };

  return (
    <Card className="bg-card text-card-foreground border-border">
      <CardHeader>
        <CardTitle className="text-foreground">
          {isRTL ? 'المنشآت المسجلة' : 'Registered Companies'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={isRTL ? 'البحث عن منشأة...' : 'Search companies...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-background text-foreground border-input"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                  {isRTL ? 'اسم المنشأة' : 'Company Name'}
                </th>
                <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                  {isRTL ? 'آخر تقديم' : 'Last Submission'}
                </th>
                <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                  {isRTL ? 'درجة المخاطر' : 'Risk Score'}
                </th>
                <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                  {isRTL ? 'الحالة' : 'Status'}
                </th>
                <th className="text-right p-3 text-sm font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((company) => (
                <>
                  <tr
                    key={company.id}
                    className="border-b border-border hover:bg-accent cursor-pointer"
                    onClick={() =>
                      setExpandedRow(expandedRow === company.id ? null : company.id)
                    }
                  >
                    <td className="p-3 text-sm text-foreground">{company.name}</td>
                    <td className="p-3 text-sm text-foreground">{company.lastSubmission}</td>
                    <td className="p-3 text-sm text-foreground">{company.riskScore}</td>
                    <td className={`p-3 text-sm font-medium ${getStatusColor(company.status)}`}>
                      {getStatusLabel(company.status)}
                    </td>
                    <td className="p-3 text-sm text-foreground">
                      {expandedRow === company.id ? (
                        <ChevronUpIcon className="w-4 h-4" />
                      ) : (
                        <ChevronDownIcon className="w-4 h-4" />
                      )}
                    </td>
                  </tr>
                  {expandedRow === company.id && (
                    <tr>
                      <td colSpan={5} className="p-6 bg-muted">
                        <div className="space-y-3">
                          <p className="text-sm text-foreground">
                            <strong>{isRTL ? 'معرف المنشأة:' : 'Company ID:'}</strong> {company.id}
                          </p>
                          <p className="text-sm text-foreground">
                            <strong>{isRTL ? 'تاريخ التسجيل:' : 'Registration Date:'}</strong> 2023-06-15
                          </p>
                          <p className="text-sm text-foreground">
                            <strong>{isRTL ? 'عدد البيانات المقدمة:' : 'Total Manifests:'}</strong> 156
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground"
                          >
                            {isRTL ? 'عرض التفاصيل الكاملة' : 'View Full Details'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
