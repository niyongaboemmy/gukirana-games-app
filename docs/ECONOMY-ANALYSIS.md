# Economy analysis: wallet, fees, conversion, rewards

How money and Stars move in Gukirana Playground, the exact formulas the platform earns by, and how they are configured.
All amounts are integers (`Coins`, minor currency units); all formulas live in `packages/money`, and are covered by tests in
`packages/money/src/economy.test.ts`. Figures below are generated from that code with the default settings (version 1).

## 1. Currencies

| Unit | What it is | Cash value |
|---|---|---|
| **Stars** | Practice currency. Daily claim, level-up gifts, streaks. | **None.** It can't be bought or cashed out (FR-CUR-05). |
| **Coins** | Real-money unit for the licensed pilot only (off by default). Peg: 1 coin = 10 RWF. | Yes, via the payment provider. |
| **Money** | RWF, USD, EUR (any ISO 4217 code can be added), held in minor units. | n/a |

## 2. How the platform earns

**Table fee (rake):** each player pays a fee on top of the stake. The winner receives exactly both stakes (FR-ESC-03).

```
fee(stake)       = clamp( round_half_up(stake × rate_bp / 10 000), minFee, cap )   (rate from the fee band of the stake; ≥ minFeeRateBp)
player pays      = stake + fee
winner receives  = 2 × stake
house per match  = 2 × fee
```

Default bands: 10–49 → 10 %, 50–199 → 8 %, 200–999 → 6 %, 1 000+ → 5 % capped at 200.

| Stake (coins) | Stake (RWF) | Fee each | Player pays | Winner gets | House per match | Effective fee* | EV, even match | EV, 60 % wins |
|---|---|---|---|---|---|---|---|---|
| 10 | 100 | 1 | 11 | 20 | 2 | 9.1 % | −1 | +1 |
| 25 | 250 | 3 | 28 | 50 | 6 | 10.7 % | −3 | +2 |
| 50 | 500 | 4 | 54 | 100 | 8 | 7.4 % | −4 | +6 |
| 100 | 1 000 | 8 | 108 | 200 | 16 | 7.4 % | −8 | +12 |
| 200 | 2 000 | 12 | 212 | 400 | 24 | 5.7 % | −12 | +28 |
| 1 000 | 10 000 | 50 | 1 050 | 2 000 | 100 | 4.8 % | −50 | +150 |
| 5 000 | 50 000 | 200 | 5 200 | 10 000 | 400 | 3.9 % | −200 | +800 |

\* fee ÷ (stake + fee)

**House revenue per 1 000 matches:**

| Stake | Revenue |
|---|---|
| 25 | 6 000 coins (60 000 RWF) |
| 100 | 16 000 coins (160 000 RWF) |
| 1 000 | 100 000 coins (1 000 000 RWF) |

**Player expected value.** For a player who wins with probability p:

```
EV = p·stake − (1 − p)·stake − fee
```

For an evenly matched pair, EV = −fee: the fee is the honest price of a fair game. A stronger player (p > 0.5 + fee/(2·stake)) has positive EV. That's what makes it a skill game and not a house-edge gamble. The platform never takes a side; it earns only the fee.

**Conversion spread** (pilot): players buy coins at the mid rate plus `buySpreadBp`, and cash out at the mid rate minus `sellSpreadBp`, minus a flat `cashoutFeeMinor`.

```
coins bought   = floor( pay_minor × 10⁶ × 10⁴ / (minorPerCoinMicro × (10⁴ + buySpreadBp)) )
cash-out minor = floor( coins × minorPerCoinMicro × (10⁴ − sellSpreadBp) / (10⁶ × 10⁴) ) − cashoutFeeMinor
```

Default rates: RWF has no spread (the peg). USD and EUR have 1.5 % each way.

| Currency | Buy 10.00 | Cash out those coins | 1 000 coins ≈ |
|---|---|---|---|
| RWF | 10 000 RWF → 1 000 coins | 10 000 RWF | 10 000 RWF |
| USD | $10.00 → 1 379 coins | $9.70 (spread $0.15 + $0.15) | $7.14 |
| EUR | €10.00 → 1 497 coins | €9.70 | €6.58 |

