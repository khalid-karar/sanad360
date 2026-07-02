import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import type { Membership } from '../lib/database.types';
import { Building2Icon } from 'lucide-react';

// Role → landing route (mirrors App.tsx roleRoute)
const ROLE_ROUTE: Record<string, string> = {
  driver: '/driver',
  owner: '/company',
  manager: '/company',
  dispatcher: '/transport',
  admin: '/admin',
};

/**
 * Consultant tenant switcher (migration 012). Rendered only when the user
 * holds more than one membership; switching updates user_active_tenant,
 * re-hydrates the AuthUser, and routes to the new role's home.
 */
export default function TenantSwitcher() {
  const { user, isRTL, switchTenant } = useAuthStore();
  const navigate = useNavigate();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const memberships = user?.memberships ?? [];

  useEffect(() => {
    if (memberships.length < 2) return;
    let cancelled = false;

    (async () => {
      const companyIds = memberships.map((m) => m.company_id).filter(Boolean) as string[];
      const tcIds = memberships.map((m) => m.transport_company_id).filter(Boolean) as string[];

      const [companiesRes, tcsRes] = await Promise.all([
        companyIds.length
          ? supabase.from('companies').select('id, name_ar').in('id', companyIds)
          : Promise.resolve({ data: [] as { id: string; name_ar: string }[] }),
        tcIds.length
          ? supabase.from('transport_companies').select('id, name_ar').in('id', tcIds)
          : Promise.resolve({ data: [] as { id: string; name_ar: string }[] }),
      ]);
      if (cancelled) return;

      const names = new Map<string, string>();
      for (const c of companiesRes.data ?? []) names.set(c.id, c.name_ar);
      for (const t of tcsRes.data ?? []) names.set(t.id, t.name_ar);

      const next: Record<string, string> = {};
      for (const m of memberships) {
        const tenantId = m.company_id ?? m.transport_company_id;
        const tenantName = tenantId ? names.get(tenantId) : undefined;
        next[m.id] = tenantName ?? (isRTL ? 'مشرف المنصة' : 'Platform Admin');
      }
      setLabels(next);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, memberships.length, isRTL]);

  if (!user || memberships.length < 2) return null;

  async function handleSwitch(membershipId: string) {
    if (membershipId === user?.active_membership_id) return;
    setBusy(true);
    try {
      await switchTenant(membershipId);
      const role = useAuthStore.getState().user?.role ?? 'driver';
      navigate(ROLE_ROUTE[role] ?? '/login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Building2Icon className="w-4 h-4 text-muted-foreground" />
      <select
        value={user.active_membership_id}
        disabled={busy}
        onChange={(e) => handleSwitch(e.target.value)}
        className="bg-background text-foreground border border-input rounded-md px-2 py-1.5 text-sm max-w-[220px]"
        title={isRTL ? 'تبديل المنشأة' : 'Switch tenant'}
      >
        {memberships.map((m: Membership) => (
          <option key={m.id} value={m.id}>
            {labels[m.id] ?? '…'}
          </option>
        ))}
      </select>
    </div>
  );
}
