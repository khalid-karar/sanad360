import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTransportStore, Driver } from '../stores/transportStore';
import AppShell from '../components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { 
  PlusIcon, 
  SearchIcon, 
  UserIcon, 
  CalendarIcon, 
  ShieldCheckIcon,
  AlertTriangleIcon,
  EditIcon,
  TrashIcon
} from 'lucide-react';
import FadeInUp from '../components/animations/FadeInUp';
import StaggeredList from '../components/animations/StaggeredList';
import InteractiveButton from '../components/animations/InteractiveButton';

export default function DriverManagementPage() {
  const { isRTL } = useAuthStore();
  const { drivers, addDriver } = useTransportStore();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDriver, setNewDriver] = useState({
    name: '',
    licenseNumber: '',
    licenseExpiry: '',
    absherVerified: false,
    status: 'active' as const
  });

  const filteredDrivers = drivers.filter(driver =>
    driver.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    driver.licenseNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddDriver = () => {
    if (!newDriver.name || !newDriver.licenseNumber || !newDriver.licenseExpiry) {
      toast({
        title: isRTL ? 'خطأ' : 'Error',
        description: isRTL ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields',
        variant: 'destructive'
      });
      return;
    }

    addDriver(newDriver);
    setNewDriver({
      name: '',
      licenseNumber: '',
      licenseExpiry: '',
      absherVerified: false,
      status: 'active'
    });
    setShowAddForm(false);
    
    toast({
      title: isRTL ? 'تم بنجاح' : 'Success',
      description: isRTL ? 'تم إضافة السائق بنجاح' : 'Driver added successfully'
    });
  };

  const getExpiryStatus = (expiryDate: string) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return { status: 'expired', color: 'destructive', days: Math.abs(daysUntilExpiry) };
    } else if (daysUntilExpiry <= 30) {
      return { status: 'expiring', color: 'warning', days: daysUntilExpiry };
    }
    return { status: 'valid', color: 'success', days: daysUntilExpiry };
  };

  const getStatusBadge = (driver: Driver) => {
    const expiryStatus = getExpiryStatus(driver.licenseExpiry);
    
    if (expiryStatus.status === 'expired') {
      return <Badge variant="destructive">{isRTL ? 'منتهية الصلاحية' : 'Expired'}</Badge>;
    } else if (expiryStatus.status === 'expiring') {
      return <Badge className="bg-warning text-warning-foreground">{isRTL ? `تنتهي خلال ${expiryStatus.days} يوم` : `Expires in ${expiryStatus.days} days`}</Badge>;
    }
    return <Badge variant="default">{isRTL ? 'صالحة' : 'Valid'}</Badge>;
  };

  return (
    <AppShell role="transport">
      <div className={`space-y-8 ${isRTL ? 'rtl' : 'ltr'}`}>
        <FadeInUp>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                {isRTL ? 'إدارة السائقين' : 'Driver Management'}
              </h1>
              <p className="text-muted-foreground">
                {isRTL ? 'إدارة وتتبع السائقين ورخصهم' : 'Manage and track drivers and their licenses'}
              </p>
            </div>
            <InteractiveButton
              onClick={() => setShowAddForm(true)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              hapticFeedback
            >
              <PlusIcon className="w-4 h-4 mr-2" />
              {isRTL ? 'إضافة سائق' : 'Add Driver'}
            </InteractiveButton>
          </div>
        </FadeInUp>

        {/* Search Bar */}
        <FadeInUp delay={0.1}>
          <Card className="bg-card text-card-foreground border-border">
            <CardContent className="pt-6">
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={isRTL ? 'البحث عن سائق...' : 'Search drivers...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-background text-foreground border-input"
                />
              </div>
            </CardContent>
          </Card>
        </FadeInUp>

        {/* Add Driver Form */}
        {showAddForm && (
          <FadeInUp delay={0.2}>
            <Card className="bg-card text-card-foreground border-border border-2 border-primary/20">
              <CardHeader>
                <CardTitle className="text-foreground flex items-center gap-3">
                  <UserIcon className="w-6 h-6 text-primary" />
                  {isRTL ? 'إضافة سائق جديد' : 'Add New Driver'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-foreground">{isRTL ? 'اسم السائق' : 'Driver Name'}</Label>
                    <Input
                      value={newDriver.name}
                      onChange={(e) => setNewDriver({ ...newDriver, name: e.target.value })}
                      placeholder={isRTL ? 'أدخل اسم السائق' : 'Enter driver name'}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label className="text-foreground">{isRTL ? 'رقم الرخصة' : 'License Number'}</Label>
                    <Input
                      value={newDriver.licenseNumber}
                      onChange={(e) => setNewDriver({ ...newDriver, licenseNumber: e.target.value })}
                      placeholder={isRTL ? 'أدخل رقم الرخصة' : 'Enter license number'}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label className="text-foreground">{isRTL ? 'تاريخ انتهاء الرخصة' : 'License Expiry Date'}</Label>
                    <Input
                      type="date"
                      value={newDriver.licenseExpiry}
                      onChange={(e) => setNewDriver({ ...newDriver, licenseExpiry: e.target.value })}
                      className="mt-2"
                    />
                  </div>
                  <div className="flex items-center space-x-2 pt-8">
                    <input
                      type="checkbox"
                      id="absher-verified"
                      checked={newDriver.absherVerified}
                      onChange={(e) => setNewDriver({ ...newDriver, absherVerified: e.target.checked })}
                      className="rounded border-input"
                    />
                    <Label htmlFor="absher-verified" className="text-foreground">
                      {isRTL ? 'تم التحقق من أبشر' : 'Absher Verified'}
                    </Label>
                  </div>
                </div>
                
                <div className="flex gap-3 pt-4">
                  <InteractiveButton
                    variant="outline"
                    onClick={() => setShowAddForm(false)}
                    className="flex-1"
                    hapticFeedback
                  >
                    {isRTL ? 'إلغاء' : 'Cancel'}
                  </InteractiveButton>
                  <InteractiveButton
                    onClick={handleAddDriver}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    hapticFeedback
                    soundFeedback
                  >
                    {isRTL ? 'إضافة السائق' : 'Add Driver'}
                  </InteractiveButton>
                </div>
              </CardContent>
            </Card>
          </FadeInUp>
        )}

        {/* Drivers List */}
        <FadeInUp delay={0.3}>
          <Card className="bg-card text-card-foreground border-border">
            <CardHeader>
              <CardTitle className="text-foreground">
                {isRTL ? 'قائمة السائقين' : 'Drivers List'} ({filteredDrivers.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] pr-4">
                <StaggeredList staggerDelay={0.05}>
                  {filteredDrivers.map((driver) => {
                    const expiryStatus = getExpiryStatus(driver.licenseExpiry);
                    
                    return (
                      <Card
                        key={driver.id}
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
                                <UserIcon className="w-6 h-6 text-primary" />
                              </div>
                              <div>
                                <h3 className="font-semibold text-foreground text-lg">{driver.name}</h3>
                                <p className="text-sm text-muted-foreground">{driver.licenseNumber}</p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3">
                              {getStatusBadge(driver)}
                              <div className="flex gap-2">
                                <InteractiveButton size="sm" variant="outline" hapticFeedback>
                                  <EditIcon className="w-4 h-4" />
                                </InteractiveButton>
                                <InteractiveButton size="sm" variant="outline" className="text-destructive hover:text-destructive" hapticFeedback>
                                  <TrashIcon className="w-4 h-4" />
                                </InteractiveButton>
                              </div>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-border">
                            <div className="flex items-center gap-2">
                              <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {isRTL ? 'تاريخ الانتهاء' : 'Expiry Date'}
                                </p>
                                <p className="text-sm font-medium text-foreground">{driver.licenseExpiry}</p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <ShieldCheckIcon className={`w-4 h-4 ${driver.absherVerified ? 'text-success' : 'text-muted-foreground'}`} />
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {isRTL ? 'التحقق من أبشر' : 'Absher Verification'}
                                </p>
                                <p className={`text-sm font-medium ${driver.absherVerified ? 'text-success' : 'text-muted-foreground'}`}>
                                  {driver.absherVerified 
                                    ? (isRTL ? 'تم التحقق' : 'Verified')
                                    : (isRTL ? 'غير محقق' : 'Not Verified')
                                  }
                                </p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${driver.status === 'active' ? 'bg-success' : 'bg-muted-foreground'}`} />
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {isRTL ? 'الحالة' : 'Status'}
                                </p>
                                <p className="text-sm font-medium text-foreground">
                                  {driver.status === 'active' 
                                    ? (isRTL ? 'نشط' : 'Active')
                                    : (isRTL ? 'غير نشط' : 'Inactive')
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
                                  ? `تحذير: رخصة السائق تنتهي خلال ${expiryStatus.days} يوم`
                                  : `Warning: Driver's license expires in ${expiryStatus.days} days`
                                }
                              </p>
                            </div>
                          )}
                          
                          {expiryStatus.status === 'expired' && (
                            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3">
                              <AlertTriangleIcon className="w-5 h-5 text-destructive flex-shrink-0" />
                              <p className="text-sm text-destructive">
                                {isRTL 
                                  ? `خطر: رخصة السائق منتهية الصلاحية منذ ${expiryStatus.days} يوم`
                                  : `Critical: Driver's license expired ${expiryStatus.days} days ago`
                                }
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </StaggeredList>
              </ScrollArea>
            </CardContent>
          </Card>
        </FadeInUp>
      </div>
    </AppShell>
  );
}
