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
import {
  Activity,
  CalendarDays,
  LineChart,
  PieChart,
  Receipt,
  TableProperties,
  TrendingUp,
} from "lucide-react";
import { SettingsDialog } from "@/components/settings-dialog";
import { UserMenu } from "@/components/user-menu";
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
  {
    to: "/detailed-positions",
    labelId: "nav.detailedPositions" as const,
    icon: TableProperties,
  },
  { to: "/performance", labelId: "nav.performance" as const, icon: TrendingUp },
  { to: "/daily", labelId: "nav.daily" as const, icon: Activity },
  {
    to: "/dividends",
    labelId: "nav.dividends" as const,
    icon: CalendarDays,
  },
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

  if (labelId === "nav.daily") {
    return <Trans id="nav.daily">Daily</Trans>;
  }

  if (labelId === "nav.performance") {
    return <Trans id="nav.performance">Performance</Trans>;
  }

  if (labelId === "nav.detailedPositions") {
    return <Trans id="nav.detailedPositions">Detailed positions</Trans>;
  }

  if (labelId === "nav.dividends") {
    return <Trans id="nav.dividends">Income</Trans>;
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
          <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2 lg:h-14 lg:flex-nowrap lg:gap-6 lg:px-6 lg:py-0">
            <Link to="/positions" className="flex shrink-0 items-center gap-2">
              <LineChart className="size-5" aria-hidden="true" />
              <span className="font-semibold tracking-tight">
                <Trans id="shell.brand">Portfolio Tracker</Trans>
              </span>
            </Link>

            <nav
              aria-label={i18n._(msg({ id: "nav.main", message: "Main" }))}
              className="order-3 flex w-full items-center gap-1 overflow-x-auto lg:order-none lg:w-auto"
            >
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
              <SettingsDialog />
              <UserMenu
                email={user.email}
                signingOut={logout.isPending}
                onSignOut={() => logout.mutate()}
              />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </SettingsProvider>
  );
}
