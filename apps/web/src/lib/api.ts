import { QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchLink,
  httpBatchStreamLink,
  splitLink,
} from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/src/trpc/router";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const trpc = createTRPCReact<AppRouter>();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 15 * 60 * 1_000,
      gcTime: 60 * 60 * 1_000,
    },
  },
});

/**
 * `/trpc` is proxied by Vite, so the API host is never hardcoded.
 *
 * Queries stream: a batch delivers one result at a time, so a screen that asks
 * for a cheap SQL query alongside a provider-backed valuation renders the cheap
 * one without waiting for the whole batch.
 *
 * Mutations deliberately do not stream. A streamed response runs its procedures
 * while the body is being consumed, which is after the response headers are
 * settled — and `auth.login`/`auth.logout` have to write the session cookie.
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (operation) => operation.type === "query",
      true: httpBatchStreamLink({ url: "/trpc" }),
      false: httpBatchLink({ url: "/trpc" }),
    }),
  ],
});
