import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { activateLocale, detectInitialLocale } from "./i18n";
import { queryClient } from "./lib/api";
import { sessionQueryOptions } from "./lib/session";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");

if (!rootEl) {
  throw new Error("Root element not found");
}

// The `_app` route guard needs the session before any page code or data can
// load. Asking now overlaps that round trip with the locale download below;
// the guard's `ensureQueryData` reuses this in-flight request.
void queryClient.prefetchQuery(sessionQueryOptions);

// Load the persisted locale (browser language is a first-visit hint only)
// before the first paint so no untranslated copy flashes.
await activateLocale(detectInitialLocale());

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
