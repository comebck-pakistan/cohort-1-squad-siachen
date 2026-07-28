import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Real Supabase auth — replaces the MOCK_ADMINS flow that previously
// lived here. The dashboard now actually signs the user in against
// Supabase Auth, then reads profiles.role from the backend to decide
// whether they get superadmin or salon-portal routes.
//
// Token storage: Supabase JS keeps the JWT + refresh token in localStorage
// via its persistSession option (see supabase.ts). We expose getToken()
// so api.ts can attach it as Authorization: Bearer on every backend call.
// ---------------------------------------------------------------------------

export type AdminRole = "superadmin" | "business_owner" | "staff";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

interface AuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isReady: boolean;
  /** Real Supabase sign-in. Throws on bad credentials. */
  login: (email: string, password: string) => Promise<AdminUser>;
  logout: () => Promise<void>;
  /** Current access token (for api.ts to attach to requests). */
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

const ROLE_STORAGE_KEY = "recepta.admin.role";
const NAME_STORAGE_KEY = "recepta.admin.name";

/**
 * Look up the caller's profile.role from our backend.
 * Backend endpoint: GET /api/auth/me — returns user.role + business info.
 * Falls back to a localStorage cache if backend is unreachable so the
 * UI doesn't flicker on every refresh.
 */
async function fetchProfileFromBackend(token: string): Promise<{
  role: AdminRole;
  full_name: string | null;
}> {
  const API = (import.meta.env.VITE_API_URL as string) || "";
  try {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data = (await res.json()) as {
      user?: { role?: string; full_name?: string | null };
    };
    const role = (data.user?.role as AdminRole) || "business_owner";
    return { role, full_name: data.user?.full_name ?? null };
  } catch {
    // Fall back to whatever we cached last time
    const cached = (typeof localStorage !== "undefined"
      ? localStorage.getItem(ROLE_STORAGE_KEY)
      : null) as AdminRole | null;
    const cachedName =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(NAME_STORAGE_KEY)
        : null;
    return { role: cached ?? "business_owner", full_name: cachedName };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Restore session from Supabase's localStorage on page load.
      const { data } = await supabase().auth.getSession();
      if (cancelled) return;
      const session = data.session;
      if (session?.user) {
        const profile = await fetchProfileFromBackend(session.access_token);
        const u: AdminUser = {
          id: session.user.id,
          email: session.user.email || "",
          name: profile.full_name || session.user.email || "(user)",
          role: profile.role,
        };
        setUser(u);
        localStorage.setItem(ROLE_STORAGE_KEY, profile.role);
        if (profile.full_name) localStorage.setItem(NAME_STORAGE_KEY, profile.full_name);
      }
      setIsReady(true);
    })();

    // Also subscribe to token refresh so user stays logged in across tabs.
    const { data: sub } = supabase().auth.onAuthStateChange(
      (_event: string, session: { user?: { id: string; email?: string } } | null) => {
        if (cancelled) return;
        if (!session?.user) {
          setUser(null);
        }
      }
    );

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string): Promise<AdminUser> => {
    const { data, error } = await supabase().auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user || !data.session) {
      throw new Error(error?.message || "Invalid email or password");
    }
    const profile = await fetchProfileFromBackend(data.session.access_token);
    const u: AdminUser = {
      id: data.user.id,
      email: data.user.email || "",
      name: profile.full_name || data.user.email || "(user)",
      role: profile.role,
    };
    setUser(u);
    localStorage.setItem(ROLE_STORAGE_KEY, profile.role);
    if (profile.full_name) localStorage.setItem(NAME_STORAGE_KEY, profile.full_name);
    return u;
  };

  const logout = async () => {
    await supabase().auth.signOut();
    setUser(null);
    localStorage.removeItem(ROLE_STORAGE_KEY);
    localStorage.removeItem(NAME_STORAGE_KEY);
  };

  const getToken = async (): Promise<string | null> => {
    const { data } = await supabase().auth.getSession();
    return data.session?.access_token ?? null;
  };

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isReady, login, logout, getToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
