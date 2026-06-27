import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTransportStore, PickupRecord } from '../stores/transportStore';
import AppShell from '../components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  SearchIcon, 
  CalendarIcon, 
  TruckIcon,
  UserIcon,
  WeightIcon,
  Trash2Icon,
  FilterIcon,
  DownloadIcon,
  EyeIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  XCircleIcon
} from 'lucide-react';

// Mock data for pickup records
const mockPickupRecords: PickupRecord[] = [
  {
    id: '1',
    date: '2024-03-15',
    facility: 'مطعم النجمة',
    driver: 'أحمد محمد',
    vehicle: 'ABC-1234',
    wasteType: 'نفايات عضوية',
    weight: '45 كجم',
    complianceStatus: 'compliant'
  },
  {
    id: '2',
    date: '2024-03-15',
    facility: 'مستشفى الأمل',
    driver: 'خالد عبدالله',
    vehicle: 'XYZ-5678',
    wasteType: 'نفايات طبية',
    weight: '23 كجم',
    complianceStatus: 'warning'
  },
  {
    id: '3',
    date: '2024-03-14',
    facility: 'شركة الخليج للصناعات',
    driver: 'محمد سعيد',
    vehicle: 'DEF-9012',
    wasteType: 'نفايات صناعية',
    weight: '120 كجم',
    complianceStatus: 'compliant'
  },
  {
    id: '4',
    date: '2024-03-14',
    facility: 'مصنع الرياض للمعادن',
    driver: 'أحمد محمد',
    vehicle: 'ABC-1234',
    wasteType: 'نفايات معدنية',
    weight: '89 كجم',
    complianceStatus: 'non-compliant'
  },
  {
    id: '5',
    date: '2024-03-13',
    facility: 'شركة جدة للإلكترونيات',
    driver: 'خالد عبدالله',
    vehicle: 'GHI-3456',
    wasteType: 'نفايات إلكترونية',
    weight: '67 كجم',
    complianceStatus: 'compliant'
  },
  {
    id: '6',
    date: '2024-03-13',
    facility: 'مطعم الأصالة',
    driver: 'محمد سعيد',
    vehicle: 'JKL-7890',
    wasteType: 'نفايات عضوية',
    weight: '34 كجم',
    complianceStatus: 'warning'
  },
  {
    id: '7',
    date: '2024-03-12',
    facility: 'مستشفى الملك فهد',
    driver: 'أحمد محمد',
    vehicle: 'XYZ-5678',
    wasteType: 'نفايات طبية',
    weight: '56 كجم',
    complianceStatus: 'compliant'
  },
  {
    id: '8',
    date: '2024-03-12',
    facility: 'شركة البتروكيماويات',
    driver: 'خالد عبدالله',
    vehicle: 'MNO-2468',
    wasteType: 'نفايات كيميائية',
    weight: '78 كجم',
    complianceStatus: 'non-compliant'
  }
];

