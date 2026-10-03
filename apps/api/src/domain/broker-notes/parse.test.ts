import { describe, expect, it } from "vitest";
import type { PdfPage } from "../../lib/pdf-text";
import { page, sinacorPage } from "./fixtures.test-helpers";
import { describeB3Security } from "./inter-dtvm";
import { parseBrokerNotePages } from "./parse";
import { parseBrazilianAmount, parseUsAmount, parseUsDate } from "./text";
import { BrokerNoteParseError } from "./types";

type Row = [number, ...[number, string][]];

/**
 * Three buys (2.645,22) and one sale (431,00); costs 0,77 + 0,15 + 0,06;
 * IRRF 0,02 on the sale, outside the net amount as Inter prints it.
 */
const trades = [
  {
    side: "C" as const,
    spec: [
      [218, "UNT"],
      [242, "N2"],
      [280, "BTGP BANCO"],
    ] as [number, string][],
    quantity: "20",
    price: "54,90",
    value: "1.098,00",
  },
  {
    side: "C" as const,
    spec: [
      [218, "ON"],
      [240, "NM"],
      [280, "TIM"],
    ] as [number, string][],
    obs: "D",
    quantity: "50",
    price: "18,57",
    value: "928,50",
  },
  {
    side: "C" as const,
    market: "VIS",
    spec: [
      [218, "CI"],
      [280, "FII XP LOG"],
    ] as [number, string][],
    quantity: "6",
    price: "103,12",
    value: "618,72",
  },
  {
    side: "V" as const,
    market: "VIS",
    spec: [
      [218, "PNB N1"],
      [280, "ELETROBRAS"],
    ] as [number, string][],
    quantity: "10",
    price: "43,10",
    value: "431,00",
  },
];

function summary({
  purchases = "2.645,22",
  net = "2.215,20",
}: {
  purchases?: string;
  net?: string;
} = {}): Row[] {
  return [
    [487, [23, "Debêntures"], [277, "0,00"], [301, "Clearing"]],
    [
      497,
      [23, "Vendas à vista"],
      [277, "431,00"],
      [301, "Valor líquido das operações"],
      [523, "2.214,22"],
      [561, "D"],
    ],
    [
      507,
      [23, "Compras à vista"],
      [264, purchases],
      [301, "Taxa de liquidação"],
      [536, "0,77"],
      [561, "D"],
    ],
    [517, [301, "Taxa de Registro"], [536, "0,00"], [561, "D"]],
    [558, [23, "Valor das operações"], [264, "3.076,22"]],
    [572, [301, "Emolumentos"], [536, "0,15"], [561, "D"]],
    [583, [301, "Total"], [536, "0,15"], [561, "D"]],
    [599, [21, "Especificações diversas"], [299, "Depositária"]],
    [612, [299, "Taxa de Tranferência de Ativos"], [536, "0,06"], [561, "D"]],
    [638, [301, "Corretagem / Despesas"]],
    [649, [301, "Clearing"], [537, "0,00"], [561, "D"]],
    [689, [301, "I.R.R.F. s/ operações, base"], [393, "431,00"], [537, "0,02"]],
    [722, [301, "Líquido para"], [361, "03/09/2026"], [523, net], [561, "D"]],
  ];
}

function parseError(pages: PdfPage[]): BrokerNoteParseError {
  try {
    parseBrokerNotePages(pages);
  } catch (error) {
    if (error instanceof BrokerNoteParseError) return error;
    throw error;
  }
  throw new Error("Expected the document to be rejected");
}

describe("text parsing", () => {
  it("reads Brazilian and US amounts exactly", () => {
    expect(parseBrazilianAmount("1.205,96")).toBe("1205.96");
    expect(parseBrazilianAmount("-102,32")).toBe("-102.32");
    expect(parseBrazilianAmount("1.000")).toBe("1000");
    expect(parseUsAmount("($494.84)")).toBe("-494.84");
    expect(parseUsAmount("$1,234.56")).toBe("1234.56");
    expect(parseUsAmount("-0.38281")).toBe("-0.38281");
    expect(parseUsDate("03/06/24")).toBe("2024-03-06");
    expect(parseUsDate("9/1/2026")).toBe("2026-09-01");
  });

  it("refuses malformed numbers and dates instead of guessing", () => {
    expect(() => parseBrazilianAmount("1,2,3")).toThrow(BrokerNoteParseError);
    expect(() => parseUsAmount("($1.00")).toThrow(BrokerNoteParseError);
    expect(() => parseUsDate("13/40/2024")).toThrow(BrokerNoteParseError);
  });
});

