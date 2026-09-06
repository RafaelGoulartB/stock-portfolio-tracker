import { z } from "zod";
import { currencySchema } from "./currency";
import { assetClassSchema, tickerSchema } from "./transactions";

/**
 * Color tokens map to `--chart-n` CSS variables. Stored as keys, never as
 * ad-hoc hex, so the palette follows the active theme.
 */
export const CATEGORY_COLORS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
  "chart-7",
  "chart-8",
  "chart-9",
  "chart-10",
] as const;

export const categoryColorSchema = z.enum(CATEGORY_COLORS);
export type CategoryColor = z.infer<typeof categoryColorSchema>;

export const DEFAULT_CATEGORY_COLOR: CategoryColor = "chart-1";

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(40, "Use at most 40 characters")
  .regex(/\S/, "Name is required")
  .transform((value) => value.replace(/\s+/g, " "));

export const categoryIdSchema = z.uuid();

export const createCategoryInput = z.object({
  name: categoryNameSchema,
  color: categoryColorSchema.optional(),
});

export type CreateCategoryInput = z.input<typeof createCategoryInput>;

export const updateCategoryInput = z
  .object({
    id: categoryIdSchema,
    name: categoryNameSchema.optional(),
    color: categoryColorSchema.optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.color !== undefined,
    "Provide a name or a color",
  );

export type UpdateCategoryInput = z.input<typeof updateCategoryInput>;

export const deleteCategoryInput = z.object({ id: categoryIdSchema });

export const assignCategoryInput = z.object({
  ticker: tickerSchema,
  /** `null` clears the assignment (uncategorized). */
  categoryId: categoryIdSchema.nullable(),
});

export type AssignCategoryInput = z.input<typeof assignCategoryInput>;

export const assignManyCategoriesInput = z.object({
  tickers: z.array(tickerSchema).min(1).max(500),
  categoryId: categoryIdSchema.nullable(),
});

export type AssignManyCategoriesInput = z.input<
  typeof assignManyCategoriesInput
>;

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  color: categoryColorSchema,
  sortOrder: z.number(),
  assetCount: z.number(),
});

export type Category = z.infer<typeof categorySchema>;

export const categorizedAssetSchema = z.object({
  ticker: z.string(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  categoryId: z.string().nullable(),
  /** True when the ticker has at least one trade in the log. */
  traded: z.boolean(),
});

export type CategorizedAsset = z.infer<typeof categorizedAssetSchema>;
