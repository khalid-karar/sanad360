import { useAuthStore } from '../../stores/authStore';
import { useThemeStore, Theme, ColorScheme } from '../../stores/themeStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { 
  SunIcon, 
  MoonIcon, 
  MonitorIcon, 
  PaletteIcon,
  XIcon,
  CheckIcon
} from 'lucide-react';

interface ThemeCustomizerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ThemeCustomizer({ isOpen, onClose }: ThemeCustomizerProps) {
  const { isRTL } = useAuthStore();
  const { theme, colorScheme, setTheme, setColorScheme } = useThemeStore();

  if (!isOpen) return null;

  const themeOptions: { value: Theme; label: string; labelAr: string; icon: React.ReactNode }[] = [
    {
      value: 'light',
      label: 'Light',
      labelAr: 'فاتح',
      icon: <SunIcon className="w-5 h-5" />
    },
    {
      value: 'dark',
      label: 'Dark',
      labelAr: 'داكن',
      icon: <MoonIcon className="w-5 h-5" />
    },
    {
      value: 'system',
      label: 'System',
      labelAr: 'النظام',
      icon: <MonitorIcon className="w-5 h-5" />
    }
  ];

  const colorOptions: { value: ColorScheme; label: string; labelAr: string; color: string }[] = [
    {
      value: 'default',
      label: 'Green',
      labelAr: 'أخضر',
      color: 'bg-green-500'
    },
    {
      value: 'blue',
      label: 'Blue',
      labelAr: 'أزرق',
      color: 'bg-blue-500'
    },
    {
      value: 'purple',
      label: 'Purple',
      labelAr: 'بنفسجي',
      color: 'bg-purple-500'
    },
    {
      value: 'orange',
      label: 'Orange',
      labelAr: 'برتقالي',
      color: 'bg-orange-500'
    }
  ];

  return (
    <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card text-card-foreground border-border animate-scale-in">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PaletteIcon className="w-6 h-6 text-primary" />
              <CardTitle className="text-xl text-foreground">
                {isRTL ? 'تخصيص المظهر' : 'Theme Customizer'}
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <XIcon className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Theme Selection */}
          <div className="space-y-4">
            <Label className="text-foreground font-medium">
              {isRTL ? 'وضع المظهر' : 'Theme Mode'}
            </Label>
            <div className="grid grid-cols-3 gap-3">
              {themeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={theme === option.value ? 'default' : 'outline'}
                  size="default"
                  onClick={() => setTheme(option.value)}
                  className="flex flex-col gap-2 h-auto py-4 transition-all duration-200"
                >
                  {option.icon}
                  <span className="text-xs font-medium">
                    {isRTL ? option.labelAr : option.label}
                  </span>
                  {theme === option.value && (
                    <CheckIcon className="w-3 h-3 absolute top-2 right-2" />
                  )}
                </Button>
              ))}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Color Scheme Selection */}
          <div className="space-y-4">
            <Label className="text-foreground font-medium">
              {isRTL ? 'نظام الألوان' : 'Color Scheme'}
            </Label>
            <div className="grid grid-cols-2 gap-3">
              {colorOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={colorScheme === option.value ? 'default' : 'outline'}
                  size="default"
                  onClick={() => setColorScheme(option.value)}
                  className="flex items-center gap-3 justify-start h-auto py-3 transition-all duration-200 relative"
                >
                  <div className={`w-4 h-4 rounded-full ${option.color}`} />
                  <span className="text-sm font-medium">
                    {isRTL ? option.labelAr : option.label}
                  </span>
                  {colorScheme === option.value && (
                    <CheckIcon className="w-3 h-3 absolute top-2 right-2" />
                  )}
                </Button>
              ))}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Preview Section */}
          <div className="space-y-4">
            <Label className="text-foreground font-medium">
              {isRTL ? 'معاينة' : 'Preview'}
            </Label>
            <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <PaletteIcon className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-medium text-foreground text-sm">
                    {isRTL ? 'تدوير 360' : 'Tadweer360'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isRTL ? 'نظام إدارة النفايات' : 'Waste Management System'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1">
                  {isRTL ? 'أساسي' : 'Primary'}
                </Button>
                <Button size="sm" variant="outline" className="flex-1">
                  {isRTL ? 'ثانوي' : 'Secondary'}
                </Button>
              </div>
            </div>
          </div>

          {/* Apply Button */}
          <Button
            onClick={onClose}
            size="lg"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isRTL ? 'تطبيق التغييرات' : 'Apply Changes'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
