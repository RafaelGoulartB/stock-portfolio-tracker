# Cash balance

## Decision

Cash is an account-owned BRL balance, separate from transactions and fixed
income. It is represented virtually when no database row exists, so every
account always has exactly one cash allocation/position with a zero default.

Its allocation target is derived, never stored:

`cash target = max(0, 100% - sum of non-cash allocation targets)`

The cash amount is stored as `numeric(22, 8)`. Editing it in USD converts the
display amount back to BRL with the explicit USD/BRL rate. Live portfolio
totals and weights include cash; historical snapshots do not, because this
model stores the current balance rather than a cash ledger. Performance adds
the live balance to today's totals only (portfolio value, cost basis, the
open-result percent base and a `cash` category) so they match Positions;
its monthly values, returns and drawdown stay cash-free and say so.
Fixed-income balances follow the same rule for the same reason, except that
they join today's value only, never the cost basis or a calculated return,
matching how Positions treats them; their deposits are not monthly flows.

The live cash position uses a virtual quantity of one. Its average cost,
invested cost, market price, and market value all equal the current cash
balance (converted where applicable), so its open result and return are
explicitly zero. Cash participates in the live portfolio return base with
that zero contribution; it still has no market quote or historical return.

## Acceptance criteria

- Allocation always returns one non-removable cash row.
- The cash target fills the unassigned portion up to 100%.
- Cash value is editable from Allocation and survives reloads.
- Cash is included in live Positions with equal cost and market value, yielding
  zero open result while participating in the portfolio return base.
- Cash is excluded from quote-provider calls and historical snapshots.
- Backup/export/import/delete-all include the account-owned cash balance.
- English and Brazilian Portuguese UI catalogs contain the new copy.
- Domain/API tests cover the residual target, value conversion, totals, account
  scoping contract, and backup compatibility.
