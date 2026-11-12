# ledger module

Owns the double-entry ledger (SRS §6, plan Appendix A). **Only this module writes ledger tables.**

- `LedgerService.post()` — balanced, idempotent, lock-ordered postings (task P0-LED-03)
- Posting recipes — plan Appendix A.4
- Sign convention — user / escrow / promo accounts are credit-normal; provider clearing and platform contra
  accounts may be configured with `allow_negative`.

Changes here need two approvals (one is the tech lead) and property tests (plan §4.3).