export default function PickupLogPage() {
  const { isRTL } = useAuthStore();
  const { drivers, vehicles } = useTransportStore();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedDriver, setSelectedDriver] = useState('all');
  const [selectedVehicle, setSelectedVehicle] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedWasteType, setSelectedWasteType] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  // Filter records based on all criteria
  const filteredRecords = mockPickupRecords.filter(record => {
    const matchesSearch = record.facility.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.driver.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.vehicle.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesDateFrom = !dateFrom || record.date >= dateFrom;
    const matchesDateTo = !dateTo || record.date <= dateTo;
    const matchesDriver = selectedDriver === 'all' || record.driver === selectedDriver;
    const matchesVehicle = selectedVehicle === 'all' || record.vehicle === selectedVehicle;
    const matchesStatus = selectedStatus === 'all' || record.complianceStatus === selectedStatus;
    const matchesWasteType = selectedWasteType === 'all' || record.wasteType.includes(selectedWasteType);

    return matchesSearch && matchesDateFrom && matchesDateTo && 
           matchesDriver && matchesVehicle && matchesStatus && matchesWasteType;
  });

  const getStatusBadge = (status: PickupRecord['complianceStatus']) => {
    const config = {
      compliant: {
        variant: 'default' as const,
        label: isRTL ? 'متوافق' : 'Compliant',
        icon: CheckCircle2Icon,
        color: 'text-success'
      },
      warning: {
        variant: 'secondary' as const,
        label: isRTL ? 'تحذير' : 'Warning',
        icon: AlertTriangleIcon,
        color: 'text-warning'
      },
      'non-compliant': {
        variant: 'destructive' as const,
        label: isRTL ? 'غير متوافق' : 'Non-Compliant',
        icon: XCircleIcon,
        color: 'text-destructive'
      }
    };

    const { variant, label, icon: Icon, color } = config[status];
    
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </Badge>
    );
  };

  const getWasteTypeColor = (wasteType: string) => {
    if (wasteType.includes('طبية') || wasteType.includes('Medical')) return 'text-red-600';
    if (wasteType.includes('كيميائية') || wasteType.includes('Chemical')) return 'text-orange-600';
    if (wasteType.includes('صناعية') || wasteType.includes('Industrial')) return 'text-blue-600';
    if (wasteType.includes('إلكترونية') || wasteType.includes('Electronic')) return 'text-purple-600';
    if (wasteType.includes('عضوية') || wasteType.includes('Organic')) return 'text-green-600';
    return 'text-gray-600';
  };

  const clearFilters = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setSelectedDriver('all');
    setSelectedVehicle('all');
    setSelectedStatus('all');
    setSelectedWasteType('all');
  };

  const exportData = () => {
    // Mock export functionality
    const csvContent = filteredRecords.map(record => 
      `${record.date},${record.facility},${record.driver},${record.vehicle},${record.wasteType},${record.weight},${record.complianceStatus}`
    ).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pickup-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const uniqueDrivers = [...new Set(mockPickupRecords.map(r => r.driver))];
  const uniqueVehicles = [...new Set(mockPickupRecords.map(r => r.vehicle))];
  const uniqueWasteTypes = [...new Set(mockPickupRecords.map(r => r.wasteType))];

  return (
    <AppShell role="transport">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {isRTL ? 'سجل الالتقاطات' : 'Pickup Log'}
            </h1>
            <p className="text-muted-foreground">
              {isRTL ? 'تتبع وإدارة جميع عمليات الالتقاط' : 'Track and manage all pickup operations'}
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground"
            >
              <FilterIcon className="w-4 h-4 mr-2" />
              {isRTL ? 'المرشحات' : 'Filters'}
            </Button>
            <Button
              onClick={exportData}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <DownloadIcon className="w-4 h-4 mr-2" />
              {isRTL ? 'تصدير' : 'Export'}
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <Card className="bg-card text-card-foreground border-border">
          <CardContent className="pt-6">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={isRTL ? 'البحث في السجلات...' : 'Search records...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-background text-foreground border-input"
              />
            </div>
          </CardContent>
        </Card>

        {/* Advanced Filters */}
        {showFilters && (
          <Card className="bg-card text-card-foreground border-border border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-3">
                <FilterIcon className="w-6 h-6 text-primary" />
                {isRTL ? 'المرشحات المتقدمة' : 'Advanced Filters'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label className="text-foreground">{isRTL ? 'من تاريخ' : 'Date From'}</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label className="text-foreground">{isRTL ? 'إلى تاريخ' : 'Date To'}</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label className="text-foreground">{isRTL ? 'السائق' : 'Driver'}</Label>
                  <Select value={selectedDriver} onValueChange={setSelectedDriver}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder={isRTL ? 'جميع السائقين' : 'All Drivers'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{isRTL ? 'جميع السائقين' : 'All Drivers'}</SelectItem>
                      {uniqueDrivers.map((driver) => (
                        <SelectItem key={driver} value={driver}>{driver}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground">{isRTL ? 'المركبة' : 'Vehicle'}</Label>
                  <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder={isRTL ? 'جميع المركبات' : 'All Vehicles'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{isRTL ? 'جميع المركبات' : 'All Vehicles'}</SelectItem>
                      {uniqueVehicles.map((vehicle) => (
                        <SelectItem key={vehicle} value={vehicle}>{vehicle}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground">{isRTL ? 'حالة الامتثال' : 'Compliance Status'}</Label>
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder={isRTL ? 'جميع الحالات' : 'All Statuses'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{isRTL ? 'جميع الحالات' : 'All Statuses'}</SelectItem>
                      <SelectItem value="compliant">{isRTL ? 'متوافق' : 'Compliant'}</SelectItem>
                      <SelectItem value="warning">{isRTL ? 'تحذير' : 'Warning'}</SelectItem>
                      <SelectItem value="non-compliant">{isRTL ? 'غير متوافق' : 'Non-Compliant'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground">{isRTL ? 'نوع النفايات' : 'Waste Type'}</Label>
                  <Select value={selectedWasteType} onValueChange={setSelectedWasteType}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder={isRTL ? 'جميع الأنواع' : 'All Types'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{isRTL ? 'جميع الأنواع' : 'All Types'}</SelectItem>
                      {uniqueWasteTypes.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="flex-1"
                >
                  {isRTL ? 'مسح المرشحات' : 'Clear Filters'}
                </Button>
                <Button
                  onClick={() => setShowFilters(false)}
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isRTL ? 'تطبيق المرشحات' : 'Apply Filters'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{isRTL ? 'إجمالي الالتقاطات' : 'Total Pickups'}</p>
                  <p className="text-2xl font-bold text-foreground">{filteredRecords.length}</p>
                </div>
                <CalendarIcon className="w-8 h-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{isRTL ? 'متوافقة' : 'Compliant'}</p>
                  <p className="text-2xl font-bold text-success">
                    {filteredRecords.filter(r => r.complianceStatus === 'compliant').length}
                  </p>
                </div>
                <CheckCircle2Icon className="w-8 h-8 text-success" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{isRTL ? 'تحذيرات' : 'Warnings'}</p>
                  <p className="text-2xl font-bold text-warning">
                    {filteredRecords.filter(r => r.complianceStatus === 'warning').length}
                  </p>
                </div>
                <AlertTriangleIcon className="w-8 h-8 text-warning" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{isRTL ? 'غير متوافقة' : 'Non-Compliant'}</p>
                  <p className="text-2xl font-bold text-destructive">
                    {filteredRecords.filter(r => r.complianceStatus === 'non-compliant').length}
                  </p>
                </div>
                <XCircleIcon className="w-8 h-8 text-destructive" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Records Table */}
        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle className="text-foreground">
              {isRTL ? 'سجل الالتقاطات' : 'Pickup Records'} ({filteredRecords.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-4">
              <div className="space-y-4">
                {filteredRecords.map((record) => (
                  <Card
                    key={record.id}
                    className={`border-2 ${
                      record.complianceStatus === 'compliant' 
                        ? 'bg-success/5 border-success/20'
                        : record.complianceStatus === 'warning'
                        ? 'bg-warning/5 border-warning/20'
                        : 'bg-destructive/5 border-destructive/20'
                    }`}
                  >
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                            <CalendarIcon className="w-6 h-6 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground text-lg">{record.facility}</h3>
                            <p className="text-sm text-muted-foreground">{record.date}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          {getStatusBadge(record.complianceStatus)}
                          <Button size="sm" variant="outline">
                            <EyeIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="flex items-center gap-2">
                          <UserIcon className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              {isRTL ? 'السائق' : 'Driver'}
                            </p>
                            <p className="text-sm font-medium text-foreground">{record.driver}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <TruckIcon className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              {isRTL ? 'المركبة' : 'Vehicle'}
                            </p>
                            <p className="text-sm font-medium text-foreground">{record.vehicle}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Trash2Icon className={`w-4 h-4 ${getWasteTypeColor(record.wasteType)}`} />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              {isRTL ? 'نوع النفايات' : 'Waste Type'}
                            </p>
                            <p className={`text-sm font-medium ${getWasteTypeColor(record.wasteType)}`}>
                              {record.wasteType}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <WeightIcon className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              {isRTL ? 'الوزن' : 'Weight'}
                            </p>
                            <p className="text-sm font-medium text-foreground">{record.weight}</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                
                {filteredRecords.length === 0 && (
                  <div className="text-center py-12">
                    <CalendarIcon className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">
                      {isRTL ? 'لا توجد سجلات' : 'No Records Found'}
                    </h3>
                    <p className="text-muted-foreground">
                      {isRTL ? 'لم يتم العثور على سجلات تطابق المعايير المحددة' : 'No records match the specified criteria'}
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
