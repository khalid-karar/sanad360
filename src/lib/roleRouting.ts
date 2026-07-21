import type { MemberRole } from './database.types';

/**
 * Single source of truth for role → landing route. Previously duplicated
 * three times (App.tsx's homeRouteFor, LoginPage.tsx's post-login redirect,
 * TenantSwitcher.tsx's ROLE_ROUTE) with each copy drifting out of sync as
 * new roles were added — CP5 added 7 more roles, which is what forced this
 * consolidation. App.tsx, LoginPage.tsx, and TenantSwitcher.tsx all call
 * this one function now.
 */

const RECYCLER_ROLES: MemberRole[] = ['recycler_manager', 'scale_operator'];

// Maya-side roles reuse the existing /admin shell chrome (AppShell's
// role="admin"), but each still needs its OWN nav array in Sidebar.tsx — see
// 4c. Only the destination route is shared here.
const MAYA_ADMIN_SHELL_ROLES: MemberRole[] = [
  'admin', 'super_admin', 'system_admin', 'support_agent', 'billing_accountant',
];

export interface RoutableUser {
  role: MemberRole;
  transport_company_id: string | null;
}

/**
 * owner/manager exist on BOTH company and transport-company tenants, so the
 * destination can't be a static role→route map for those two roles — it
 * depends on which tenant field the active membership actually set.
 */
export function homeRouteFor(user: RoutableUser): string {
  if (MAYA_ADMIN_SHELL_ROLES.includes(user.role)) return '/admin';
  if (user.role === 'driver') return '/driver';
  if (RECYCLER_ROLES.includes(user.role)) return '/recycler';
  if (user.role === 'document_reviewer') return '/reviewer';
  if (user.role === 'branch_operator') return '/branch';
  if (user.role === 'consultant') return '/consultant';
  if (user.role === 'gov_viewer') return '/gov';
  return user.transport_company_id ? '/transport' : '/company';
}
