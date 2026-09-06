import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { LineChart, LogOut, PieChart, Receipt } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SettingsDialog } from "@/components/settings-dialog";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/api";
import { clearSession, sessionQueryOptions } from "@/lib/session";
import { SettingsProvider } from "@/lib/settings";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions);

    if (!user) {
      throw redirect({ to: "/login" });
    }

    return { user };
  },
  component: AppLayout,
});

const NAV_ITEMS = [
  { to: "/positions", labelId: "nav.positions" as const, icon: PieChart },
  { to: "/transactions", labelId: "nav.transactions" as const, icon: Receipt },
] as const;

function NavLabel({
  labelId,
}: {
  labelId: (typeof NAV_ITEMS)[number]["labelId"];
}) {
  if (labelId === "nav.positions") {
    return <Trans id="nav.positions">Positions</Trans>;
  }

  return <Trans id="nav.transactions">Transactions</Trans>;
}

function AppLayout() {
  const { i18n } = useLingui();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  const logout = trpc.auth.logout.useMutation({
    onSettled: async () => {
      clearSession();
      await navigate({ to: "/login" });
    },
  });

  return (
    <SettingsProvider>
      <div className="min-h-svh bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
            <Link to="/positions" className="flex items-center gap-2">
              <LineChart className="size-5" aria-hidden="true" />
              <span className="font-semibold tracking-tight">
                <Trans id="shell.brand">Portfolio Tracker</Trans>
              </span>
            </Link>

            <nav
              aria-label={i18n._(msg({ id: "nav.main", message: "Main" }))}
              className="flex items-center gap-1"
            >
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  activeProps={{
                    className: "bg-accent text-accent-foreground",
                  }}
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  <NavLabel labelId={item.labelId} />
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {user.email}
              </span>
              <LanguageSwitcher />
              <ThemeSwitcher />
              <SettingsDialog />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                <LogOut className="size-4" aria-hidden="true" />
                <Trans id="shell.signOut">Sign out</Trans>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-6 py-8">
          <Outlet />
        </main>
      </div>
    </SettingsProvider>
  );
}
