# 0003. Integer money and a double-entry ledger

- Status: Accepted
- Date: 2026-11-13

## Decision
Coins (1 = 10 RWF) are safe integers end to end (`bigint` in Postgres, branded `Coins` in TS). Balances change only through
balanced, idempotent journal entries posted by the ledger module. Fees are computed only by `@gukirana/money`.

## Consequences
No rounding drift, full audit trail, reconciliation possible. All money code needs property tests and two reviewers.
