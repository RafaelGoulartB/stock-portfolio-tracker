import type {
  AssetClass,
  Currency,
  NextResult,
} from "@portifolio-tracker/shared";

export type ResultDateAsset = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
};

export type ResultDateProvider = {
  getNextResult(
    asset: ResultDateAsset,
    today: string,
  ): Promise<NextResult | null>;
};

export type ParsedResultEvent = {
  date: string;
  period: string | null;
};
