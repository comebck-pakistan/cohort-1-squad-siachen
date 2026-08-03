import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/superadmin")({
  head: () => ({
    meta: [
      { title: "Admin — Recepta" },
      { name: "description", content: "Recepta super-admin control plane." },
      { property: "og:title", content: "Admin — Recepta" },
      { property: "og:description", content: "Recepta super-admin control plane." },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { user, isReady } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isLoginRoute = pathname === "/superadmin/login";

  useEffect(() => {
    if (!isReady) return;
    if (user?.role !== "superadmin" && !isLoginRoute) {
      navigate({ to: "/superadmin/login", search: { redirect: pathname } });
    }
  }, [isReady, user, isLoginRoute, pathname, navigate]);

  if (!isReady) return null;
  if (isLoginRoute || user?.role !== "superadmin") return <Outlet />;


  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
