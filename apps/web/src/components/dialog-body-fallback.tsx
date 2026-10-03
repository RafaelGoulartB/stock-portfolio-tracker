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
