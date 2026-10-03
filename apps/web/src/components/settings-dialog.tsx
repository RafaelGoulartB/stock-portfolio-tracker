import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Settings } from "lucide-react";
import { lazy, Suspense } from "react";
import {
  DialogBodyBoundary,
  DialogBodyFallback,
} from "@/components/dialog-body-fallback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

const loadBody = () => import("@/components/settings-dialog-body");
const SettingsDialogBody = lazy(() =>
  loadBody().then((module) => ({ default: module.SettingsDialogBody })),
);

/** Header shortcut that opens the portfolio settings modal. */
export function SettingsDialog() {
  const { i18n } = useLingui();
  const title = i18n._(msg({ id: "settings.open", message: "Settings" }));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={title}
          // Fetch the body while the pointer approaches, so a click opens it
          // without a visible loading state on a normal connection.
          onPointerEnter={loadBody}
          onFocus={loadBody}
        >
          <Settings className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(42rem,calc(100svh-2rem))] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl sm:flex-row">
        <DialogBodyBoundary title={title}>
          <Suspense fallback={<DialogBodyFallback title={title} />}>
            <SettingsDialogBody />
          </Suspense>
        </DialogBodyBoundary>
      </DialogContent>
    </Dialog>
  );
}
