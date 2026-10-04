import type { I18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import type { RouterOutputs } from "@/lib/api";

export type GoalOverview = RouterOutputs["goals"]["overview"];
export type GoalProjection = NonNullable<GoalOverview["projection"]>;
export type GoalScenarioProjection = GoalProjection["scenarios"][number];
export type ContributionHistory = GoalOverview["contributions"];

/** `YYYY-MM` as a short month and year, e.g. `Mar 2041`. */
export function monthKeyLabel(key: string, locale: string): string {
  const [year, month] = key.split("-").map(Number);

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** A count of months as years and months, e.g. `18 years and 9 months`. */
export function durationLabel(totalMonths: number, i18n: I18n): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const yearsText = i18n._(
    t({
      id: "goals.durationYears",
      message: plural(years, { one: "# year", other: "# years" }),
    }),
  );
  const monthsText = i18n._(
    t({
      id: "goals.durationMonths",
      message: plural(months, { one: "# month", other: "# months" }),
    }),
  );

  if (years === 0) {
    return monthsText;
  }

  if (months === 0) {
    return yearsText;
  }

  return i18n._(
    t({
      id: "goals.durationYearsAndMonths",
      message: `${yearsText} and ${monthsText}`,
    }),
  );
}