describe("describeB3Security", () => {
  it("keys a security by name and class, without markers", () => {
    expect(describeB3Security(["ON", "EJ", "NM", "TUPY"]).sourceKey).toBe(
      "B3:TUPY|ON",
    );
    expect(describeB3Security(["ON", "NM", "TUPY"]).sourceKey).toBe(
      "B3:TUPY|ON",
    );
    expect(describeB3Security(["ELETROBRAS", "PNB", "N1"]).sourceKey).toBe(
      "B3:ELETROBRAS|PNB",
    );
  });

  it("uses a printed ticker and drops the fractional suffix", () => {
    expect(describeB3Security(["XMAL11", "CI"])).toMatchObject({
      sourceKey: "B3:XMAL11",
      ticker: "XMAL11",
    });
    expect(describeB3Security(["PETR4F", "PN"]).ticker).toBe("PETR4");
  });

  it("suggests a class from the specification", () => {
    expect(describeB3Security(["CI", "FII", "XP", "LOG"]).classHint).toBe(
      "reit",
    );
    expect(describeB3Security(["CI", "ISHARE", "SP500"]).classHint).toBe("etf");
    expect(describeB3Security(["DRN", "AMAZON"]).classHint).toBe("bdr");
    expect(describeB3Security(["UNT", "N2", "BTGP", "BANCO"]).classHint).toBe(
      "stock_br",
    );
  });
});

describe("Inter DTVM SINACOR note", () => {
  it("reads trades, costs, IRRF and settlement when everything reconciles", () => {
    const [note, ...rest] = parseBrokerNotePages([
      sinacorPage({ trades, summary: summary() }),
    ]);

    expect(rest).toHaveLength(0);
    expect(note).toMatchObject({
      format: "inter-dtvm-sinacor",
      currency: "BRL",
      noteNumber: "43172350",
      account: "999999999",
      tradeDate: "2026-09-01",
      settlementDate: "2026-09-03",
      purchasesTotal: "2645.22",
      salesTotal: "431.00",
      feesTotal: "0.98",
      withheldTax: "0.02",
      dayTradeWithheldTax: "0.00",
      withheldTaxBase: "431.00",
      netAmount: "-2215.20",
      fees: [
        { label: "Taxa de liquidação", amount: "0.77" },
        { label: "Emolumentos", amount: "0.15" },
        { label: "Taxa de transferência de ativos", amount: "0.06" },
      ],
    });
    expect(
      note?.trades.map((trade) => [
        trade.side,
        trade.sourceKey,
        trade.quantity,
        trade.executionPrice,
        trade.grossValue,
        trade.market,
        trade.flags,
      ]),
    ).toEqual([
      ["buy", "B3:BTGP BANCO|UNT", "20", "54.90", "1098.00", "FRA", []],
      ["buy", "B3:TIM|ON", "50", "18.57", "928.50", "FRA", ["D"]],
      ["buy", "B3:FII XP LOG|CI", "6", "103.12", "618.72", "VIS", []],
      ["sell", "B3:ELETROBRAS|PNB", "10", "43.10", "431.00", "VIS", []],
    ]);
  });

  it("treats Inter's note number 0 as no number", () => {
    const [note] = parseBrokerNotePages([
      sinacorPage({ noteNumber: "0", trades, summary: summary() }),
    ]);

    expect(note?.noteNumber).toBeNull();
  });

  it("rejects a note whose totals disagree with its lines", () => {
    expect(
      parseError([
        sinacorPage({ trades, summary: summary({ purchases: "2.645,23" }) }),
      ]).code,
    ).toBe("reconciliation_failed");
  });

  it("rejects a net amount that the itemized costs do not explain", () => {
    expect(
      parseError([
        sinacorPage({ trades, summary: summary({ net: "2.215,21" }) }),
      ]).message,
    ).toMatch(/Itemized costs are 0.98, the net amount implies 0.99/);
  });

  it("rejects a line whose quantity × price is not its value", () => {
    const misread = trades.map((trade, index) =>
      index === 0 ? { ...trade, price: "54,99" } : trade,
    );

    expect(
      parseError([sinacorPage({ trades: misread, summary: summary() })]).code,
    ).toBe("reconciliation_failed");
  });

  it("rejects options and other non-spot markets", () => {
    const option = trades.map((trade, index) =>
      index === 0 ? { ...trade, market: "OPCAO DE COMPRA" } : trade,
    );

    expect(
      parseError([sinacorPage({ trades: option, summary: summary() })]).code,
    ).toBe("unsupported_market");
  });

  it("rejects a note without its financial summary", () => {
    expect(parseError([sinacorPage({ trades, summary: [] })]).code).toBe(
      "invalid_layout",
    );
  });

  /** Trades fill page 1; page 2 has no header, only the summary. */
  function splitAcrossPages(tradeRows: typeof trades) {
    const first = sinacorPage({ trades: tradeRows, summary: [] });

    return [
      {
        ...first,
        lines: first.lines.filter(
          (line) => !line.text.startsWith("Resumo dos negócios"),
        ),
      },
      page(2, [
        [32, [22, "Resumo dos negócios"], [300, "Resumo financeiro"]],
        ...summary(),
      ]),
    ];
  }

  it("reads a note whose summary is on a continuation page", () => {
    const [note, ...rest] = parseBrokerNotePages(splitAcrossPages(trades));

    expect(rest).toHaveLength(0);
    expect(note).toMatchObject({
      tradeDate: "2026-09-01",
      purchasesTotal: "2645.22",
      netAmount: "-2215.20",
    });
    expect(note?.trades).toHaveLength(4);
  });

  it("still rejects a continuation note that lost a line", () => {
    expect(parseError(splitAcrossPages(trades.slice(1))).code).toBe(
      "reconciliation_failed",
    );
  });

  it("rejects a document that starts with a continuation page", () => {
    const [, summaryPage] = splitAcrossPages(trades);

    expect(parseError([summaryPage as PdfPage]).code).toBe("unknown_format");
  });
});

