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
import { LineChart } from "lucide-react";
import { AddTransactionButton } from "@/components/add-transaction-button";
import { AppNav } from "@/components/app-nav";
import { LogoDevAttribution } from "@/components/asset-logo";
import { DocumentationDialog } from "@/components/documentation-dialog";
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
      <div className="min-h-svh overflow-x-clip bg-muted/30">
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
              <AppNav />
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <AddTransactionButton />
              <DocumentationDialog />
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
        <footer className="mx-auto flex w-full max-w-6xl justify-end px-4 pb-4 sm:px-6">
          <LogoDevAttribution />
        </footer>
      </div>
    </SettingsProvider>
  );
}
