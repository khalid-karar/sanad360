import { create } from 'zustand';
import {
  signIn as apiSignIn,
  signOut as apiSignOut,
  fetchMyProfile,
  setActiveTenant,
} from '../lib/api/auth';
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
  /**
   * Consultant flow: switch the active tenant (migration 012), then re-hydrate
   * so role/tenant state matches what RLS now enforces server-side.
   */
  switchTenant: (membershipId: string) => Promise<void>;
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
    // Clear local state immediately so the user is logged out instantly and
    // navigation can proceed even if the network signOut hangs or fails.
    set({ user: null, isLoading: false });
    // Best-effort network sign-out (already timeout-guarded in api/auth).
    try {
      await apiSignOut();
    } catch {
      /* ignore — local state is already cleared */
    }
  },

  switchTenant: async (membershipId: string) => {
    const current = useAuthStore.getState().user;
    if (!current) throw new Error('Not authenticated');
    set({ isLoading: true, error: null });
    try {
      await setActiveTenant(current.id, membershipId);
      const user = await fetchMyProfile(current.id);
      set({ user, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tenant switch failed';
      set({ error: message, isLoading: false });
      throw err;
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
