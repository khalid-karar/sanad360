import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useThemeStore } from './stores/themeStore';
import { supabase } from './lib/supabase';
import { Toaster } from './components/ui/toaster';
import ToastNotification from './components/notifications/ToastNotification';
import PWAInstallPrompt from './components/pwa/PWAInstallPrompt';
import PWAUpdatePrompt from './components/pwa/PWAUpdatePrompt';
import OfflineIndicator from './components/pwa/OfflineIndicator';
import BackgroundSync from './components/pwa/BackgroundSync';
import SyncStatus from './components/pwa/SyncStatus';
import ChatBubble from './components/chat/ChatBubble';
import LoginPage from './pages/LoginPage';
import DriverDashboard from './pages/DriverDashboard';
import CompanyDashboard from './pages/CompanyDashboard';
import AdminDashboard from './pages/AdminDashboard';
import TransportDashboard from './pages/TransportDashboard';
import DriverManagementPage from './pages/DriverManagementPage';
import VehicleManagementPage from './pages/VehicleManagementPage';
import PickupLogPage from './pages/PickupLogPage';
import BranchesPage from './pages/BranchesPage';
import ProfilePage from './pages/ProfilePage';

// Role → route mapping (keeps the existing URL scheme)
const roleRoute: Record<string, string> = {
  driver: '/driver',
  owner: '/company',
  manager: '/company',
  dispatcher: '/transport',
  admin: '/admin',
};

function App() {
  const { user, hydrate } = useAuthStore();
  const { initializeTheme } = useThemeStore();
  // true while we're checking if an existing session exists on first load
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  useEffect(() => {
    let cancelled = false;

    // onAuthStateChange fires INITIAL_SESSION almost immediately (no network call).
    // This is the most reliable way to know whether a valid session exists on load,
    // and it replaces the old getSession() + separate subscription pattern that was
    // causing a race / double-logout loop in React 18 StrictMode.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (cancelled) return;

        if (event === 'INITIAL_SESSION') {
          if (session?.user) {
            // Session self-heal: validate the token against the server. After a
            // `supabase db reset` the local JWT references a user that no longer
            // exists; getUser() then returns an error and we must sign out (once)
            // and route to login rather than spin in a hydrate loop.
            supabase.auth.getUser().then(({ error }) => {
              if (cancelled) return;
              if (error) {
                useAuthStore.getState().logout().finally(() => {
                  if (!cancelled) setSessionChecked(true);
                });
              } else {
                hydrate(session.user.id).finally(() => {
                  if (!cancelled) setSessionChecked(true);
                });
              }
            });
          } else {
            setSessionChecked(true);
          }
          return;
        }

        // Post-login: SIGNED_IN / TOKEN_REFRESHED
        if (session?.user && !useAuthStore.getState().user) {
          hydrate(session.user.id);
          return;
        }

        // Token expired or signed out from another tab
        if (event === 'SIGNED_OUT') {
          useAuthStore.getState().logout();
        }
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hydrate]);

  // Show nothing (or a spinner) while we're determining the session state.
  // This prevents a flash of the login page for already-authenticated users.
  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={
            user
              ? <Navigate to={roleRoute[user.role] ?? '/driver'} replace />
              : <LoginPage />
          }
        />
        <Route
          path="/driver"
          element={
            user?.role === 'driver'
              ? <DriverDashboard />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company"
          element={
            user && ['owner', 'manager'].includes(user.role)
              ? <CompanyDashboard />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company/branches"
          element={
            user && ['owner', 'manager'].includes(user.role)
              ? <BranchesPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company/pickups"
          element={
            user && ['owner', 'manager'].includes(user.role)
              ? <PickupLogPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/profile"
          element={
            user
              ? <ProfilePage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/admin"
          element={
            user?.role === 'admin'
              ? <AdminDashboard />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/transport"
          element={
            user && ['owner', 'manager', 'dispatcher'].includes(user.role) && user.transport_company_id
              ? <TransportDashboard />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/transport/drivers"
          element={
            user && ['owner', 'manager', 'dispatcher'].includes(user.role) && user.transport_company_id
              ? <DriverManagementPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/transport/vehicles"
          element={
            user && ['owner', 'manager'].includes(user.role) && user.transport_company_id
              ? <VehicleManagementPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/transport/pickups"
          element={
            user && ['owner', 'manager', 'dispatcher'].includes(user.role) && user.transport_company_id
              ? <PickupLogPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/"
          element={
            user
              ? <Navigate to={roleRoute[user.role] ?? '/driver'} replace />
              : <Navigate to="/login" replace />
          }
        />
      </Routes>
      <Toaster />
      <ToastNotification />
      <PWAInstallPrompt />
      <PWAUpdatePrompt />
      <OfflineIndicator />
      <BackgroundSync />
      <SyncStatus />
      {user && <ChatBubble />}
    </Router>
  );
}

export default App;
