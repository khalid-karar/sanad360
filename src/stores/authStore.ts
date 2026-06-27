import { create } from 'zustand';
import { signIn as apiSignIn, signOut as apiSignOut, fetchMyProfile } from '../lib/api/auth';
import type { AuthUser, MemberRole } from '../lib/api/auth';

// Re-export so existing imports stay compatible
export type UserRole = MemberRole;
export type { AuthUser as User };

interface AuthState {
  user: AuthUser | null;
  isRTL: boolean;
  isLoading: boolean;
  error: string | null;
  /** Sign in with email + password. Drivers use {phone}@driver.sanad360.com format. */
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Called from App.tsx onAuthStateChange when a session already exists.
   * Hydrates the user from the DB rather than requiring a fresh login.
   */
  hydrate: (userId: string) => Promise<void>;
  clearError: () => void;
  toggleLanguage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isRTL: true,
  isLoading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = await apiSignIn(email, password);
      set({ user, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      set({ error: message, isLoading: false });
      throw err; // re-throw so LoginPage can react
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await apiSignOut();
      set({ user: null, isLoading: false });
    } catch (err) {
      // Clear local state even if network call failed
      set({ user: null, isLoading: false });
    }
  },

  hydrate: async (userId: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = await fetchMyProfile(userId);
      set({ user, isLoading: false });
    } catch (err) {
      // Profile lookup failed — clear session state
      set({ user: null, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),

  toggleLanguage: () => set((state) => ({ isRTL: !state.isRTL })),
}));
