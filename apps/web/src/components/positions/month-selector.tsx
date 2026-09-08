import { Trans } from "@lingui/react/macro";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMonthLabel, type lastTwelveMonths } from "@/lib/months";

export function MonthSelector({
  months,
  selectedKey,
  onSelect,
  locale,
}: {
  months: ReturnType<typeof lastTwelveMonths>;
  selectedKey: string;
  onSelect: (key: string) => void;
  locale: string;
}) {
  return (
    <>
      <Label htmlFor="positions-month" className="sr-only">
        <Trans id="positions.month">Snapshot month</Trans>
      </Label>
      <Select value={selectedKey} onValueChange={onSelect}>
        <SelectTrigger
          id="positions-month"
          size="sm"
          className="w-full max-w-[168px] sm:w-[168px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((month) => (
            <SelectItem key={month.key} value={month.key}>
              {month.current ? (
                <Trans id="positions.currentMonth">
                  {formatMonthLabel(month, locale)} · Live
                </Trans>
              ) : (
                formatMonthLabel(month, locale)
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
