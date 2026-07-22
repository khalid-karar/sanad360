import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { listAllCompanies } from '../../lib/api/admin';
import type { Company as DbCompany } from '../../lib/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon, Building2Icon } from 'lucide-react';
import OnboardCompanyForm from './OnboardCompanyForm';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

interface Company {
  id: string;
  name: string;
  lastSubmission: string;
  status: 'low' | 'medium' | 'high';
}

export default function CompaniesTable() {
  const { isRTL } = useAuthStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showOnboard, setShowOnboard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadCompanies = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listAllCompanies()
      .then((rows: DbCompany[]) =>
        setCompanies(
          rows.map((c) => ({
            id: c.id,
            name: isRTL ? c.name_ar : (c.name_en ?? c.name_ar),
            lastSubmission: new Date(c.created_at).toISOString().slice(0, 10),
            status: 'low' as const,
          }))
        )
      )
      .catch((err) => {
        setCompanies([]);
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, [isRTL]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

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
      {showOnboard && (
        <OnboardCompanyForm
          onClose={() => setShowOnboard(false)}
          onSuccess={() => loadCompanies()}
        />
      )}
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-foreground">
          {isRTL ? 'المنشآت المسجلة' : 'Registered Companies'}
        </CardTitle>
        {/* This one button onboards EITHER tenant type — the modal has a
            "Tenant Type" radio (Company / Transport Company) at the top.
            Renamed from "Add Company" because that hid the transport-company
            path entirely. */}
        <Button onClick={() => setShowOnboard(true)} className="gap-2">
          <PlusIcon className="w-4 h-4" />
          {isRTL ? 'إضافة منشأة / ناقل' : 'Add Company / Transporter'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <SearchIcon className="absolute start-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="text"
            aria-label={isRTL ? 'البحث عن منشأة' : 'Search companies'}
            placeholder={isRTL ? 'البحث عن منشأة...' : 'Search companies...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="ps-10 bg-background text-foreground border-input"
          />
        </div>

        {loading ? (
          <LoadingState label={isRTL ? 'جارٍ التحميل' : 'Loading'} />
        ) : loadError ? (
          <ErrorState message={loadError} retry={loadCompanies} retryLabel={isRTL ? 'إعادة المحاولة' : 'Retry'} />
        ) : filteredCompanies.length === 0 ? (
          <EmptyState
            icon={<Building2Icon />}
            title={isRTL ? 'لا توجد منشآت' : 'No companies'}
            hint={searchTerm ? (isRTL ? 'جرّب كلمة بحث مختلفة' : 'Try a different search term') : undefined}
          />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-start p-3 text-sm font-medium text-muted-foreground">
                  {isRTL ? 'اسم المنشأة' : 'Company Name'}
                </th>
                <th className="text-start p-3 text-sm font-medium text-muted-foreground">
                  {isRTL ? 'آخر تقديم' : 'Last Submission'}
                </th>
                <th className="text-start p-3 text-sm font-medium text-muted-foreground">
                  {isRTL ? 'الحالة' : 'Status'}
                </th>
                <th className="text-start p-3 text-sm font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((company) => {
                const isExpanded = expandedRow === company.id;
                const toggle = () => setExpandedRow(isExpanded ? null : company.id);
                return (
                <>
                  <tr
                    key={company.id}
                    className="border-b border-border hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                    onClick={toggle}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
                    }}
                  >
                    <td className="p-3 text-sm text-foreground">{company.name}</td>
                    <td className="p-3 text-sm text-foreground">{company.lastSubmission}</td>
                    <td className={`p-3 text-sm font-medium ${getStatusColor(company.status)}`}>
                      {getStatusLabel(company.status)}
                    </td>
                    <td className="p-3 text-sm text-foreground">
                      {isExpanded ? (
                        <ChevronUpIcon className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <ChevronDownIcon className="w-4 h-4" aria-hidden="true" />
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={4} className="p-6 bg-muted">
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
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
