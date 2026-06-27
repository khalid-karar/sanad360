import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTransportStore, Vehicle } from '../stores/transportStore';
import AppShell from '../components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  PlusIcon, 
  SearchIcon, 
  TruckIcon, 
  CalendarIcon, 
  ShieldCheckIcon,
  AlertTriangleIcon,
  EditIcon,
  TrashIcon,
  FileTextIcon
} from 'lucide-react';

const vehicleTypes = [
  { value: 'small-truck', labelAr: 'شاحنة صغيرة', labelEn: 'Small Truck' },
  { value: 'medium-truck', labelAr: 'شاحنة متوسطة', labelEn: 'Medium Truck' },
  { value: 'large-truck', labelAr: 'شاحنة كبيرة', labelEn: 'Large Truck' },
  { value: 'specialized', labelAr: 'مركبة متخصصة', labelEn: 'Specialized Vehicle' },
];

const licenseTypes = [
  { value: 'general', labelAr: 'نفايات عامة', labelEn: 'General Waste' },
  { value: 'medical', labelAr: 'نفايات طبية', labelEn: 'Medical Waste' },
  { value: 'hazardous', labelAr: 'نفايات خطرة', labelEn: 'Hazardous Waste' },
  { value: 'industrial', labelAr: 'نفايات صناعية', labelEn: 'Industrial Waste' },
  { value: 'electronic', labelAr: 'نفايات إلكترونية', labelEn: 'Electronic Waste' },
];