describe("Inter DTVM home-broker print", () => {
  const legacy = page(1, [
    [57, [222, "Inter DTVM Ltda."]],
    [
      114,
      [304, "Data pregão: 10/01/2022"],
      [419, "Nº Nota: 14802450"],
      [518, "Folha: 1"],
    ],
    [172, [35, "Banco"], [154, "Agência"], [302, "Conta Corrente"]],
    [181, [35, "077"], [154, "00019"], [302, "10411576-9"]],
    [
      198,
      [47, "Praça"],
      [83, "C/V"],
      [102, "Tipo Mercado"],
      [168, "Especificação do Título"],
      [271, "OBS(*)"],
      [308, "Quantidade"],
      [368, "Preço Liquidação (R$)"],
      [468, "Compra/Venda (R$)"],
      [548, "D/C"],
    ],
    [
      209,
      [37, "1-Bovespa"],
      [87, "C"],
      [100, "VIS"],
      [161, "XMAL11 CI"],
      [345, "15"],
      [439, "6,82"],
      [519, "102,30"],
      [552, "D"],
    ],
    [218, [162, "SubTotal :"], [345, "15"], [430, "6,8200"], [519, "102,30"]],
    [445, [120, "Resumo dos Negócios"], [392, "Resumo Financeiro"]],
    [
      456,
      [34, "Debêntures"],
      [280, "0,00"],
      [300, "Valor Líquido das Operações(1)"],
      [523, "-102,30"],
      [553, "D"],
    ],
    [
      467,
      [34, "Vendas à Vista"],
      [280, "0,00"],
      [300, "Taxa de Liquidação(2)"],
      [534, "0,02"],
      [553, "D"],
    ],
    [
      477,
      [34, "Compras à Vista"],
      [272, "102,30"],
      [300, "Taxa de Registro(3)"],
      [534, "0,00"],
      [553, "D"],
    ],
    [
      488,
      [34, "Opções - Compras"],
      [280, "0,00"],
      [300, "Total(1+2+3) A"],
      [523, "-102,32"],
      [553, "D"],
    ],
    [
      540,
      [34, "Valor das Operações"],
      [272, "102,30"],
      [300, "Corretagem"],
      [534, "0,00"],
      [553, "D"],
    ],
    [
      561,
      [34, "IR Sobre Corretagem"],
      [280, "0,00"],
      [300, "I.R.R.F. s/ operações, base 0,00"],
      [534, "0,00"],
      [553, "D"],
    ],
    [582, [300, "Liquido para 12/01/2022"], [523, "-102,32"], [553, "D"]],
  ]);

  it("reads the printed ticker and the net amount", () => {
    const [note] = parseBrokerNotePages([legacy]);

    expect(note).toMatchObject({
      format: "inter-dtvm-web",
      noteNumber: "14802450",
      account: "10411576-9",
      tradeDate: "2022-01-10",
      settlementDate: "2022-01-12",
      purchasesTotal: "102.30",
      feesTotal: "0.02",
      netAmount: "-102.32",
    });
    expect(note?.trades).toHaveLength(1);
    expect(note?.trades[0]).toMatchObject({
      ticker: "XMAL11",
      quantity: "15",
      executionPrice: "6.82",
      grossValue: "102.30",
    });
  });
});

