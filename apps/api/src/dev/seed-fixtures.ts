// DEV-ONLY fixture set for local manual testing.
//
// Isolated from production domain code: it only feeds the `devSeed` tRPC
// router, which refuses to run in production. Trades satisfy
// `createTransactionInput` and the one-currency-per-ticker rule. Sells never
// exceed the buys above them. Allocation rows and quarterly reviews are the
// research history the allocation screen and asset-detail page need.

import type {
  AssetClass,
  CreateTransactionInput,
  Currency,
  UpsertAllocationAssetInput,
  UpsertAssetReviewInput,
} from "@portifolio-tracker/shared";

const DEV_NOTE = "Dev seed data";

type SeedTrade = CreateTransactionInput;
type SeedAsset = Required<
  Pick<UpsertAllocationAssetInput, "ticker" | "assetClass" | "currency">
> & {
  targetWeight: string | null;
  valuationRef: string | null;
};
type SeedReview = Required<
  Pick<UpsertAssetReviewInput, "ticker" | "period">
> & {
  grade: string | null;
  notes: string | null;
  fairValue: string | null;
  fairValueRef: string | null;
};

type SeedName = {
  asset: SeedAsset;
  trades: SeedTrade[];
  reviews: SeedReview[];
};

function asset(
  ticker: string,
  assetClass: AssetClass,
  currency: Currency,
  targetWeight: string | null,
  valuationRef: string | null = null,
): SeedAsset {
  return { ticker, assetClass, currency, targetWeight, valuationRef };
}

function trade(
  ticker: string,
  assetClass: AssetClass,
  currency: Currency,
  side: SeedTrade["side"],
  quantity: string,
  price: string,
  tradedAt: string,
  fees = "0",
): SeedTrade {
  return {
    ticker,
    assetClass,
    currency,
    side,
    quantity,
    price,
    fees,
    tradedAt,
    notes: DEV_NOTE,
  };
}

function review(
  ticker: string,
  period: string,
  fields: {
    grade?: string;
    notes?: string;
    fairValue?: string;
    fairValueRef?: string;
  },
): SeedReview {
  return {
    ticker,
    period,
    grade: fields.grade ?? null,
    notes: fields.notes ?? null,
    fairValue: fields.fairValue ?? null,
    fairValueRef: fields.fairValueRef ?? null,
  };
}

const REF = {
  petr: "https://example.com/research/petr4/2026q2",
  aapl: "https://example.com/research/aapl/2026q1",
  hglg: "https://example.com/research/hglg11/2025q4",
  btc: "https://example.com/research/btc/2026q2",
  nvda: "https://example.com/research/nvda/2026q2",
} as const;

