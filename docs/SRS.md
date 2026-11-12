# Software Requirements Specification (SRS)
## Gukirana Games — Real-Money Skill Gaming Platform with Wallet

| Item | Value |
|---|---|
| Document | Software Requirements Specification |
| Version | 1.4 (Draft for review) |
| Change log | v1.1: Coin economy (1 🪙 = 10 RWF), Open Challenges (winner takes 2×), table-fee revenue model, no-crypto decision (ADR-09), fee transparency rules · v1.2: Player levels & XP (§5.9), Player of the Day with a no-loss prize formula (§5.10) · v1.4: Immersive VR in the MVP (§8.4.9), visual direction and HUD from the reference design (§8.4.10), landscape play on phones · v1.3: 3D Virtual Games World with halls, rooms, avatars, proximity voice and text, in-world proposals, VR support, performance tiers (§8.4) |
| Date | 12 November 2026 |
| Status | Draft — needs legal, finance and product sign-off |
| Standard | Structure loosely follows ISO/IEC/IEEE 29148:2018 |
| Primary market | Rwanda (RWF), with a later East Africa expansion |
| Platform | Web, Progressive Web App (PWA), mobile first, responsive up to desktop |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Market Research and Competitive Analysis](#2-market-research-and-competitive-analysis)
3. [Product Overview](#3-product-overview)
4. [Game Catalogue and Phased Roadmap](#4-game-catalogue-and-phased-roadmap)
5. [Functional Requirements](#5-functional-requirements)
6. [Coin Economy, Wallet, Ledger and Payments](#6-coin-economy-wallet-ledger-and-payments)
7. [Fair Play, Anti-Cheat and Integrity](#7-fair-play-anti-cheat-and-integrity)
8. [UX, UI and the 3D Virtual Games World](#8-ux-ui-and-the-3d-virtual-games-world)
9. [System Architecture (2026+)](#9-system-architecture-2026)
10. [Game Module SDK (Adding Games Later)](#10-game-module-sdk-adding-games-later)
11. [Non-Functional Requirements](#11-non-functional-requirements)
12. [Security and Privacy](#12-security-and-privacy)
13. [Legal, Regulatory and Responsible Gaming](#13-legal-regulatory-and-responsible-gaming)
14. [Data Model (Core Entities)](#14-data-model-core-entities)
15. [Admin and Back-Office](#15-admin-and-back-office)
16. [Analytics and KPIs](#16-analytics-and-kpis)
17. [Release Plan](#17-release-plan)
18. [Risks and Mitigations](#18-risks-and-mitigations)
19. [Open Questions](#19-open-questions)
20. [Glossary](#20-glossary)
21. [References](#21-references)

---

## 1. Introduction

### 1.1 Purpose
This document states the requirements for **Gukirana Games**. It is a web platform where registered users play skill-based multiplayer games such as billiards (8-ball pool), Ludo and others against real opponents. Users top up their in-app **wallet** with money, which is converted into **Coins (1 🪙 = 10 RWF)**. A player can **post a challenge** with a coin stake. When another player accepts, both stakes are locked, and **the winner gets both stakes (2×)**. Coins can be withdrawn back to mobile money or a bank account at the same rate. Free play uses a separate practice currency (Stars) with no cash value.

The audience is product owners, engineers, designers, QA, compliance and finance staff, investors and the regulator.

### 1.2 Scope
In scope:
- Player accounts, identity verification (KYC) and profiles
- A coin wallet (1 🪙 = 10 RWF) with top-ups, withdrawals, escrow, pots and bonuses
- Open Challenges: players post funded challenges, and the winner takes 2× the stake
- A **3D Virtual Games World** (plaza, game halls, rooms, tables) with avatars, proximity voice and text chat, in-world game proposals, and VR headset support. It has a 2D fallback lobby (§8.4)
- Real-time multiplayer games, starting with **3 launch games** and growing through a plug-in Game Module SDK
- Matchmaking, private challenges, tournaments and leaderboards
- Fair play: server-authoritative game logic, provably fair randomness, anti-cheat and anti-collusion
- Responsible gaming tools and regulatory compliance
- Admin, risk, finance and support back-office
- A mobile-first responsive PWA that also has a full desktop grid layout

Out of scope for v1:
- Native iOS or Android store apps (the PWA covers mobile; native wrappers are a Phase 3 option)
- House-banked casino games, slots and sports betting (players only compete against each other)
- Crypto deposits (see [§9.8](#98-future-technology-watch-list) for future options)

### 1.3 Product Principle: Skill vs Chance
The platform is designed as a **peer-to-peer skill competition**:
- The platform **never plays against the user** and never takes a position in the outcome.
- Revenue comes mainly from a small, **disclosed table fee** paid by each player on top of the stake. The winner always receives exactly 2× the stake. Secondary revenue: withdrawal fees, Premium, cosmetics, ads in free mode, sponsorships (§6.7).
- Every game must have a **dominant skill element**. Games with dice or other randomness (such as Ludo) must use **provably fair randomness** and skill-weighted rule variants. See [§13](#13-legal-regulatory-and-responsible-gaming).

> **Important:** Whether real-money skill games count as "gaming" under Rwandan law (Law n°58/2011) has to be confirmed by a licensed legal adviser and the regulator (RDB) **before** real-money features go live. The system is built so that real money can be switched on per country, per game and per user segment through feature flags.

### 1.4 Definitions
See [§20 Glossary](#20-glossary).

---

## 2. Market Research and Competitive Analysis

### 2.1 Global Landscape

| Platform | Region | Model | Games | Key Takeaways for Us |
|---|---|---|---|---|
| **Skillz** | US / global | Platform for third-party developers; rake on prize pools, reportedly **~14–18%**, split with the developer | Pool, solitaire, bingo, puzzles | An SDK and platform model works. A high rake pushes players away; prize pools shrink when the player base shrinks. |
| **AviaGames (Pocket7Games, 8 Ball Strike)** | US, CA, UK, AU | First-party cash tournaments and "Cups" with large prize pools | 8-ball pool, solitaire, bingo | **Seasonal cups** and live championships drive engagement. Cash play is available only where it is legal. |
| **MPL (Mobile Premier League)** | India → global | Entry-fee cut (example: ₹2 of a ₹10 entry) plus ads | 60+ games, Ludo, pool, fantasy | A big catalogue and aggressive marketing. Had to exit or pivot after the 2025 Indian ban. |
| **WinZO** | India → US | 100+ mini-games, cash contests, vernacular UX | Ludo, carrom, pool | Local-language UX and micro-stakes. Under enforcement investigation in India after the ban. |
| **Zupee** | India | Skill-variant Ludo (limited moves, timed) | Ludo variants | **Skill-weighted Ludo variants** strengthen the "skill" argument. Pivoted to free-to-play in 2026. |
| **Dream11** | India | Fantasy sports contests | Fantasy | Pivoted fully to free-to-play after the 2025 Act. |

### 2.2 African Landscape

| Platform / Signal | Market | Notes |
|---|---|---|
| **Ludo Naira** and similar apps | Nigeria | Cash Ludo with winnings sent to bank accounts. Users **doubt dice fairness**, which shows the need for provable fairness. |
| **MPL Africa** | Select African countries | Cash Ludo, 18+ only. |
| **Ludo Arena** | Mobile-first Africa (Celo / MiniPay) | 1v1 real-money Ludo with stablecoin payouts. Uses **verifiable dice** as its differentiator. |
| **Skrmiish (MoneyMatch)** | Africa | Instant cash matches without waiting for tournaments. |
| **Sports betting incumbents** | Rwanda, Kenya, Nigeria | Betway, ElephantBet and ForteBet were licensed in Rwanda in July 2026. They all use mobile-money rails (MoMo, M-Pesa, OPay, PalmPay). |

### 2.3 Regulatory Signals That Shape This SRS
1. **India (Aug 2025):** The *Promotion and Regulation of Online Gaming Act, 2025* banned **all** real-money online games, **whether skill or chance**. Large operators collapsed or pivoted overnight. **Lesson:** never depend 100% on cash play. A strong **free-to-play and social layer** and a **kill-switch for real money** are architectural requirements.
2. **Rwanda (2025–2026):** The sector runs under Law n°58/2011 plus ministerial orders (2013, 2023). RDB reopened licensing in 2025. **The tax on gross gambling revenue (GGR) rose from 13% to 40%**, and the **tax on winnings rose from 15% to 25%** (from Aug 2025). Enforcement against unlicensed operators is active: 7,000+ slot machines were seized and the Inzozi Lotto licence was revoked. A new national gambling policy is in progress. **Lesson:** design for licensing, tax withholding, regulator reporting and audit from day one.

### 2.4 Gaps and Opportunities (Our Differentiators)
| # | Gap in the market | Our answer |
|---|---|---|
| D1 | Players don't trust dice and RNG | **Provably fair** commit-reveal randomness, verifiable by the player after each match ([§7.2](#72-provably-fair-randomness)) |
| D2 | High rake (14–20%+) taken from winnings | **"Winner takes 2×"** with a small, tiered table fee (5–10%) shown *before* joining, and lower fees for Premium members |
| D3 | Imported games with no local identity | **Local games** such as **Igisoro** (Rwandan mancala) next to global favourites, with Kinyarwanda, English, French and Swahili UX |
| D4 | Slow or opaque withdrawals | **Instant mobile-money payouts** (MTN MoMo, Airtel Money) with live status tracking |
| D5 | Regulatory fragility | Kill-switch per jurisdiction, a solid free-to-play mode, compliance-by-design and regulator reporting |
| D6 | Cheating, bots and collusion | Server-authoritative engine, behavioural ML, collusion graph detection, replays |
| D7 | Native app installs are heavy on low-end phones | **PWA under 2 MB initial load**, works on 3G, installable, no app store needed |
| D8 | Lonely play | Social layer: friends, clubs and teams, spectating, emoji reactions, voice-free safe chat |
| D9 | Problem gambling | Responsible gaming built in: limits, cool-offs, self-exclusion, spend insights, AI risk nudges |
| D10 | Lobbies are flat menus; meeting opponents is anonymous | A **3D virtual games world**: walk into halls and rooms, see people, talk by voice or text, agree on a game and sit at a table. Works on mobile, desktop and VR |

---

## 3. Product Overview

### 3.1 Product Vision
> *"The most trusted place in Africa to play the games you love against real people, and get paid instantly when you win."*

### 3.2 User Classes

| Role | Description |
|---|---|
| **Guest** | Browses games and plays practice matches against bots. Cannot stake. |
| **Registered Player (Tier 0)** | Phone or passkey account. Free-to-play only, with Stars (practice currency, no cash value). |
| **Verified Player (Tier 1)** | KYC passed (national ID and liveness), 18+. Can deposit, stake and withdraw up to the tier limits. |
| **Premium Verified (Tier 2)** | Enhanced due diligence. Higher limits. |
| **Club Owner** | Creates a club or community, hosts private tournaments. |
| **Support Agent** | Handles tickets, disputes and replays. |
| **Risk / Fraud Analyst** | Reviews flags, collusion cases and AML alerts. |
| **Finance Officer** | Reconciliation, payouts, tax reports. |
| **Compliance Officer** | KYC review, responsible gaming, regulator reports. |
| **Content / Game Ops** | Configures games, stakes, tournaments, promotions. |
| **Super Admin** | Full configuration and role management. |
| **Regulator (read-only)** | Optional portal with live reporting access. |

### 3.3 Core User Journey
```
Discover → Sign up (phone OTP / passkey) → Play free (practice / Stars ⭐)
   → Verify KYC (ID + selfie liveness) → Top up (1,000 RWF → 100 🪙 via MoMo / Airtel / card)
   → Post a challenge (game + stake) OR accept one from the Challenge Board OR Quick Match
   → Stake + table fee locked in escrow → Play (server-authoritative)
   → Winner gets 2× stake instantly → Withdraw coins to MoMo / bank (1 🪙 = 10 RWF)
   → Share win / rematch
```

### 3.4 Operating Environment
- **Clients:** Any modern browser (Chrome, Safari, Edge, Firefox and Samsung Internet; last 2 major versions). Android 9+ and iOS 16+ through the browser or installed PWA. Desktop on Windows, macOS and Linux.
- **Minimum device:** 2 GB RAM Android phone, 360×640 viewport, 3G network (≥ 1 Mbps, ≤ 300 ms RTT).
- **Server:** Cloud-native (Kubernetes), with the primary region close to East Africa. Choose a region that meets the data-residency rules in [§12.4](#124-data-protection-rwanda-law-n05821).

### 3.5 Assumptions and Dependencies
- MTN MoMo and Airtel Money APIs (Collections and Disbursements) will be approved for production.
- Identity verification uses NIDA (national ID) through a licensed KYC provider.
- The legal opinion and the licence (or an exemption confirmation) come before any real-money launch.

---

## 4. Game Catalogue and Phased Roadmap

### 4.1 Launch Games (MVP: 3 Games)

| # | Game | Players | Skill Factor | Randomness | Why at launch |
|---|---|---|---|---|---|
| G1 | **8-Ball Pool (Billiards)** | 1v1 | Very high (aim, power, spin, strategy) | None after the break (deterministic physics) | Strongest skill profile and a global favourite. Proven cash format (AviaGames, Skillz). |
| G2 | **Ludo (skill variants)** | 1v1, 2v2, 4-player FFA | Medium-high in skill variants | Dice (provably fair) | Huge mass appeal across Africa and Asia. Variants reduce luck. |
| G3 | **Igisoro** (Rwandan mancala) | 1v1 | Very high (pure strategy, no randomness) | None | Local cultural identity and **pure skill**, which is the strongest legal footing. Nobody else offers it. |

> **Alternative G3:** If market testing favours a global title, swap Igisoro for **Draughts / Checkers** (also pure skill, with the same module type as Igisoro). Both should eventually ship.

### 4.2 Game Rules Requirements per Launch Game

#### G1: 8-Ball Pool
- FR-G1-01: Standard 8-ball rules (WPA-inspired, simplified): break, open table, solids/stripes assignment, fouls, ball-in-hand, calling the 8-ball pocket.
- FR-G1-02: Controls: drag to aim, pull-back power bar (mobile), mouse plus wheel or keys (desktop), cue-ball spin selector (top, back, side), fine-aim slider.
- FR-G1-03: Aim guide line length depends on the table tier (full guide in low-stakes rooms, shorter guide in high-stakes rooms) to reward skill.
- FR-G1-04: Shot timer (default 30 s, configurable). Repeated timeouts lead to a forfeit.
- FR-G1-05: **Deterministic physics**. The same input always gives the same output on client and server (fixed-timestep, fixed-point or deterministic float WASM engine).
- FR-G1-06: The client simulates the shot for instant feedback. The **server re-simulates and decides the result**. If they diverge, the server wins and the client reconciles.
- FR-G1-07: Break randomness (rack order) comes from the provably fair seed.
- FR-G1-08: Modes: Quick Match, Best-of-3, "9-Ball" (Phase 2), Trick Shot Challenge (solo skill tournament, Phase 2).

#### G2: Ludo
- FR-G2-01: Classic rules: a 6 to leave base, captures, safe squares, home column, extra roll on a 6 (configurable), three sixes forfeit (configurable).
- FR-G2-02: **Skill variants** (default for cash play):
  - **Ludo Sprint:** fixed number of moves (for example 24 each). The highest score wins (points per square moved, bonus for captures and tokens home). This reduces the impact of luck.
  - **Ludo Timed:** a 5–10 minute game, score-based.
  - **Ludo Dice Draft (innovative):** both players get the **same dice sequence** from a shared seed (a "duplicate" format, like duplicate bridge). Luck is equal, so only decisions differ.
- FR-G2-03: Classic mode is available for free-to-play. It is enabled for cash only if the legal opinion allows it.
- FR-G2-04: Move timer (default 15 s) with auto-move on timeout, which counts as a strike. 3 strikes means a forfeit.
- FR-G2-05: The server generates every dice roll from the commit-reveal seed. The client never generates outcomes.
- FR-G2-06: 2v2 team mode with a team wallet split (Phase 2).

#### G3: Igisoro
- FR-G3-01: Traditional 4×8 pit board, 2 players, sowing and capture rules per the agreed Rwandan rule set. The rules must be validated with cultural experts and documented in-app.
- FR-G3-02: Interactive tutorial plus a rule-explainer animation (essential, because many young or urban users may not know the rules).
- FR-G3-03: Move timer and chess-style game clock (for example 5+3).
- FR-G3-04: No randomness. Starting player decided by the provably fair coin flip.
- FR-G3-05: AI opponent with difficulty levels for practice (minimax / MCTS).

### 4.3 Future Games (Phase 2+)
Added through the [Game Module SDK](#10-game-module-sdk-adding-games-later) without changing core code.

| Phase | Candidate Games | Type |
|---|---|---|
| 2 | Draughts / Checkers, Carrom, Chess (blitz), 9-Ball, Dominoes | Turn-based / physics |
| 2 | Word duel (Kinyarwanda, Swahili, English), Trivia (Rwanda and Africa culture, sports) | Knowledge / puzzle |
| 3 | Mini football penalty duel, Darts, Bowling, Mini golf | Physics / reflex |
| 3 | Solitaire / Match-3 / Sudoku "same seed" async duels | Asynchronous solo-vs-solo |
| 3 | Rummy / Card games (only if legally allowed) | Cards (high regulatory risk) |
| 4 | Partner / third-party developer games through a public SDK | Platform marketplace |

---

## 5. Functional Requirements

Priority key: **M** = Must (MVP), **S** = Should (MVP+ / Phase 2), **C** = Could (Phase 3+).

### 5.1 Account and Identity

| ID | Requirement | Priority |
|---|---|---|
| FR-ACC-01 | Sign up with phone number + OTP (SMS / WhatsApp fallback). | M |
| FR-ACC-02 | **Passkeys (WebAuthn / FIDO2)** as the primary passwordless login after sign-up. | M |
| FR-ACC-03 | Optional social sign-in (Google, Apple) for Tier 0 only. | S |
| FR-ACC-04 | Unique username, avatar (preset, uploaded or AI-generated stylised avatar), country, language. | M |
| FR-ACC-05 | Age gate: date of birth at sign-up. **Real-money features locked until 18+ is verified through KYC.** | M |
| FR-ACC-06 | KYC Tier 1: national ID (NIDA) or passport, selfie **liveness** check, name match with the mobile-money account. | M |
| FR-ACC-07 | KYC Tier 2: proof of address, source of funds (above thresholds). | S |
| FR-ACC-08 | One person = one account. Device fingerprinting plus ID uniqueness checks. | M |
| FR-ACC-09 | Session management: see and revoke active devices. | M |
| FR-ACC-10 | Account deletion / data export (subject to legal retention). | M |
| FR-ACC-11 | Referral code and invite links. | S |

### 5.2 Lobby and Discovery

| ID | Requirement | Priority |
|---|---|---|
| FR-LOB-01 | Home shows a game grid (cards with live player counts), the wallet balance, continue-playing and live tournaments. | M |
| FR-LOB-02 | Per-game lobby: stake tables (Free ⭐, 10, 20, 50, 100, 500 🪙 …, configurable), with the **stake, table fee and winner's pot (2×) shown before joining**, plus a link to the Challenge Board. | M |
| FR-LOB-03 | Filters: game, stake range, mode, number of players. | M |
| FR-LOB-04 | Practice vs AI bot (free, unranked). | M |
| FR-LOB-05 | Personalised recommendations (games, stakes matching skill and limits, never pushing a higher stake to an at-risk player). | S |
| FR-LOB-06 | Event banners (seasonal cups, holidays, Umuganura cultural events, etc.). | S |

### 5.3 Matchmaking

| ID | Requirement | Priority |
|---|---|---|
| FR-MM-01 | Skill-based matchmaking using a rating per game (**Glicko-2 / TrueSkill 2**). | M |
| FR-MM-02 | Matching on stake, mode, region / latency and rating band. The band widens over time (max wait configurable, for example 30 s). | M |
| FR-MM-03 | **No bots in real-money matches**, ever. If no human is found: offer to keep waiting, change stake or play free vs AI. | M |
| FR-MM-04 | Private challenge: invite a friend by link / QR / username with an agreed stake. Both must have funds. | M |
| FR-MM-05 | Rematch button (both accept → new escrow). | M |
| FR-MM-06 | Anti-collusion rules: prevent repeated matches between flagged pairs, same device / IP / household. | M |
| FR-MM-07 | New-player protection: first N cash matches only against other new players. | S |
| FR-MM-08 | Asynchronous matchmaking for "same seed" solo games (play now, compare scores later). | C |

### 5.4 Gameplay Session (Common to All Games)

| ID | Requirement | Priority |
|---|---|---|
| FR-GS-01 | Server-authoritative game state. The client only sends **intents** (shot vector, chosen token, chosen pit). | M |
| FR-GS-02 | Real-time transport: **WebTransport** (HTTP/3, QUIC) with **WebSocket fallback**. | M |
| FR-GS-03 | **Reconnection**: a player who disconnects has a grace window (default 60 s, configurable per game) to rejoin with full state restore. | M |
| FR-GS-04 | Disconnect policy: grace window expires → turn timeouts → forfeit per game rules. Mass outage on our side → **match voided and stakes refunded**. | M |
| FR-GS-05 | In-game quick chat (preset phrases + emojis) and mute. Free text and voice during matches follow the rules in §8.4.5. | M |
| FR-GS-06 | Resign / forfeit with confirmation. | M |
| FR-GS-07 | Full **replay** recorded (event log) for disputes, review and sharing. | M |
| FR-GS-08 | Spectator mode for friends and tournament finals (with a delay to stop ghosting). | S |
| FR-GS-09 | Haptic feedback (Vibration API), sound, reduced-motion mode. | M |
| FR-GS-10 | Result screen: winner, pot won, fees paid, any tax withheld, rating change, rematch, share card (auto-generated image). | M |

### 5.5 Tournaments and Competitions

| ID | Requirement | Priority |
|---|---|---|
| FR-TRN-01 | Scheduled tournaments: knockout / Swiss, entry fee, guaranteed or dynamic prize pool, payout table. | S |
| FR-TRN-02 | Sit-and-Go: starts when N players register. | S |
| FR-TRN-03 | Leaderboard tournaments (best score over a period). | S |
| FR-TRN-04 | **Seasonal Cups** (monthly / quarterly) with a live-streamed final. | C |
| FR-TRN-05 | Club tournaments created by club owners (share of table fees for the club owner, configurable and disclosed). | C |
| FR-TRN-06 | Free-roll tournaments with sponsor prizes (good regulatory footing, marketing driver). | S |
| FR-TRN-07 | Automatic refunds if a tournament is cancelled. | S |

### 5.6 Social and Community

| ID | Requirement | Priority |
|---|---|---|
| FR-SOC-01 | Friends list, online status, invite to match. | M |
| FR-SOC-02 | Player profile: stats per game, rating, badges, recent matches (privacy controls). | M |
| FR-SOC-03 | Clubs / teams with club chat (moderated). | C |
| FR-SOC-04 | Leaderboards: global, country, friends, weekly. | S |
| FR-SOC-05 | Achievements and badges (never redeemable for cash). | S |
| FR-SOC-06 | Share wins to WhatsApp / Instagram / X via Web Share API. | S |
| FR-SOC-07 | **AI moderation** of user names, avatars and club chat (toxicity, PII, hate). | S |

### 5.7 Notifications

| ID | Requirement | Priority |
|---|---|---|
| FR-NOT-01 | Web Push (PWA) for: challenge received, match found, tournament starting, deposit / withdrawal status. | M |
| FR-NOT-02 | SMS for financial events and security alerts. | M |
| FR-NOT-03 | In-app notification centre. | M |
| FR-NOT-04 | User controls per notification type. Marketing opt-in only. | M |

### 5.8 Smart / AI Features (2026+)

| ID | Requirement | Priority |
|---|---|---|
| FR-AI-01 | **AI Coach** (free mode): after a match, gives tips ("you could have potted the 3-ball with back-spin", "this Igisoro move gave up 6 seeds"). | S |
| FR-AI-02 | **AI practice opponents** with human-like levels (trained on anonymised human play). | M (basic), S (adaptive) |
| FR-AI-03 | **AI support assistant**: answers FAQs, explains a transaction, opens a dispute with replay attached; hands off to a human. | S |
| FR-AI-04 | AI risk models for fraud, collusion and problem gaming (see §7, §13). | M (rules-based) → S (ML) |
| FR-AI-05 | Auto-generated match highlights (best shot clip) for sharing. | C |
| FR-AI-06 | Natural-language admin analytics ("revenue by game last week in Huye"). | C |

> **Guardrail:** AI features must never be available *during* a real-money match (no in-match assistance). AI personalisation must never promote higher stakes or longer play to users flagged as at-risk.

### 5.9 Player Levels and Experience (XP)

**Level** measures **experience** (how much someone has played and achieved). It only goes up. The separate **skill rating** (Glicko-2, §5.3) measures **strength**. It goes up and down and is the only value used for matchmaking. Both appear on the profile.

#### 5.9.1 Earning XP

| Event | XP | Notes |
|---|---|---|
| Completed rated match (any result) | +10 | Base value, configurable per game (longer games can give more) |
| Win | +10 | On top of the base |
| Draw | +5 | On top of the base |
| Beat a higher-rated opponent | +5 | Rewards skill, not just volume |
| First win of the day | +20 | Once per day |
| Tournament finish (top 10% / final / win) | +30 / +60 / +100 | Per tournament |
| Practice vs AI | +2 | Max 20 XP per day from practice |
| Forfeit, abandon or timeout loss | 0 | No XP for leaving games |
| **Daily XP cap** | **400 XP** | About 20 matches. Stops grinding and supports responsible gaming |

**Rules:**
- **Free (⭐) and cash (🪙) matches earn the same XP.** Leveling must never push players toward cash play or higher stakes.
- Matches voided, reversed in a dispute or flagged for collusion lose their XP.
- XP from the same opponent counts for at most 5 matches per day (stops farming XP with a friend or a second account).

#### 5.9.2 Level Curve and Tiers

Every player starts at level 1 with 0 XP. XP needed to go from level L−1 to level L = **50 × (L − 1)**. Total XP to reach level L = **25 × L × (L − 1)**.

| Level | Total XP | Typical time at 150 XP/day | Tier |
|---|---|---|---|
| 1 – 9 | 0 – 2,249 | First 2 weeks | 🥉 Bronze |
| 10 | 2,250 | About 2 weeks | 🥈 Silver (10–24) |
| 25 | 15,000 | About 3 months | 🥇 Gold (25–49) |
| 50 | 61,250 | About 13 months | 💎 Platinum (50–74) |
| 75 | 138,750 | About 2.5 years | 🔷 Diamond (75–99) |
| 100 | 247,500 | Long-term goal (about 4.5 years) | 👑 Legend |

#### 5.9.3 Level Rewards (No Cash Cost)
Rewards are **cosmetic or status-based**, so leveling costs the platform nothing.

| Level | Reward |
|---|---|
| 5 | Eligible for **Player of the Day** (§5.10) |
| 10 | Avatar frame (Silver) + choice of profile title |
| 15 | Custom dice / cue colour |
| 25 | +1 open-challenge slot + Gold frame |
| 50 | Exclusive cue / dice / board skin + Platinum frame |
| 75 | Animated avatar frame + Diamond badge on challenge cards |
| 100 | Legend crown + invitation to the monthly sponsored **Legends Cup** (free entry) |

| ID | Requirement | Priority |
|---|---|---|
| FR-LVL-01 | XP is awarded by the server only, at match settlement, according to §5.9.1. | M |
| FR-LVL-02 | Level, tier, XP progress bar and next reward are shown on the profile and in the header (mobile: compact ring around the avatar). | M |
| FR-LVL-03 | Level-up celebration (animation, haptic, shareable card). Respects reduced motion. | M |
| FR-LVL-04 | XP and level rules are configurable in the admin console, and every change is versioned. | M |
| FR-LVL-05 | Level is shown on challenge cards next to the rating. **Matchmaking uses rating only.** | M |
| FR-LVL-06 | XP history (per match) is visible to the player for transparency. | S |
| FR-LVL-07 | Seasonal XP passes (optional, cosmetic rewards only) | C |

### 5.10 Player of the Day (Best Performer)

Every day the platform names **one Player of the Day**. They get a prize and are featured on the home page and social media for advertising. The prize is designed to be **loss-proof**: it is paid only from money the platform has already earned.

#### 5.10.1 Eligibility (all must be true)
1. Level ≥ 5 and account age ≥ 7 days.
2. At least **10 completed rated matches** that day against **at least 5 different opponents** (human only; AI practice does not count).
3. KYC Tier 1 verified (required for any coin prize; unverified players can win the title and non-cash rewards).
4. **Opted in** to being featured publicly (consent for advertising use of username / avatar under Law N°058/2021).
5. No open risk or collusion case, not self-excluded, no cool-off and no active responsible-gaming flag.
6. Not a staff member, partner or affiliate account.
7. Did not win Player of the Day in the previous 7 days (spreads the spotlight and widens the advertising reach).

#### 5.10.2 Scoring: Daily Performance Score (DPS)
The score rewards **beating expectations**, not just playing a lot. This is fairer across games and stakes, and it resists farming.

For each counted match *i* that day:
- `sᵢ` = actual result (win = 1, draw = 0.5, loss = 0)
- `eᵢ` = expected result from both players' ratings **before** the match (Glicko-2 expected score)

```
Surplus   = Σ (sᵢ − eᵢ)                      over the first 30 counted matches of the day (chronological)
Diversity = min(1, distinct_opponents / 5)
DPS       = Surplus × Diversity
```

- Beating a stronger opponent adds a lot (for example +0.75). Beating a much weaker one adds little (+0.1). Losing to a weaker one subtracts.
- Counting only the **first 30 matches in time order** stops players from cherry-picking good runs or grinding all day.
- **Tie-breakers:** (1) higher win rate that day, (2) more distinct opponents, (3) whoever reached the score first.
- Free and cash rated matches count equally, so the award never pushes cash play.
- The day is 00:00–23:59 CAT. Matches still running at midnight count for the day they started.

**Example:**

| Player | Matches | Wins | Surplus | Distinct opponents | DPS |
|---|---|---|---|---|---|
| Aline | 14 | 10 | +3.9 | 9 | **3.9** 🏆 |
| Eric | 12 | 11 | +4.4 | 3 | 4.4 × 0.6 = 2.64 |
| Jean | 30 | 19 | +2.6 | 12 | 2.6 |

Aline wins: she beat stronger opponents. Eric had the highest raw surplus but played only 3 different people, so his score is reduced. Jean played the most games but only his first 30 count, and he mostly beat weaker players.

#### 5.10.3 Prize Funding: the No-Loss Rule

The prize is **never paid from reserves or player funds**. It is calculated from the **previous day's net fee revenue**, which the platform has already earned:

```
NetRevenue(d−1) = table fees + tournament fees − GGR tax − payment costs       (day d−1, settled)

Pool(d) = 0                                                  if NetRevenue(d−1) ≤ 0
        = min( p × NetRevenue(d−1),  DailyCap,  MonthlyPromoBudgetLeft )   otherwise

Defaults:  p = 5%   ·   DailyCap = 5,000 🪙 (50,000 RWF)   ·   MonthlyPromoBudget set by finance
```

- **Pool is the total cost**, including any tax withheld on the prize. Player receives `Pool − statutory withholding`. The platform never pays more than `Pool`.
- If `Pool` is below the **minimum cash prize** (for example 200 🪙), the winner gets the **non-cash package only**. The platform never tops up from reserves.
- **Non-cash package (every winner):** "Player of the Day" badge (permanent), 7 days of Premium, homepage hero spot for 24 h, an exclusive daily-champion avatar frame. These have almost no marginal cost.
- Because `Pool ≤ 5%` of income the platform has already earned, **the award cannot create a loss**, whatever the volume.

**Illustrative calculation** (using the §6.7.4 assumptions):

| Item | Value |
|---|---|
| Table fees per day | 1,200,000 RWF |
| − GGR tax (40%) | −480,000 RWF |
| − Payment costs (about 1/30 of the monthly 1.6M) | −53,000 RWF |
| **NetRevenue (d−1)** | **667,000 RWF** |
| Pool = 5% (below the 50,000 RWF cap) | **33,350 RWF = 3,335 🪙** |
| Monthly cost (30 days) | ≈ 1.0M RWF, about 4.5% of the 22M RWF monthly net contribution |

#### 5.10.4 Award Process

```
00:00 CAT   Day closes. DPS calculated for all eligible players
00:15       Top 5 candidates → automated fraud and collusion checks
00:15–10:00 Risk review of the leading candidate (replays, opponent graph, device checks)
10:00       Winner announced. Prize credited. Home page, push notification, social posts
            If the leader fails review → next candidate is checked; the title can stay
            unawarded for that day rather than go to a suspicious account
```

#### 5.10.5 Advertising Use

| ID | Requirement | Priority |
|---|---|---|
| FR-POD-01 | Automatic **share card** (avatar, username, level, tier, games won, best-shot replay clip) in story (9:16) and post (1:1) formats. | M |
| FR-POD-02 | Home page "Player of the Day" hero (mobile: top card; desktop: right panel spotlight) for 24 h. | M |
| FR-POD-03 | **Hall of Champions** page: past daily winners, filterable by game and month. | S |
| FR-POD-04 | Ads focus on **skill and achievement** (best shot, comeback, opponents beaten). They don't advertise prize money or "get rich" messages (LEG-08). | M |
| FR-POD-05 | Only username and avatar are shown. Real name, photo or interview only with **separate written consent**. The winner can withdraw consent at any time. | M |
| FR-POD-06 | The winner is notified first and can ask not to be featured on social media and still keep the prize. | M |
| FR-POD-07 | Scoring rules and the prize formula are published on the "How it works" page. | M |
| FR-POD-08 | Later: Player of the Week / Month and per-game daily champions, using the same no-loss formula with their own `p` and caps. | C |

#### 5.10.6 Requirements Summary

| ID | Requirement | Priority |
|---|---|---|
| FR-POD-10 | Daily batch job computes DPS from settled matches only. It is idempotent and can be re-run. | M |
| FR-POD-11 | Pool computed from the **settled** ledger for d−1 (fees, tax, payment costs). The calculation is stored with the award for audit. | M |
| FR-POD-12 | The prize is paid from a dedicated `PROMO_BUDGET` ledger account, funded daily by a transfer of `Pool` from `PLATFORM_REVENUE`. The promo account can never go negative. | M |
| FR-POD-13 | Prize coins are paid as **Available** coins (withdrawable), unless finance configures bonus coins with a published play-through. | M |
| FR-POD-14 | Admin review queue for candidates: approve, reject (with reason), skip day. Four-eyes approval when the prize is above a threshold. | M |
| FR-POD-15 | Parameters (`p`, caps, minimum matches, eligibility rules) are configurable and versioned. | M |

---

## 6. Coin Economy, Wallet, Ledger and Payments

### 6.1 Currency Model

The platform uses **two separate units**. They must never be mixed in the UI, the ledger or marketing.

| Unit | Symbol | Backed by | Bought with money? | Withdrawable? | Used for |
|---|---|---|---|---|---|
| **Coin** | 🪙 | **1 Coin = 10 RWF**, fully backed by player funds held in a segregated trust account | Yes (top-up) | **Yes**, 1:1 back to RWF | Cash matches, open challenges, tournaments, cosmetics, Premium |
| **Star** (practice currency) | ⭐ | Nothing. It has no cash value | **No**, never | **No**, never | Free matches, practice vs AI, free-roll entry tickets |

**Why the Coin is pegged to RWF and not to USD:**
- The ratio in the original idea, "1 coin = 10 RWF = 0.5 USD", can't hold. 0.5 USD is about 725 RWF at around 1,450 RWF/USD (2026), and the RWF/USD rate floats every day. A coin can have **one** fixed peg only.
- Players deposit and withdraw in RWF (MoMo or Airtel), and taxes are paid in RWF. Pegging to RWF means **no FX risk for players or the platform**.
- USD (or KES, UGX and others) is shown as **approximate display only**: "🪙 100 ≈ 1,000 RWF ≈ $0.69". It uses a daily reference rate labelled "approx.".
- For future non-RWF top-ups (cards, other countries), the currency is converted to RWF at a **quoted rate the player sees and accepts before paying**. Any FX margin is shown in the quote (see [§6.7](#67-revenue-model-system-owner-earnings)).

**Coins are not crypto and not e-money:**
- Coins are an internal **accounting unit** for the player's own RWF balance. They are not a token, not on a blockchain, and **cannot be transferred between users**. The only way coins move between players is through a settled match or tournament.
- This keeps the platform out of the virtual-asset regime (Law No. 023/2026) and out of P2P remittance / e-money activity. It also closes a common money-laundering path (gifting or selling coins). See ADR-09.

| ID | Requirement | Priority |
|---|---|---|
| FR-CUR-01 | The coin peg (1 Coin = 10 RWF) is a platform configuration value. Changing it requires compliance approval, 30 days' notice to users, and conversion of existing balances at full value. | M |
| FR-CUR-02 | Coins are stored as **integers** (no fractional coins). The ledger stores the underlying RWF value as integer minor units as well. | M |
| FR-CUR-03 | Every coin amount shown to users can be expanded to its RWF value (tap the amount → "100 🪙 = 1,000 RWF"). | M |
| FR-CUR-04 | Coins cannot be sent, gifted, sold or traded between users. There is no transfer API. | M |
| FR-CUR-05 | Stars can never be converted into Coins or money, in either direction. | M |
| FR-CUR-06 | Foreign-currency display uses a daily reference rate, marked "approx.". It is never used for settlement. | S |

### 6.2 Wallet Balances

| Balance | Description | Withdrawable |
|---|---|---|
| **Available Coins** | Topped-up coins + winnings | Yes |
| **Bonus Coins** | Promotional coins with clear play-through rules | No (until converted per the bonus terms) |
| **Locked Coins** | Coins held in escrow for an active match, an open challenge or a tournament | No (until settled or refunded) |
| **Pending Withdrawal** | Requested and awaiting provider confirmation | No |
| **Stars** | Practice currency (no cash value) | No |

| ID | Requirement | Priority |
|---|---|---|
| FR-WAL-01 | Each verified user has one coin wallet. Its underlying RWF value is tracked in the ledger. | M |
| FR-WAL-02 | **Double-entry ledger**: every movement is a balanced journal entry (debit = credit). Balances are *derived* from the ledger, never edited directly. | M |
| FR-WAL-03 | Ledger entries are **immutable and append-only**. Corrections only through reversing entries. | M |
| FR-WAL-04 | All money operations are **idempotent** (idempotency key per request). | M |
| FR-WAL-05 | Integer units only, no floating point anywhere in money logic. | M |
| FR-WAL-06 | Transaction history with filters, search and downloadable statements (PDF / CSV). Each line shows coins **and** RWF, **including every fee charged**. | M |
| FR-WAL-07 | Real-time balance updates in the UI (pushed over the real-time channel). | M |
| FR-WAL-08 | Wallet PIN or passkey confirmation for withdrawals and changes to payout methods. | M |
| FR-WAL-09 | Monthly statement: "Topped up X, won Y, lost Z, fees paid F, net N". | M |

### 6.3 Top-Up (Money → Coins)

```
Player selects: 1,000 RWF  →  Quote: 100 🪙  (fee: 0)  →  MoMo push prompt on phone
→ Player approves with MoMo PIN  →  Webhook / poll confirms  →  +100 🪙 Available
```

| ID | Requirement | Priority |
|---|---|---|
| FR-TOP-01 | **MTN MoMo** Collections (RequestToPay) with a push prompt on the user's phone. | M |
| FR-TOP-02 | **Airtel Money** collections. | M |
| FR-TOP-03 | Cards (Visa / Mastercard) through a PCI-DSS compliant gateway (hosted fields / 3DS2). Shows the RWF quote and any FX margin before payment. | S |
| FR-TOP-04 | Preset packs (for example 50 🪙 / 100 🪙 / 500 🪙 / 1,000 🪙) plus a custom amount. Coins credited = RWF paid ÷ 10, **at par**. | M |
| FR-TOP-05 | Payment aggregator abstraction (for example Flutterwave, Pesapal, DPO, or direct MNO) with provider routing. | M |
| FR-TOP-06 | Minimum / maximum top-up per KYC tier. Daily / weekly / monthly limits (user-set and regulatory). | M |
| FR-TOP-07 | Payer name must match the KYC name (or be flagged). Third-party funding is blocked. | M |
| FR-TOP-08 | Asynchronous status handling: pending → success / failed through webhook + polling fallback. Timeout after N minutes, then automatic retry or cancel. | M |
| FR-TOP-09 | Any top-up fee (if the business ever adds one) must appear in the quote before the MoMo prompt is sent. The default is **0 fee**. | M |

### 6.4 Open Challenges (Post a Challenge)

The core social mechanic: a player **posts a challenge** with a game and a coin stake. Another player accepts it, and **the winner takes the pot (2× the stake)**.

**Challenge card (what every player sees):**
```
┌────────────────────────────────────────────┐
│ 🎱 8-Ball Pool · Best of 1                 │
│ Posted by  Kevin_R  ·  Rating 1,640 (Gold) │
│ Stake      100 🪙 each                     │
│ Winner gets 200 🪙  (= 2,000 RWF)          │
│ Table fee   6 🪙 each  · shown before join │
│ Expires in 14:32                           │
│                     [ Accept · pay 106 🪙 ] │
└────────────────────────────────────────────┘
```

**Lifecycle:**
```
POST    → creator's stake + table fee move to Locked (escrow) → challenge is OPEN
ACCEPT  → acceptor's stake + fee locked → match created → both notified
PLAY    → server-authoritative match
SETTLE  → winner +2× stake (the pot) · table fees → platform revenue
EXPIRE / CANCEL (before accept) → creator's stake + fee fully refunded
DRAW    → each player's stake refunded; fee handling per the published draw rule
VOID    → (server fault, both disconnected by our outage) → stakes AND fees refunded
```

| ID | Requirement | Priority |
|---|---|---|
| FR-CHL-01 | A verified player can post a challenge with: game, mode / variant, stake (from allowed steps, for example multiples of 10 🪙), time control, **opponent rating range** (optional), public / friends-only / private link, and expiry (5 min – 24 h). | M |
| FR-CHL-02 | **The creator's stake + table fee are locked in escrow when the challenge is posted.** No unfunded or fake challenges. | M |
| FR-CHL-03 | **Challenge Board**: a live list filtered by game, stake range, rating range and time control, sorted by newest, stake or "fits my rating". | M |
| FR-CHL-04 | The challenge card always shows the **creator's rating and tier**, the stake, the pot the winner gets, the table fee and the expiry. | M |
| FR-CHL-05 | Accepting shows a confirmation sheet: "You pay 106 🪙 (100 stake + 6 fee). Winner gets 200 🪙." Slide-to-confirm above a threshold. | M |
| FR-CHL-06 | The creator can cancel any time before acceptance for a full refund (stake + fee). | M |
| FR-CHL-07 | Auto-expiry with full refund. A notification is sent to the creator. | M |
| FR-CHL-08 | Limits: max open challenges per user (for example 3), max stake per KYC tier and per the user's own RG limits. Locked coins count toward loss / stake limits. | M |
| FR-CHL-09 | **New-player protection**: players with fewer than N cash matches can only accept challenges inside their rating band. Players far above the challenge's rating range cannot accept (stops "hustling" of beginners). | M |
| FR-CHL-10 | **Anti-collusion**: block or flag repeat challenges between the same pair, accounts sharing device / IP / payout method, and patterns of always-losing to the same opponent (chip dumping). | M |
| FR-CHL-11 | Direct challenge: send a challenge to a specific friend (username / link / QR). It expires if not accepted. | M |
| FR-CHL-12 | Rematch: after a match, both players can rematch at the same stake in one tap (new escrow, fees shown again). | M |
| FR-CHL-13 | Multi-player challenges (for example 4-player Ludo, 4× stake pot) with published payout rules (winner-takes-all, or 1st / 2nd split). | S |
| FR-CHL-14 | Quick Match (automatic matchmaking at a stake table, see §5.3) uses **the same money flow** as challenges. | M |

### 6.5 Escrow and Settlement (Ledger Entries)

Example: 100 🪙 stake each, 6% table fee.

```
1. Post / accept (per player):
   A.available  -106 🪙 → ESCROW(match) +100 🪙 · FEE_HELD(match) +6 🪙
   B.available  -106 🪙 → ESCROW(match) +100 🪙 · FEE_HELD(match) +6 🪙
2. Match ends; server issues a signed result: A wins.
3. Settlement (one atomic DB transaction):
   ESCROW(match)      -200 🪙 → A.available +200 🪙     (pot = 2× stake)
   FEE_HELD(match)    -12 🪙  → PLATFORM_REVENUE +12 🪙
4. Winnings tax (if applicable by law; see §13 and the open questions):
   A.available        -T 🪙   → TAX_PAYABLE +T 🪙       (shown on the result screen)
5. Draw  → ESCROW refunds 100 🪙 to each; fee per the published draw rule.
   Void  → ESCROW and FEE_HELD fully refunded to each player.
```

| ID | Requirement | Priority |
|---|---|---|
| FR-ESC-01 | Stakes and fees move into escrow **before** the first move. If escrow fails, the match does not start. | M |
| FR-ESC-02 | Settlement is triggered only by a **signed result** from the game server. It is atomic and exactly-once. | M |
| FR-ESC-03 | The pot paid to the winner is always **exactly the sum of the stakes**. Fees are a separate line, never taken from the pot. "Winner gets 2×" is always literally true. | M |
| FR-ESC-04 | Disputed matches can be **held** (escrow frozen) for review, with a deadline (for example 24–72 h). | M |
| FR-ESC-05 | Winnings-tax withholding engine (rules per jurisdiction, threshold, rate, gross vs net base). Per-user tax certificates. | M |
| FR-ESC-06 | Daily automated job: sum of escrow entries = sum of open challenges + active matches. Alert on mismatch. | M |

### 6.6 Withdrawals (Coins → Money)

| ID | Requirement | Priority |
|---|---|---|
| FR-WDR-01 | Withdraw coins to **MTN MoMo / Airtel Money** (Disbursements / Transfer API) at par: 1 🪙 = 10 RWF. Target: **under 2 minutes** for auto-approved requests. | M |
| FR-WDR-02 | Withdraw to a bank account. | S |
| FR-WDR-03 | Only to payout methods verified in the user's own name. | M |
| FR-WDR-04 | Risk engine auto-approval rules (amount, account age, KYC tier, play-through, risk score). Others go to the manual review queue. | M |
| FR-WDR-05 | Withdrawal fee policy is configurable and **shown before confirmation**. Recommended default: first 2 withdrawals per month free, then a small flat fee. | M |
| FR-WDR-06 | Topped-up coins must be played through a minimum amount before withdrawal (AML rule, configurable), except for refunds to the source. | M |
| FR-WDR-07 | Live tracking: requested → approved → sent → received. | M |
| FR-WDR-08 | Automatic reversal to the wallet if the provider fails. | M |
| FR-WDR-09 | Minimum withdrawal (for example 50 🪙 = 500 RWF). | M |

### 6.7 Revenue Model (System Owner Earnings)

#### 6.7.1 Principle: earn on volume, disclose every fee
The platform is a **neutral referee**. It never wins or loses when a player wins or loses. It earns a small, **disclosed** fee on activity, and money from optional products.

> **Design rule:** Every fee must be shown **before the player commits**, appear on the statement, and be published on a public "How we earn" page. Fees can be *simple and unobtrusive* (one line on the confirm sheet) but **never hidden**. Hidden fees or a hidden house edge in a real-money product break consumer-protection and gaming-licence conditions. They are also the fastest way to lose the trust that this platform depends on (see the competitor lessons in §2). In practice, the disclosed model earns more (§6.7.4).

#### 6.7.2 Revenue Options Compared

| Model | How it works | Revenue scales with play? | User perception | Verdict |
|---|---|---|---|---|
| **A. Table fee (recommended)** | Each player pays stake + a small fee. Winner gets exactly 2× the stake. | ✅ Yes | "Winner takes 2×" stays true. The fee is a clear, small line. | ✅ **Primary model** |
| B. Rake from the pot | Winner gets 2× minus X% | ✅ Yes | Feels like "you took part of my winnings" | ⚪ Not used. Tournaments show the fee as a separate line too |
| C. Top-up / cash-out spread | 1,000 RWF buys 95 🪙 | ❌ Only on money in / out | Feels like a hidden charge | ❌ Not at launch |
| D. Withdrawal fee | Flat fee per cash-out | ❌ Only on cash-out | Accepted if a few free ones are included | ✅ Secondary (small) |
| E. Premium membership | Monthly subscription with perks | ✅ Recurring | Positive (optional) | ✅ Secondary |
| F. Cosmetics store | Cue skins, dice, boards, avatars (paid in coins) | ✅ Yes | Positive (optional, no gameplay advantage) | ✅ Secondary |
| G. Ads (free mode only) | Rewarded ads for Stars, sponsor banners | ✅ With free users | Neutral | ✅ Secondary |
| H. Sponsored tournaments | Brands fund prize pools | ✅ Yes | Very positive | ✅ Growth |

#### 6.7.3 Recommended Fee Schedule (Configurable)

**Table fee per player (cash matches and challenges):**

| Stake per player | Fee rate | Example |
|---|---|---|
| 10 – 40 🪙 | 10% (min 1 🪙) | Stake 20 → fee 2 → pay 22, winner gets 40 |
| 50 – 190 🪙 | 8% | Stake 100 → fee 8 → pay 108, winner gets 200 |
| 200 – 990 🪙 | 6% | Stake 500 → fee 30 → pay 530, winner gets 1,000 |
| 1,000+ 🪙 | 5%, capped at 200 🪙 | Stake 2,000 → fee 100 → pay 2,100, winner gets 4,000 |

- Fee = stake × rate, **rounded to the nearest whole coin**, shown exactly before commit.
- **Premium members:** −2 percentage points on table fees (min 3%).
- **Draw rule (published):** stakes are refunded and fees are kept (the platform hosted the match). **Void** (our fault) refunds everything.
- **Tournaments:** entry = prize-pool contribution + fee, both shown (for example entry 110 🪙 = 100 to the prize pool + 10 fee).

**Other fees:**

| Item | Recommended default |
|---|---|
| Top-up | **Free** at par (absorb mobile-money collection cost; it reduces drop-off) |
| Withdrawal | 2 free per month, then 10 🪙 (100 RWF) flat, shown before confirm |
| Premium | about 2,000 RWF / month: lower fees, advanced stats, AI coach, extra open-challenge slots, profile flair |
| Cosmetics | 20 – 500 🪙 per item. Cosmetic only, no gameplay advantage. Non-refundable after use. |

#### 6.7.4 Unit Economics (Illustrative)

Assumptions (Phase 1b → 2, adjust with real data): 5,000 daily active cash players, 6 cash matches per player per day, average stake 50 🪙 (500 RWF), average fee 8%. Mobile-money cost about 1.5% on money in and out (unverified; confirm in the provider contract). GGR tax at 40% (confirm the base with tax counsel).

| Line (per month, 30 days) | Model A: Table fee | Model C: 5% top-up spread only |
|---|---|---|
| Matches per day | 15,000 | 15,000 |
| Fee revenue | 15,000 × 8 🪙 × 30 = 3.6M 🪙 = **36.0M RWF** | — |
| Spread revenue (top-ups 60M RWF / month) | — | **3.0M RWF** |
| GGR tax (40%) | −14.4M RWF | −1.2M RWF |
| Payment costs (about 1.5% of 105M RWF in + out) | −1.6M RWF | −1.6M RWF |
| Withdrawal fees + Premium (estimate) | +2.0M RWF | +2.0M RWF |
| **Net contribution** | **≈ 22.0M RWF (≈ $15k)** | **≈ 2.2M RWF** |

**Takeaways:**
1. Revenue must come from **play volume**, not money in / out. Players recycle winnings, so activity is many times larger than top-ups.
2. **Liquidity is the main growth lever.** More matches matter far more than a higher fee rate. Low fees + fast matchmaking + fast payouts → more matches.
3. The **40% GGR tax is the biggest cost.** Confirm how it applies to fee-based P2P platforms before fixing fee rates (open question Q2).
4. Lower rates at higher stakes keep serious players. Players compare fees, and Skillz-level take rates (14–18%) push players away.

#### 6.7.5 Forbidden Revenue Practices (System MUST NOT)

| ID | The system must never… |
|---|---|
| FR-REV-X1 | Put house-owned accounts, bots or "shill" players into cash matches or challenges. |
| FR-REV-X2 | Change RNG, physics, matchmaking or timers to favour any player, the platform, or "keep players playing". |
| FR-REV-X3 | Charge any fee not shown before commit, or apply a rate different from the displayed one. |
| FR-REV-X4 | Use personalised pricing that charges more to frequent, losing or at-risk players. |
| FR-REV-X5 | Use rounding, expiry or dormancy rules to quietly take player coins. Dormant balances follow the published policy and the law (notify, then hold, never confiscate silently). |
| FR-REV-X6 | Add friction to withdrawals to discourage cash-out (dark patterns such as hidden buttons or "are you sure?" loops). |
| FR-REV-X7 | Send bonus or "come back" promotions to self-excluded or at-risk users. |

These rules are covered by automated tests, internal audit and the external RNG / fairness certification.

### 6.8 Bonuses and Promotions

| ID | Requirement | Priority |
|---|---|---|
| FR-BON-01 | Welcome bonus coins, fee-free match vouchers, free tournament tickets, referral rewards. | S |
| FR-BON-02 | Clear play-through requirements and expiry. Bonus coins are used after Available coins (configurable). | S |
| FR-BON-03 | Bonus abuse detection (multi-accounting, referral rings). | S |
| FR-BON-04 | Promotions engine: targeting rules, budgets, A/B tests (never targeting at-risk or self-excluded users). | C |

### 6.9 Reconciliation and Finance

| ID | Requirement | Priority |
|---|---|---|
| FR-FIN-01 | Daily automated reconciliation: internal ledger vs provider statements (MoMo, Airtel, card gateway) vs bank. | M |
| FR-FIN-02 | **Player funds segregation**: the RWF value of all player coins (available + locked + pending) is held in a separate, ring-fenced trust / bank account. Daily check that the trust balance ≥ total coin liabilities × 10 RWF. | M |
| FR-FIN-03 | Tax reports: GGR (fee revenue), winnings withheld, per period, in the regulator format. | M |
| FR-FIN-04 | Exportable general-ledger feed to the accounting system. | S |
| FR-FIN-05 | Revenue dashboard by stream (table fees, tournament fees, withdrawal fees, Premium, cosmetics, ads, sponsors), by game and by stake band, plus promotional costs (Player of the Day pool, bonuses) against their budgets. | M |
| FR-FIN-06 | Public "How we earn" page generated from the live fee configuration, so the page and the system can never disagree. | M |

---

## 7. Fair Play, Anti-Cheat and Integrity

### 7.1 Server Authority
- NFR-FAIR-01: The game server is the **single source of truth**. Clients send only intents and render state.
- NFR-FAIR-02: All input is validated against the rules and **physics plausibility** (for example a shot power and angle within human limits, input timing distribution).
- NFR-FAIR-03: Hidden information is never sent to the client (for future card games, opponent hands stay on the server).
- NFR-FAIR-04: Each match result is **signed** (server key, Ed25519) and stored with the full event log hash.

### 7.2 Provably Fair Randomness
For any game with randomness (Ludo dice, pool rack order, first-player selection):
1. Before the match, the server creates `server_seed`, publishes `commit = SHA-256(server_seed)`.
2. Each client contributes a `client_seed` (generated in the browser).
3. Roll *n* = `HMAC-SHA256(server_seed, client_seedA ‖ client_seedB ‖ match_id ‖ n)` → mapped without bias (rejection sampling) to the outcome.
4. After the match, the server reveals `server_seed`. Anyone can verify every roll with the in-app **"Verify Fairness"** tool or an open-source verifier.
5. The RNG and implementation must be **certified** by an accredited test lab (for example GLI, iTech Labs, BMM) if the regulator requires it.

| ID | Requirement | Priority |
|---|---|---|
| FR-PF-01 | Commit shown at match start. Reveal and verification tool after the match. | M |
| FR-PF-02 | Open-source verification library (JS) published. | S |
| FR-PF-03 | Optional anchoring of daily seed-commit Merkle roots to a public blockchain for third-party auditability. | C |

### 7.3 Anti-Cheat
| ID | Requirement | Priority |
|---|---|---|
| FR-AC-01 | Detect aim bots / auto-play: input timing entropy, superhuman precision consistency, shot-solver similarity scoring. | M (rules) / S (ML) |
| FR-AC-02 | Client integrity signals: devtools detection, automation / headless browser detection, emulator detection, tamper checks on WASM bundles. Signals only, never trusted alone. | M |
| FR-AC-03 | Rate limiting and bot detection at the edge. | M |
| FR-AC-04 | Device fingerprinting for multi-accounting. | M |
| FR-AC-05 | Engine-assistance detection for strategy games (Igisoro, chess, draughts): compare moves with engine top-N over many games. | S |

### 7.4 Anti-Collusion and Match Fixing
| ID | Requirement | Priority |
|---|---|---|
| FR-COL-01 | **Graph analysis**: who-plays-whom networks, money flows between accounts (chip dumping). Flag dense clusters. | S |
| FR-COL-02 | Detect deliberate losing (abnormally poor play, quick resigns in high-stakes matches versus the same opponent). | S |
| FR-COL-03 | Block matching between accounts sharing device / IP / payout method / household signals. | M |
| FR-COL-04 | Risk case management: freeze funds, review replays, decision, appeal. | M |

### 7.5 Disputes
- FR-DSP-01: The user can report a match within 24 h. The replay is auto-attached.
- FR-DSP-02: SLA: first response within 4 h, decision within 72 h.
- FR-DSP-03: Outcomes: result stands / reversed / void + refund. Ledger handles reversals through compensating entries.

---

## 8. UX, UI and the 3D Virtual Games World

### 8.1 Design Principles
1. **Mobile first, landscape for play:** the 3D world and all games are designed for **phone landscape** (from 640×360) and **desktop**, then scaled up. Account, wallet and KYC screens work in both orientations.
2. **Thumb zone:** primary actions in the bottom 40% of the screen. Bottom navigation on mobile.
3. **Two-thumb landscape play** on phones (left thumb: move / joystick; right thumb: camera and actions), like console-style mobile games. Desktop uses keyboard + mouse.
4. **Fast:** interactive in under 3 s on 3G. Skeleton loaders, no blocking spinners.
5. **Trust visible:** coin balance (tap for RWF), stake, table fee, pot and fairness badge always visible where money is involved.
6. **Accessible:** WCAG 2.2 AA.
7. **Localised:** Kinyarwanda, English, French, Swahili. RWF formatting (`1,000 RWF`). Right-to-left ready (future).

### 8.2 Responsive Breakpoints and Grid

| Breakpoint | Width | Layout | Columns / Gutter | Navigation |
|---|---|---|---|---|
| **XS (mobile)** | 320–479 px | Single column, game cards 2-up | 4 col / 16 px | Bottom tab bar (Home, Games, Play, Wallet, Profile) |
| **SM (large phone)** | 480–767 px | 2–3-up game grid | 4 col / 16 px | Bottom tab bar |
| **Phone landscape** ⭐ | 640–932 × 320–440 px | **Main play layout**: full-screen 3D world / game, HUD in corners, side sheets for chat, wallet and proposals | Overlay HUD, safe-area insets | Icon rail (left) + HUD buttons |
| **MD (tablet)** | 768–1023 px | 3–4-up grid, side panels as sheets | 8 col / 24 px | Bottom bar or collapsible rail |
| **LG (laptop)** | 1024–1439 px | **App-shell grid**: left nav rail + main + right panel | 12 col / 24 px | Left nav rail |
| **XL (desktop)** | ≥ 1440 px | Max content width 1440 px, 3-pane layout | 12 col / 32 px | Expanded sidebar |

**Desktop 3-pane layout (LG / XL):**
```
┌─────────────┬──────────────────────────────────┬──────────────────┐
│  Nav rail   │   Main: game grid / game table   │  Right panel:    │
│  Home       │   ┌────┐┌────┐┌────┐┌────┐       │  Wallet summary  │
│  Games      │   │Pool││Ludo││Igis││Soon│       │  Live matches    │
│  Tournaments│   └────┘└────┘└────┘└────┘       │  Friends online  │
│  Wallet     │   Live tournaments carousel      │  Chat / feed     │
│  Profile    │                                  │                  │
└─────────────┴──────────────────────────────────┴──────────────────┘
```

**Classic 2D lobby, phone (XS / SM; also used for wallet / account screens in portrait):**
```
┌──────────────────────────┐
│ Logo           🪙 1,250  │  ← sticky header, balance always visible
├──────────────────────────┤
│ [Continue: Ludo vs Eric] │
│ ┌──────────┐┌──────────┐ │
│ │  8-Ball  ││   Ludo   │ │  ← 2-up game card grid
│ │ 1.2k live││ 3.4k live│ │
│ └──────────┘└──────────┘ │
│ ┌──────────┐┌──────────┐ │
│ │ Igisoro  ││ Coming   │ │
│ └──────────┘└──────────┘ │
│ Live tournaments  →      │
├──────────────────────────┤
│ 🏠   🎮   ▶️   👛   👤    │  ← bottom tab bar (thumb zone)
└──────────────────────────┘
```

### 8.3 UI Requirements

| ID | Requirement | Priority |
|---|---|---|
| UI-01 | CSS Grid + **Container Queries** so components adapt to their container, not only the viewport. | M |
| UI-02 | Fluid typography with `clamp()`. Minimum body size 16 px on mobile. | M |
| UI-03 | Touch targets at least 44×44 px. Gestures always have a button alternative. | M |
| UI-04 | The 3D world and games run **full-screen in landscape** on phones (Fullscreen API + Screen Orientation lock where supported; PWA manifest `orientation: landscape` for play routes). Holding the phone in portrait shows a **"Rotate your phone"** screen, with an option to use the Classic 2D lobby. Safe-area insets (notches, rounded corners, gesture bars). | M |
| UI-04b | Wallet, profile, KYC and settings open as **side sheets** over the world in landscape, so the player never has to rotate to top up or withdraw. | M |
| UI-05 | Desktop: keyboard shortcuts, mouse precision aiming, hover states, multi-panel (watch a tournament while in the lobby). | M |
| UI-06 | Dark mode (default for games) and light mode. Follows the system preference. | M |
| UI-07 | **View Transitions API** for smooth page changes. Respect `prefers-reduced-motion`. | S |
| UI-08 | Design system: tokens (colour, spacing, radius, motion), component library, Storybook. | M |
| UI-09 | Data-saver mode: lower-res textures, no background animations, compressed audio. | S |
| UI-10 | Installable PWA prompt after the 2nd session or 1st win (not on first visit). | M |
| UI-11 | Offline: lobby shell, profile and history cached. Practice vs AI works offline. Clear "offline" state. | S |
| UI-12 | Money confirmation sheets: stake, table fee, total to pay, pot the winner gets (2×), balance after, all in coins with the RWF value. Slide-to-confirm for stakes above a threshold. | M |

### 8.4 Virtual Games World (3D)

The main lobby is a **shared 3D virtual world**. Players appear as avatars, walk into game halls, enter rooms, meet other players, **talk by voice or text**, agree on a game and stake, then sit down at a table to play. It is designed for **desktop and phones in landscape**, and for **VR headsets** (WebXR, §8.4.9). A lightweight **2D grid lobby** (§8.2) is always available as a fallback and for accessibility. Both lobbies give access to the same functions.

> Detailed visual, interaction, game-screen and performance design is in the companion document [DESIGN-SPEC-3D-VR.md](DESIGN-SPEC-3D-VR.md).

#### 8.4.1 World Structure

```
                         ┌────────────────────────────┐
                         │   GUKIRANA PLAZA (hub)     │  spawn point, Player of the Day statue,
                         │   live boards, events      │  tournament screens, wallet kiosk, help desk
                         └─────┬──────────┬───────────┘
              ┌────────────────┘          │           └────────────────┐
     ┌────────▼────────┐       ┌──────────▼────────┐       ┌───────────▼────────┐
     │  🎱 POOL HALL    │       │  🎲 LUDO LOUNGE    │       │  🌰 IGISORO COURT   │
     │  (neon club)     │       │  (rooftop garden)  │       │  (Imigongo-styled)  │
     └──┬─────┬─────┬──┘       └──┬─────┬─────┬─────┘       └──┬─────┬─────┬──────┘
        │     │     │             │     │     │                │     │     │
     Free  Bronze Gold         Free  Bronze Gold            Free  Bronze Gold      ← rooms by stake band
     room  room   VIP          room  room   VIP             room  room   VIP
     (⭐)  10–50🪙 200+🪙       ...                          ...
        └── each room: 4–12 tables · bar / lounge area · spectator stands · challenge board wall

     + Private rooms (invite link / QR)   + Club houses (§5.6)   + Tournament Arena (finals, stands)
```

| Area | Purpose |
|---|---|
| **Plaza (hub)** | Arrival point. Live tournament screens, the Player of the Day hologram / statue (§5.10), the Hall of Champions, the wallet kiosk (opens the wallet sheet), the help desk (AI assistant + human support), event stage. |
| **Game Halls** | One hall per game, with its own themed look and music. New games add a new hall through the Game Module SDK (§10). |
| **Rooms** | Instances inside a hall, grouped by **stake band** (Free ⭐, Bronze, Silver, Gold, VIP) and language. Each room has tables, a lounge area for chatting, a **Challenge Board wall** and spectator spots. |
| **Tables** | Physical game tables. A table shows its state: free, open challenge (stake floating above), in play (spectators allowed or not). |
| **Private rooms** | Created by a player or a club. Invite by link / QR. The owner sets games, stake limits, voice rules and who can enter. |
| **Tournament Arena** | Stage + stands for finals, with live commentary (optional) and a big screen. |

**Cultural design:** the art direction mixes a modern style (neon, glass, soft lighting) with **Rwandan motifs**: Imigongo geometric patterns, Agaseke basket shapes, hills of the "Land of a Thousand Hills" visible from the rooftop lounge. This gives the platform a unique, local identity.

#### 8.4.2 The Core Flow: Meet → Agree → Play

```
1. Enter world → spawn in Plaza → walk (or tap a hall) → choose a room (stake band)
2. In the room: see avatars around tables and in the lounge, with name tag, level, tier and rating
3. Walk up to a player → tap their avatar → action menu:
     [👋 Wave]  [💬 Message]  [🎙️ Talk]  [⚔️ Propose a game]  [👤 Profile]  [🚫 Block / Report]
4. Talk by proximity voice or text, then "Propose a game":
     ┌─────────────────────────────────────────┐
     │ Proposal to  Aline_K  (Lvl 27 · 1,720)  │
     │ Game:    🎱 8-Ball · Best of 3           │
     │ Stake:   [ 100 🪙 ]  each               │
     │ Fee:     8 🪙 each · Winner gets 200 🪙  │
     │ Table:   Table 4 (free)                  │
     │            [ Send proposal ]             │
     └─────────────────────────────────────────┘
5. The other player can Accept / Counter (change stake, mode or table) / Decline
6. Accept → both stakes + fees go to escrow (same flow as §6.4/§6.5)
7. Both avatars walk / teleport to the table → they sit → the camera moves into the game view
8. Game is played (full-screen game renderer, §4). Spectators gather around the table in the world
9. Result → back to the room at the table. Winner celebration emote → rematch / leave
```

> **Rule:** All agreements must go through a **system proposal** with escrow. Side deals ("pay me on MoMo and I'll let you win", "send money first") are against the rules. The system warns users and moderators can act on them. The text filter blocks phone numbers, MoMo numbers and payment requests in chat (FR-COM-09).

#### 8.4.3 Controls by Device

| Device | Movement | Camera | Interaction | Layout |
|---|---|---|---|---|
| **Phone (landscape, default)** | **Left virtual joystick** with a built-in mini-map, plus tap-to-walk | Drag on the right side, pinch to zoom | Tap avatar / table → action menu. Big round buttons bottom-right (Run · Emote · Interact) | HUD in the corners (profile top-left, coins top-right). Chat, wallet and proposals as side sheets |
| **Phone (portrait)** | — | — | — | "Rotate your phone" screen, or continue in the Classic 2D lobby |
| **Tablet** | Tap to walk / joystick | Drag / pinch | Tap | Side chat panel |
| **Desktop** | WASD / arrows or click-to-move | Right-drag mouse, wheel zoom | Click; hotkeys (T = chat, V = push-to-talk, E = interact, M = map) | **3-pane**: world view centre, chat & friends right, map & rooms left |
| **VR (WebXR)** | Teleport (comfort default) or smooth move | Head tracking, snap turn | Laser pointer, grab; in-world wrist menu | Full immersion. Games open as a floating board / real-size pool table |

**Phone world layout (landscape, required for the 3D world and games):**
```
┌──────────────────────────────────────────────────────────────────┐
│ [🧑] Player123 ⭐Lvl 5        Pool Hall · Gold room 3    🪙 250  ⚙️ │
│                                                                  │
│                      [3D room view, 3rd person]                  │
│      🧍Aline        🎱 Table 4               🎱 Table 2 (100🪙)    │
│                 🧍Eric          🧍You                              │
│                                        ┌──────────────────────┐  │
│                                        │ ✋ Propose to Aline   │  │
│ Eric: anyone for 50? 🎱                 └──────────────────────┘  │
│ ┌─────┐                                                          │
│ │ ◎ ▲ │ joystick + mini-map       [💬] [🎙️]   [🏃] [🙋] [✋]       │
│ └─────┘                                                          │
└──────────────────────────────────────────────────────────────────┘
  Left thumb: move · Right thumb: camera drag + action buttons
```

**Desktop world layout:**
```
┌──────────────┬───────────────────────────────────────┬────────────────────┐
│ 🗺️ Map        │                                       │ 💬 Room chat       │
│ Plaza        │          [3D world view]              │ 👥 Nearby (8)      │
│ ▸ Pool Hall  │                                       │ 🧑‍🤝‍🧑 Friends online  │
│   Gold rm 3 ●│   avatars, tables, challenge wall     │ ⚔️ Proposals (1)   │
│ ▸ Ludo Lounge│                                       │ 🎙️ Voice: Nearby ▾ │
│ ▸ Igisoro    │                                       │                    │
│ Arena        │                                       │ 🪙 1,250 · Lvl 27  │
└──────────────┴───────────────────────────────────────┴────────────────────┘
```

#### 8.4.4 Avatars

| ID | Requirement | Priority |
|---|---|---|
| FR-AV-01 | Stylised 3D avatars (glTF / VRM format), built in an in-app avatar creator: body, face, skin tone, hair, outfits. Optional "make my avatar from a selfie" (on-device AI, the photo is not stored). | M |
| FR-AV-02 | The name tag shows username, level ring / tier, rating and a "Looking for game" status chip (game + stake band). | M |
| FR-AV-03 | Emotes and gestures (wave, clap, dance, "GG", thinking), plus basic lip-sync / mouth movement when talking. | M |
| FR-AV-04 | Status: Available · Looking for game (game, stake) · In game · Do not disturb. | M |
| FR-AV-05 | Cosmetics (outfits, accessories, entrance effects, table themes) sold for coins. **Cosmetic only, no gameplay advantage** (adds to the §6.7 revenue). | S |
| FR-AV-06 | Level and Player of the Day rewards (§5.9.3, §5.10) unlock avatar frames, badges and exclusive outfits. | S |

#### 8.4.5 Voice and Text Communication

| ID | Requirement | Priority |
|---|---|---|
| FR-COM-01 | **Proximity (spatial) voice**: you hear players near you, louder when closer and with direction (3D audio). Range configurable per room (default about 8 m). | M |
| FR-COM-02 | Voice channels: **Nearby**, **Table** (the players at one table), **Party** (friends group), **Private call** (1:1, both must accept). | M |
| FR-COM-03 | **Push-to-talk by default** on mobile and for new accounts. Open mic is optional on desktop. Mic indicator above speaking avatars. | M |
| FR-COM-04 | Room text chat, nearby text bubbles above avatars, 1:1 private messages (friends or after an accepted chat request). | M |
| FR-COM-05 | Quick phrases and emoji reactions in all languages, auto-translated (Kinyarwanda ↔ English ↔ French ↔ Swahili). | S |
| FR-COM-06 | **Live text translation** of chat messages. Optional live voice captions (speech-to-text) for accessibility and translation. | S |
| FR-COM-07 | Per-user mute, mute all, volume per person, block (blocked users become invisible and silent to you), report. | M |
| FR-COM-08 | **Personal space bubble**: other avatars can't walk inside your space. You can turn on "friends only" visibility. | M |
| FR-COM-09 | Text safety filter: profanity, hate, harassment, **phone numbers, MoMo numbers, payment requests and external links** blocked or masked, with a warning about scams. | M |
| FR-COM-10 | **AI real-time moderation** for voice (toxicity detection on the audio stream, with clear notice in the voice terms) and text. Graduated actions: warning → temporary mute → kick from room → ban review. | S |
| FR-COM-11 | **Report with evidence**: when a user reports someone, the reporter's device sends the last 30 s of received audio (kept in a local rolling buffer, never uploaded otherwise) plus chat lines to the moderation queue. | S |
| FR-COM-12 | Voice is **not recorded** server-side by default. Reported clips are kept for a limited period (for example 90 days) and then deleted (Law N°058/2021). | M |
| FR-COM-13 | Low-bandwidth voice: Opus codec at about 16–32 kbps, automatic quality drop on weak networks, a "voice data use" indicator and a **voice-off in data-saver mode**. | M |

**Voice rules during games (fair play):**

| Situation | Voice / text allowed |
|---|---|
| 1v1 match (free or cash) | Table voice and text between the 2 players, **only if both opt in**. Off by default. |
| 3–4 player cash match (for example Ludo FFA) | **No private channels between players at the table.** Only the open table channel that all players hear, or none (room setting). This reduces collusion. |
| Spectators of a cash match | Spectators can talk to each other but **cannot reach the players**. The spectator view has a delay (anti-ghosting, FR-GS-08). |
| Tournament finals | Players' voice is off. Commentator and spectator channels only. |

#### 8.4.6 Room Rules and Capacity

| ID | Requirement | Priority |
|---|---|---|
| FR-RM-01 | Each room instance holds up to about **50 avatars** (configurable). When full, a new instance opens automatically. "Join friend" puts you in your friend's instance. | M |
| FR-RM-02 | Room entry rules: stake band rooms require enough coins for the minimum stake; cash rooms require 18+ verified (KYC Tier 1); free rooms are open to all registered users. | M |
| FR-RM-03 | Room language tag (Kinyarwanda / English / French / Swahili) and voice policy (open / push-to-talk only / text only). | M |
| FR-RM-04 | Private rooms: owner, invite list, password / QR, games and stake limits, voice rules, kick / ban, a room size limit. | S |
| FR-RM-05 | The room Challenge Board wall shows the room's open challenges (§6.4). Tapping one walks you to its table. | M |
| FR-RM-06 | Tables show the state in the world: free / open challenge (stake floating above) / in play (with a spectator count). | M |
| FR-RM-07 | Moderators can enter rooms with a visible **moderator badge**. They can mute, kick, close a room and see reports in context. | M |
| FR-RM-08 | Events in the Plaza / Arena: tournament finals screening, live DJ / sponsor events, new-game launches. | C |

#### 8.4.7 Performance Tiers and Fallback

The 3D world must not break the mobile-first goal (fast on low-end Android over 3G). The device and network are detected at start and the matching tier is chosen. The user can switch tiers at any time.

| Tier | Target devices | Rendering | What you see |
|---|---|---|---|
| **Ultra** | Desktop with a good GPU, VR headsets | WebGPU, high-res textures, real-time shadows, 60–90 fps (VR 72–90 fps) | Full world, 50 avatars, effects |
| **Standard** | Mid-range phones (2023+), laptops | WebGPU or WebGL2, baked lighting, LOD, 30–60 fps | Full world, nearby avatars detailed, distant ones simplified |
| **Lite** | Low-end phones (2 GB RAM), weak networks | WebGL2, low-poly, about 10 visible avatars, 30 fps | Simplified world, top-down / isometric camera |
| **Classic 2D** | Very low-end, data saver, accessibility, screen readers | No 3D, the §8.2 grid lobby | Same rooms as lists, the same people list, chat, voice, proposals |

| ID | Requirement | Priority |
|---|---|---|
| NFR-3D-01 | The 2D lobby loads first (NFR-PERF-01). The 3D world is **lazy-loaded** in the background and streamed by area. | M |
| NFR-3D-02 | First 3D entry download ≤ 8 MB (Standard) / ≤ 3 MB (Lite). Each hall streams on demand. Assets cached by the service worker. | M |
| NFR-3D-03 | Asset formats: glTF 2.0 + meshopt / Draco geometry compression, KTX2 (Basis Universal) textures, LOD levels and impostors for distant avatars. | M |
| NFR-3D-04 | Frame rate: ≥ 30 fps on the reference device (Lite), ≥ 60 fps on desktop (Ultra / Standard), ≥ 72 fps in VR. | M |
| NFR-3D-05 | Memory: ≤ 400 MB on mobile Standard, ≤ 250 MB on Lite. | M |
| NFR-3D-06 | Avatar position sync: 10–20 Hz with interpolation. Interest management (only nearby avatars are sent). p95 latency ≤ 200 ms in region. | M |
| NFR-3D-07 | Voice mouth-to-ear latency ≤ 300 ms p95 in region. | M |
| NFR-3D-08 | Battery and heat: Lite mode automatically when the battery is low or the device is hot. Frame-rate cap when the app is idle. | S |
| NFR-3D-09 | Accessibility: the Classic 2D mode has **full feature parity** (rooms, people, chat, voice, proposals). Captions for voice. Motion-sickness comfort settings (vignette, snap turn, teleport). | M |

#### 8.4.8 Safety and Age Rules for Social Features

| ID | Requirement | Priority |
|---|---|---|
| SAFE-01 | The world is for **18+ only** (platform age gate). Voice is only available after phone verification + Level 3, or after KYC (stops throwaway abuse accounts). | M |
| SAFE-02 | New accounts start with push-to-talk + text only in Free rooms until they reach a trust score threshold. | M |
| SAFE-03 | Community rules shown on first entry, and in-world help signs. Strikes system with clear appeals. | M |
| SAFE-04 | Anti-harassment: the personal bubble, block = invisible, "safe zone" quick button (instantly move to a quiet private space). | M |
| SAFE-05 | Anti-scam: warnings when someone mentions money outside the system. Repeated attempts trigger auto-mute and review. | M |
| SAFE-06 | Responsible gaming in the world: reality-check popups also appear in the world (time spent in the world + in games). Self-excluded users cannot enter cash rooms. | M |

#### 8.4.9 Virtual Reality (VR) Mode: First-Class Experience

VR is a **core experience, in the MVP**, not an add-on. The same world runs as:

| Mode | Devices | Experience |
|---|---|---|
| **Immersive VR** | Standalone headsets with a WebXR browser (for example Meta Quest family, Pico, Android XR headsets, Apple Vision Pro through Safari WebXR) | First-person, full 6-DoF. Walk the Plaza, enter rooms through portals, sit at real-size tables, play with your hands / controllers, talk naturally with spatial voice |
| **Mixed Reality (passthrough)** | Headsets with colour passthrough | The Ludo / Igisoro board or a mini pool table is placed **on your real table** at home. Opponents appear as avatars sitting across from you |
| **Phone AR** | Android phones with WebXR AR (ARCore) | Place the game board on a real surface through the camera (Phase 2) |
| **VR-style 3D (screen)** | Phones, tablets, desktops | Third-person view of your avatar in the same world (see §8.4.10). Same rooms, people and voice as VR users |

All modes share **one world**. A VR player and a phone player can stand in the same room, talk and play each other.

**Entering VR:** a **"Enter VR 🥽"** button appears when the browser supports WebXR (`immersive-vr`). One tap gives a full-immersion session, with no app store install (PWA / WebXR). The headset browser can also install the PWA to the home screen.

##### VR Interaction

| ID | Requirement | Priority |
|---|---|---|
| FR-VR-01 | Locomotion: **teleport** (default, comfort), smooth locomotion (optional), snap turn 30° / 45° (smooth turn optional), seated and standing modes, height calibration. | M |
| FR-VR-02 | Input: tracked controllers **and hand tracking** (pinch to select, grab to pick up tokens / seeds, palm-up wrist menu). | M (controllers), S (hands) |
| FR-VR-03 | **Wrist menu** (look at your wrist): coins, level, friends, proposals, mute, settings, leave room. | M |
| FR-VR-04 | Portals: walk through a room doorway (as in the reference image) → short fade → arrive in the room. Comfort vignette during movement. | M |
| FR-VR-05 | Social presence: avatar head and hands follow real movement (IK for arms / body), lip-sync from the voice, eye-contact look-at, natural gestures (wave, thumbs up, clap). | M |
| FR-VR-06 | Proposals in VR: point at a player → radial menu → "Propose a game" → floating proposal card (same content as §8.4.2) → confirm with a **two-step press** (money safety). | M |
| FR-VR-07 | Text input in VR: voice dictation (speech-to-text), quick phrases, virtual keyboard as a fallback. | M |
| FR-VR-08 | Keep the play space safe: respect the headset's guardian / boundary, warn when the player is near it, "recenter" button. | M |

##### Games in VR

| Game | VR experience | Phase |
|---|---|---|
| 🎲 **Ludo** | Real-size board on a table. **Pick up and throw the dice** with your hand (the outcome still comes from the server's provably fair RNG; the throw is only an animation). Grab and move tokens. | MVP |
| 🌰 **Igisoro** | Wooden board on a carved table. **Scoop and sow seeds by hand**, pit by pit, with satisfying sound and haptics. | MVP |
| 🎱 **8-Ball Pool** | Walk around a real-size table. **Laser-aim mode** (point + trigger power), aligned with standard controls. | MVP |
| 🎱 **Pool: physical cue** | Hold the controller like a real cue, with real stroke motion. **Free and VR-only rooms only** until input parity is proven (see FR-VR-11). | Phase 2 |
| 🏆 **Tournament Arena** | Sit in the stands and watch the final on a giant table, with commentary. | Phase 2 |

##### Fairness Across Devices (Real-Money Rule)

| ID | Requirement | Priority |
|---|---|---|
| FR-VR-10 | Whatever the device (VR, phone, desktop), the client only sends the **same intent** to the server (for example the shot angle / power / spin, the chosen token or pit). The game outcome is decided only on the server. | M |
| FR-VR-11 | Input modes that could give an advantage (for example the physical cue in pool) are only used in **free rooms or rooms where all players use the same input class**. Cash matchmaking groups players by input class unless both players accept a mixed match. | M |
| FR-VR-12 | Timers are the same for all devices. VR players get no extra time. | M |
| FR-VR-13 | The input class is recorded with every match for fairness analytics and disputes. | M |

##### VR Comfort, Safety and Performance

| ID | Requirement | Priority |
|---|---|---|
| NFR-VR-01 | **72 fps minimum, 90 fps target** on standalone headsets. Fixed foveated rendering, dynamic resolution, a strict draw-call budget per room. | M |
| NFR-VR-02 | Motion-to-photon latency within the headset's native budget. No camera movement the player didn't cause (no forced camera moves). | M |
| NFR-VR-03 | Comfort options: vignette, teleport-only, seated mode, reduced effects, a mode for left-handed players. | M |
| NFR-VR-04 | Session reminders: a break reminder every 30–45 minutes (comfort) in addition to the responsible-gaming reality checks. | M |
| NFR-VR-05 | Personal-space bubble on by default in VR (stronger than on screens), instant "safe zone" by pressing a button on the wrist. | M |
| NFR-VR-06 | Hand / head tracking data is used only in real time to animate the avatar. It is **not stored** or used for profiling. | M |
| NFR-VR-07 | Asset budget per room in VR: ≤ 150k triangles visible, ≤ 100 draw calls, KTX2 textures. Avatars: LOD + impostors beyond 10 m. | M |

> **Market reality:** in Rwanda most players will join from phones, so the phone experience stays the main entry. VR is the **flagship and marketing experience** (VR gaming lounges, events, Player of the Day showcases, partnerships with gaming cafés that offer headsets). A **"VR Lounge partner"** program can provide shared headsets in cafés and hubs (Phase 2).

#### 8.4.10 Visual Direction and HUD (from the reference design)

The reference image sets the target look: a bright, stylised, **third-person 3D playground** with an avatar wearing a VR headset, portal doorways into themed rooms, and a clean game HUD.

**Art direction:**
- Stylised, friendly 3D (soft shading, bright sky, plants, rounded architecture), with **neon-lit portal frames** in a different colour per game.
- Each game has a **portal doorway with a live preview** of the room behind it (for example 🎱 Pool Room in blue, 🎲 Ludo Room in orange, 🌰 Igisoro Room in green, a 🏆 Arena portal, and "Coming soon" portals for future games).
- Large 3D title sign: **"Gukirana Playground: Play · Meet · Win"**, and a **welcome board** (news, events, Player of the Day).
- Floor guidance: glowing paths and circles leading to portals, with an **interaction prompt** when you are close ("E · Enter Pool Room" on desktop, a tap button on mobile, a trigger hint in VR).
- Rwandan touches (Imigongo patterns on portal frames, Agaseke shapes in the architecture, hills in the skyline) keep the look local.

**HUD layout (screen modes):**
```
┌───────────────────────────────────────────────────────────────────────┐
│ [🧑 avatar] Player123          GUKIRANA PLAYGROUND          🪙 250  ⚙️ │  ← top bar
│            ⭐ Level 5                                                   │
│                                                                        │
│   [🎱 Pool Room]   [🎲 Ludo Room]   [🌰 Igisoro Room]   [🏆 Arena]      │  ← portals in the 3D world
│                                                                        │
│                         (your avatar, 3rd person)                      │
│                                          ┌───────────────────────┐     │
│                                          │ E  Enter Pool Room    │     │  ← proximity prompt
│                                          └───────────────────────┘     │
│ ┌─────┐                                                                │
│ │ ◎ ▲ │  joystick / mini-map                    [🏃] [🙋] [✋]  [🎙️] [💬]│  ← run · emote · interact · voice · chat
│ └─────┘                                                                │
└───────────────────────────────────────────────────────────────────────┘
```

| HUD element | Mobile | Desktop | VR |
|---|---|---|---|
| Profile (avatar, name, level ring) | Top-left, compact | Top-left | Wrist menu |
| Coins + settings | Top-right (tap coins → wallet sheet) | Top-right | Wrist menu |
| Movement | Bottom-left **joystick with built-in mini-map compass** (or tap-to-walk) | WASD / click-to-move; mini-map bottom-left | Teleport / thumbstick |
| Actions | Bottom-right large round buttons: **Run · Emote · Interact (hand)**, plus mic and chat | Hotkeys + same buttons | Controller buttons / hand gestures |
| Interaction prompt | Large tap button near the target | "E · Enter …" | Floating hint on the controller |
| Chat | Collapsible strip above the action buttons | Right panel | Floating panel / voice dictation |

| ID | Requirement | Priority |
|---|---|---|
| UI-3D-01 | The HUD stays inside the safe areas, with touch targets ≥ 48 px for the action buttons and ≥ 120 px for the joystick on mobile. | M |
| UI-3D-02 | Third-person camera with collision (it never goes through walls), auto-follow, and a first-person toggle on screens. | M |
| UI-3D-03 | Portals show a live (or cached animated) preview of the room and its live player count. | S |
| UI-3D-04 | Interaction prompts adapt to the device (key, tap button, controller hint). | M |
| UI-3D-05 | The HUD can be hidden (screenshot / photo mode) and scaled (accessibility). | S |
| UI-3D-06 | The game titles, room names and signs in the world are localised (Kinyarwanda / English / French / Swahili). | M |

---

## 9. System Architecture (2026+)

### 9.1 High-Level Architecture

```
                ┌──────────────────────────── Clients ─────────────────────────────┐
                │  PWA (Mobile / Desktop browsers)  ·  Admin Console  ·  Regulator  │
                └──────────────┬───────────────────────────────┬───────────────────┘
                               │ HTTPS / HTTP3                 │ WebTransport / WSS
                     ┌─────────▼─────────┐           ┌─────────▼──────────┐
                     │ Edge / CDN / WAF  │           │ Realtime Gateway   │
                     │ (bot mgmt, DDoS)  │           │ (sticky sessions)  │
                     └─────────┬─────────┘           └─────────┬──────────┘
                     ┌─────────▼──────────┐                    │
                     │ API Gateway / BFF  │                    │
                     │ (GraphQL or REST)  │                    │
                     └─────────┬──────────┘                    │
 ┌──────────┬──────────┬───────┴───┬──────────┬───────────┐    │
 │ Identity │  Wallet  │ Payments  │  Match-  │ Tourna-   │    │
 │ & KYC    │  Ledger  │ (MoMo,    │  making  │ ments     │    │
 │ Service  │ Service  │ Airtel,   │ Service  │ Service   │    │
 │          │          │ Cards)    │          │           │    │
 └────┬─────┴────┬─────┴─────┬─────┴────┬─────┴─────┬─────┘    │
      │          │           │          │           │    ┌─────▼──────────────┐
      │          │           │          └──────────────► │ Game Server Fleet  │
      │          │           │                           │ (room per match,   │
      │          │           │                           │  game modules via  │
      │          │           │                           │  WASM, autoscaled) │
      │          │           │                           └─────┬──────────────┘
 ┌────▼──────────▼───────────▼───────────────────────────────────▼──────────────┐
 │                 Event Bus (Kafka / Redpanda / NATS JetStream)                 │
 └────┬──────────┬───────────┬──────────────┬──────────────┬────────────────────┘
 ┌────▼────┐ ┌───▼──────┐ ┌──▼─────────┐ ┌──▼──────────┐ ┌─▼──────────────────┐
 │ Risk &  │ │ Notifi-  │ │ Analytics  │ │ Responsible │ │ Compliance /       │
 │ Fraud ML│ │ cations  │ │ Warehouse  │ │ Gaming Svc  │ │ Regulator Reports  │
 └─────────┘ └──────────┘ └────────────┘ └─────────────┘ └────────────────────┘

 Data: PostgreSQL (ledger, accounts) · Redis/Valkey (sessions, queues, presence)
       Object storage (replays, KYC docs – encrypted) · ClickHouse (analytics)
```

### 9.2 Recommended Technology Stack

| Layer | Recommendation | Rationale |
|---|---|---|
| **Frontend framework** | **Next.js 15+ (React 19, Server Components)** or SvelteKit; TypeScript | SSR / streaming for fast first load, PWA support, big talent pool |
| **Styling** | Tailwind CSS v4 + design tokens; CSS Grid + Container Queries | Mobile-first utilities, small CSS |
| **Game rendering** | **PixiJS v8 (WebGPU with WebGL2 fallback)** for 2D; Three.js / Babylon.js (WebGPU) for optional 3D pool | WebGPU is widely supported in 2026 browsers. Fallback keeps low-end phones working. |
| **Physics (Pool)** | **Rapier (Rust → WASM)** in deterministic mode, *or* a custom fixed-point billiards engine in Rust/WASM shared by client and server | Same binary on client and server gives deterministic results |
| **Game logic modules** | **Rust or TypeScript compiled to WASM** (Component Model) | One rules engine on server (authority) and client (prediction) |
| **Real-time server** | **Go** or **Rust** room servers (or Colyseus / Nakama as an accelerator); **Elixir/Phoenix** is a strong alternative | Low latency, high concurrency, cheap per room |
| **Transport** | **WebTransport (HTTP/3)** + WebSocket fallback; binary protocol (Protobuf / FlatBuffers) | Lower latency and better behaviour on lossy mobile networks |
| **3D world engine** | **Three.js (WebGPU renderer, WebGL2 fallback)** with React Three Fiber, *or* Babylon.js / PlayCanvas; WebXR for VR | Runs in the browser, has a large ecosystem, VR through the same code |
| **World / presence server** | Go or Rust instance servers (or Colyseus) with interest management; positions at 10–20 Hz | Cheap per avatar, scales by room instance |
| **Voice** | **WebRTC SFU** (LiveKit or mediasoup, self-hosted in region), Opus codec, Web Audio API spatial audio (PannerNode / HRTF) | Low-latency group voice, proximity audio computed on the client |
| **3D assets pipeline** | Blender → glTF 2.0, meshopt / Draco, KTX2 textures, VRM avatars; asset CDN | Small downloads for mobile networks |
| **Speech & moderation AI** | Streaming speech-to-text (captions / translation) + toxicity classifiers for voice and text | Safety and accessibility at scale |
| **Core services** | Go / Kotlin / TypeScript (NestJS) microservices; start as a **modular monolith** | Ship the MVP fast, split later |
| **Ledger DB** | **PostgreSQL 17** (serializable transactions), or **TigerBeetle** for the high-throughput financial ledger | Strong consistency for money |
| **Cache / presence** | Redis / Valkey | Matchmaking queues, presence, rate limits |
| **Event streaming** | Kafka / Redpanda / NATS JetStream | Event-driven integration, audit, analytics |
| **Analytics** | ClickHouse + dbt; product analytics (PostHog, self-hosted) | Real-time dashboards, privacy-friendly |
| **ML / AI** | Python services (feature store + models); LLM APIs for the support assistant, moderation and admin analytics | Fraud, collusion and RG risk models |
| **Infra** | Kubernetes (EKS / GKE / AKS or local cloud), Terraform, Argo CD (GitOps) | Repeatable, autoscaling game fleets (Agones optional) |
| **Edge** | Cloudflare / Akamai (CDN, WAF, bot management, DDoS) | Security and global performance |
| **Observability** | OpenTelemetry → Grafana (Prometheus, Loki, Tempo) or Datadog | Traces across game and wallet flows |
| **Feature flags** | OpenFeature + Unleash / Flagsmith | Per-country real-money kill-switch, staged rollouts |
| **Auth** | Passkeys (WebAuthn), OIDC (Keycloak / Auth0 / Ory) | Phishing-resistant, passwordless |

### 9.3 Key Architectural Decisions

| ADR | Decision | Reason |
|---|---|---|
| ADR-01 | **Modular monolith first, microservices later** (Wallet and Game Servers separate from day 1) | Speed of delivery. Money and real-time are isolated for safety and scale. |
| ADR-02 | **Server-authoritative + client-side prediction** | Fair play with a responsive feel |
| ADR-03 | **Shared deterministic WASM rule engines** | One source of rules, no client/server drift |
| ADR-04 | **Double-entry, append-only ledger with idempotency** | Financial correctness and auditability |
| ADR-05 | **Outbox pattern** for events from Wallet / Game | Exactly-once settlement, no lost events |
| ADR-06 | **Feature-flagged real money per jurisdiction / game / user** | Regulatory agility (lesson from India 2025) |
| ADR-07 | **Payment provider abstraction + smart routing** | Resilience, cost optimisation, easy expansion |
| ADR-08 | **PWA rather than native at launch** | No app-store restrictions on real-money apps, faster iteration, low-end device reach |
| ADR-09 | **Coins are an internal RWF-pegged accounting unit, not crypto** (no token, no blockchain, no P2P transfers) | Avoids a second licence under the virtual-asset law (Law No. 023/2026), no price volatility, MoMo-native UX, closes laundering paths. Blockchain is used only to anchor fairness proofs (FR-PF-03). |
| ADR-10 | **Revenue from a disclosed table fee on play volume** (winner takes exactly 2×) | Scales with matches rather than top-ups, keeps the "2×" promise literally true, keeps licence and consumer-protection compliance |
| ADR-11 | **3D world is a progressive layer on top of a 2D lobby** with feature parity (Ultra / Standard / Lite / Classic 2D tiers) | Keeps the fast-load, low-end-device goal; accessibility; the 3D world is not a single point of failure |
| ADR-12 | **Separate world, voice and game servers** (the world shows presence; matches run on the authoritative game fleet) | Avatars and voice can scale or fail without affecting matches or money |
| ADR-13 | **VR is first-class in the MVP through WebXR in the same codebase**; phones play in landscape | One world for headsets, desktops and phones; no app-store dependency; landscape gives the console-style HUD of the reference design |

### 9.4 Match Lifecycle (Sequence)
```
Client A/B     Matchmaking      Wallet          Game Server        Event Bus
   │ join(stake) ──►│                │                 │                 │
   │               │ pair found      │                 │                 │
   │               │ lock stakes ───►│ escrow entries  │                 │
   │               │◄── locked ──────│                 │                 │
   │               │ allocate room ──────────────────► │ create room     │
   │◄──────── room ticket (signed JWT, room addr) ─────│                 │
   │ connect (WebTransport) ─────────────────────────► │ seed commit     │
   │ ◄═══════════════ realtime play (intents/state) ═══►│                 │
   │               │                 │                 │ result signed ─►│
   │               │                 │◄─ settle(result)──────────────────│
   │               │                 │ pot + fee entries              │
   │◄──── balance update / result screen ──────────────│ seed reveal     │
```

### 9.5 Scalability Targets (Design Capacity)

| Metric | MVP | Year 2 |
|---|---|---|
| Registered users | 100k | 2M |
| Peak concurrent users | 5k | 100k |
| Concurrent matches | 2.5k | 50k |
| Wallet transactions / sec (peak) | 200 | 5,000 |
| Matchmaking time p50 / p95 | ≤ 10 s / ≤ 30 s | ≤ 5 s / ≤ 20 s |

### 9.6 Environments
- Local (Docker Compose / devcontainers), Dev, Staging (**payments sandbox**: MTN MoMo sandbox, Airtel sandbox), Pre-prod (production-like, load tests), Production.
- Real-money tests in production only with internal "test-money" accounts and capped limits.

### 9.7 CI/CD and Quality
- Trunk-based development, PR checks (lint, type-check, unit, contract tests), preview deployments.
- **Deterministic simulation tests** for game modules (millions of random games: no rule violation, no crash, client/server state hashes match).
- **Property-based tests** for the ledger (sum of all accounts = 0, no negative coin balances).
- Load tests (k6 / Locust) for matchmaking, game rooms and wallet.
- Chaos tests: kill game servers mid-match → verify reconnection or void + refund.
- Security: SAST, DAST, dependency scanning, SBOM, signed container images.

### 9.8 Future Technology Watch List
| Technology | Potential use | Phase |
|---|---|---|
| **Stablecoin payout rails through a licensed VASP partner** (never self-custody; coins stay RWF-pegged) | Cross-border payouts for diaspora / other markets | 4 |
| **Central bank digital currency / instant payment switches** (for example Rwanda's eKash interoperability) | Cheaper, instant interoperable payouts | 3 |
| **On-device AI (WebGPU / WebNN)** | Offline AI opponents and coaching with no server cost | 3 |
| **Verifiable credentials / digital ID wallets** | Reusable KYC, fewer drop-offs | 3 |
| **WebXR (AR)** | AR pool table on a real table surface (premium mode). VR world support is already in §8.4.9 (MVP) | 4 |
| **AI-driven NPC hosts** | Friendly world guides / tournament commentators powered by AI, clearly labelled as AI, never playing in cash matches | 3 |
| **Live-streaming integrations** | Stream tournament finals, creator-hosted matches | 3 |
| **Public Game SDK + revenue share** | Third-party developers ship games (Skillz-style marketplace) | 4 |

---

## 10. Game Module SDK (Adding Games Later)

Goal: **add a new game without changing the platform core.** Each game is a self-contained module.

### 10.1 Game Module Contract

```ts
// Shared between server (authoritative) and client (prediction/rendering)
interface GameModule<State, Intent, Config> {
  meta: {
    id: string;                 // "pool-8ball", "ludo-sprint", "igisoro"
    version: string;            // semver; matches are pinned to a version
    minPlayers: number;
    maxPlayers: number;
    teams?: boolean;
    usesRandomness: boolean;    // forces provably-fair RNG wiring
    skillClassification: 'pure-skill' | 'skill-dominant' | 'mixed'; // compliance gate
    realtime: 'turn-based' | 'simultaneous' | 'async-same-seed';
  };
  init(config: Config, players: PlayerRef[], rng: FairRng): State;
  validate(state: State, player: PlayerId, intent: Intent): ValidationResult;
  apply(state: State, player: PlayerId, intent: Intent, rng: FairRng): State; // pure, deterministic
  onTimeout(state: State, player: PlayerId): State;
  currentTurn(state: State): PlayerId | PlayerId[] | null;
  isTerminal(state: State): boolean;
  result(state: State): MatchResult;            // ranks, scores, draw
  viewFor(state: State, player: PlayerId | 'spectator'): unknown; // hides private info
  hash(state: State): string;                   // desync detection
}
```

### 10.2 SDK Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-SDK-01 | Game modules are compiled to **WASM**, versioned and stored in a module registry. Matches are pinned to a module version. | M |
| FR-SDK-02 | Module config (timers, fee schedule, stake tables, variants) is managed from the admin console. No redeploy needed. | M |
| FR-SDK-03 | Each module ships: rules engine, renderer (client), AI bot, tutorial, rules page, test suite and a **compliance sheet** (skill classification, RNG usage). | M |
| FR-SDK-04 | **Certification pipeline**: simulation tests, desync tests, performance budget (< 500 KB gzipped renderer, 60 fps on the reference device), and compliance approval before release. | M |
| FR-SDK-05 | Gradual rollout: internal → free-to-play only → limited real money → general availability. | M |
| FR-SDK-06 | Public developer SDK and portal for third-party studios (revenue share). | C |

---

## 11. Non-Functional Requirements

### 11.1 Performance
| ID | Requirement |
|---|---|
| NFR-PERF-01 | Initial load (lobby) on a mid-range Android over 4G: **LCP ≤ 2.0 s**, **INP ≤ 200 ms**, **CLS ≤ 0.1**. On 3G: interactive in ≤ 3.5 s. |
| NFR-PERF-02 | Initial JS bundle ≤ 200 KB gzipped (lobby). Game bundles lazy-loaded (≤ 1.5 MB including assets per game). |
| NFR-PERF-03 | Game rendering at 60 fps on the reference device (2 GB RAM Android), never below 30 fps. |
| NFR-PERF-04 | Real-time round-trip (intent → authoritative state) p95 ≤ 150 ms within the region. |
| NFR-PERF-05 | Wallet API p95 ≤ 300 ms. Settlement completes ≤ 2 s after the match ends. |
| NFR-PERF-06 | Auto-approved withdrawals reach the provider ≤ 30 s after the request. |

### 11.2 Availability and Reliability
| ID | Requirement |
|---|---|
| NFR-AV-01 | Platform availability **99.9%** monthly (MVP), 99.95% (Year 2). Wallet: 99.95%. |
| NFR-AV-02 | RPO ≤ 1 min for financial data (synchronous replication); RTO ≤ 30 min. |
| NFR-AV-03 | Game server failure mid-match → state snapshot restored onto a new server within 10 s, or void + refund. |
| NFR-AV-04 | Graceful degradation: if payments are down, gameplay with existing balances continues and deposits / withdrawals queue. |
| NFR-AV-05 | Multi-AZ deployment. A cross-region DR copy for financial data. |

### 11.3 Scalability
- NFR-SC-01: Horizontally scalable game server fleet (autoscale on rooms and CPU).
- NFR-SC-02: Stateless APIs. Ledger partitioned by account if needed.

### 11.4 Usability and Accessibility
- NFR-US-01: WCAG 2.2 AA (contrast, focus, screen-reader labels for lobby and wallet, colour-blind-safe game palettes: Ludo colours plus shapes / patterns).
- NFR-US-02: A new user completes sign-up → first free match in ≤ 90 s.
- NFR-US-03: A verified user completes deposit → first cash match in ≤ 60 s.

### 11.5 Localisation
- NFR-L10N-01: i18n framework with ICU message format. Languages at launch: **Kinyarwanda, English, French**. Swahili in Phase 2.
- NFR-L10N-02: Currency, date and number formatting per locale. Timezone: CAT (UTC+2).

### 11.6 Maintainability
- NFR-MT-01: Test coverage ≥ 80% for wallet, ledger, settlement and game rule engines.
- NFR-MT-02: All services observable: structured logs, metrics, distributed traces, a correlation ID across match and wallet flows.
- NFR-MT-03: API contracts versioned (OpenAPI / GraphQL schema, Protobuf for real-time).

### 11.7 Compatibility
- NFR-CP-01: Graceful fallbacks: WebGPU → WebGL2 → Canvas2D (turn-based games); WebTransport → WebSocket.

---

## 12. Security and Privacy

### 12.1 Application Security
| ID | Requirement |
|---|---|
| SEC-01 | OWASP ASVS Level 2 (Level 3 for wallet and payments). OWASP Top 10 and API Top 10 mitigated. |
| SEC-02 | TLS 1.3 everywhere, HSTS, strict CSP, SRI for third-party scripts. |
| SEC-03 | Passkeys first. OTP rate limiting. Step-up authentication for withdrawals and payout-method changes. |
| SEC-04 | Secrets in a vault / KMS. Keys rotated. HSM / KMS for result-signing and seed keys. |
| SEC-05 | Encryption at rest (AES-256). KYC documents field-level encrypted with restricted access and an audit trail. |
| SEC-06 | Least-privilege RBAC for the admin console. **Four-eyes approval** for manual ledger adjustments and large payouts. |
| SEC-07 | Full audit log of admin actions (immutable, exportable to the regulator). |
| SEC-08 | Annual external penetration test plus continuous bug bounty (after launch). |
| SEC-09 | Card data never touches our servers (PCI-DSS SAQ-A scope through hosted fields). |
| SEC-10 | Webhook signature verification and IP allow-lists for payment providers. |

### 12.2 Fraud and AML
| ID | Requirement |
|---|---|
| AML-01 | Customer due diligence by tier. Enhanced due diligence above thresholds. |
| AML-02 | Sanctions and PEP screening at onboarding and periodically. |
| AML-03 | Transaction monitoring rules: rapid deposit → withdrawal without play, structuring, chip dumping, unusual volumes. |
| AML-04 | Suspicious transaction reports to the Financial Intelligence Centre (Rwanda FIC) following the legal procedure. |
| AML-05 | Record retention per law (for example at least 10 years for financial records; confirm with counsel). |

### 12.3 Privacy
- PRV-01: Privacy by design and data minimisation. Explicit consent for marketing and analytics cookies.
- PRV-02: User rights: access, rectification, deletion (subject to AML retention), portability.
- PRV-03: Player data in the public profile is controlled by the user (hide stats, hide online status).

### 12.4 Data Protection (Rwanda Law N°058/2021)
- PRV-04: Register as data controller / processor with **NCSA** (National Cyber Security Authority).
- PRV-05: Personal data **stored in Rwanda** unless an NCSA authorisation for storage abroad is obtained. Architecture must support an in-country primary region or an approved cross-border arrangement.
- PRV-06: Data breach notification within the legal timelines. Incident response runbook.
- PRV-07: Appoint a Data Protection Officer (DPO).

---

## 13. Legal, Regulatory and Responsible Gaming

### 13.1 Licensing and Classification
| ID | Requirement |
|---|---|
| LEG-01 | Get a **written legal opinion** on how peer-to-peer skill gaming with stakes is classified under Law n°58/2011 and its ministerial orders, and under any new gambling law or policy. |
| LEG-02 | Engage **RDB** (gaming regulator) early. Apply for the right licence (online gaming), or get confirmation of an exemption. **No real-money launch without this.** |
| LEG-03 | Per-game compliance sheet (skill classification, randomness, certification) approved by the Compliance Officer before real money is enabled. |
| LEG-04 | Geo-fencing: real money only in approved jurisdictions (IP + GPS permission + KYC country + SIM / mobile-money country). |
| LEG-05 | Tax engine configured for the applicable regime. Since Aug 2025 reporting cites **40% tax on GGR** and **25% tax on winnings** (verify the exact base and applicability to P2P table-fee revenue with tax counsel and RRA). |
| LEG-06 | Terms of Service, Privacy Policy, Fair Play Policy, Responsible Gaming Policy, Bonus Terms, available in all supported languages. |
| LEG-07 | Regulator reporting: scheduled reports (players, GGR, stakes, winnings, taxes, self-exclusions) and an optional read-only regulator portal / API. |
| LEG-08 | Marketing compliance: no targeting of minors, no "get rich" messaging, required responsible-gaming notices on ads. |
| LEG-09 | **Kill-switch**: real money can be disabled per country / game / segment within minutes. Users keep withdrawal access to their balances. |
| LEG-10 | **Fee transparency**: every fee and rate is shown before commit, on statements and on a public "How we earn" page generated from live config (FR-FIN-06). Complies with Rwanda's competition and consumer protection law and licence conditions. The forbidden practices in §6.7.5 are audited. |
| LEG-11 | Coin terms: peg, top-up and withdrawal rules, fee schedule, draw / void rules, dormancy policy, published in all supported languages. |

### 13.2 Responsible Gaming (RG)
| ID | Requirement | Priority |
|---|---|---|
| RG-01 | Deposit limits (daily / weekly / monthly). Decreases take effect immediately; increases after a cooling-off of 24–72 h. | M |
| RG-02 | Loss limits and stake limits per match. | M |
| RG-03 | Session time limits and reality checks ("You have played 60 min; net result −200 🪙 (−2,000 RWF)"). | M |
| RG-04 | Cool-off (24 h – 6 weeks) and **self-exclusion** (6 months – permanent). Syncs with a national self-exclusion register if one exists. | M |
| RG-05 | **AI risk scoring** for problem-play markers (chasing losses, late-night binges, rising deposits). Graduated interventions: nudge → mandatory pause → outreach. | S |
| RG-06 | Links to help resources and helplines (local support organisations). | M |
| RG-07 | No bonuses or promotions sent to self-excluded or high-risk users. | M |
| RG-08 | Free-to-play is always available and promoted equally. | M |
| RG-09 | Minors: age-verified at KYC. Underage detection triggers lock and refund of deposits. | M |

---

## 14. Data Model (Core Entities)

```
User(id, phone, username, dob, country, language, kyc_tier, status, created_at)
KycRecord(id, user_id, provider, doc_type, doc_ref_encrypted, liveness_score, status, reviewed_by)
Device(id, user_id, fingerprint_hash, first_seen, last_seen, trust_score)
Wallet(id, user_id, currency, status)
LedgerAccount(id, owner_type[user|platform|escrow|tax|provider], owner_id, kind[cash|bonus|locked|pending], currency)
JournalEntry(id, type[topup|withdrawal|stake|table_fee|pot_payout|refund|bonus|tax|withdrawal_fee|purchase|adjustment], idempotency_key, ref_type, ref_id, created_at, created_by)
JournalLine(id, entry_id, account_id, amount_minor, direction[debit|credit])
PaymentTransaction(id, user_id, provider, direction[in|out], amount, status, provider_ref, payer_msisdn, webhook_log)
PayoutMethod(id, user_id, type[momo|airtel|bank], account_ref, verified_name, status)
Game(id, slug, name, module_id, status, real_money_enabled, config)
GameModuleVersion(id, game_id, version, wasm_hash, compliance_status, released_at)
StakeTable(id, game_id, stake_coins, fee_schedule_id, min_tier, status)
CoinPeg(id, coin_value_rwf, effective_from, approved_by)                 -- 1 🪙 = 10 RWF
FeeSchedule(id, name, bands[{min_stake, max_stake, rate_bp, min_fee, cap}], premium_discount_bp, draw_rule, effective_from)
Challenge(id, creator_id, game_id, variant, stake_coins, fee_coins, visibility[public|friends|private], rating_min, rating_max, time_control, status[open|accepted|expired|cancelled], expires_at, match_id)
Product(id, type[premium|cosmetic], price_coins, status)
PlayerLevel(user_id, total_xp, level, tier, updated_at)
XpEvent(id, user_id, match_id, reason, xp, ts, reversed)
DailyAward(id, date, winner_id, dps, candidates_json, net_revenue_prev_day, pool_coins, tax_withheld, status[computed|in_review|awarded|skipped], approved_by)
FeatureConsent(user_id, public_feature, real_name_use, granted_at, withdrawn_at)
WorldArea(id, type[plaza|hall|arena], game_id, theme, asset_bundle_version)
Room(id, area_id, type[public|private|club|tournament], stake_band, language, voice_policy, capacity, owner_id, status)
RoomInstance(id, room_id, server_addr, avatar_count, created_at)
WorldTable(id, room_id, game_id, seat_count, state[free|open_challenge|in_play], challenge_id, match_id)
Avatar(user_id, model_ref, outfit_items[], emotes[], updated_at)
Proposal(id, from_user, to_user, room_id, game_id, variant, stake_coins, table_id, status[sent|countered|accepted|declined|expired], parent_proposal_id, challenge_id)
ChatMessage(id, channel[room|nearby|private|table], room_instance_id, sender_id, text, moderation_status, ts)   -- short retention
VoiceSession(id, user_id, channel, room_instance_id, started_at, ended_at)                                      -- metadata only, no audio
ModerationReport(id, reporter_id, subject_id, context[voice|text|behaviour], evidence_ref, status, action, decided_by)
Match(id, game_id, module_version, stake_table_id, status[pending|active|settled|void|disputed], seed_commit, seed_reveal, result_signature, started_at, ended_at)
MatchPlayer(match_id, user_id, seat, team, client_seed, result_rank, score, rating_before, rating_after)
MatchEvent(match_id, seq, actor, intent, state_hash, ts)          -- replay / audit (object storage + index)
Tournament(id, game_id, format, entry_fee, prize_pool, payout_table, schedule, status)
TournamentEntry(tournament_id, user_id, status, final_rank, prize)
Rating(user_id, game_id, mu, sigma/rd, volatility, games_played)
RiskCase(id, subject_user_ids, type[collusion|cheat|aml|rg], score, status, decision, assigned_to)
RgSetting(user_id, deposit_limits, loss_limits, session_limit, self_exclusion_until)
Dispute(id, match_id, raised_by, reason, status, decision, decided_by)
AdminAuditLog(id, admin_id, action, target, before, after, ts, approval_id)
```

**Ledger invariants (must be tested continuously):**
1. For every `JournalEntry`: Σ debits = Σ credits.
2. A user's `cash` balance is never below 0.
3. The sum of the `escrow` balances equals the sum of the stakes of matches that are not yet settled.
4. Platform trust account balance (RWF) ≥ Σ user coins (available + locked + pending) × 10 RWF (checked daily).
5. For every settled match, pot paid = Σ stakes (exactly 2× for 1v1).

---

## 15. Admin and Back-Office

| Module | Key functions |
|---|---|
| **Dashboard** | Live CCU, active matches, deposits / withdrawals, GGR, alerts |
| **Users** | Search, profile, KYC status, wallet, matches, devices, notes, freeze / unfreeze, RG status |
| **KYC Review** | Queue, document viewer (masked), liveness results, approve / reject with reasons |
| **Finance** | Ledger explorer, reconciliation results, manual adjustments (four-eyes), payout queue, tax reports |
| **Risk & Fraud** | Case queue, collusion graph viewer, replay viewer, rules editor, ML scores |
| **Games & Config** | Enable / disable games, module versions, stake tables, fee schedules (versioned, with approval), coin peg, timers, variants, real-money flags per country |
| **Tournaments & Promotions** | Create / schedule tournaments, bonuses, campaigns, budgets |
| **World & Moderation** | Live world map with room instances and counts, enter as moderator, mute / kick / ban, close room, report queue with audio clips and chat context, room and hall configuration, event scheduling |
| **Levels & Awards** | XP rules and level rewards, Player of the Day candidate review, pool calculation audit, share-card approval, Hall of Champions |
| **Support** | Tickets, disputes, canned responses, AI assistant hand-offs |
| **Content / CMS** | Banners, FAQs, rules pages, legal docs (versioned, multilingual) |
| **Compliance** | RG interventions, self-exclusion list, regulator reports, audit logs export |
| **Roles & Access** | RBAC, SSO for staff, mandatory MFA (hardware keys for finance and super admin) |

---

## 16. Analytics and KPIs

| Category | KPI |
|---|---|
| Acquisition | Installs (PWA), sign-ups, KYC completion rate, CAC, referral K-factor |
| Activation | % of sign-ups playing their first match in 24 h; % making their first deposit in 7 days |
| Engagement | DAU / MAU, matches per user per day, session length, D1 / D7 / D30 retention, level distribution, level-ups per day |
| Virtual World | World entries / DAU, average time in world, proposals sent → accepted rate, % of matches started from the world, voice usage %, tier distribution (Ultra / Standard / Lite / Classic), fps and crash rate per tier, reports per 1,000 voice hours |
| Awards & Advertising | Daily award cost ÷ previous-day net revenue (must stay ≤ p), share-card shares and clicks, sign-ups attributed to Player of the Day posts, days left unawarded |
| Monetisation | GGR (table fees), effective take rate (fees ÷ total stakes), revenue by stream, open challenges posted / accepted / expired, ARPPU, average stake, deposit conversion, withdrawal ratio |
| Liquidity | Matchmaking time p50 / p95, % of queue abandons, players per stake table |
| Trust & Safety | Cheat / collusion detection rate, dispute rate, dispute resolution time, chargebacks |
| Payments | Deposit success rate per provider, payout time p50 / p95, reconciliation breaks |
| Responsible Gaming | % users with limits set, interventions triggered, self-exclusions, at-risk share |
| Technical | Crash-free sessions, LCP / INP, real-time latency, desync rate, uptime |

---

## 17. Release Plan

| Phase | Timeline (indicative) | Scope |
|---|---|---|
| **Phase 0: Foundations** | Months 0–2 | Legal opinion and regulator engagement, payment provider contracts, design system, architecture skeleton, ledger core, CI/CD |
| **Phase 1: MVP (Free-to-Play Beta)** | Months 2–5 | PWA, accounts (phone OTP + passkeys), **3 games** (8-Ball Pool, Ludo, Igisoro) with Stars, AI practice bots, matchmaking, ratings, friends, replays, provably fair, admin basics. **3D world v1**: Plaza + 3 halls, Free rooms, avatars, text chat, push-to-talk proximity voice, in-world proposals, Lite and Classic 2D tiers, **phone landscape and desktop HUD**, **Immersive VR (WebXR)** for the world, Ludo, Igisoro and laser-aim Pool. **No real money.** Validates retention and liquidity. |
| **Phase 1b: Real-Money Pilot** | Months 5–7 (after licence) | KYC, wallet, MoMo / Airtel deposits and withdrawals, coins, Open Challenges, escrow and settlement, table fees, RG tools, risk rules, reconciliation, regulator reports. Capped stakes, limited users. |
| **Phase 2: Growth** | Months 7–12 | VR hand tracking, mixed reality (board on your real table), physical-cue Pool, VR Lounge partner program, phone AR, Tournament Arena, private rooms and club houses, live translation and captions, AI voice moderation, avatar cosmetics store, Tournaments, leaderboards, Ludo skill variants expansion, Draughts / Carrom / Chess, Swahili, cards, referrals, AI coach, ML fraud models, club features |
| **Phase 3: Scale** | Year 2 | East Africa expansion (per-country compliance), seasonal cups and streaming, async same-seed games, native wrappers (optional), on-device AI |
| **Phase 4: Platform** | Year 2+ | Public Game SDK and developer marketplace, new payment rails, WebXR premium modes |

### 17.1 MVP Acceptance Criteria (Summary)
- [ ] A new user can sign up and play a free match in ≤ 90 s on a mid-range Android over 4G.
- [ ] All 3 games pass 1M-game deterministic simulation tests with 0 desyncs.
- [ ] Reconnection works for drops of up to 60 s with no state loss.
- [ ] (Phase 1b) A deposit through MoMo is reflected in the wallet ≤ 30 s after the user approves it.
- [ ] (Phase 1b) A posted challenge locks stake + fee. Accept → play → the winner receives exactly 2× the stake. Expire / cancel refunds 100%.
- [ ] (Phase 1b) Every fee shown before commit matches the ledger entry exactly (automated test on all fee bands).
- [ ] (Phase 1b) Settlement and prize credit ≤ 2 s after the match ends. Ledger invariants hold under load tests.
- [ ] (Phase 1b) Auto-approved withdrawal received on MoMo ≤ 2 min.
- [ ] Lighthouse mobile performance ≥ 90 on the lobby. WCAG 2.2 AA audit passed.
- [ ] Layout verified at 360, 414, 768, 1024, 1440 and 1920 px widths.

---

## 18. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Real-money skill gaming classified as gambling / licence refused / new restrictive law (cf. India 2025) | Medium | Critical | Legal opinion first; free-to-play-first launch; kill-switch; sponsor-prize free-rolls; diversify revenue (ads, cosmetics, subscriptions, sponsorships) |
| R2 | High tax burden (40% GGR, 25% winnings) hurts unit economics | High | High | Model the economics before launch; tune table fees and minimum stakes; lobby for clarity on skill-gaming treatment; efficient payments |
| R3 | Low liquidity → long matchmaking waits | High (early) | High | Start with few games and few stake tables; scheduled "happy hours"; async modes; free mode builds the pool |
| R4 | Cheating / collusion erodes trust | Medium | High | Server authority, provably fair, ML detection, quick dispute handling, publish fairness stats |
| R5 | Mobile-money API outages / slow production approval | Medium | High | Multiple providers + aggregator, queueing, clear user messaging; start approval early |
| R6 | Problem gambling / reputational damage | Medium | High | Strong RG by default, AI risk detection, no aggressive marketing, partner with support organisations |
| R7 | Low-end devices can't run physics games smoothly | Medium | Medium | WASM physics, WebGL2 fallback, data-saver mode, a 2D pool renderer |
| R8 | Fraud: stolen MoMo accounts, multi-accounting, bonus abuse | High | Medium | KYC name match, device fingerprinting, velocity rules, payout to own name only |
| R9 | Data residency non-compliance | Low | High | Primary region in Rwanda or NCSA authorisation; encryption; DPO |
| R10 | Cultural rule disputes (Igisoro variants) | Low | Low | Validate rules with cultural experts; publish rules; offer variants |
| R11 | Strong players "hustle" beginners on the Challenge Board | High | Medium | Ratings shown on every challenge, rating-range filters, new-player protection (FR-CHL-09) |
| R12 | Coins treated as e-money or a virtual asset by regulators | Low | High | No P2P transfers, RWF peg, segregated funds, legal confirmation with BNR / CMA |
| R13 | The 3D world is too heavy for low-end phones or costly on mobile data | High | High | Performance tiers, lazy loading, Lite and Classic 2D modes, data-saver, asset budgets (NFR-3D-01…05) |
| R14 | Voice harassment, hate speech or abuse | Medium | High | 18+ gate, trust-based voice access, push-to-talk default, block = invisible, AI moderation, report-with-evidence, visible moderators |
| R15 | Side deals and scams arranged by voice (outside escrow), or collusion talk during multi-player games | Medium | High | All deals through system proposals, PII / payment filters, scam warnings, no private voice channels in 3–4 player cash matches, collusion detection (§7.4) |
| R16 | 3D world scope delays the MVP | Medium | Medium | Ship the 2D lobby first and the 3D world in increments (Plaza + 1 hall → 3 halls → VR); use proven engines and an SFU |

---

## 19. Open Questions

1. What legal classification and licence category does RDB give peer-to-peer skill gaming with stakes? Is classic Ludo (dice) allowed for cash, or only skill variants?
2. How do the 40% GGR tax and the 25% winnings tax apply to table-fee P2P platforms? Is winnings tax on the gross pot or the net gain (pot − own stake)? Who withholds and remits?
3. Final fee schedule (§6.7.3) and draw rule: keep fees on a draw, or refund them? Target net take after tax?
4. Will the company hold player funds itself or through a licensed payment service provider / trust account (BNR requirements)?
5. Which KYC provider supports NIDA verification + liveness at the needed cost per check?
6. Launch region: Rwanda only, or Rwanda + one more EAC market in Year 1?
7. Third launch game: Igisoro (local differentiation) or Draughts (wider familiarity)? Recommend testing both in the free beta.
8. Brand and name confirmation, plus trademark search.
9. Hosting: in-country cloud / data centre vs international cloud with NCSA authorisation?
10. Coin peg: confirm 1 🪙 = 10 RWF (low stakes, simple maths) or 1 🪙 = 100 RWF (fewer digits)?
11. Does BNR consider the RWF-pegged coin wallet a stored-value / e-money product needing its own authorisation, given there are no P2P transfers?

---

## 20. Glossary

| Term | Meaning |
|---|---|
| **Coin (🪙)** | Internal unit of a player's real-money balance. 1 🪙 = 10 RWF, withdrawable at par, not transferable, not crypto |
| **Star (⭐)** | Practice currency for free play. No cash value, never convertible |
| **Table fee** | Small disclosed fee each player pays on top of the stake. The winner still gets exactly 2× the stake |
| **Pot** | The sum of all stakes in a match, paid in full to the winner |
| **Open Challenge** | A funded match offer posted to the Challenge Board, waiting for an opponent |
| **XP / Level** | Experience points from completed matches. Level only goes up and measures experience, not skill |
| **DPS** | Daily Performance Score: results above rating expectations, used to pick the Player of the Day |
| **Pool (daily award)** | Player of the Day prize budget: at most 5% of the previous day's net revenue, capped |
| **Plaza / Hall / Room** | Levels of the 3D world: central hub → one hall per game → room instances by stake band, with tables |
| **Proposal** | An in-world game offer (game, stake, table) sent to another player. Accepting it creates an escrowed challenge |
| **Proximity voice** | Voice chat where you hear players near your avatar, with 3D direction and volume |
| **SFU** | Selective Forwarding Unit: a server that relays WebRTC voice streams between many users |
| **WebXR** | Browser API for VR / AR headsets |
| **Performance tier** | The graphics level chosen for the device: Ultra, Standard, Lite or Classic 2D |
| **Rake** | A fee taken out of the prize pool (used by competitors; not used here. Our fee is always a separate line) |
| **GGR** | Gross Gaming Revenue: total stakes minus total prizes (for P2P platforms ≈ total platform fees) |
| **Escrow** | A ledger account holding stakes while a match is in progress |
| **KYC** | Know Your Customer: identity verification |
| **AML** | Anti-Money Laundering |
| **RG** | Responsible Gaming |
| **PWA** | Progressive Web App: an installable, offline-capable web app |
| **Server-authoritative** | The server decides all game outcomes; clients only send inputs |
| **Provably fair** | A cryptographic method that lets players verify randomness was not manipulated |
| **Commit-reveal** | Publishing a hash of a secret before use, and revealing the secret afterwards |
| **Chip dumping** | Deliberately losing to transfer money to another account (collusion / laundering) |
| **CCU** | Concurrent users |
| **WASM** | WebAssembly: portable, fast binary code that runs in browsers and on servers |
| **WebTransport** | A modern low-latency browser transport over HTTP/3 (QUIC) |
| **WebGPU** | A modern browser graphics / compute API (successor to WebGL) |
| **Passkey** | Phishing-resistant passwordless login based on WebAuthn / FIDO2 |
| **Glicko-2 / TrueSkill** | Skill rating systems used for matchmaking |
| **Igisoro** | A traditional Rwandan mancala-style strategy board game |
| **MoMo** | MTN Mobile Money |
| **RDB** | Rwanda Development Board (gaming regulator in Rwanda) |
| **NCSA** | National Cyber Security Authority (data protection authority in Rwanda) |
| **RRA** | Rwanda Revenue Authority |
| **FIC** | Financial Intelligence Centre |

---

## 21. References

Market and competitor research (accessed November 2026; several sources are trade or marketing press and should be checked against primary sources before business decisions):

- Skillz rake and model: [terms.law — Skillz terms analysis](https://terms.law/Terms-Scanner/app/gaming/skills-based-platforms/skillz/), [Pocket Gamer.biz — The slow rise of Skillz](https://www.pocketgamer.biz/the-slow-rise-of-skillz/), [Septum — Skillz analysis](https://septum.substack.com/p/skillz-sklz-analysis-and-insights)
- MPL monetisation: [Markhub24 — MPL monetisation models](https://www.markhub24.com/post/mpl-mobile-premier-league-new-age-gaming-monetization-models), [Inc42 — MPL global business](https://inc42.com/startups/as-indian-mobile-gaming-goes-global-mpls-focus-turn-beyond-india)
- AviaGames 8 Ball Strike Cup: [aviagames.com](https://www.aviagames.com/8-ball-strike-cup)
- Ludo cash games: [The Bridge — Ludo money games guide](https://thebridge.in/gp-article/the-ultimate-guide-ludo-money-games-how-play-win-real-cash-53665), [Coherent Lab — Ludo earning apps India](https://www.coherentlab.com/blog/top-ludo-earning-apps-india)
- India's 2025 Act: [The Week — RMG ban impact](https://www.theweek.in/theweek/business/2025/08/30/real-money-gaming-impact-india.html), [Outlook Business — How RMG unravelled in 2025](https://www.outlookbusiness.com/in-depth/year-ender-from-unicorns-to-ed-raids-how-real-money-gaming-unravelled-in-2025), [Mondaq — India's new gaming law](https://www.mondaq.com/india/gaming/1687756/indias-new-gaming-law-transforms-landscape), [Campaign Asia](https://www.campaignasia.com/article/india-clears-online-gaming-bill-that-bans-real-money-gaming/504370)
- Africa: [Ludo Naira review](https://credreviews.blogspot.com/2025/08/ludo-naira-review-2025-is-it-legit-or.html), [Ludo Arena (Karma)](https://www.karmahq.xyz/project/ludo-arena/about), [Africa.com — play-to-earn app](https://africa.com/top-10-news/mobile-play-to-earn-app-enables-gamers-of-every-level-to-earn-cash-in-every-match-they-play), [BusinessDay — Africa's gamers & payments](https://businessday.ng/life-arts/article/africas-350m-gamers-get-in-app-payment-platforms/), [Xsolla — Africa local payments](https://blog.webflow.xsolla.com/blog/harness-africa-gaming-potential-local-payment-options)
- Rwanda regulation and tax: [RDB — Directives to Gambling Operators (2025)](https://rdb.rw/wp-content/uploads/2025/08/Directives-to-Gambling-Operators-and-Interested-Parties.pdf), [KT Press — Rwanda resumes issuing gaming licences](https://www.ktpress.rw/2025/08/rwanda-resumes-issuing-gaming-licenses/), [KT Press — New gambling tax](https://www.ktpress.rw/2025/04/rwanda-introduces-new-gambling-tax/), [iGaming Expert — Rwanda's new licensing era](https://igamingexpert.com/news/regulation/rwanda-new-licensing-era/?amp=1), [The New Times — Licensing suspension lifted](https://www.newtimes.co.rw/article/28565/news/law/rwanda-lifts-suspension-on-gambling-licensing/amp), [Vixio — Rwanda's new gambling policy](https://www.vixio.com/insights/gc-rwandas-new-gambling-policy-introduce-robust-regulatory-regime), [SiGMA — Rwanda betting sector regulation](https://sigma.world/news/rwanda-betting-sector-regulation/)
- MTN MoMo API (Rwanda): [MoMo Developer Portal — Products](https://momodeveloper.mtn.co.rw/products), [Going live with MTN MoMo API (2025)](https://cleverengineer.substack.com/p/going-live-with-mtn-momo-api-in-2025), [McTaba — MoMo API integration Rwanda](https://mctaba.com/learn/rwanda/momo-api-integration-rwanda)

---

*End of document. Next steps: (1) review workshop with stakeholders, (2) legal opinion on §13, (3) UX wireframes for §8, (4) technical spike on deterministic pool physics in WASM, (5) payment provider onboarding.*
