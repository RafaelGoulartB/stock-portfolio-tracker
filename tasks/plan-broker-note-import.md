# Broker note import

## Decision

Users upload one or more broker-note PDFs on Transactions → **Broker notes**.
The API parses each file server-side, reconciles it against its own totals,
shows a preview, and imports the confirmed notes atomically. Every imported
trade is an ordinary `transactions` row tied to its `broker_notes` row by
`broker_note_id`; positions, results, dividends and snapshots read it like any
other trade.

Imported trades are immutable from the trade log: they cannot be edited or
deleted one by one. Deleting the note removes all of its trades at once, after
the same oversell replay that guards a manual delete. Only the missing
trade-date PTAX may still be filled later, exactly like a manual trade.

The original PDF is not stored. The note keeps its SHA-256, file name, header
facts, numeric totals and a JSON audit snapshot of the document's lines and
fee items (decimal strings, never read by calculations). The user keeps the
PDF itself, which is the document accepted for income tax.

## Supported formats

| Format id | Broker | Market | Ticker source |
| --- | --- | --- | --- |
| `inter-dtvm-sinacor` | Inter DTVM | B3 | security name + class, mapped by the user |
| `inter-dtvm-web` | Inter DTVM (home-broker print) | B3 | ticker printed in the specification |
| `apex-confirm` | Apex Clearing (Inter & Co, until 2025) | US | `SYM` column |
| `drivewealth-confirm` | DriveWealth (Inter Co Securities) | US | `Symbol` column |

A file nobody recognizes, a password-protected PDF, or a note with derivative,
forward or other non-spot markets is rejected with a reason. No trade line is
ever skipped silently.

## Precision rules

- **Reconciliation is mandatory.** A B3 note must satisfy every check, in
  cents: each line `quantity × price = value`; Σ buys = "Compras à vista";
  Σ sells = "Vendas à vista"; sells − buys = "Valor líquido das operações";
  the itemized fees add up to the costs implied by "Líquido para"; and
  sells − buys − fees = "Líquido para". A US confirmation must satisfy, per
  line, net = principal ± commission, transaction fee and other fees, and the
  Apex daily summary must match. Any mismatch rejects the note: it means the
  layout changed or the text was misread.
- **Costs follow the document.** B3 note costs (settlement, registration,
  exchange, custody transfer, brokerage, ISS and others) are apportioned to the
  note's trades in proportion to each trade's value, at 8 decimal places, with
  the largest-remainder method so the shares add up exactly to the note total.
  Withheld income tax (IRRF) is not a cost; it stays on the note.
- **Cash is authoritative.** The stored unit price is the document price when
  `quantity × price` equals the line value exactly (every B3 trade). Otherwise
  (US fractional and rounded fills) the stored price is the line principal over
  the quantity, at 8 decimal places, so `quantity × price + fees` is the cash
  that actually moved. The execution price stays in the audit snapshot.
- Trades keep document order: each one gets an increasing `created_at`, which
  is the ledger tie-breaker for trades on the same day.
- USD trades get the BCB PTAX of the trade date, the same rule as manual
  trades; it can be filled later when BCB is unreachable.

## Identity and duplicates

A note's fingerprint is the SHA-256 of its canonical parsed content (format,
account, trade date, note number, trades and totals), unique per user. The
same note downloaded twice, or re-printed with different bytes, is reported as
already imported or duplicated within the upload. The preview also warns when
a manual trade with the same ticker, date, side and quantity exists, because
importing the note would count it twice; deleting the manual trade stays the
user's decision.

## Securities on B3 notes

Inter's SINACOR note prints the trading name and share class (`ELETROBRAS PNB
N1`), not the ticker. The parser derives a stable source key from the name and
the class, without governance or ex-right markers (`B3:ELETROBRAS|PNB`). The
user maps each new key to a ticker once; `broker_security_aliases` stores the
mapping per account when an import runs (including mappings typed for notes
left out of it), and later imports resolve it automatically, still showing it
for review and correction. No built-in name-to-ticker table exists: a wrong static mapping
would silently corrupt positions.

A ticker's asset class comes from its existing trades, then from an allocation
asset, then from the user's choice in the preview (suggested from the note:
`FII` → REIT, other `CI` → ETF, `DR*` → BDR, `REIT` in a US description →
REIT).

## Validation at import

Under the ticker advisory locks, the import re-reads every affected ledger and
splits, then refuses the whole batch if a note is already imported, a ticker
is unresolved, a currency would mix, or any sell would exceed the quantity held
at that point of the ledger (all selected notes replayed together, in date and
document order). The preview runs the same plan without locks.

## Persistence, backup and delete-all

- `broker_notes` and `broker_security_aliases` are account-owned, cascade with
  the user, and appear in `data.summary` and delete-all.
- Backup format v11 exports `brokerNotes` (before `transactions`, with a
  portable `ref`) and `brokerSecurityAliases`; a transaction carries
  `brokerNoteRef`. Older backups restore without notes. Restore rejects a
  dangling reference.

## Transport and limits

Files travel as base64 in the tRPC mutation body: at most 20 files and 5 MB
each. PDF.js runs with eval disabled and a page limit. Preview and import
re-parse the uploaded bytes; the client only contributes ticker mappings,
asset classes for new tickers, and the selection of notes.

## Known limits

- An Inter DTVM SINACOR note may run its trades table over several pages; a
  page without the note header (only more trades or the summary) continues
  the previous note, and reconciliation proves no line was lost at the page
  break. A note with more than one financial summary is rejected until a
  sample exists.
- Option, forward and futures markets are out of scope. Day-trade lines are
  imported as ordinary trades; the observation flags printed next to them are
  kept in the audit snapshot for a future tax report.
- Income-tax reports are not computed yet; the stored facts (per-trade cost
  with apportioned fees, IRRF, settlement date, PTAX) are the inputs they will
  need.
