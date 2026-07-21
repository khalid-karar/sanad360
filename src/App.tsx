import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useThemeStore } from './stores/themeStore';
import { useNotificationStore } from './stores/notificationStore';
import { initPickupQueueSync } from './lib/offline/pickupQueue';
import { initDisposalQueueSync } from './lib/offline/disposalQueue';
import { supabase } from './lib/supabase';
import { Toaster } from './components/ui/toaster';
import ToastNotification from './components/notifications/ToastNotification';
import PWAInstallPrompt from './components/pwa/PWAInstallPrompt';
import PWAUpdatePrompt from './components/pwa/PWAUpdatePrompt';
import OfflineIndicator from './components/pwa/OfflineIndicator';
import BackgroundSync from './components/pwa/BackgroundSync';
import SyncStatus from './components/pwa/SyncStatus';
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
import PickupSchedulePage from './components/schedule/PickupSchedulePage';
import MySchedulePage from './components/schedule/MySchedulePage';
import DriverDeliveriesPage from './pages/DriverDeliveriesPage';
import ReviewQueuePage from './pages/ReviewQueuePage';
import ApprovedTransportersPage from './components/company/ApprovedTransportersPage';
import CompaniesPage from './pages/CompaniesPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminAnalyticsPage from './pages/AdminAnalyticsPage';
import RecyclerDashboard from './pages/RecyclerDashboard';
import TransportTripsPage from './pages/TransportTripsPage';
import OnboardingPage from './pages/OnboardingPage';
import DocumentReviewQueuePage from './pages/DocumentReviewQueuePage';
import { homeRouteFor } from './lib/roleRouting';

const RECYCLER_ROLES = ['recycler_manager', 'scale_operator'];
const MAYA_ADMIN_SHELL_ROLES = ['admin', 'super_admin', 'system_admin', 'support_agent', 'billing_accountant'];