describe("Apex Clearing confirmation", () => {
  const apex = page(2, [
    [24, [46, "Apex Clearing Corporation"]],
    [120, [81, "Account Number: 3IN-00000"], [332, "Account Name: TEST"]],
    [
      163,
      [19, "Type"],
      [55, "B/S"],
      [82, "Trade Date"],
      [136, "Settle Date"],
      [190, "QTY"],
      [244, "SYM"],
      [298, "PRICE"],
      [361, "Principal"],
      [424, "COMM"],
      [470, "Tran Fee"],
      [533, "Fees"],
      [596, "Number"],
      [635, "Net Amount Trade#"],
    ],
    [
      178,
      [18, "1"],
      [54, "B"],
      [81, "03/06/24"],
      [135, "03/08/24"],
      [189, "0.24288"],
      [243, "AMT"],
      [297, "205.8585000"],
      [393, "50.00"],
      [423, "0.00"],
      [469, "0.00"],
      [531, "0.00"],
      [595, "P4316"],
      [634, "50.00"],
      [690, "INT0308"],
    ],
    [
      190,
      [18, "Desc:"],
      [54, "AMERICAN TOWER CORPORATION REIT"],
      [531, "Interest/STTax:"],
      [595, "0.00"],
      [634, "CUSIP:"],
      [690, "03027X100"],
    ],
    [202, [18, "Currency: USD"], [135, "ReportedPX:"]],
    [
      227,
      [18, "1"],
      [54, "S"],
      [81, "03/06/24"],
      [135, "03/08/24"],
      [189, "2"],
      [243, "O"],
      [297, "52.6234000"],
      [393, "105.25"],
      [423, "0.00"],
      [469, "0.01"],
      [531, "0.00"],
      [595, "Q1111"],
      [634, "105.24"],
      [690, "INT0308"],
    ],
    [
      239,
      [18, "Desc:"],
      [54, "REALTY INCOME CORP"],
      [531, "Interest/STTax:"],
      [595, "0.00"],
      [634, "CUSIP:"],
      [690, "756109104"],
    ],
    [251, [18, "Currency: USD"]],
    [396, [135, "SUMMARY FOR CURRENT TRADE DATE:"], [379, "03/06/24"]],
    [
      408,
      [135, "TOTAL SHARES BOUGHT:"],
      [397, "0.24"],
      [423, "TOTAL DOLLARS BOUGHT:"],
      [629, "-50.00"],
    ],
    [
      419,
      [135, "TOTAL SHARES SOLD:"],
      [397, "2.00"],
      [423, "TOTAL DOLLARS SOLD:"],
      [642, "105.24"],
    ],
  ]);

  it("reads each line with its own fees and the daily summary", () => {
    const [note] = parseBrokerNotePages([apex]);

    expect(note).toMatchObject({
      format: "apex-confirm",
      currency: "USD",
      account: "3IN-00000",
      tradeDate: "2024-03-06",
      settlementDate: "2024-03-08",
      purchasesTotal: "50.00",
      salesTotal: "105.25",
      feesTotal: "0.01",
      netAmount: "55.24",
    });
    expect(note?.trades.map((trade) => trade.classHint)).toEqual([
      "reit",
      "stock_us",
    ]);
    expect(note?.trades[1]).toMatchObject({
      side: "sell",
      ticker: "O",
      quantity: "2",
      grossValue: "105.25",
      netValue: "105.24",
      references: { tag: "Q1111", trade: "INT0308", cusip: "756109104" },
    });
  });

  it("rejects a line whose fees do not explain its net amount", () => {
    const broken = {
      ...apex,
      lines: apex.lines.map((line) =>
        line.text.includes("105.24  INT0308")
          ? {
              ...line,
              text: line.text.replace("105.24  INT0308", "105.20  INT0308"),
            }
          : line,
      ),
    };

    expect(parseError([broken]).code).toBe("reconciliation_failed");
  });
});

