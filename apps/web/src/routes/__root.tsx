import { I18nProvider } from "@lingui/react";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { i18n } from "@/i18n";
import { queryClient, trpc, trpcClient } from "@/lib/api";
import { ThemePaletteProvider } from "@/lib/theme-palette-provider";

export type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <I18nProvider i18n={i18n}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            enableColorScheme
            disableTransitionOnChange
            storageKey="portfolio-theme"
          >
            <ThemePaletteProvider>
              <Outlet />
              <Toaster position="top-right" richColors />
            </ThemePaletteProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </I18nProvider>
  );
}
