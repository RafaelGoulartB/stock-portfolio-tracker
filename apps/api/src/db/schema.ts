import {
  ASSET_CLASSES,
  CURRENCIES,
  TRANSACTION_SIDES,
} from "@portifolio-tracker/shared";
import {
  date,
  index,
  integer,
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
    /** Free-order rank, ascending. Ties fall back to the ticker. */
    sortOrder: integer("sort_order").notNull().default(0),
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

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type AllocationAssetRow = typeof allocationAssets.$inferSelect;
export type AssetReviewRow = typeof assetReviews.$inferSelect;
