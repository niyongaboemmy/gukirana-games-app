# Wallet UX (P1-WAL-10)

The in-world wallet of Gukirana Playground: an open leather bifold held up in front of you. This note fixes the
information architecture, the flows and the visual rules. Code: `apps/web/src/wallet/`.

## 1. Mental model: two balances, one display setting

| | Stars | Coins |
| --- | --- | --- |
| What | Practice currency | The real-money unit (1 coin = 10 RWF) |
| Cash value | None, ever | Yes, at the published rate |
| How you get them | Free daily claim, streaks, level-ups | Top up (licensed pilot only) |
| Where you spend them | Practice tables | Cash tables (pilot, 18+) |
| Can be cashed out | No | Yes, with the fee shown first |
| Visual | Gold star token, gold label | Silver coin token, steel label |

**Money (RWF / USD / EUR) is not a third balance.** The currency tabs only change how the coins' money value is
*shown*. They carry the caption "Show coins in" and sit directly above the card; the coins row repeats it
("≈ RWF 0 · shown in RWF, estimate"). An "i" strip on the balance card opens "What are Stars and Coins?".

## 2. Information architecture (the format is fixed: refine inside it)

```
Wallet (B key / Stars chip: 1 tap shows both balances)
├─ LEFT half
│   ├─ "Show coins in"  [RWF] [USD] [EUR]      display only
│   ├─ cream balance card
│   │   ├─ STARS · practice      920  (gold tokens)   "No cash value"
│   │   ├─ ─────────────
│   │   ├─ COINS · real money    0 coins      ≈ RWF 0
│   │   └─ (i) What are Stars and Coins?            → Info card
│   └─ Claim +200 Stars / Claimed · next in 23 h
└─ RIGHT half (2×2 stitched buttons)
    ├─ Top up    → card: Amount → Review → Pay    (2 taps from the world)
    ├─ Cash out  → card: Amount → Review → Pay
    ├─ Activity  → card: filter All / Stars / Coins, grouped by day
    └─ Play safe → card: stake limit, reminder, break, each explained
```

## 3. Flows

- **Balance**: open the wallet; both numbers are on the card. A change counts up over 0.7 s (instant with reduced
  motion). The screen-reader summary states both balances in words.
- **Claim**: one tap. Three gold tokens slide from the button into the Stars pocket, "+220 Stars" floats up once,
  a soft chime plays (after a gesture, if sound is on). The button then reads "Claimed · next in 23 h". No
  countdown pressure, no "last chance".
- **Top up** (cream card that slides out of the Top up button):
  1. *Amount*: "Pay in" currency, a big printed amount, note chips (RWF 1 000 / 5 000 / 10 000, $5 / $10 / $20) and
     a POS keypad (also keyboard digits). A live line: "You get ≈ 150 coins".
  2. *Review*: a receipt slip with a perforated edge: You pay → You get, the exchange margin (included), the fee,
     the rate and the rate version. Payment method tiles (MTN MoMo, Airtel Money, Card): the integration point,
     disabled and labelled while the pilot is off.
  3. *Pay*: a slide-to-pay track. While `pilotEnabled` is false it is locked and reads "Coming with the licensed
     pilot". With the pilot on, completing the slide hands over to the payment provider; the wallet never shows a
     success it did not receive from the ledger.
- **Cash out** mirrors it: coins (chips 500 / 1 000 / 5 000 / All, never above the balance) and "Receive in";
  the receipt shows You give → fee → margin → You receive; methods MTN MoMo, Airtel Money, Bank.
- **Activity**: filter All / Stars / Coins; groups Today, Yesterday, then dates; an icon per type (claim, streak,
  level-up, stake, match result, refund, welcome); every amount signed and coloured, with its unit.
- **Play safe**: three blocks, each with a one-line "what it does" and its control: daily stake limit (lower now,
  raise after 24 h), play-time reminder, take a break.

## 4. Interaction rules

- Close is always visible (top right). Esc / outside tap closes the open card first, then the wallet. Back returns
  to the previous step, then to the wallet. Focus moves into an opened card and back to its button on close; Tab
  stays inside the wallet.
- Touch targets are at least 44 screen px at phone landscape (844×390); cards fit 94% of the height with a sticky
  footer action.
- Press feedback: every control depresses 2 to 3 px; a soft click plays after the first gesture (respects the
  sound setting). Hover lightens leather. Idle sway of the wallet is under 1°, off with reduced motion.

## 5. Visual rules

- The 3D object keeps its leather, stitching, cream printed card and gold. Matte materials, no glare.
- Opened cards are physical too: cream card stock with a faint grain, a stitched inner edge and a leather header
  band; dark ink text. The receipt is a whiter slip with perforations and tabular numerals.
- The app's blue accent is used only for the primary action of a step and for focus rings.
- Chakra Petch for numbers and titles, Inter for text, lucide icons, no emojis.

## 6. Ethics

Every amount signed; the margin and fee are always shown before any confirm; Stars always carry "no cash value";
wins and losses look the same size and weight (no celebratory loss disguising); no fake urgency, no near-miss
effects; no simulated payments.
