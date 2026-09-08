import { formatSignedWeightPrecise } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Score with a proportional bar, so the ranking is readable at a glance. */
export function ScoreCell({
  value,
  blocked,
  share,
}: {
  value: string;
  blocked: boolean;
  share: number;
}) {
  const numeric = Number(value);

  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-foreground/60"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
      <span
        className={cn(
          "w-14 text-right",
          numeric > 0 && "font-medium",
          numeric < 0 && "text-loss",
          numeric === 0 && "text-muted-foreground",
        )}
      >
        {blocked ? "—" : formatSignedWeightPrecise(value)}
      </span>
    </div>
  );
}
