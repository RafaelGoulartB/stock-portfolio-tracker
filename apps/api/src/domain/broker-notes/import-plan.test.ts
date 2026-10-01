import { describe, expect, it } from "vitest";
import { noteFingerprint } from "./booking";
import {
  type PlanContext,
  type PlanLedgerEntry,
  planBrokerNoteImport,
  previewNote,
} from "./import-plan";
import type { ParsedBrokerNote, ParsedNoteTrade } from "./types";

function trade(partial: Partial<ParsedNoteTrade> = {}): ParsedNoteTrade {
  return {
    side: "buy",
    sourceKey: "B3:VALE|ON",
    description: "VALE ON",
    ticker: null,
    classHint: "stock_br",
    quantity: "10",
    executionPrice: "60.00",
    grossValue: "600.00",
    netValue: null,
    market: "VIS",
    flags: [],
    settlementDate: null,
    references: {},
    ...partial,
  };
}

function note(partial: Partial<ParsedBrokerNote> = {}): ParsedBrokerNote {
  return {
    format: "inter-dtvm-sinacor",
    currency: "BRL",
    noteNumber: null,
    account: null,
    tradeDate: "2026-01-05",
    settlementDate: "2026-01-07",
    trades: [trade()],
    fees: [],
    purchasesTotal: "600.00",
    salesTotal: "0.00",
    feesTotal: "0.00",
    withheldTax: "0.00",
    withheldTaxBase: null,
    netAmount: "-600.00",
    ...partial,
  };
}

function ledger(partial: Partial<PlanLedgerEntry> = {}): PlanLedgerEntry {
  return {
    ticker: "VALE3",
    assetClass: "stock_br",
    currency: "BRL",
    side: "buy",
    quantity: "10",
    price: "50",
    fees: "0",
    tradedAt: "2025-06-01",
    createdAt: new Date("2025-06-01T12:00:00Z"),
    manual: true,
    ...partial,
  };
}

function plan(
  notes: ParsedBrokerNote[],
  context: Partial<Omit<PlanContext, "documents">> = {},
) {
  return planBrokerNoteImport({
    documents: notes.map((value, index) => ({
      fileName: `note-${index}.pdf`,
      sha256: String(index).repeat(64),
      notes: [value],
    })),
    history: [],
    splits: [],
    importedFingerprints: new Set(),
    savedAliases: new Map(),
    mappings: new Map(),
    classChoices: new Map(),
    allocationClasses: new Map(),
    selected: null,
    now: new Date("2026-02-01T00:00:00Z"),
    ...context,
  });
}

const sale = note({
  tradeDate: "2026-01-10",
  trades: [trade({ side: "sell", quantity: "4", grossValue: "240.00" })],
  purchasesTotal: "0.00",
  salesTotal: "240.00",
  netAmount: "240.00",
});

