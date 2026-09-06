import type { SessionUser } from "@portifolio-tracker/shared";
import { queryOptions } from "@tanstack/react-query";
import { queryClient, trpcClient } from "./api";

export const sessionQueryKey = ["auth", "me"] as const;

export const sessionQueryOptions = queryOptions<SessionUser | null>({
  queryKey: sessionQueryKey,
  queryFn: () => trpcClient.auth.me.query(),
  staleTime: 60_000,
});

/** Seeds the cache right after sign in so route guards see the new session. */
export function setSession(user: SessionUser) {
  queryClient.setQueryData(sessionQueryKey, user);
}

/** Drops every cached query so no data leaks between accounts. */
export function clearSession() {
  queryClient.clear();
  queryClient.setQueryData(sessionQueryKey, null);
}