A buy followed straight away by a cash-out loses exactly the two spreads. There is no hidden drift (tested). Rounding never credits a fraction of a coin, and never pays more than the mid value.

**Tournaments:**

```
pool  = entry × players
rake  = floor(pool × tournamentRakeBp / 10 000)
prize = floor((pool − rake) × payout_bp)      (rounding remainder goes to 1st place)
```

Example: 16 players × 100 coins makes a pool of 1 600 and a rake of 160 (10 %). Prizes are 864 / 432 / 144.

**Sensitivity:**
- Each +1 % on a band raises house revenue in that band by about 2 % of the stake per match, and lowers every player's EV by the same 1 % of the stake.
- Each +0.5 % of FX spread costs a round-trip player about 1 % of what they move.
- Caps protect high-stake players: above 4 000 coins the fee stops growing.

## 3. Rewards: engagement without deception

Rewards are honest and funded explicitly from ledger budget accounts (the marketing cost shows in the reports):
- daily Stars claim;
- level-up gift;
- daily-streak bonus (+20, 40, 60, 80, 100 Stars, then 100 each day);
- tournaments with published prize pools;
- achievements.

**Deliberately NOT implemented:** mechanics that make players believe they gain when they lose. That means no hiding net losses, no "win" effects on losing outcomes, no currency layering meant to obscure real value, and no near-miss manipulation. Besides harming players, these breach consumer-protection and gaming rules and would endanger the pilot licence.

The UI shows every stake, fee and result signed (+/−), labels Stars as having no cash value, and labels conversions as estimates. Responsible-play tools (session reminders, optional limits, self-exclusion) are part of the pilot scope.

## 4. Settings: dynamic, in the database (`economy_settings`)

- **Versioned and append-only.** An admin edit inserts version n+1 with an effective-from time. It is never retroactive, and the history is never edited.
- **Settings:** fee bands, the minimum fee rate, daily / level-up / streak Stars, currencies (code, exponent, `minorPerCoinMicro`, buy and sell spreads, cash-out fee, min/max, enabled), the pilot switch, and tournament rake and payout.
- **Validation (`validateEconomy`):**
  - fee bands are contiguous, the last band is open-ended, and no rate exceeds 20 %;
  - spreads are at most 10 %;
  - payouts sum to 100 %;
  - currency codes are ISO 4217.
- **Audit:** every journal entry records `economy_version`, so any result can be recomputed with the exact rules that applied.
- **Caching:** the API caches the settings for 30 s. Publishing clears the cache.

## 5. API

| Endpoint | Purpose |
|---|---|
| `GET /economy` | Public. Display rates, rewards, fee bands, pilot flag. |
| `GET /wallet`, `POST /wallet/daily-stars` | Player. The daily amount comes from the live settings. |
| `GET /admin/economy`, `GET /admin/economy/versions` | Admin (`x-admin-token`). |
| `POST /admin/economy` | Admin. Publish a new version (validated). Optional `effectiveFrom`, `note`; `x-admin-user` is recorded. |
| `GET /admin/reports/summary?from&to` | Revenue, Stars issued, daily claims, matches settled, escrow outstanding and player liabilities, per currency. |
| `GET /admin/reports/daily` and `daily.csv` | Daily entries, revenue and volume by currency and type (Kigali days). |
| `GET /admin/reports/reconciliation` | Every currency nets to zero, and stored balances equal the sum of postings. |

All reports are computed from the ledger, the single source of truth, not from counters.

## 6. In the world: the physical wallet

Press **B**, or tap the Stars chip, to open it. Your person takes out a leather wallet; others see the gesture, never the amounts. It shows:
- Stars as gold tokens;
- coins and money as stylised generic notes and coins of the chosen currency (no real banknote designs);
- an honest balance panel: Stars, coins with an estimate in RWF, USD or EUR, and signed recent activity;
- the daily claim.

Adding funds and cash-out appear only when the licensed pilot is enabled for the player. Payments are never simulated.
