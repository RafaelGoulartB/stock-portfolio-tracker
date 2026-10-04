import {
  assetTaxProfileInput,
  darfPaymentInput,
  type ForeignCashBalance,
  foreignCashInput,
  type IncomeTaxReport,
  type IncomeTaxSettings,
  incomeTaxReportInput,
  incomeTaxSettingsInput,
  removeDarfPaymentInput,
  removeForeignCashInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, min } from "drizzle-orm";
import { db } from "../../db";
import {
  assetTaxProfiles,
  brokerNotes,
  darfPayments,
  foreignCashBalances,
  incomeTaxSettings,
  transactions,
} from "../../db/schema";
import {
  brokerOfNoteFormat,
  buildIncomeTaxReport,
  defaultOpening,
  type IncomeTaxOpening,
} from "../../domain/income-tax";
import { formatDecimal, toDecimal } from "../../lib/decimal";
import { ptaxBuyRateOnOrBefore, saoPauloToday } from "../../lib/fx/bcb-ptax";
import { protectedProcedure, router } from "../trpc";
import { loadAccountSplits, loadTransactions } from "./transactions";

function currentYear(): number {
  return Number(saoPauloToday().slice(0, 4));
}

/** Stored amounts as plain decimals, without the column's trailing zeros. */
function plain(value: string): string {
  return formatDecimal(toDecimal(value), 2);
}

async function readOpening(userId: string): Promise<IncomeTaxOpening> {
  const [row] = await db
    .select()
    .from(incomeTaxSettings)
    .where(eq(incomeTaxSettings.userId, userId))
    .limit(1);

  if (row) {
    return {
      startYear: row.startYear,
      ordinaryLoss: plain(row.ordinaryLoss),
      dayTradeLoss: plain(row.dayTradeLoss),
      fiiLoss: plain(row.fiiLoss),
      foreignLoss: plain(row.foreignLoss),
      pendingDarf: plain(row.pendingDarf),
      configured: true,
    };
  }

  const [first] = await db
    .select({ tradedAt: min(transactions.tradedAt) })
    .from(transactions)
    .where(eq(transactions.userId, userId));

  return defaultOpening(
    first?.tradedAt ? [{ tradedAt: first.tradedAt }] : [],
    currentYear(),
  );
}

function cashBalanceOf(row: {
  year: number;
  amountUsd: string;
  valueBrl: string;
  institution: string | null;
}): ForeignCashBalance {
  return {
    year: row.year,
    amountUsd: plain(row.amountUsd),
    valueBrl: plain(row.valueBrl),
    institution: row.institution,
  };
}

/** The broker of each ticker's most recent imported note. */
async function brokersFromNotes(userId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ ticker: transactions.ticker, format: brokerNotes.format })
    .from(transactions)
    .innerJoin(brokerNotes, eq(brokerNotes.id, transactions.brokerNoteId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNotNull(transactions.brokerNoteId),
      ),
    )
    .orderBy(desc(transactions.tradedAt));
  const brokers = new Map<string, string>();

  for (const row of rows) {
    const broker = brokerOfNoteFormat(row.format);
    if (broker && !brokers.has(row.ticker)) brokers.set(row.ticker, broker);
  }

  return brokers;
}

