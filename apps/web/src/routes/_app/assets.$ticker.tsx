import { createFileRoute } from "@tanstack/react-router";
import { AssetDetailPage } from "@/components/allocation/asset-detail-page";

export const Route = createFileRoute("/_app/assets/$ticker")({
  component: AssetDetailPage,
});
