import { Trans } from "@lingui/react/macro";
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder while a lazily loaded dialog body downloads. It keeps the
 * dialog named for assistive technology and holds the final layout's shape.
 */
export function DialogBodyFallback({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col gap-3 p-6" aria-busy="true">
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">{title}</DialogDescription>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  );
}

/**
 * Keeps a failed body download inside the dialog instead of replacing the
 * page with the route error screen. A tab opened before a deploy asks for
 * chunk names that no longer exist, and `lazy` remembers the rejection, so
 * the recovery is a reload rather than a retry.
 */
export class DialogBodyBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <div className="flex flex-1 flex-col items-start gap-3 p-6" role="alert">
        <DialogTitle>{this.props.title}</DialogTitle>
        <DialogDescription>
          <Trans id="dialog.bodyLoadFailed">
            This panel could not be loaded. The app may have been updated since
            this page was opened.
          </Trans>
        </DialogDescription>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          <Trans id="dialog.reloadPage">Reload page</Trans>
        </Button>
      </div>
    );
  }
}
