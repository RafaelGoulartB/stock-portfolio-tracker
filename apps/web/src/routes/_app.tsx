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
import { AddTransactionButton } from "@/components/add-transaction-button";
import { AppNav } from "@/components/app-nav";
import { LogoDevAttribution } from "@/components/asset-logo";
import { BrandLogo } from "@/components/brand-logo";
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
        <a
          href="#main-content"
          className="sr-only fixed top-2 left-2 z-[100] rounded-md bg-background px-3 py-2 text-sm font-medium shadow-lg ring-2 ring-ring focus:not-sr-only"
        >
          <Trans id="a11y.skipToContent">Skip to main content</Trans>
        </a>
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:sticky lg:top-0 lg:z-40 print:hidden">
          <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2 lg:h-14 lg:flex-nowrap lg:gap-6 lg:px-6 lg:py-0">
            <Link
              to="/allocation"
              className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BrandLogo className="size-6 shrink-0" />
              <span className="font-semibold tracking-tight">
                <Trans id="shell.brand">Portfolio Tracker</Trans>
              </span>
            </Link>

            <nav
              aria-label={i18n._(msg({ id: "nav.main", message: "Main" }))}
              className="order-3 grid w-full grid-cols-4 gap-1 lg:order-none lg:flex lg:w-auto lg:items-center"
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

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-4 py-6 outline-none sm:px-6 sm:py-8"
        >
          <Outlet />
        </main>
        <footer className="mx-auto flex w-full max-w-6xl justify-end px-4 pb-4 sm:px-6 print:hidden">
          <LogoDevAttribution />
        </footer>
      </div>
    </SettingsProvider>
  );
}
