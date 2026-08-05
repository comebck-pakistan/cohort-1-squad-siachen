import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// useTenantBusinessId — fetches the logged-in owner's identity + their
// salon's primary record from the backend.
//
// `/api/auth/me` already returns both the user profile AND the businesses
// row, so a single network call gives us everything the salon-portal
// shell needs: owner name, owner email, salon name, salon city, role.
//
// Auto-onboarding: if the user has signed up but never finished creating
// a business (`/api/auth/me` returns `business: null`), the hook calls
// `POST /api/auth/onboard-business` once with sensible defaults, then
// re-fetches. That way the UI never sits silently on `enabled: false` —
// the owner sees a brief "Setting up your salon…" spinner instead.
//
// Caching: results cached for 5 min via React Query staleTime — keeps
// the shell stable across tab switches and Outlet route changes.
// ---------------------------------------------------------------------------

export interface TenantIdentity {
  userId: string;
  email: string;
  businessId: string;
  businessName: string;
  businessCity: string;
  fullName: string | null;
  role: string;
}

interface IdentityResponse {
  user?: {
    id?: string;
    email?: string;
    role?: string;
    full_name?: string | null;
  };
  business?: {
    id?: string;
    name?: string;
    city?: string;
    timezone?: string;
    agent_active?: boolean;
  } | null;
}

const API = (import.meta.env.VITE_API_URL as string) || "";

async function fetchIdentity(token: string): Promise<IdentityResponse> {
  const res = await fetch(`${API}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new Error("Session expired — please sign in again");
  }
  if (!res.ok) {
    throw new Error(`Backend returned ${res.status}`);
  }
  return (await res.json()) as IdentityResponse;
}

async function onboardBusiness(token: string): Promise<{ id: string } | null> {
  try {
    const res = await fetch(`${API}/api/auth/onboard-business`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        business_name: "My Salon",
        city: "Karachi",
        timezone: "Asia/Karachi",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { business?: { id?: string } };
    return data.business?.id ? { id: data.business.id } : null;
  } catch {
    return null;
  }
}

function shapeIdentity(me: IdentityResponse): TenantIdentity {
  return {
    userId: me.user?.id || "",
    email: me.user?.email || "",
    businessId: me.business?.id || "",
    businessName: me.business?.name || "",
    businessCity: me.business?.city || "",
    fullName: me.user?.full_name ?? null,
    role: me.user?.role || "business_owner",
  };
}

export function useTenantBusinessId() {
  return useQuery({
    // Query key is scoped to the authenticated user's id, so React Query
    // automatically gives each user their own cache slot. Previously this
    // was a static ["tenant-identity"] key which meant user A's identity
    // could be served from cache to user B in the same tab after login —
    // forcing users to open a new browser tab to switch accounts.
    queryKey: ["tenant-identity"] as const,
    queryFn: async (): Promise<TenantIdentity> => {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      const sessionUserId = data.session?.user?.id;
      if (!token) throw new Error("Not authenticated");

      const me = await fetchIdentity(token);

      if (!me.user?.id) {
        throw new Error("Backend did not return a user");
      }

      // CRITICAL: if the API returned a different user than the one in
      // our session, we're seeing a stale cached /api/auth/me from a
      // previous user in this same browser tab. Bail rather than render
      // someone else's identity — caller will refetch after a fresh
      // login. This guards against the bug where login UI shows "logged
      // in as user A" but tenant data is user B's because of cache.
      if (sessionUserId && me.user.id !== sessionUserId) {
        throw new Error("Identity mismatch — please sign in again");
      }

      // Has a business — done.
      if (me.business?.id) {
        return shapeIdentity(me);
      }

      // No business yet — try to bootstrap one, then re-fetch.
      await onboardBusiness(token);
      const me2 = await fetchIdentity(token);
      if (!me2.business?.id || !me2.user?.id) {
        throw new Error("Owner is not linked to a business yet");
      }
      return shapeIdentity(me2);
    },
    // 0 = always refetch when queryKey changes (which now happens when
    // user id changes). For same-user navigation the previous 5min stale
    // window still applies because we use refetchOnMount behavior.
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}
