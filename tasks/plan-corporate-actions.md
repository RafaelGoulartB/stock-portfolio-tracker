# Splits and reverse splits

## Decision

Splits are user-recorded ledger events in the account-owned
`corporate_actions` table: `from_quantity` old shares become `to_quantity`
new ones on `effective_at`, the first day trading in the new units. Only
`kind = 'split'` exists; a bonus issue (bonificação) also changes cost basis
and needs its own rules and plan.

The ledger is read in today's share units. `adjustForSplits` multiplies the
units of every trade dated before a split by `to / from`; the trade's money
(`quantity × price + fees`) is never touched, so cost basis and realized
results stay what was paid and the average price follows. Quote providers
publish split-adjusted historical closes and dividends, which are already in
today's units, so live values, month-end snapshots, dividend entitlements and
oversell checks all agree.

Yahoo's published splits are only suggestions on the asset page. Positions
never depend on the provider being reachable: nothing changes until the user
records a split.

## Invariants

- A split needs a trade of the ticker before `effective_at`; one split per
  ticker and day; fixed income and cash cannot split.
- Creating or removing a split re-runs the oversell replay in the resulting
  units, under the ticker lock, and is refused if a later sale would be
  uncovered. Trade create, edit and delete replay with the recorded splits.
- Backup format v8 exports `corporateActions`; older backups restore with
  none. Import validation replays the backup's own splits. Delete-all and the
  data summary include the table.

## Known limits

- A reverse split that leaves fractional shares keeps the fraction; the cash
  B3 pays for auctioned fractions must be entered as a sale.
- Alpha Vantage dividend amounts are not split-adjusted, unlike Yahoo's;
  with `ALPHA_VANTAGE_API_KEY` set, pre-split dividend estimates of a split
  ticker can be overstated.
