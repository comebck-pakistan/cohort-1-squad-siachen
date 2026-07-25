import { createFileRoute, useNavigate, useRouterState, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/superadmin/login")({
  head: () => ({
    meta: [
      { title: "Admin sign in — Recepta" },
      { name: "description", content: "Restricted access. Authorized Recepta operators only." },
      { property: "og:title", content: "Admin sign in — Recepta" },
      { property: "og:description", content: "Restricted access. Authorized Recepta operators only." },
    ],
  }),
  component: AdminLogin,
});

function AdminLogin() {
  const { login, isAuthenticated, isReady } = useAuth();
  const navigate = useNavigate();
  const redirect = useRouterState({
    select: (s) => (s.location.search as { redirect?: string })?.redirect,
  });
  const [email, setEmail] = useState("admin@recepta.pk");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isReady && isAuthenticated) {
      navigate({ to: redirect ?? "/superadmin" });
    }
  }, [isReady, isAuthenticated, redirect, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, password);
      toast.success(`Welcome, ${user.name}`);
      navigate({ to: redirect ?? "/superadmin" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-sidebar p-6 text-sidebar-foreground">
      <div className="absolute inset-0 -z-10 opacity-60">
        <div className="absolute -top-24 left-1/3 size-[520px] rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute right-0 top-40 size-[420px] rounded-full bg-rose-gold/20 blur-3xl" />
      </div>
      <div className="w-full max-w-md rounded-3xl border border-sidebar-border bg-card p-8 text-card-foreground shadow-luxe">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
            <Sparkles className="size-5" />
          </div>
          <div className="font-display text-lg font-semibold">Recepta</div>
        </Link>
        <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">Admin sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Restricted access · Authorized operators only.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label>Email</Label>
            <Input
              className="mt-1.5 h-11"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              className="mt-1.5 h-11"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button
            type="submit"
            className="h-11 w-full rounded-full bg-gradient-luxe text-white shadow-luxe hover:opacity-95"
            disabled={loading}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Demo: admin@recepta.pk / admin123
        </p>
      </div>
    </div>
  );
}