export default function VehicleManagementPage() {
  const { isRTL } = useAuthStore();
  const { vehicles, addVehicle } = useTransportStore();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    plateNumber: '',
    type: '',
    licenseType: '',
    ncwmLicenseExpiry: '',
    status: 'active' as const
  });

  const filteredVehicles = vehicles.filter(vehicle =>
    vehicle.plateNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vehicle.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddVehicle = () => {
    if (!newVehicle.plateNumber || !newVehicle.type || !newVehicle.licenseType || !newVehicle.ncwmLicenseExpiry) {
      toast({
        title: isRTL ? 'خطأ' : 'Error',
        description: isRTL ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields',
        variant: 'destructive'
      });
      return;
    }

    // Convert values to Arabic labels for display
    const typeLabel = vehicleTypes.find(t => t.value === newVehicle.type)?.[isRTL ? 'labelAr' : 'labelEn'] || newVehicle.type;
    const licenseLabel = licenseTypes.find(l => l.value === newVehicle.licenseType)?.[isRTL ? 'labelAr' : 'labelEn'] || newVehicle.licenseType;

    addVehicle({
      ...newVehicle,
      type: typeLabel,
      licenseType: licenseLabel
    });

    setNewVehicle({
      plateNumber: '',
      type: '',
      licenseType: '',
      ncwmLicenseExpiry: '',
      status: 'active'
    });
    setShowAddForm(false);
    
    toast({
      title: isRTL ? 'تم بنجاح' : 'Success',
      description: isRTL ? 'تم إضافة المركبة بنجاح' : 'Vehicle added successfully'
    });
  };

  const getExpiryStatus = (expiryDate: string) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return { status: 'expired', color: 'destructive', days: Math.abs(daysUntilExpiry) };
    } else if (daysUntilExpiry <= 60) { // 60 days for vehicles vs 30 for drivers
      return { status: 'expiring', color: 'warning', days: daysUntilExpiry };
    }
    return { status: 'valid', color: 'success', days: daysUntilExpiry };
  };

  const getStatusBadge = (vehicle: Vehicle) => {
    const expiryStatus = getExpiryStatus(vehicle.ncwmLicenseExpiry);
    
    if (expiryStatus.status === 'expired') {
      return <Badge variant="destructive">{isRTL ? 'منتهية الصلاحية' : 'Expired'}</Badge>;
    } else if (expiryStatus.status === 'expiring') {
      return <Badge className="bg-warning text-warning-foreground">{isRTL ? `تنتهي خلال ${expiryStatus.days} يوم` : `Expires in ${expiryStatus.days} days`}</Badge>;
    }
    return <Badge variant="default">{isRTL ? 'صالحة' : 'Valid'}</Badge>;
  };

  const getLicenseTypeColor = (licenseType: string) => {
    if (licenseType.includes('طبية') || licenseType.includes('Medical')) return 'text-red-600';
    if (licenseType.includes('خطرة') || licenseType.includes('Hazardous')) return 'text-orange-600';
    if (licenseType.includes('صناعية') || licenseType.includes('Industrial')) return 'text-blue-600';
    if (licenseType.includes('إلكترونية') || licenseType.includes('Electronic')) return 'text-purple-600';
    return 'text-green-600';
  };

  return (
    <AppShell role="transport">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {isRTL ? 'إدارة المركبات' : 'Vehicle Management'}
            </h1>
            <p className="text-muted-foreground">
              {isRTL ? 'إدارة وتتبع المركبات وتراخيص NCWM' : 'Manage and track vehicles and NCWM licenses'}
            </p>
          </div>
          <Button
            onClick={() => setShowAddForm(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            {isRTL ? 'إضافة مركبة' : 'Add Vehicle'}
          </Button>
        </div>

        {/* Search Bar */}
        <Card className="bg-card text-card-foreground border-border">
          <CardContent className="pt-6">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={isRTL ? 'البحث عن مركبة...' : 'Search vehicles...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-background text-foreground border-input"
              />
            </div>
          </CardContent>
        </Card>

        {/* Add Vehicle Form */}
        {showAddForm && (
          <Card className="bg-card text-card-foreground border-border border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-3">
                <TruckIcon className="w-6 h-6 text-primary" />
                {isRTL ? 'إضافة مركبة جديدة' : 'Add New Vehicle'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-foreground">{isRTL ? 'رقم اللوحة' : 'Plate Number'}</Label>
                  <Input
                    value={newVehicle.plateNumber}
                    onChange={(e) => setNewVehicle({ ...newVehicle, plateNumber: e.target.value })}
                    placeholder={isRTL ? 'مثال: ABC-1234' : 'Example: ABC-1234'}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label className="text-foreground">{isRTL ? 'نوع المركبة' : 'Vehicle Type'}</Label>
                  <Select value={newVehicle.type} onValueChange={(value) => setNewVehicle({ ...newVehicle, type: value })}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder={isRTL ? 'اختر نوع المركبة' : 'Select vehicle type'} />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicleTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {isRTL ? type.labelAr : type.labelEn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground">{isRTL ? 'نوع ترخيص النفايات' : 'Waste License Type'}</Label>
                  <Select value={newVehicle.licenseType} onValueChange={(value) => setNewVehicle({ ...newVehicle, licenseType: value })}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder={isRTL ? 'اختر نوع الترخيص' : 'Select license type'} />
                    </SelectTrigger>
                    <SelectContent>
                      {licenseTypes.map((license) => (
                        <SelectItem key={license.value} value={license.value}>
                          {isRTL ? license.labelAr : license.labelEn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground">{isRTL ? 'تاريخ انتهاء ترخيص NCWM' : 'NCWM License Expiry'}</Label>
                  <Input
                    type="date"
                    value={newVehicle.ncwmLicenseExpiry}
                    onChange={(e) => setNewVehicle({ ...newVehicle, ncwmLicenseExpiry: e.target.value })}
                    className="mt-2"
                  />
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1"
                >
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button
                  onClick={handleAddVehicle}
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isRTL ? 'إضافة المركبة' : 'Add Vehicle'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Vehicles List */}
        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle className="text-foreground">
              {isRTL ? 'قائمة المركبات' : 'Vehicles List'} ({filteredVehicles.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-4">
              <div className="space-y-4">
                {filteredVehicles.map((vehicle) => {
                  const expiryStatus = getExpiryStatus(vehicle.ncwmLicenseExpiry);
                  
                  return (
                    <Card
                      key={vehicle.id}
                      className={`border-2 ${
                        expiryStatus.status === 'expired' 
                          ? 'bg-destructive/5 border-destructive/20'
                          : expiryStatus.status === 'expiring'
                          ? 'bg-warning/5 border-warning/20'
                          : 'bg-success/5 border-success/20'
                      }`}
                    >
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                              <TruckIcon className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-foreground text-lg">{vehicle.plateNumber}</h3>
                              <p className="text-sm text-muted-foreground">{vehicle.type}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            {getStatusBadge(vehicle)}
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline">
                                <EditIcon className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
                                <TrashIcon className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-border">
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {isRTL ? 'انتهاء ترخيص NCWM' : 'NCWM License Expiry'}
                              </p>
                              <p className="text-sm font-medium text-foreground">{vehicle.ncwmLicenseExpiry}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <FileTextIcon className={`w-4 h-4 ${getLicenseTypeColor(vehicle.licenseType)}`} />
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {isRTL ? 'نوع الترخيص' : 'License Type'}
                              </p>
                              <p className={`text-sm font-medium ${getLicenseTypeColor(vehicle.licenseType)}`}>
                                {vehicle.licenseType}
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${vehicle.status === 'active' ? 'bg-success' : 'bg-muted-foreground'}`} />
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {isRTL ? 'الحالة' : 'Status'}
                              </p>
                              <p className="text-sm font-medium text-foreground">
                                {vehicle.status === 'active' 
                                  ? (isRTL ? 'نشطة' : 'Active')
                                  : (isRTL ? 'غير نشطة' : 'Inactive')
                                }
                              </p>
                            </div>
                          </div>
                        </div>
                        
                        {expiryStatus.status === 'expiring' && (
                          <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-lg flex items-center gap-3">
                            <AlertTriangleIcon className="w-5 h-5 text-warning flex-shrink-0" />
                            <p className="text-sm text-warning">
                              {isRTL 
                                ? `تحذير: ترخيص NCWM للمركبة ينتهي خلال ${expiryStatus.days} يوم`
                                : `Warning: Vehicle's NCWM license expires in ${expiryStatus.days} days`
                              }
                            </p>
                          </div>
                        )}
                        
                        {expiryStatus.status === 'expired' && (
                          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3">
                            <AlertTriangleIcon className="w-5 h-5 text-destructive flex-shrink-0" />
                            <p className="text-sm text-destructive">
                              {isRTL 
                                ? `خطر: ترخيص NCWM للمركبة منتهي الصلاحية منذ ${expiryStatus.days} يوم`
                                : `Critical: Vehicle's NCWM license expired ${expiryStatus.days} days ago`
                              }
                            </p>
                          </div>
                        )}

                        {/* License Type Info */}
                        <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <ShieldCheckIcon className="w-4 h-4 text-primary" />
                            <span className="text-sm font-medium text-foreground">
                              {isRTL ? 'معلومات الترخيص' : 'License Information'}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {isRTL 
                              ? `هذه المركبة مرخصة لنقل: ${vehicle.licenseType}`
                              : `This vehicle is licensed for: ${vehicle.licenseType}`
                            }
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
