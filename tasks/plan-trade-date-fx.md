# Trade-date USD/BRL

## Decision

Every transaction stores `usd_brl_rate numeric(22, 8)`: BRL per 1 USD on its
trade date. By default the API resolves the official BCB PTAX sell rate
(`cotacaoVenda`) of `tradedAt`, or of the previous business day on weekends
and holidays. A rate typed in the trade form, such as a broker's, wins.

Cross-currency cost basis and realized results use these rates instead of
today's consolidation rate. The moving average is kept in both currencies:
a buy adds its cost converted at its own rate, and a sale releases the same
fraction of the native cost and of the other-currency cost, realizing the
proceeds at the sale's rate. Market value still converts at the current
spot, so the display-currency open result includes the FX move since each
purchase. `convertedFxPnl` isolates that part: cost at today's rate minus
cost at the trade-date rates.

## Missing rates

The column is nullable. A trade without a rate converts at the consolidation
rate, and positions report the count in `tradesMissingFx`. Writes never fail
because BCB is unreachable: create, edit and book-holdings store `null`
instead. A trade dated today stays unresolved until that day's PTAX is
published, because carrying yesterday's close forward would store the wrong
rate for good. Transactions shows how many trades in the non-display currency
are pending and fills all of them with one BCB range request; filling never
overwrites a stored rate.

## Scope

- Positions, Detailed positions (FX result column), Deep Finder "vs cost",
  and Performance cost basis and cash flows use the stored rates.
- Allocation keeps its native-currency result and percent.
- `bcb_ptax` is also selectable as the consolidation FX source.
- Backup format v7 exports `usdBrlRate`; older backups restore with `null`.
- This is not tax accounting: IR rules (monthly exemption, loss
  carryforward, DARF) remain out of scope.

## Acceptance criteria

- A USD buy stores the PTAX of its trade date, or `null` when unavailable.
- BRL cost of a USD position equals the sum of each buy converted at its own
  rate, and sales release it pro rata.
- Missing rates fall back to the consolidation rate and are counted.
- The fill action resolves every pending past trade and reports what is left.
- Provider tests are deterministic and never call BCB.
- English and Brazilian Portuguese catalogs cover the new UI.
