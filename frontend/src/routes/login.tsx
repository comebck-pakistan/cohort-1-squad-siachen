import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Loader2, Mail, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — Recepta Salon Owner Portal" },
      {
        name: "description",
        content: "Sign in to your Recepta salon account to manage bookings, AI receptionist and analytics.",
      },
      { property: "og:title", content: "Log in — Recepta" },
      { property: "og:description", content: "Salon owner sign-in for Recepta AI Receptionist." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter your email and password");
      return;
    }
    setLoading(true);
    try {
      const user = await auth.login(email, password);
      toast.success(`Welcome back, ${user.name}!`);
      // Route by role — superadmin goes to the platform dashboard,
      // everyone else goes to their salon portal.
      if (user.role === "superadmin") {
        navigate({ to: "/superadmin" });
      } else {
        navigate({ to: "/salon-portal" });
      }
    } catch (err) {
      toast.error((err as Error).message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  function handleGoogle() {
    // Google OAuth not wired yet — would require configuring Google
    // provider in Supabase + an OAuth client ID. Until that's set up,
    // disable the button with a hint.
    toast.error(
      "Google sign-in isn't configured yet. Use email + password."
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Left visual */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground">
        <div className="absolute inset-0 -z-10 opacity-70">
          <div className="absolute -top-24 -left-24 size-[520px] rounded-full bg-primary/30 blur-3xl" />
          <div className="absolute right-0 bottom-0 size-[460px] rounded-full bg-rose-gold/25 blur-3xl" />
        </div>
        <Link to="/" className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
            <Sparkles className="size-5" />
          </div>
          <div className="font-display text-lg font-semibold">Recepta</div>
        </Link>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-glow">
            Salon Owner Portal
          </div>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight">
            Your AI receptionist,
            <br /> answering while you rest.
          </h1>
          <p className="mt-4 max-w-md text-sm text-sidebar-foreground/70">
            Log in to manage bookings, review live call transcripts, and see how many appointments
            Recepta booked for you today.
          </p>
          <div className="mt-8 flex items-center gap-3 text-sm text-sidebar-foreground/60">
            <div className="flex -space-x-2">
              {["A", "H", "Z"].map((c) => (
                <div
                  key={c}
                  className="grid size-8 place-items-center rounded-full border-2 border-sidebar bg-gradient-luxe text-xs font-semibold text-white"
                >
                  {c}
                </div>
              ))}
            </div>
            <span>Trusted by 300+ salons across Karachi, Lahore & Islamabad.</span>
          </div>
        </div>
        <div className="text-xs text-sidebar-foreground/50">© {new Date().getFullYear()} Recepta</div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <Link to="/" className="flex items-center gap-2 lg:hidden mb-8">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
              <Sparkles className="size-5" />
            </div>
            <div className="font-display text-lg font-semibold">Recepta</div>
          </Link>

          <h2 className="font-display text-3xl font-semibold tracking-tight">
            Welcome back
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to your Recepta salon dashboard.
          </p>

          <Button
            type="button"
            variant="outline"
            className="mt-8 h-11 w-full rounded-full font-medium"
            onClick={handleGoogle}
            disabled={loading}
          >
            <GoogleIcon /> Continue with Google
          </Button>

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-widest text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or with email
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative mt-1.5">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@salon.pk"
                  className="pl-10 h-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button type="button" className="text-xs text-primary hover:underline">
                  Forgot?
                </button>
              </div>
              <div className="relative mt-1.5">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10 h-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
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

          <p className="mt-6 text-center text-sm text-muted-foreground">
            New to Recepta?{" "}
            <Link
              to="/onboarding"
              className="font-semibold text-primary hover:underline"
            >
              Get your agent!
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-4">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