describe("DriveWealth confirmation", () => {
  const header: Row = [
    183,
    [32, "Symbol"],
    [107, "Security"],
    [276, "A/CType"],
    [308, "Action"],
    [361, "Execution Time"],
    [439, "Quantity"],
    [506, "Price"],
    [534, "Trade Date"],
    [577, "Settle Date"],
    [656, "Capacity"],
  ];
  const footer: Row = [
    766,
    [29, "Clearing and execution services provided by DriveWealth, LLC"],
  ];
  const first = page(1, [
    [71, [38, "Account Number:"], [105, "ITER-001-TEST"]],
    [167, [332, "Confirmation Date :"], [412, "11/6/2025"]],
    header,
    [
      194,
      [32, "SPGI"],
      [107, "S&P GLOBAL INC"],
      [162, "COM"],
      [287, "M"],
      [313, "Sell"],
      [371, "10:41:34 AM"],
      [458, "-1"],
      [496, "494.8386"],
      [538, "11/6/2025"],
      [581, "11/7/2025"],
      [661, "Agency"],
    ],
    [210, [465, "Principal Amount"], [653, "($494.84)"]],
    [220, [465, "Interest"]],
    [228, [465, "Commission"], [663, "$0.00"]],
    [238, [465, "Transaction Fee"], [663, "$0.01"]],
    [248, [465, "Other Fees / Credits"], [663, "$0.00"]],
    [262, [465, "Net Amount"], [653, "($494.83)"]],
    footer,
  ]);
  const second = page(2, [
    header,
    [
      135,
      [32, "INTR"],
      [107, "INTER & CO INC"],
      [159, "CLASS A COM"],
      [287, "M"],
      [312, "Buy"],
      [371, "12:27:55 PM"],
      [431, "0.32365696"],
      [503, "9.6386"],
      [538, "11/6/2025"],
      [581, "11/7/2025"],
      [658, "Principal"],
    ],
    [151, [465, "Principal Amount"], [663, "$3.12"]],
    [160, [465, "Interest"]],
    [169, [465, "Commission"], [663, "$0.00"]],
    [179, [465, "Transaction Fee"], [663, "$0.00"]],
    [189, [465, "Other Fees / Credits"], [663, "$0.00"]],
    [203, [465, "Net Amount"], [663, "$3.12"]],
    footer,
  ]);
  const terms = page(3, [[125, [31, "Transaction Terms"]], footer]);

  it("reads trades across pages and stops at the legal terms", () => {
    const [note] = parseBrokerNotePages([first, second, terms]);

    expect(note).toMatchObject({
      format: "drivewealth-confirm",
      account: "ITER-001-TEST",
      tradeDate: "2025-11-06",
      settlementDate: "2025-11-07",
      purchasesTotal: "3.12",
      salesTotal: "494.84",
      feesTotal: "0.01",
      netAmount: "491.71",
    });
    expect(
      note?.trades.map((trade) => [
        trade.side,
        trade.ticker,
        trade.quantity,
        trade.market,
      ]),
    ).toEqual([
      ["sell", "SPGI", "1", "Agency"],
      ["buy", "INTR", "0.32365696", "Principal"],
    ]);
  });

  it("rejects a trade without its amounts", () => {
    const truncated = {
      ...first,
      lines: first.lines.filter((line) => !line.text.startsWith("Net Amount")),
    };

    expect(parseError([truncated]).code).toBe("invalid_layout");
  });
});

it("rejects documents nobody recognizes", () => {
  expect(
    parseError([page(1, [[10, [10, "Extrato mensal de conta corrente"]]])])
      .code,
  ).toBe("unknown_format");
});
