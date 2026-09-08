import { createFileRoute } from "@tanstack/react-router";
import { AssetDetailPage } from "@/components/allocation/asset-detail-page";

// The page component lives in `components/` so this route file exports only
// `Route`. A second export here would keep the whole module (and Recharts,
// through the detail chart) in the eager router graph instead of the route's
// own lazy chunk.
export const Route = createFileRoute("/_app/allocation/$ticker")({
  component: AssetDetailPage,
});