function App() {
  const { user, hydrate } = useAuthStore();
  const { initializeTheme } = useThemeStore();
  // true while we're checking if an existing session exists on first load
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  // Offline disposal queue: replay pending custody confirmations (same
  // triggers as the pickup queue below).
  useEffect(() => {
    return initDisposalQueueSync((r) => {
      useNotificationStore.getState().addNotification({
        type: 'success',
        priority: 'medium',
        title: 'تمت مزامنة تأكيدات التسليم',
        titleEn: 'Queued Deliveries Synced',
        message: `تم إرسال ${r.synced} تأكيد تسليم محفوظ محلياً`,
        messageEn: `${r.synced} locally saved delivery confirmation(s) submitted`,
        role: 'driver',
        autoHide: true,
        duration: 5000,
      });
    });
  }, []);

  // Offline pickup queue: replay any pending submissions on app start and
  // whenever connectivity returns; notify the driver on success.
  useEffect(() => {
    return initPickupQueueSync((r) => {
      useNotificationStore.getState().addNotification({
        type: 'success',
        priority: 'medium',
        title: 'تمت مزامنة الالتقاطات المحفوظة',
        titleEn: 'Queued Pickups Synced',
        message: `تم إرسال ${r.synced} بيان محفوظ محلياً`,
        messageEn: `${r.synced} locally saved manifest(s) submitted`,
        role: 'driver',
        autoHide: true,
        duration: 5000,
      });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    // onAuthStateChange fires INITIAL_SESSION almost immediately (no network call).
    // This is the most reliable way to know whether a valid session exists on load,
    // and it replaces the old getSession() + separate subscription pattern that was
    // causing a race / double-logout loop in React 18 StrictMode.
    // DEADLOCK GUARD: supabase-js runs this callback while holding its
    // internal navigator lock. Calling ANY other auth method (getUser,
    // signOut) synchronously inside it deadlocks the client — which froze
    // every tab of the origin after sign-out on staging. All work is
    // therefore deferred out of the callback with setTimeout(0), per the
    // supabase-js documentation.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (cancelled) return;

        setTimeout(() => {
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

        // Token expired or signed out from another tab. Guard on state so a
        // logout we initiated ourselves doesn't recurse into logout again.
        if (event === 'SIGNED_OUT' && useAuthStore.getState().user) {
          useAuthStore.getState().logout();
        }
        }, 0);
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
              ? <Navigate to={homeRouteFor(user)} replace />
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
          path="/driver/schedule"
          element={
            user?.role === 'driver'
              ? <MySchedulePage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/driver/deliveries"
          element={
            user?.role === 'driver'
              ? <DriverDeliveriesPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/driver/onboarding"
          element={
            user?.role === 'driver'
              ? <OnboardingPage ownerType="driver" ownerId={user.driver_record_id} shellRole="driver" />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company"
          element={
            user && ['owner', 'manager'].includes(user.role) && user.company_id
              ? <CompanyDashboard />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company/branches"
          element={
            user && ['owner', 'manager'].includes(user.role) && user.company_id
              ? <BranchesPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company/pickups"
          element={
            user && ['owner', 'manager'].includes(user.role) && user.company_id
              ? <PickupLogPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company/review"
          element={
            user && ['owner', 'manager'].includes(user.role) && user.company_id
              ? <ReviewQueuePage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company/schedule"
          element={
            user && ['owner', 'manager', 'dispatcher'].includes(user.role) && user.company_id
              ? <PickupSchedulePage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company/transporters"
          element={
            user && ['owner', 'manager'].includes(user.role) && user.company_id
              ? <ApprovedTransportersPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/company/onboarding"
          element={
            user && ['owner', 'manager'].includes(user.role) && user.company_id
              ? <OnboardingPage ownerType="company" ownerId={user.company_id} shellRole="company" />
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
            user && MAYA_ADMIN_SHELL_ROLES.includes(user.role)
              ? <AdminDashboard />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/admin/companies"
          element={
            // Full-admin only (mirrors DB is_full_admin()) — system_admin's
            // actual permission surface is still a pending product decision
            // (migration 025), so it doesn't get raw company-list access yet.
            user && ['admin', 'super_admin'].includes(user.role)
              ? <CompaniesPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/admin/users"
          element={
            user && ['admin', 'super_admin'].includes(user.role)
              ? <AdminUsersPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/admin/analytics"
          element={
            user && ['admin', 'super_admin'].includes(user.role)
              ? <AdminAnalyticsPage />
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
            // dispatcher included: RLS already lets any transport member SELECT
            // vehicles (only INSERT/UPDATE is owner/manager-only) — excluding
            // dispatcher here left the sidebar link pointing at a page they'd
            // instantly get redirected out of, which /login then bounced back
            // to this role's home ('/transport'), looking like a dead click.
            // VehicleManagementPage hides the write actions for dispatcher.
            user && ['owner', 'manager', 'dispatcher'].includes(user.role) && user.transport_company_id
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
          path="/transport/trips"
          element={
            user && ['owner', 'manager', 'dispatcher'].includes(user.role) && user.transport_company_id
              ? <TransportTripsPage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/transport/onboarding"
          element={
            user && ['owner', 'manager', 'dispatcher'].includes(user.role) && user.transport_company_id
              ? <OnboardingPage ownerType="transport_company" ownerId={user.transport_company_id} shellRole="transport" />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/recycler"
          element={
            user && RECYCLER_ROLES.includes(user.role) && user.facility_id
              ? <RecyclerDashboard />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/recycler/onboarding"
          element={
            user && RECYCLER_ROLES.includes(user.role) && user.facility_id
              ? <OnboardingPage ownerType="facility" ownerId={user.facility_id} shellRole="recycler" />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/reviewer"
          element={
            user?.role === 'document_reviewer'
              ? <DocumentReviewQueuePage />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/admin/document-review"
          element={
            user && ['admin', 'super_admin'].includes(user.role)
              ? <DocumentReviewQueuePage />
              : <Navigate to="/login" replace />
          }
        />
        {/* /branch, /gov, /consultant routes are added alongside their pages
            in the 4d/4f/4g commits, not speculatively here. */}
        <Route
          path="/"
          element={
            user
              ? <Navigate to={homeRouteFor(user)} replace />
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
      {/* Chat mock removed: real-world coordination happens over WhatsApp —
          schedulers deep-link to drivers from the schedule page. */}
    </Router>
  );
}

export default App;
