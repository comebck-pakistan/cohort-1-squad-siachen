import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Mock SuperAdmin auth. Simulates the eventual DB-backed flow: an admins
// table + roles is checked on login. Persists the signed-in admin in
// localStorage so refreshes keep the session. Swap MOCK_ADMINS for a real
// POST /api/auth/login later without changing the component surface.
// ---------------------------------------------------------------------------

export type AdminRole = "superadmin" | "admin";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

interface StoredAdmin extends AdminUser {
  password: string;
}

const MOCK_ADMINS: StoredAdmin[] = [
  {
    id: "u1",
    name: "Marriyam Andeel",
    email: "admin@recepta.pk",
    password: "admin123",
    role: "superadmin",
  },
  {
    id: "u2",
    name: "Bilal Khan",
    email: "ops@recepta.pk",
    password: "ops12345",
    role: "admin",
  },
];

const STORAGE_KEY = "recepta.admin.session";

interface AuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isReady: boolean;
  login: (email: string, password: string) => Promise<AdminUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw) as AdminUser);
    } catch {
      // ignore malformed session
    }
    setIsReady(true);
  }, []);

  const login = async (email: string, password: string): Promise<AdminUser> => {
    // Simulate network round-trip to POST /api/auth/login
    await new Promise((r) => setTimeout(r, 400));
    const match = MOCK_ADMINS.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password,
    );
    if (!match) throw new Error("Invalid email or password");
    const { password: _pw, ...safe } = match;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    setUser(safe);
    return safe;
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isReady, login, logout }}
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