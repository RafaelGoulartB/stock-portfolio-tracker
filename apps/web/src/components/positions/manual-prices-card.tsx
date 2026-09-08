import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  positiveDecimal,
  type ValuedPosition,
} from "@portifolio-tracker/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { manualPriceErrorMessage } from "@/lib/validation-messages";

/** Per-ticker price editor backing the manual quote source. */
export function ManualPricesCard({
  positions,
}: {
  positions: ValuedPosition[];
}) {
  const { i18n } = useLingui();
  const { manualPrices, setManualPrice } = useSettings();
  const open = positions.filter((position) => Number(position.quantity) > 0);

  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      open.map((position) => [
        position.ticker,
        manualPrices[position.ticker] ?? "",
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  if (open.length === 0) {
    return null;
  }

  function save() {
    const nextErrors: Record<string, boolean> = {};
    let valid = true;

    for (const position of open) {
      const raw = (drafts[position.ticker] ?? "").trim();

      if (raw.length === 0) {
        continue;
      }

      if (!positiveDecimal.safeParse(raw).success) {
        nextErrors[position.ticker] = true;
        valid = false;
      }
    }

    setErrors(nextErrors);

    if (!valid) {
      return;
    }

    for (const position of open) {
      setManualPrice(position.ticker, (drafts[position.ticker] ?? "").trim());
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.manualPrices">Manual prices</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.manualPricesHint">
            Native-currency price per unit. Manual prices apply to every month.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((position) => (
            <div key={position.ticker} className="grid gap-1.5">
              <Label
                htmlFor={`manual-price-${position.ticker}`}
                className="w-full justify-between text-xs"
              >
                <span>
                  {position.ticker} ({position.currency})
                </span>
                <span className="font-normal text-muted-foreground tabular-nums">
                  {position.marketPrice
                    ? formatMoney(position.marketPrice, position.currency)
                    : "—"}
                </span>
              </Label>
              <Input
                id={`manual-price-${position.ticker}`}
                inputMode="decimal"
                placeholder="0.00"
                value={drafts[position.ticker] ?? ""}
                aria-invalid={!!errors[position.ticker]}
                aria-describedby={
                  errors[position.ticker]
                    ? `manual-price-error-${position.ticker}`
                    : undefined
                }
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [position.ticker]: event.target.value,
                  }))
                }
              />
              {errors[position.ticker] ? (
                <p
                  id={`manual-price-error-${position.ticker}`}
                  className="text-xs text-destructive"
                >
                  {manualPriceErrorMessage(i18n)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <Button type="button" size="sm" onClick={save}>
          <Trans id="positions.savePrices">Save prices</Trans>
        </Button>
      </CardContent>
    </Card>
  );
}
