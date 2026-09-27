import {
  type Currency,
  FX_EXECUTION_IOF,
  FX_EXECUTION_SPREAD,
} from "@portifolio-tracker/shared";
import { add, formatDecimal, mul, sub, toDecimal } from "../lib/decimal";
import { convertMoney } from "./positions";

const ONE = toDecimal("1");

/**
 * Spot USD/BRL inflated by the contribution spread and IOF. Valuation of
 * existing positions keeps using the raw spot; only the planner reads this.
 */
export function usdBrlExecutionRate(spot: string): string {
  const factor = mul(
    add(ONE, toDecimal(FX_EXECUTION_SPREAD)),
    add(ONE, toDecimal(FX_EXECUTION_IOF)),
  );

  return formatDecimal(mul(toDecimal(spot), factor), 8);
}

/**
 * Extra fraction a BRL-funded USD purchase pays over spot:
 * `(1 + spread) × (1 + IOF) - 1`. The score uses it as a hurdle a cheap USD
 * asset must clear before valuation tilts its target up.
 */
export function executionCostRatio(): string {
  return formatDecimal(
    sub(
      mul(
        add(ONE, toDecimal(FX_EXECUTION_SPREAD)),
        add(ONE, toDecimal(FX_EXECUTION_IOF)),
      ),
      ONE,
    ),
    8,
  );
}

/**
 * Display-currency price used to turn a contribution slice into units.
 * USD assets shown in BRL pay the VET rate; every other pair uses spot.
 */
export function executionPrice(
  nativePrice: string | null,
  from: Currency,
  display: Currency,
  usdBrlSpot: string | null,
): { price: string | null; fxApplied: boolean } {
  if (nativePrice === null) {
    return { price: null, fxApplied: false };
  }

  if (from === display) {
    return {
      price: convertMoney(nativePrice, from, display, "1"),
      fxApplied: false,
    };
  }

  if (usdBrlSpot === null) {
    return { price: null, fxApplied: false };
  }

  const applyVet = from === "USD" && display === "BRL";

  return {
    price: convertMoney(
      nativePrice,
      from,
      display,
      applyVet ? usdBrlExecutionRate(usdBrlSpot) : usdBrlSpot,
    ),
    fxApplied: applyVet,
  };
}
