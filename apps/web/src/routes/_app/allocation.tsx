import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/allocation")({
  component: AllocationLayout,
});

function AllocationLayout() {
  return <Outlet />;
}