export const incomeTaxRouter = router({
  settings: protectedProcedure.query(
    async ({ ctx }): Promise<IncomeTaxSettings> => readOpening(ctx.user.id),
  ),

  saveSettings: protectedProcedure
    .input(incomeTaxSettingsInput)
    .mutation(async ({ ctx, input }): Promise<IncomeTaxSettings> => {
      const values = {
        startYear: input.startYear,
        ordinaryLoss: input.ordinaryLoss,
        dayTradeLoss: input.dayTradeLoss,
        fiiLoss: input.fiiLoss,
        foreignLoss: input.foreignLoss,
        pendingDarf: input.pendingDarf,
        updatedAt: new Date(),
      };

      await db
        .insert(incomeTaxSettings)
        .values({ userId: ctx.user.id, ...values })
        .onConflictDoUpdate({ target: incomeTaxSettings.userId, set: values });

      return readOpening(ctx.user.id);
    }),

  /**
   * The year's assessment, recomputed from the whole ledger so any new,
   * edited or deleted trade or note is reflected in every later month.
   */
  report: protectedProcedure
    .input(incomeTaxReportInput)
    .query(async ({ ctx, input }): Promise<IncomeTaxReport> => {
      const userId = ctx.user.id;
      const [
        trades,
        splits,
        withheld,
        opening,
        payments,
        profiles,
        brokers,
        cash,
      ] = await Promise.all([
        loadTransactions(userId),
        loadAccountSplits(userId),
        db
          .select({
            tradeDate: brokerNotes.tradeDate,
            withheldTax: brokerNotes.withheldTax,
            dayTradeWithheldTax: brokerNotes.dayTradeWithheldTax,
          })
          .from(brokerNotes)
          .where(eq(brokerNotes.userId, userId)),
        readOpening(userId),
        db
          .select({
            month: darfPayments.month,
            paidOn: darfPayments.paidOn,
            amount: darfPayments.amount,
          })
          .from(darfPayments)
          .where(eq(darfPayments.userId, userId)),
        db
          .select()
          .from(assetTaxProfiles)
          .where(eq(assetTaxProfiles.userId, userId)),
        brokersFromNotes(userId),
        db
          .select()
          .from(foreignCashBalances)
          .where(
            and(
              eq(foreignCashBalances.userId, userId),
              inArray(foreignCashBalances.year, [input.year - 1, input.year]),
            ),
          ),
      ]);

      const report = buildIncomeTaxReport({
        year: input.year,
        // The tax ledger applies splits on their own dates.
        trades: trades.map(({ unitScale: _unitScale, ...trade }) => trade),
        splits,
        withheld,
        opening,
        payments,
      });
      const profileOf = new Map(
        profiles.map((profile) => [profile.ticker, profile]),
      );
      const cashOf = (year: number) => {
        const row = cash.find((entry) => entry.year === year);
        return row ? cashBalanceOf(row) : null;
      };

      return {
        ...report,
        holdings: report.holdings.map((holding) => {
          const profile = profileOf.get(holding.ticker);

          return {
            ...holding,
            legalName: profile?.legalName ?? null,
            cnpj: profile?.cnpj ?? null,
            broker: profile?.broker ?? brokers.get(holding.ticker) ?? null,
          };
        }),
        bonuses: report.bonuses.map((bonus) => ({
          ...bonus,
          legalName: profileOf.get(bonus.ticker)?.legalName ?? null,
          cnpj: profileOf.get(bonus.ticker)?.cnpj ?? null,
        })),
        foreignCash: {
          before: cashOf(input.year - 1),
          after: cashOf(input.year),
        },
      };
    }),

  /** Records (or corrects) the DARF paid for an assessed month. */
  recordDarfPayment: protectedProcedure
    .input(darfPaymentInput)
    .mutation(async ({ ctx, input }) => {
      const values = {
        paidOn: input.paidOn,
        amount: input.amount,
        updatedAt: new Date(),
      };

      await db
        .insert(darfPayments)
        .values({ userId: ctx.user.id, month: input.month, ...values })
        .onConflictDoUpdate({
          target: [darfPayments.userId, darfPayments.month],
          set: values,
        });

      return { month: input.month };
    }),

  removeDarfPayment: protectedProcedure
    .input(removeDarfPaymentInput)
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(darfPayments)
        .where(
          and(
            eq(darfPayments.userId, ctx.user.id),
            eq(darfPayments.month, input.month),
          ),
        );

      return { month: input.month };
    }),

  /** Saves a ticker's declaration facts; all-empty removes the record. */
  saveAssetProfile: protectedProcedure
    .input(assetTaxProfileInput)
    .mutation(async ({ ctx, input }) => {
      const scope = and(
        eq(assetTaxProfiles.userId, ctx.user.id),
        eq(assetTaxProfiles.ticker, input.ticker),
      );

      if (!input.legalName && !input.cnpj && !input.broker) {
        await db.delete(assetTaxProfiles).where(scope);
        return { ticker: input.ticker };
      }

      const values = {
        legalName: input.legalName,
        cnpj: input.cnpj,
        broker: input.broker,
        updatedAt: new Date(),
      };

      await db
        .insert(assetTaxProfiles)
        .values({ userId: ctx.user.id, ticker: input.ticker, ...values })
        .onConflictDoUpdate({
          target: [assetTaxProfiles.userId, assetTaxProfiles.ticker],
          set: values,
        });

      return { ticker: input.ticker };
    }),

  saveForeignCash: protectedProcedure
    .input(foreignCashInput)
    .mutation(async ({ ctx, input }): Promise<ForeignCashBalance> => {
      const values = {
        amountUsd: input.amountUsd,
        valueBrl: input.valueBrl,
        institution: input.institution,
        updatedAt: new Date(),
      };
      const [row] = await db
        .insert(foreignCashBalances)
        .values({ userId: ctx.user.id, year: input.year, ...values })
        .onConflictDoUpdate({
          target: [foreignCashBalances.userId, foreignCashBalances.year],
          set: values,
        })
        .returning();

      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return cashBalanceOf(row);
    }),

  removeForeignCash: protectedProcedure
    .input(removeForeignCashInput)
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(foreignCashBalances)
        .where(
          and(
            eq(foreignCashBalances.userId, ctx.user.id),
            eq(foreignCashBalances.year, input.year),
          ),
        );

      return { year: input.year };
    }),

  /**
   * BCB PTAX buy rate of the year's last business day, the conversion the
   * declaration uses for foreign balances held on 31 December.
   */
  yearEndBuyRate: protectedProcedure
    .input(incomeTaxReportInput)
    .query(async ({ input }) => {
      // A year still running has no 31 December rate yet.
      if (`${input.year}-12-31` > saoPauloToday()) return null;

      try {
        const point = await ptaxBuyRateOnOrBefore(`${input.year}-12-31`);
        return point ? { rate: point.rate, asOf: point.asOf } : null;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            error instanceof Error
              ? `BCB PTAX failed: ${error.message}`
              : "BCB PTAX failed",
        });
      }
    }),
});
