import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type ColorScheme = 'default' | 'blue' | 'purple' | 'orange';

interface ThemeState {
  theme: Theme;
  colorScheme: ColorScheme;
  systemTheme: 'light' | 'dark';
  actualTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  toggleTheme: () => void;
  initializeTheme: () => void;
}

const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const getActualTheme = (theme: Theme, systemTheme: 'light' | 'dark'): 'light' | 'dark' => {
  return theme === 'system' ? systemTheme : theme;
};

const applyTheme = (actualTheme: 'light' | 'dark', colorScheme: ColorScheme) => {
  const root = document.documentElement;
  
  // Remove existing theme classes
  root.classList.remove('light', 'dark', 'theme-default', 'theme-blue', 'theme-purple', 'theme-orange');
  
  // Apply theme and color scheme
  root.classList.add(actualTheme, `theme-${colorScheme}`);
  
  // Update meta theme-color for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    const themeColor = actualTheme === 'dark' ? '#0f172a' : '#ffffff';
    metaThemeColor.setAttribute('content', themeColor);
  }
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      colorScheme: 'default',
      systemTheme: getSystemTheme(),
      actualTheme: getActualTheme('system', getSystemTheme()),

      setTheme: (theme: Theme) => {
        const { systemTheme, colorScheme } = get();
        const actualTheme = getActualTheme(theme, systemTheme);
        
        set({ theme, actualTheme });
        applyTheme(actualTheme, colorScheme);
      },

      setColorScheme: (colorScheme: ColorScheme) => {
        const { actualTheme } = get();
        set({ colorScheme });
        applyTheme(actualTheme, colorScheme);
      },

      toggleTheme: () => {
        const { theme } = get();
        const newTheme: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
        get().setTheme(newTheme);
      },

      initializeTheme: () => {
        const { theme, colorScheme } = get();
        const systemTheme = getSystemTheme();
        const actualTheme = getActualTheme(theme, systemTheme);
        
        set({ systemTheme, actualTheme });
        applyTheme(actualTheme, colorScheme);

        // Listen for system theme changes
        if (typeof window !== 'undefined') {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
          const handleChange = (e: MediaQueryListEvent) => {
            const newSystemTheme = e.matches ? 'dark' : 'light';
            const { theme, colorScheme } = get();
            const newActualTheme = getActualTheme(theme, newSystemTheme);
            
            set({ systemTheme: newSystemTheme, actualTheme: newActualTheme });
            applyTheme(newActualTheme, colorScheme);
          };

          mediaQuery.addEventListener('change', handleChange);
          
          // Cleanup function
          return () => mediaQuery.removeEventListener('change', handleChange);
        }
      },
    }),
    {
      name: 'tadweer-theme-storage',
      partialize: (state) => ({ 
        theme: state.theme, 
        colorScheme: state.colorScheme 
      }),
    }
  )
);