describe("planBrokerNoteImport", () => {
  it("blocks a security without ticker until it is mapped", () => {
    const blocked = plan([note()]);

    expect(blocked.notes[0]?.status).toBe("blocked");
    expect(blocked.notes[0]?.issues).toEqual([
      {
        code: "unmapped_security",
        ticker: null,
        available: null,
        description: "VALE ON",
      },
    ]);
    expect(blocked.securities).toEqual([
      {
        sourceKey: "B3:VALE|ON",
        description: "VALE ON",
        ticker: null,
        saved: false,
      },
    ]);

    const mapped = plan([note()], {
      mappings: new Map([["B3:VALE|ON", "VALE3"]]),
    });
    expect(mapped.notes[0]?.status).toBe("ready");
    expect(mapped.newTickers).toEqual([
      {
        ticker: "VALE3",
        currency: "BRL",
        suggestedClass: "stock_br",
        assetClass: "stock_br",
      },
    ]);
  });

  it("resolves saved mappings and lets the request override them", () => {
    const saved = new Map([["B3:VALE|ON", "VALE3"]]);

    expect(plan([note()], { savedAliases: saved }).securities[0]).toMatchObject(
      { ticker: "VALE3", saved: true },
    );
    expect(
      plan([note()], {
        savedAliases: saved,
        mappings: new Map([["B3:VALE|ON", "VALE5"]]),
      }).securities[0],
    ).toMatchObject({ ticker: "VALE5", saved: false });
  });

  it("skips notes already imported and repeated in the upload", () => {
    const value = note({ trades: [trade({ ticker: "VALE3" })] });
    const result = plan([value, value], {
      importedFingerprints: new Set(),
    });

    expect(result.notes.map((planned) => planned.status)).toEqual([
      "ready",
      "duplicate",
    ]);
    expect(
      plan([value], {
        importedFingerprints: new Set([noteFingerprint(value)]),
      }).notes[0]?.status,
    ).toBe("imported");
  });

  it("refuses to mix currencies on one ticker", () => {
    const usd = note({
      format: "apex-confirm",
      currency: "USD",
      trades: [trade({ ticker: "VALE3", sourceKey: "US:VALE3" })],
    });
    const result = plan([usd], { history: [ledger()] });

    expect(result.notes[0]?.issues.map((value) => value.code)).toEqual([
      "currency_conflict",
    ]);
  });

  it("blocks a sale the ledger cannot cover, with the quantity held", () => {
    const mapped = new Map([["B3:VALE|ON", "VALE3"]]);
    const result = plan([sale], {
      mappings: mapped,
      history: [ledger({ quantity: "3" })],
    });

    expect(result.notes[0]?.status).toBe("blocked");
    expect(result.notes[0]?.issues).toEqual([
      {
        code: "oversell",
        ticker: "VALE3",
        available: "3",
        description: null,
      },
    ]);
  });

  it("lets an earlier note of the upload cover a later sale", () => {
    const mapped = new Map([["B3:VALE|ON", "VALE3"]]);
    const result = plan([sale, note()], { mappings: mapped });

    expect(result.notes.map((planned) => planned.status)).toEqual([
      "ready",
      "ready",
    ]);

    // Trades are inserted by trade date, whatever the upload order.
    const [saleDrafts, buyDrafts] = result.notes.map(
      (planned) => planned.drafts,
    );
    expect(buyDrafts?.[0]?.createdAt.getTime()).toBeLessThan(
      saleDrafts?.[0]?.createdAt.getTime() ?? 0,
    );
  });

  it("does not let a later purchase cover an earlier sale", () => {
    const mapped = new Map([["B3:VALE|ON", "VALE3"]]);
    const laterBuy = note({ tradeDate: "2026-01-20" });
    const result = plan([sale, laterBuy], { mappings: mapped });

    expect(result.notes.map((planned) => planned.status)).toEqual([
      "blocked",
      "ready",
    ]);
  });

  it("only imports the selected notes", () => {
    const mapped = new Map([["B3:VALE|ON", "VALE3"]]);
    const buy = note();
    const result = plan([sale, buy], {
      mappings: mapped,
      selected: new Set([noteFingerprint(sale)]),
    });

    expect(result.notes[0]?.status).toBe("blocked");
    expect(result.notes[1]?.drafts).toEqual([]);
  });

  it("books new tickers with the chosen class and known ones with theirs", () => {
    const value = note({
      trades: [
        trade({ ticker: "XPLG11", sourceKey: "B3:XPLG11", classHint: "reit" }),
        trade({ ticker: "VALE3", sourceKey: "B3:VALE3" }),
      ],
    });
    const result = plan([value], {
      history: [ledger({ assetClass: "other" })],
      classChoices: new Map([
        ["XPLG11", "etf"],
        ["VALE3", "etf"],
      ]),
    });

    expect(result.notes[0]?.drafts.map((draft) => draft.assetClass)).toEqual([
      "etf",
      "other",
    ]);
    expect(result.newTickers).toEqual([
      {
        ticker: "XPLG11",
        currency: "BRL",
        suggestedClass: "reit",
        assetClass: "etf",
      },
    ]);
  });

  it("flags a manual trade that the note would count twice", () => {
    const value = note({ trades: [trade({ ticker: "VALE3" })] });
    const history = [ledger({ tradedAt: "2026-01-05", quantity: "10" })];
    const result = plan([value], { history });
    const preview = previewNote(
      result.notes[0] as (typeof result.notes)[number],
      result,
      history,
    );

    expect(preview.trades[0]?.possibleDuplicate).toBe(true);
    expect(preview.trades[0]?.total).toBe("600.00");
  });
});
