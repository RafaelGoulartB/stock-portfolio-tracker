import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { i18n as defaultI18n } from "@/i18n";

/**
 * Shared validation strings live in `packages/shared` as English source
 * messages so the API and the schemas stay locale-free. React Hook Form and
 * the holdings importer surface those raw strings verbatim, which leaves the
 * `pt-BR` UI showing English. This helper is the single place that maps every
 * known validation source string to a Lingui message, so a `FormMessage` or an
 * import issue reads naturally in the active locale.
 *
 * The map is keyed by the exact English source string emitted by the Zod
 * schemas. Adding a new schema message means adding its case here; an unmapped
 * string falls through unchanged so a missing entry degrades to English rather
 * than to a blank field.
 */
const VALIDATION_MESSAGES: Record<string, MessageDescriptor> = {
  // auth.ts
  "Email is required": msg({
    id: "validation.emailRequired",
    message: "Email is required",
  }),
  "Email is too long": msg({
    id: "validation.emailTooLong",
    message: "Email is too long",
  }),
  "Enter a valid email": msg({
    id: "validation.emailInvalid",
    message: "Enter a valid email",
  }),
  "Use at least 8 characters": msg({
    id: "validation.passwordMin",
    message: "Use at least 8 characters",
  }),
  "Use at most 128 characters": msg({
    id: "validation.passwordMax",
    message: "Use at most 128 characters",
  }),

  // decimal.ts
  "Use digits with up to 8 decimal places": msg({
    id: "validation.decimalDigits",
    message: "Use digits with up to 8 decimal places",
  }),
  "Must be greater than zero": msg({
    id: "validation.positive",
    message: "Must be greater than zero",
  }),
  "Use the YYYY-MM-DD format": msg({
    id: "validation.dateFormat",
    message: "Use the YYYY-MM-DD format",
  }),
  "Not a valid calendar date": msg({
    id: "validation.dateInvalid",
    message: "Not a valid calendar date",
  }),

  // transactions.ts
  "Ticker is required": msg({
    id: "validation.tickerRequired",
    message: "Ticker is required",
  }),
  "Use at most 120 characters": msg({
    id: "validation.tickerMax",
    message: "Use at most 120 characters",
  }),
  "Use a single-line asset name": msg({
    id: "validation.tickerSingleLine",
    message: "Use a single-line asset name",
  }),
  "Use at most 280 characters": msg({
    id: "validation.notesMax",
    message: "Use at most 280 characters",
  }),
  "Add at least one holding": msg({
    id: "validation.holdingRequired",
    message: "Add at least one holding",
  }),
  "Cash is maintained from Allocation": msg({
    id: "validation.cashFromAllocation",
    message: "Cash is maintained from Allocation",
  }),
  "Value is required": msg({
    id: "validation.valueRequired",
    message: "Value is required",
  }),
  "Fixed income cannot be sold as a trade": msg({
    id: "validation.fixedIncomeNoSell",
    message: "Fixed income cannot be sold as a trade",
  }),
  "Side is required": msg({
    id: "validation.sideRequired",
    message: "Side is required",
  }),
  "Quantity is required": msg({
    id: "validation.quantityRequired",
    message: "Quantity is required",
  }),
  "Unit price is required": msg({
    id: "validation.priceRequired",
    message: "Unit price is required",
  }),

  // categories.ts
  "Name is required": msg({
    id: "validation.nameRequired",
    message: "Name is required",
  }),
  "Use at most 40 characters": msg({
    id: "validation.nameMax",
    message: "Use at most 40 characters",
  }),
  "Provide a name or a color": msg({
    id: "validation.nameOrColor",
    message: "Provide a name or a color",
  }),

  // allocation.ts
  "Use the YYYYQn format, e.g. 2026Q1": msg({
    id: "validation.quarterFormat",
    message: "Use the YYYYQn format, e.g. 2026Q1",
  }),
  "Use a weight between 0% and 100%": msg({
    id: "validation.weightRange",
    message: "Use a weight between 0% and 100%",
  }),
  "Use a full http(s) link": msg({
    id: "validation.httpLink",
    message: "Use a full http(s) link",
  }),
  "Use at most 2048 characters": msg({
    id: "validation.linkMax",
    message: "Use at most 2048 characters",
  }),
  "Use at most 24 characters": msg({
    id: "validation.valuationRefMax",
    message: "Use at most 24 characters",
  }),
  "Use a discount above -100%": msg({
    id: "validation.discountFloor",
    message: "Use a discount above -100%",
  }),
  "Use a discount up to 1000%": msg({
    id: "validation.discountCeiling",
    message: "Use a discount up to 1000%",
  }),
  "Use at most 2000 characters": msg({
    id: "validation.reviewNotesMax",
    message: "Use at most 2000 characters",
  }),
  "Small-book impact must be at least the large-book impact": msg({
    id: "validation.contributionImpactOrder",
    message: "Small-book impact must be at least the large-book impact",
  }),
  "Grade bands must be strictly ascending by minimum grade": msg({
    id: "validation.gradeBandsAscending",
    message: "Grade bands must be strictly ascending by minimum grade",
  }),

  // holdings-import.ts issues
  "Expected ticker, quantity and average price": msg({
    id: "validation.importColumns",
    message: "Expected ticker, quantity and average price",
  }),
  "Invalid ticker": msg({
    id: "validation.importTicker",
    message: "Invalid ticker",
  }),
  "Invalid quantity": msg({
    id: "validation.importQuantity",
    message: "Invalid quantity",
  }),
  "Invalid average price": msg({
    id: "validation.importPrice",
    message: "Invalid average price",
  }),
};

/**
 * The importer's duplicate-ticker issue embeds the ticker, so it is kept as a
 * placeholder message translated at runtime with the matched ticker value.
 */
const importDuplicateMessage = msg({
  id: "validation.importDuplicate",
  message: "Duplicate ticker {0}",
});

/**
 * Translates a known validation source string. Unknown strings are returned
 * unchanged so callers never render an empty message. The optional `i18n`
 * lets components pass their `useLingui` instance; it defaults to the shared
 * activated catalog for non-component callers.
 */
export function localizeValidationMessage(
  message: string,
  i18n: I18n = defaultI18n,
): string {
  const descriptor = VALIDATION_MESSAGES[message];

  if (descriptor) {
    return i18n._(descriptor);
  }

  // Some importer issues embed a ticker, e.g. `Duplicate ticker PETR4`.
  const duplicate = /^Duplicate ticker (.+)$/.exec(message);

  if (duplicate) {
    // The descriptor keeps the message extractable; the runtime call passes
    // the ticker as the `{0}` placeholder value.
    return i18n._(importDuplicateMessage.id ?? "", { 0: duplicate[1] });
  }

  return message;
}

/**
 * Actionable, localized message for an invalid manual price on the Positions
 * screen. The manual quote editor validates a value against `positiveDecimal`
 * and, before this helper, only toggled `aria-invalid` with no visible reason.
 * Reusing this keeps the message in one place so the extracted manual-price
 * card and any adopter render the same actionable copy in both locales.
 */
export function manualPriceErrorMessage(i18n: I18n = defaultI18n): string {
  return i18n._(
    msg({
      id: "positions.manualPriceInvalid",
      message: "Enter a price above zero using digits and up to 8 decimals.",
    }),
  );
}
