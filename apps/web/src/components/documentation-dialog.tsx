import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { BookOpen } from "lucide-react";
import { lazy, Suspense } from "react";
import { DialogBodyFallback } from "@/components/dialog-body-fallback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

const loadBody = () => import("@/components/documentation-dialog-body");
const DocumentationDialogBody = lazy(() =>
  loadBody().then((module) => ({ default: module.DocumentationDialogBody })),
);

/** Header shortcut for the app-specific calculation and policy reference. */
export function DocumentationDialog() {
  const { i18n } = useLingui();
  const title = i18n._(
    msg({ id: "documentation.open", message: "Documentation" }),
  );

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
          <BookOpen className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(46rem,calc(100svh-2rem))] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl sm:flex-row">
        <Suspense fallback={<DialogBodyFallback title={title} />}>
          <DocumentationDialogBody />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
