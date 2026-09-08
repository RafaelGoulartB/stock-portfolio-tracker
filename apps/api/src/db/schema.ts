import {
  ASSET_CLASSES,
  CURRENCIES,
  type GradeBand,
  TRANSACTION_SIDES,
} from "@portifolio-tracker/shared";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const assetClassEnum = pgEnum("asset_class", ASSET_CLASSES);
export const transactionSideEnum = pgEnum(
  "transaction_side",
  TRANSACTION_SIDES,
);
export const currencyEnum = pgEnum("currency", CURRENCIES);

/** Money and quantities are `numeric` so no value is ever stored as a float. */
const DECIMAL = { precision: 22, scale: 8 } as const;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token, never the token itself. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    assetClass: assetClassEnum("asset_class").notNull().default("stock_br"),
    currency: currencyEnum("currency").notNull().default("BRL"),
    side: transactionSideEnum("side").notNull(),
    quantity: numeric("quantity", DECIMAL).notNull(),
    price: numeric("price", DECIMAL).notNull(),
    fees: numeric("fees", DECIMAL).notNull().default("0"),
    tradedAt: date("traded_at").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("transactions_user_ticker_idx").on(table.userId, table.ticker),
    index("transactions_user_traded_at_idx").on(table.userId, table.tradedAt),
    index("transactions_user_history_order_idx").on(
      table.userId,
      table.tradedAt,
      table.createdAt,
      table.id,
    ),
  ],
);

/**
 * Per-ticker analysis metadata behind the allocation screen: the target
 * weight and the manual row order. Fair value lives on each quarterly
 * review. A row with no matching transaction is a watch-only asset: on the
 * radar, no money in it.
 */
export const allocationAssets = pgTable(
  "allocation_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    assetClass: assetClassEnum("asset_class").notNull().default("stock_br"),
    currency: currencyEnum("currency").notNull().default("BRL"),
    /** Target share of the portfolio, `0`-`1`. Null until the user sets it. */
    targetWeight: numeric("target_weight", DECIMAL),
    /** Optional pointer to the valuation write-up, e.g. `1Q26`. */
    valuationRef: text("valuation_ref"),
    /**
     * Native per-unit price used when the live quote provider has nothing
     * (fixed income, opaque tickers). Set from the allocation Value cell.
     */
    manualPrice: numeric("manual_price", DECIMAL),
    /** Free-order rank, ascending. Ties fall back to the ticker. */
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Soft row highlight on the allocation table (`blue` / `yellow` / …).
     * Null when unmarked. Meaning of each color is user-defined.
     */
    markColor: text("mark_color"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("allocation_assets_user_ticker_key").on(
      table.userId,
      table.ticker,
    ),
  ],
);

/** Current BRL cash balance. Absence is the virtual zero balance. */
export const cashBalances = pgTable("cash_balances", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: numeric("amount", DECIMAL).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One quarterly review of an asset: a grade, notes, fair value, or any mix. */
export const assetReviews = pgTable(
  "asset_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    /** Calendar quarter, `YYYYQn`. Keys sort chronologically as text. */
    period: text("period").notNull(),
    /** `0`-`10`, null when the quarter only carries notes or a fair value. */
    grade: numeric("grade", DECIMAL),
    notes: text("notes"),
    /**
     * Per-share fair value in the asset's native currency for this quarter.
     * The allocation discount uses the newest quarter that has one.
     */
    fairValue: numeric("fair_value", DECIMAL),
    /** Optional URL to the valuation write-up behind this fair value. */
    fairValueRef: text("fair_value_ref"),
    /**
     * When true, the next quarter of this ticker is flagged for attention.
     * It does not change the score; it is a review workflow marker.
     */
    watchNext: boolean("watch_next").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("asset_reviews_user_ticker_period_key").on(
      table.userId,
      table.ticker,
      table.period,
    ),
    index("asset_reviews_user_id_idx").on(table.userId),
  ],
);

/**
 * User-defined labels for grouping tickers. One ticker belongs to at most
 * one category; uncategorized assets simply have no assignment row.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Key of a `--chart-n` token, never a raw color. */
    color: text("color").notNull().default("chart-1"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_user_name_key").on(table.userId, table.name),
    index("categories_user_id_idx").on(table.userId),
  ],
);

export const assetCategories = pgTable(
  "asset_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("asset_categories_user_ticker_key").on(
      table.userId,
      table.ticker,
    ),
    index("asset_categories_user_category_idx").on(
      table.userId,
      table.categoryId,
    ),
  ],
);

/**
 * Per-user contribution-score policy. Missing row means
 * `DEFAULT_SCORE_CONFIG` from `@portifolio-tracker/shared`.
 */
export const userScoreConfigs = pgTable("user_score_configs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  absoluteWeightCap: numeric("absolute_weight_cap", DECIMAL).notNull(),
  overweightBlockFactor: numeric("overweight_block_factor", DECIMAL).notNull(),
  trimFactor: numeric("trim_factor", DECIMAL).notNull(),
  cooldownDays: integer("cooldown_days").notNull(),
  gradeWindowQuarters: integer("grade_window_quarters").notNull(),
  gradeBands: jsonb("grade_bands").$type<GradeBand[]>().notNull(),
  ungradedMultiplier: numeric("ungraded_multiplier", DECIMAL).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Per-user contribution-planner policy. Missing row means
 * `DEFAULT_CONTRIBUTION_PLAN_CONFIG` from `@portifolio-tracker/shared`.
 */
export const userContributionPlanConfigs = pgTable(
  "user_contribution_plan_configs",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    smallBookImpact: numeric("small_book_impact", DECIMAL).notNull(),
    largeBookImpact: numeric("large_book_impact", DECIMAL).notNull(),
    maxShare: numeric("max_share", DECIMAL).notNull(),
    maxAssets: integer("max_assets").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type AllocationAssetRow = typeof allocationAssets.$inferSelect;
export type CashBalanceRow = typeof cashBalances.$inferSelect;
export type AssetReviewRow = typeof assetReviews.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type AssetCategoryRow = typeof assetCategories.$inferSelect;
export type UserScoreConfigRow = typeof userScoreConfigs.$inferSelect;
export type UserContributionPlanConfigRow =
  typeof userContributionPlanConfigs.$inferSelect;
