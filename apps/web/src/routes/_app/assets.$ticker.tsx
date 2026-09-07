import { createFileRoute } from "@tanstack/react-router";
import { AssetDetailPage } from "./allocation.$ticker";

export const Route = createFileRoute("/_app/assets/$ticker")({
  component: AssetDetailPage,
});
