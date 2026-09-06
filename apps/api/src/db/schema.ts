import {
  ASSET_CLASSES,
  CURRENCIES,
  TRANSACTION_SIDES,
} from "@portifolio-tracker/shared";
import {
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
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

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