const CATALOG: SeedName[] = [
  {
    asset: asset("PETR4", "stock_br", "BRL", "0.06", "2Q26"),
    trades: [
      trade(
        "PETR4",
        "stock_br",
        "BRL",
        "buy",
        "100",
        "32.15",
        "2024-03-04",
        "5.00",
      ),
      trade(
        "PETR4",
        "stock_br",
        "BRL",
        "buy",
        "50",
        "35.40",
        "2024-06-10",
        "4.50",
      ),
      trade(
        "PETR4",
        "stock_br",
        "BRL",
        "sell",
        "60",
        "38.20",
        "2024-11-18",
        "6.00",
      ),
    ],
    reviews: [
      review("PETR4", "2024Q3", {
        grade: "7",
        notes: "Production beat. Still waiting on a cleaner refining margin.",
        fairValue: "42.00",
      }),
      review("PETR4", "2024Q4", {
        grade: "6.5",
        notes:
          "Dividend held; capex guidance a bit heavy. Fair value unchanged.",
        fairValue: "42.00",
      }),
      review("PETR4", "2025Q1", {
        grade: "7.5",
        notes: "Brent helped. Raised replacement-cost value.",
        fairValue: "45.00",
      }),
      review("PETR4", "2025Q2", {
        grade: "8",
        notes: "Cash generation covers the dividend with room to spare.",
        fairValue: "48.00",
      }),
      review("PETR4", "2025Q3", {
        notes: "No new work this quarter — carried the last valuation.",
        fairValue: "48.00",
      }),
      review("PETR4", "2025Q4", {
        grade: "7",
        notes: "Government talk on prices. Haircut on the multiple.",
        fairValue: "46.00",
      }),
      review("PETR4", "2026Q1", {
        grade: "8",
        notes: "Reserve revision was a non-event. Thesis intact.",
        fairValue: "50.00",
      }),
      review("PETR4", "2026Q2", {
        grade: "8.5",
        notes:
          "Cheap vs replacement cost after the pullback. Added to the model.",
        fairValue: "52.00",
        fairValueRef: REF.petr,
      }),
    ],
  },
  {
    asset: asset("VALE3", "stock_br", "BRL", "0.03", "FY25"),
    trades: [
      trade(
        "VALE3",
        "stock_br",
        "BRL",
        "buy",
        "200",
        "62.10",
        "2024-02-15",
        "8.00",
      ),
      trade(
        "VALE3",
        "stock_br",
        "BRL",
        "sell",
        "200",
        "65.00",
        "2024-09-02",
        "8.50",
      ),
    ],
    reviews: [
      review("VALE3", "2024Q2", {
        grade: "6",
        notes: "Iron ore was fine; Samarco still a drag. Exited into strength.",
        fairValue: "68.00",
      }),
      review("VALE3", "2024Q3", {
        grade: "5.5",
        notes: "Closed the position. Watching only until China demand turns.",
        fairValue: "64.00",
      }),
      review("VALE3", "2025Q2", {
        notes: "Still on the bench. No new fair value until volumes stabilize.",
      }),
      review("VALE3", "2026Q1", {
        grade: "6",
        notes: "Would re-enter below 55. Not there yet.",
        fairValue: "72.00",
      }),
    ],
  },
  {
    asset: asset("ITUB4", "stock_br", "BRL", "0.05"),
    trades: [
      trade(
        "ITUB4",
        "stock_br",
        "BRL",
        "buy",
        "300",
        "28.50",
        "2025-01-13",
        "7.20",
      ),
    ],
    reviews: [
      review("ITUB4", "2025Q1", {
        grade: "8",
        notes: "NII and credit quality both clean. Core holding.",
        fairValue: "34.00",
      }),
      review("ITUB4", "2025Q2", {
        grade: "8",
        fairValue: "35.00",
      }),
      review("ITUB4", "2025Q4", {
        grade: "7.5",
        notes: "Fee income a touch light. Still the best private bank.",
        fairValue: "36.00",
      }),
      review("ITUB4", "2026Q1", {
        grade: "8",
        fairValue: "38.00",
      }),
      review("ITUB4", "2026Q2", {
        grade: "8",
        notes: "ROE above cost of equity with a conservative payout.",
        fairValue: "40.00",
      }),
    ],
  },
  {
    asset: asset("BBDC4", "stock_br", "BRL", "0.04"),
    trades: [
      trade(
        "BBDC4",
        "stock_br",
        "BRL",
        "buy",
        "400",
        "12.80",
        "2024-09-16",
        "6.00",
      ),
      trade(
        "BBDC4",
        "stock_br",
        "BRL",
        "buy",
        "200",
        "14.10",
        "2025-04-22",
        "3.50",
      ),
    ],
    reviews: [
      review("BBDC4", "2024Q4", {
        grade: "5",
        notes: "Turnaround still a story, not a number. Cheap for a reason.",
        fairValue: "16.00",
      }),
      review("BBDC4", "2025Q2", {
        grade: "6",
        notes: "NPL formation finally rolled over.",
        fairValue: "17.50",
      }),
      review("BBDC4", "2025Q4", {
        grade: "6.5",
        fairValue: "18.00",
      }),
      review("BBDC4", "2026Q1", {
        grade: "6",
        notes: "Guidance conservative. Holding the stake, not adding.",
        fairValue: "18.50",
      }),
      review("BBDC4", "2026Q2", {
        grade: "7",
        notes: "Provision coverage back to a comfortable range.",
        fairValue: "19.50",
      }),
    ],
  },
  {
    asset: asset("WEGE3", "stock_br", "BRL", "0.04", "1Q26"),
    trades: [
      trade(
        "WEGE3",
        "stock_br",
        "BRL",
        "buy",
        "80",
        "38.40",
        "2025-02-03",
        "4.00",
      ),
      trade(
        "WEGE3",
        "stock_br",
        "BRL",
        "buy",
        "40",
        "44.20",
        "2026-08-20",
        "2.00",
      ),
    ],
    reviews: [
      review("WEGE3", "2025Q1", {
        grade: "9",
        notes: "Quality compounder. Paid up for it on purpose.",
        fairValue: "48.00",
      }),
      review("WEGE3", "2025Q3", {
        grade: "8.5",
        fairValue: "50.00",
      }),
      review("WEGE3", "2026Q1", {
        grade: "9",
        notes: "Order book in energy still expanding abroad.",
        fairValue: "54.00",
      }),
      review("WEGE3", "2026Q2", {
        grade: "8.5",
        notes: "Added on the dip. In cooldown until the next window.",
        fairValue: "56.00",
      }),
    ],
  },
  {
    asset: asset("ABEV3", "stock_br", "BRL", "0.03"),
    trades: [
      trade(
        "ABEV3",
        "stock_br",
        "BRL",
        "buy",
        "500",
        "12.40",
        "2024-11-08",
        "5.50",
      ),
    ],
    reviews: [
      review("ABEV3", "2025Q1", {
        notes: "Volume mixed in Brazil. No grade until pricing sticks.",
      }),
      review("ABEV3", "2025Q3", {
        grade: "6",
        notes: "Premium mix helped. Still a slow compounder.",
        fairValue: "14.50",
      }),
      review("ABEV3", "2026Q2", {
        grade: "6.5",
        notes: "Cash returns the thesis. Not a growth story.",
        fairValue: "15.00",
      }),
    ],
  },
  {
    asset: asset("BBAS3", "stock_br", "BRL", "0.04"),
    trades: [
      trade(
        "BBAS3",
        "stock_br",
        "BRL",
        "buy",
        "200",
        "26.10",
        "2025-03-17",
        "5.00",
      ),
    ],
    reviews: [
      review("BBAS3", "2025Q1", {
        grade: "7",
        fairValue: "30.00",
      }),
      review("BBAS3", "2025Q2", {
        grade: "7.5",
        notes: "Agri book behaved. Dividend still the hook.",
        fairValue: "32.00",
      }),
      review("BBAS3", "2025Q4", {
        grade: "7",
        fairValue: "31.00",
      }),
      review("BBAS3", "2026Q1", {
        grade: "6.5",
        notes: "Political noise around credit policy. Haircut applied.",
        fairValue: "30.00",
      }),
      review("BBAS3", "2026Q2", {
        grade: "7",
        notes: "Cheap vs private peers even after the haircut.",
        fairValue: "33.00",
      }),
    ],
  },
  {
    asset: asset("B3SA3", "stock_br", "BRL", "0.03"),
    trades: [
      trade(
        "B3SA3",
        "stock_br",
        "BRL",
        "buy",
        "250",
        "11.20",
        "2025-05-12",
        "3.00",
      ),
    ],
    reviews: [
      review("B3SA3", "2025Q2", {
        grade: "7",
        notes: "Volumes recovering with the local equity tape.",
        fairValue: "13.50",
      }),
      review("B3SA3", "2025Q4", {
        grade: "7.5",
        fairValue: "14.00",
      }),
      review("B3SA3", "2026Q2", {
        grade: "8",
        notes: "Operating leverage showing up in the print.",
        fairValue: "15.50",
      }),
    ],
  },
  {
    asset: asset("PRIO3", "stock_br", "BRL", "0.03"),
    trades: [
      trade(
        "PRIO3",
        "stock_br",
        "BRL",
        "buy",
        "150",
        "40.50",
        "2025-01-28",
        "4.80",
      ),
      trade(
        "PRIO3",
        "stock_br",
        "BRL",
        "sell",
        "40",
        "48.00",
        "2025-09-09",
        "2.00",
      ),
    ],
    reviews: [
      review("PRIO3", "2025Q1", {
        grade: "8",
        notes: "Wahoo ramp is the whole story. Execution so far is clean.",
        fairValue: "52.00",
      }),
      review("PRIO3", "2025Q2", {
        grade: "7",
        notes: "Decline rates a bit worse than the model.",
        fairValue: "48.00",
      }),
      review("PRIO3", "2025Q4", {
        grade: "8",
        fairValue: "54.00",
      }),
      review("PRIO3", "2026Q1", {
        grade: "8.5",
        notes: "M&A optionality on top of the producing base.",
        fairValue: "58.00",
      }),
      review("PRIO3", "2026Q2", {
        grade: "8",
        fairValue: "56.00",
      }),
    ],
  },
  {
    asset: asset("EQTL3", "stock_br", "BRL", "0.025"),
    trades: [
      trade(
        "EQTL3",
        "stock_br",
        "BRL",
        "buy",
        "120",
        "31.80",
        "2025-06-02",
        "3.20",
      ),
    ],
    reviews: [],
  },
  {
    asset: asset("SUZB3", "stock_br", "BRL", "0.02"),
    trades: [
      trade(
        "SUZB3",
        "stock_br",
        "BRL",
        "buy",
        "80",
        "54.00",
        "2025-07-14",
        "3.00",
      ),
    ],
    reviews: [
      review("SUZB3", "2025Q3", {
        notes:
          "Pulp price is the only variable that matters. Parked until the cycle turns.",
      }),
      review("SUZB3", "2026Q2", {
        notes:
          "Still no grade. Watching China inventories, not the equity tape.",
      }),
    ],
  },
  {
    asset: asset("HGLG11", "reit", "BRL", "0.04", "4Q25"),
    trades: [
      trade(
        "HGLG11",
        "reit",
        "BRL",
        "buy",
        "50",
        "165.20",
        "2024-05-06",
        "3.00",
      ),
      trade(
        "HGLG11",
        "reit",
        "BRL",
        "buy",
        "30",
        "158.00",
        "2024-08-12",
        "2.50",
      ),
    ],
    reviews: [
      review("HGLG11", "2024Q3", {
        grade: "8",
        notes: "Logistics vacancies low. Yield covers the cost of capital.",
        fairValue: "172.00",
      }),
      review("HGLG11", "2025Q1", {
        grade: "8",
        fairValue: "175.00",
      }),
      review("HGLG11", "2025Q3", {
        grade: "7.5",
        notes: "New GLA a little slower to lease.",
        fairValue: "170.00",
      }),
      review("HGLG11", "2025Q4", {
        grade: "8",
        notes:
          "Occupancy back. Marked to NAV with a small premium for quality.",
        fairValue: "178.00",
        fairValueRef: REF.hglg,
      }),
      review("HGLG11", "2026Q2", {
        grade: "8",
        fairValue: "180.00",
      }),
    ],
  },
  {
    asset: asset("XPML11", "reit", "BRL", "0.03"),
    trades: [
      trade(
        "XPML11",
        "reit",
        "BRL",
        "buy",
        "60",
        "104.50",
        "2025-02-24",
        "2.80",
      ),
    ],
    reviews: [
      review("XPML11", "2025Q1", {
        grade: "7",
        notes: "Malls recovering footfall. Still a retail-cycle bet.",
        fairValue: "112.00",
      }),
      review("XPML11", "2025Q3", {
        grade: "7.5",
        fairValue: "116.00",
      }),
      review("XPML11", "2026Q1", {
        grade: "7",
        notes: "Same-store sales cooled. Fair value unchanged.",
        fairValue: "116.00",
      }),
      review("XPML11", "2026Q2", {
        grade: "7.5",
        fairValue: "118.00",
      }),
    ],
  },
  {
    asset: asset("KNRI11", "reit", "BRL", "0.02"),
    trades: [
      trade(
        "KNRI11",
        "reit",
        "BRL",
        "buy",
        "40",
        "142.00",
        "2025-04-07",
        "2.00",
      ),
    ],
    reviews: [
      review("KNRI11", "2025Q2", {
        grade: "7",
        fairValue: "150.00",
      }),
      review("KNRI11", "2025Q4", {
        grade: "6.5",
        notes: "Office bag is the drag. Logistics carries the fund.",
        fairValue: "148.00",
      }),
      review("KNRI11", "2026Q2", {
        grade: "7",
        fairValue: "152.00",
      }),
    ],
  },
  {
    asset: asset("BOVA11", "etf", "BRL", "0.04"),
    trades: [
      trade(
        "BOVA11",
        "etf",
        "BRL",
        "buy",
        "40",
        "118.50",
        "2024-04-01",
        "2.00",
      ),
      trade(
        "BOVA11",
        "etf",
        "BRL",
        "sell",
        "10",
        "125.00",
        "2025-02-10",
        "1.50",
      ),
    ],
    reviews: [
      review("BOVA11", "2025Q2", { grade: "7" }),
      review("BOVA11", "2026Q2", {
        grade: "7",
        notes:
          "Beta sleeve. Grade tracks the Brazil risk premium, not a thesis.",
      }),
    ],
  },
  {
    asset: asset("IVVB11", "etf", "BRL", "0.04"),
    trades: [
      trade(
        "IVVB11",
        "etf",
        "BRL",
        "buy",
        "20",
        "318.00",
        "2025-03-10",
        "4.00",
      ),
    ],
    reviews: [
      review("IVVB11", "2025Q1", {
        grade: "8",
        notes: "S&P exposure without wiring USD. Tracking error is acceptable.",
        fairValue: "340.00",
      }),
      review("IVVB11", "2025Q3", { grade: "8", fairValue: "355.00" }),
      review("IVVB11", "2026Q1", { grade: "7.5", fairValue: "360.00" }),
      review("IVVB11", "2026Q2", {
        grade: "8",
        notes: "Still the cheapest way to keep a US core in BRL.",
        fairValue: "370.00",
      }),
    ],
  },
  {
    asset: asset("NUBR33", "bdr", "BRL", "0.02"),
    trades: [
      trade(
        "NUBR33",
        "bdr",
        "BRL",
        "buy",
        "100",
        "11.20",
        "2024-08-05",
        "1.90",
      ),
    ],
    reviews: [
      review("NUBR33", "2025Q1", {
        grade: "6",
        notes: "Growth is there; profitability still lumpy. Small sleeve.",
        fairValue: "14.00",
      }),
      review("NUBR33", "2025Q4", { grade: "6.5", fairValue: "15.00" }),
      review("NUBR33", "2026Q2", {
        grade: "7",
        notes: "Mexico helping more than Brazil. Raised the value a notch.",
        fairValue: "16.50",
      }),
    ],
  },
  {
    asset: asset("CDB-2027", "fixed_income", "BRL", "0.05"),
    trades: [
      {
        ...trade(
          "CDB-2027",
          "fixed_income",
          "BRL",
          "buy",
          "10",
          "1000.00",
          "2024-07-01",
        ),
        value: "10000.00",
      },
    ],
    reviews: [
      review("CDB-2027", "2024Q3", {
        grade: "8",
        notes: "Issuer is a top-tier bank. Hold to maturity.",
      }),
      review("CDB-2027", "2025Q1", { grade: "8" }),
      review("CDB-2027", "2025Q3", {
        grade: "8",
        notes: "No mark-to-market. Grade is credit quality, not price.",
      }),
      review("CDB-2027", "2026Q2", {
        grade: "8",
        notes: "Still comfortable with the name through 2027.",
        fairValue: "1050.00",
      }),
    ],
  },
  {
    asset: asset("AAPL", "stock_us", "USD", "0.05", "1Q26"),
    trades: [
      trade(
        "AAPL",
        "stock_us",
        "USD",
        "buy",
        "10",
        "175.30",
        "2024-03-11",
        "1.00",
      ),
      trade(
        "AAPL",
        "stock_us",
        "USD",
        "buy",
        "5",
        "190.00",
        "2024-10-07",
        "1.00",
      ),
      trade(
        "AAPL",
        "stock_us",
        "USD",
        "sell",
        "4",
        "220.50",
        "2025-03-03",
        "1.00",
      ),
    ],
    reviews: [
      review("AAPL", "2024Q3", {
        grade: "6",
        notes:
          "Services mix helps, hardware does not. Paid a growth multiple for a mature franchise.",
        fairValue: "190.00",
      }),
      review("AAPL", "2024Q4", { grade: "5.5", fairValue: "185.00" }),
      review("AAPL", "2025Q1", {
        grade: "5",
        notes: "China still soft. Cut the grade.",
        fairValue: "200.00",
      }),
      review("AAPL", "2025Q2", { grade: "4", fairValue: "210.00" }),
      review("AAPL", "2025Q3", {
        grade: "3.5",
        notes: "Multiple ran ahead of any AI product. Trimming, not adding.",
        fairValue: "220.00",
      }),
      review("AAPL", "2025Q4", { grade: "3", fairValue: "230.00" }),
      review("AAPL", "2026Q1", {
        grade: "3",
        notes:
          "Services growth is not enough to justify the tape. Expensive vs the model.",
        fairValue: "240.00",
        fairValueRef: REF.aapl,
      }),
      review("AAPL", "2026Q2", {
        grade: "3",
        notes:
          "Fair value still well below the market. Weight cap is doing the work.",
        fairValue: "250.00",
      }),
    ],
  },
  {
    asset: asset("MSFT", "stock_us", "USD", "0.05"),
    trades: [
      trade(
        "MSFT",
        "stock_us",
        "USD",
        "buy",
        "8",
        "410.20",
        "2024-12-02",
        "1.00",
      ),
    ],
    reviews: [
      review("MSFT", "2025Q1", {
        grade: "9",
        notes:
          "Azure plus Office is still the cleanest compounder in the book.",
        fairValue: "460.00",
      }),
      review("MSFT", "2025Q2", { grade: "9", fairValue: "480.00" }),
      review("MSFT", "2025Q4", {
        grade: "8.5",
        notes: "Capex is heavy. Quality still justifies a premium.",
        fairValue: "500.00",
      }),
      review("MSFT", "2026Q1", { grade: "8.5", fairValue: "510.00" }),
      review("MSFT", "2026Q2", {
        grade: "9",
        notes: "Raised the terminal growth a notch after the last print.",
        fairValue: "530.00",
      }),
    ],
  },
  {
    asset: asset("GOOGL", "stock_us", "USD", "0.04"),
    trades: [
      trade(
        "GOOGL",
        "stock_us",
        "USD",
        "buy",
        "12",
        "164.00",
        "2025-01-21",
        "1.00",
      ),
    ],
    reviews: [
      review("GOOGL", "2025Q1", {
        grade: "8",
        notes:
          "Search is more durable than the narrative. Cloud is the option.",
        fairValue: "185.00",
      }),
      review("GOOGL", "2025Q3", { grade: "8", fairValue: "190.00" }),
      review("GOOGL", "2026Q1", {
        grade: "7.5",
        notes: "Legal overhang. Haircut on the multiple, not the cash flows.",
        fairValue: "195.00",
      }),
      review("GOOGL", "2026Q2", {
        grade: "8",
        fairValue: "210.00",
      }),
    ],
  },
  {
    asset: asset("AMZN", "stock_us", "USD", "0.04"),
    trades: [
      trade(
        "AMZN",
        "stock_us",
        "USD",
        "buy",
        "8",
        "182.00",
        "2025-04-14",
        "1.00",
      ),
    ],
    reviews: [
      review("AMZN", "2025Q2", {
        grade: "8",
        notes:
          "AWS growth re-accelerating. Retail margins finally boring in a good way.",
        fairValue: "210.00",
      }),
      review("AMZN", "2025Q4", { grade: "8.5", fairValue: "220.00" }),
      review("AMZN", "2026Q2", {
        grade: "8",
        notes: "Still a core holding. Fair value tracks AWS, not Prime Day.",
        fairValue: "230.00",
      }),
    ],
  },
  {
    asset: asset("NVDA", "stock_us", "USD", "0.04", "2Q26"),
    trades: [
      trade(
        "NVDA",
        "stock_us",
        "USD",
        "buy",
        "6",
        "118.00",
        "2025-06-16",
        "1.00",
      ),
      trade(
        "NVDA",
        "stock_us",
        "USD",
        "buy",
        "4",
        "132.00",
        "2026-02-09",
        "1.00",
      ),
    ],
    reviews: [
      review("NVDA", "2025Q2", {
        grade: "9",
        notes:
          "Demand still supply-constrained. Model assumes a slower 2027, not a cliff.",
        fairValue: "160.00",
      }),
      review("NVDA", "2025Q3", { grade: "9", fairValue: "170.00" }),
      review("NVDA", "2025Q4", { grade: "8.5", fairValue: "165.00" }),
      review("NVDA", "2026Q1", {
        grade: "9",
        notes: "Data-center mix better than feared. Raised the value.",
        fairValue: "180.00",
      }),
      review("NVDA", "2026Q2", {
        grade: "9",
        notes:
          "Tape is below the model. One of the few names that is still cheap.",
        fairValue: "190.00",
        fairValueRef: REF.nvda,
      }),
    ],
  },
  {
    asset: asset("META", "stock_us", "USD", "0.03"),
    trades: [
      trade(
        "META",
        "stock_us",
        "USD",
        "buy",
        "5",
        "512.00",
        "2025-08-04",
        "1.00",
      ),
    ],
    reviews: [
      review("META", "2025Q3", {
        grade: "7",
        notes:
          "Reels and Reality Labs still a capital sink. Core ads are fine.",
        fairValue: "540.00",
      }),
      review("META", "2025Q4", { grade: "7.5", fairValue: "560.00" }),
      review("META", "2026Q1", {
        grade: "6.5",
        notes: "Capex guide jumped. Cut the grade until returns show up.",
        fairValue: "550.00",
      }),
      review("META", "2026Q2", {
        grade: "7",
        fairValue: "580.00",
      }),
    ],
  },
  {
    asset: asset("IVV", "etf", "USD", "0.04"),
    trades: [
      trade("IVV", "etf", "USD", "buy", "6", "510.00", "2024-06-20", "1.00"),
    ],
    reviews: [
      review("IVV", "2025Q2", {
        grade: "8",
        notes: "US core. No stock-picking here.",
      }),
      review("IVV", "2026Q1", { grade: "8" }),
      review("IVV", "2026Q2", {
        grade: "8",
        notes: "Leave it alone. Rebalance with contributions, not with trades.",
      }),
    ],
  },
  {
    asset: asset("QQQ", "etf", "USD", "0.03"),
    trades: [
      trade("QQQ", "etf", "USD", "buy", "4", "478.00", "2025-05-19", "1.00"),
    ],
    reviews: [
      review("QQQ", "2025Q2", { grade: "7.5", fairValue: "500.00" }),
      review("QQQ", "2025Q4", { grade: "7", fairValue: "510.00" }),
      review("QQQ", "2026Q2", {
        grade: "7",
        notes: "Concentrated by design. Size stays capped.",
        fairValue: "520.00",
      }),
    ],
  },
  {
    asset: asset("BTC", "crypto", "USD", "0.03"),
    trades: [
      trade(
        "BTC",
        "crypto",
        "USD",
        "buy",
        "0.05",
        "67000.00",
        "2024-05-20",
        "12.00",
      ),
      trade(
        "BTC",
        "crypto",
        "USD",
        "sell",
        "0.01",
        "95000.00",
        "2025-01-06",
        "8.00",
      ),
    ],
    reviews: [
      review("BTC", "2024Q4", {
        grade: "6",
        notes: "Satellite, not a core. Sized so a 50% drawdown is boring.",
        fairValue: "80000.00",
      }),
      review("BTC", "2025Q2", { grade: "6.5", fairValue: "90000.00" }),
      review("BTC", "2025Q4", {
        grade: "7",
        notes: "ETF flows made the sleeve easier to hold.",
        fairValue: "100000.00",
      }),
      review("BTC", "2026Q1", { grade: "6.5", fairValue: "105000.00" }),
      review("BTC", "2026Q2", {
        grade: "7",
        notes: "Raised the value with the halving lag still working through.",
        fairValue: "110000.00",
        fairValueRef: REF.btc,
      }),
    ],
  },
  {
    asset: asset("ETH", "crypto", "USD", "0.02"),
    trades: [
      trade(
        "ETH",
        "crypto",
        "USD",
        "buy",
        "0.40",
        "2450.00",
        "2025-07-07",
        "6.00",
      ),
    ],
    reviews: [
      review("ETH", "2025Q3", {
        grade: "6",
        notes: "L2 activity is the tell. Smaller sleeve than BTC on purpose.",
        fairValue: "2800.00",
      }),
      review("ETH", "2026Q1", { grade: "6.5", fairValue: "3200.00" }),
      review("ETH", "2026Q2", {
        grade: "6",
        notes: "Staking yield is nice, not a reason to size up.",
        fairValue: "3400.00",
      }),
    ],
  },
  {
    asset: asset("TSLA", "stock_us", "USD", "0.02"),
    trades: [],
    reviews: [
      review("TSLA", "2025Q3", {
        grade: "4",
        notes:
          "Watch only. Delivery growth is not enough to underwrite the multiple.",
        fairValue: "180.00",
      }),
      review("TSLA", "2025Q4", { grade: "4", fairValue: "175.00" }),
      review("TSLA", "2026Q1", {
        grade: "3.5",
        notes:
          "Robotaxi remains a slide, not a cash flow. Staying on the sideline.",
        fairValue: "170.00",
      }),
      review("TSLA", "2026Q2", {
        grade: "4",
        notes: "Would engage only on a much lower print. No position yet.",
        fairValue: "185.00",
      }),
    ],
  },
  {
    asset: asset("MELI", "stock_us", "USD", null),
    trades: [],
    reviews: [
      review("MELI", "2026Q1", {
        notes:
          "On the radar after the last print. No target until I finish the model.",
      }),
      review("MELI", "2026Q2", {
        grade: "8",
        notes:
          "Quality is obvious. Need a price. Target still empty on purpose.",
        fairValue: "2100.00",
      }),
    ],
  },
  {
    asset: asset("RADL3", "stock_br", "BRL", "0.015"),
    trades: [],
    reviews: [
      review("RADL3", "2025Q4", {
        grade: "7.5",
        notes: "Pharmacy compounder. Waiting for a better entry.",
        fairValue: "28.00",
      }),
      review("RADL3", "2026Q1", { grade: "7.5", fairValue: "29.00" }),
      review("RADL3", "2026Q2", {
        grade: "8",
        notes: "Still watch-only. Would start a line below 24.",
        fairValue: "30.00",
      }),
    ],
  },
];

export const DEV_SEED_FIXTURES: CreateTransactionInput[] = CATALOG.flatMap(
  (entry) => entry.trades,
);

export const DEV_SEED_ASSETS: SeedAsset[] = CATALOG.map((entry) => entry.asset);

export const DEV_SEED_REVIEWS: SeedReview[] = CATALOG.flatMap(
  (entry) => entry.reviews,
);
