<div align="center">

# 🌊 Continuum

### A Unified Continuous Distribution Prediction Market Protocol

**Built on Sui · Powered by Move · Priced by Gaussian Mathematics**

[![Built with Move](https://img.shields.io/badge/Built%20with-Move-4DA2FF?style=for-the-badge)](https://move-language.github.io/move/)
[![Sui](https://img.shields.io/badge/Sui-Testnet-6FBCF0?style=for-the-badge&logo=sui)](https://sui.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](#11-project-license)
[![Network: Testnet](https://img.shields.io/badge/Network-Sui%20Testnet-blue?style=for-the-badge)](https://suiscan.xyz/testnet/home)

[![Stack](https://img.shields.io/badge/Frontend-React%20%2B%20Vite%20%2B%20d3-61DAFB?style=flat-square&logo=react)](#)
[![Backend](https://img.shields.io/badge/Backend-Express%205%20%2B%20Socket.io-339933?style=flat-square&logo=node.js)](#)
[![DB](https://img.shields.io/badge/DB-Prisma%20%2B%20SQLite%2FPostgres-2D3748?style=flat-square&logo=prisma)](#)
[![Indexer](https://img.shields.io/badge/Indexer-Sui%20Event%20Poller-7C3AED?style=flat-square)](#)

</div>

**Continuum** is a novel prediction market protocol built on **Sui** in the **Move** language. Instead of fragmenting liquidity across many separate binary "yes/no" pools, Continuum collapses all possible outcomes into a **single continuous liquidity curve** governed by a normal Gaussian probability density function. Our mission is to deliver a capital-efficient, mathematically precise, and demand-responsive platform for the future of prediction markets. This enables users to stake value across the many different possible outcomes under a single pool, preventing liquidity from being fragmented.

The core of **Continuum** translates the continuous Gaussian distribution into a fully on-chain pricing engine using fixed-point WAD arithmetic, an Abramowitz & Stegun error function approximation, and a Taylor-series exponential. It provides a superior alternative to fragmented binary pool designs, which require creating a separate liquidity pool for every strike price. Instead, users of our markets can bet under the same pool at the strike price of their choice. The complex mathematical model governing the protocol runs entirely on-chain at low cost on Sui, where Move's object model lets each market live as a single shared object with native, type-safe collateral and position handling.

## Addresses (Sui Testnet)

`Package:` [0x2863e293480bbe7acaaea17839492ff4f887f4eca0008f8331ec3fc15b397b31](https://suiscan.xyz/testnet/object/0x2863e293480bbe7acaaea17839492ff4f887f4eca0008f8331ec3fc15b397b31)

`Registry (shared):` [0xb17e6ec492a09bbff6f08fa74e950e3c4580e4ccf6bb11769f39acd38132bcdd](https://suiscan.xyz/testnet/object/0xb17e6ec492a09bbff6f08fa74e950e3c4580e4ccf6bb11769f39acd38132bcdd)

`TransferPolicy<Position> (shared):` [0x3f5a208082982f916c2c37ceb4403f8be0347f18fce5c240c1b8d2aa5aa2dd93](https://suiscan.xyz/testnet/object/0x3f5a208082982f916c2c37ceb4403f8be0347f18fce5c240c1b8d2aa5aa2dd93)

`Collateral type:` `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` (testnet USDC)

> The registry currently has **no markets** — create one from the app (or `market::create_market<USDC>`).

## Table of Contents

* [1. Overview](#1-overview)
  * [1.1 Introduction](#11-introduction)
  * [1.2 The Continuum Solution: Continuous Gaussian Pricing](#12-the-continuum-solution-continuous-gaussian-pricing)
  * [1.3 Demand-Responsive Curve Dynamics](#13-demand-responsive-curve-dynamics)
  * [1.4 Settlement Against Reality](#14-settlement-against-reality)
  * [1.5 AMM Model Comparison](#15-amm-model-comparison)
  * [1.6 Conclusion](#16-conclusion)
* [2. Architecture](#2-architecture)
  * [2.1 High-Level Workflow](#21-high-level-workflow)
  * [2.2 Object Model: One Module, Shared Market Objects](#22-object-model-one-module-shared-market-objects)
  * [2.3 Trade Execution Infrastructure](#23-trade-execution-infrastructure)
  * [2.4 Liquidity Provision Infrastructure](#24-liquidity-provision-infrastructure)
  * [2.5 Fee Distribution Infrastructure](#25-fee-distribution-infrastructure)
  * [2.6 Market Resolution: Manual Two-Phase Timelock](#26-market-resolution-manual-two-phase-timelock)
  * [2.7 Trustless On-Chain Resolution: The Pyth Oracle](#27-trustless-on-chain-resolution-the-pyth-oracle)
  * [2.8 Decentralized Settlement: The Multi-Agent AI Oracle](#28-decentralized-settlement-the-multi-agent-ai-oracle)
  * [2.9 Settlement Infrastructure](#29-settlement-infrastructure)
  * [2.10 Tradeable Positions: The Kiosk Secondary Market](#210-tradeable-positions-the-kiosk-secondary-market)
* [3. Features](#3-features)
* [4. Technical Overview](#4-technical-overview)
* **[Design & deep dive → DESIGN.md](./docs/DESIGN.md)**
  * [5. Product roadmap: from hackathon PoC to consumer trading platform](./docs/DESIGN.md#5-product-roadmap-from-hackathon-poc-to-consumer-trading-platform)
  * [6. Module-by-module: math meets Move](./docs/DESIGN.md#6-module-by-module-math-meets-move)
  * [7. Sui & Move ecosystem best practices](./docs/DESIGN.md#7-sui--move-ecosystem-best-practices)
  * [8. Future plans: an AI oracle for resolution](./docs/DESIGN.md#8-future-plans-an-ai-oracle-for-resolution)
* [9. Getting Started](#9-getting-started)
  * [9.1 Prerequisites](#91-prerequisites)
  * [9.2 Installation](#92-installation)
  * [9.3 Building Contracts](#93-building-contracts)
  * [9.4 Running the Backend](#94-running-the-backend)
  * [9.5 Running the Frontend](#95-running-the-frontend)
* [10. Deployment](#10-deployment)
* [11. Project License](#11-project-license)
* [12. References](#12-references)

---

## 1. Overview

**Continuum** is a prediction market protocol that replaces the traditional approach of creating many separate binary outcome pools for tracking the same numerical asset with a single, unified continuous liquidity curve derived from the Gaussian (normal) distribution, serving as the base of distribution markets where people can stake on infinite outcomes. Built on **Sui** in the **Move** language, it performs all pricing mathematics entirely on-chain using **fixed-point arithmetic**.

The platform provides a complete prediction market experience: market creation, continuous-strike trading, liquidity provision and real-time analytics — all powered by a full-stack monorepo spanning a Move smart-contract package, a backend API with real-time WebSocket feeds, and a React frontend.

### What led to this project?

Prediction markets have entered popular consciousness in the wake of the 2024 US Presidential elections, but the technology is likely still in its infancy. Further development could be of benefit both to developers and to the public at large. More specifically, today's prediction markets generally allow participants to express probability distributions over discrete outcomes, but many questions of relevance to the real world involve continuous outcomes. It's true that a perp market could elicit the expected value of a continuous variable from the market, but sometimes we would like to know more -- for example, do we know for sure a given project will take 10 years exactly, or could it perhaps be anywhere between 2 and 20? Do we know that a given project will have 10,000 users exactly, or could it be anywhere between 2,000 and 20,000? These questions are important, and today's prediction markets don't allow us to answer them.


### 1.1 Introduction

#### The problem we solve:

Existing prediction market platforms like Polymarket create separate binary pools for each possible outcome: "Will ETH be worth $5k by the end of 2026? Yes/No", "Will ETH be worth $5.1k by the end of 2026? Yes/No", and so on. Each strike price needs its own pool, its own liquidity, and its own market makers. This design leads to:

- **Fragmented liquidity**: Capital is spread thinly across many isolated pools
- **Incomplete coverage**: Only a handful of discrete strike prices are offered
- **Inefficient capital deployment**: LPs must choose which specific pool to fund

#### The Nature of Continuous Outcomes

Many real-world prediction questions don't have binary answers — they have a continuous range of possible outcomes. "What will ETH be worth at the end of 2026?" could be $500, $3,000, $10,000, or any value in between. "In what year will OpenAI release its new model?" could be 2026, 2027, 2028, or any integer value in between. Forcing this continuous outcome space into discrete yes/no buckets is an artificial constraint that wastes capital and limits expressiveness.

#### Many markets tracking a single asset

Traditional prediction markets suffer from a fundamental structural inefficiency. Consider a market on ETH's future price:

| Approach | Pools Required | Liquidity per Pool | Coverage |
|----------|---------------|-------------------|----------|
| Current markets | N separate pools (one per strike) | Total capital / N | Discrete strikes only |
| **Continuum** | **1 unified pool** | **Total capital** | **Any strike price** |

With N separate pools, each pool receives only a fraction of the total liquidity. Traders at less popular strike prices face thin order books, wide spreads, and high slippage. Market makers must actively manage positions across many pools simultaneously.

### 1.2 The Continuum Solution: Continuous Gaussian Pricing

Continuum replaces discrete pools with a **single continuous Gaussian curve**. The probability of any outcome is derived from the cumulative distribution function (CDF) of a normal distribution:

$$P_{\text{YES}}(x) = 1 - \Phi\left(\frac{x - \mu}{\sigma}\right)$$

$$P_{\text{NO}}(x) = \Phi\left(\frac{x - \mu}{\sigma}\right)$$

Where:
- $x$ is the trader's chosen strike price (any continuous value)
- $\mu$ (mu) is the market's expected value — the consensus belief of all participants
- $\sigma$ (sigma) is the market's uncertainty — how spread out beliefs are
- $\Phi$ is the cumulative distribution function of the standard normal distribution

**Economic intuition:** A YES position at strike $x$ is a bet that the final outcome will be *at or above* $x$. The further $x$ is above the current consensus $\mu$, the less likely this is, and the cheaper the YES token becomes (lower $P_{\text{YES}}$). Conversely, NO tokens become cheaper as $x$ falls further below $\mu$.

#### On-Chain Gaussian Mathematics

The Gaussian CDF is computed entirely on-chain using fixed-point WAD arithmetic (18-decimal precision). The mathematical stack consists of:

- **WAD arithmetic**: `mul(a, b) = a * b / 1e18`, `div(a, b) = a * 1e18 / b`, over a signed fixed-point type
- **Error function**: Abramowitz & Stegun 5-coefficient polynomial approximation (max error ~1.5 x 10^-7):

$$\text{erf}(x) \approx 1 - (a_1 t + a_2 t^2 + a_3 t^3 + a_4 t^4 + a_5 t^5) e^{-x^2}, \quad t = \frac{1}{1 + px}$$

- **Exponential**: Taylor series expansion, clamped to a safe input range:

$$e^x = \sum_{n=0}^{N} \frac{x^n}{n!}$$

- **Square root**: integer Newton's method, used to derive σ from variance
- **Gaussian CDF**: Composed from the above primitives as:

$$\Phi(z) = \frac{1}{2}\left(1 + \text{erf}\left(\frac{z}{\sqrt{2}}\right)\right)$$

All functions use a signed 18-decimal fixed-point representation (`Fp` over `u256`), providing ~11 significant digits of precision. Move has no native signed integer, so `continuum::fixed_point` supplies a signed-magnitude `Fp { mag, neg }` — the Gaussian math needs signed values because `x − μ` is often negative and `erf` is odd.

### 1.3 Demand-Responsive Curve Dynamics

A critical innovation of Continuum is that **bettors move the curve, liquidity providers do not**.

The parameters $\mu$ and $\sigma$ are not static — they are a **stake-weighted distribution of all strike prices** bet by traders:

$$\mu = \frac{\sum w_i \cdot x_i}{\sum w_i} \qquad \sigma = \sqrt{\frac{\sum w_i \cdot x_i^2}{\sum w_i} - \mu^2}$$

Where each bet contributes weight $w_i$ (= its net stake in USDC) at strike $x_i$.

This is maintained on-chain via three running accumulators updated on every trade:

| Accumulator | Formula | Purpose |
|:------------|:--------|:--------|
| `acc_stake_weight` | $\sum w_i$ | Total conviction weight |
| `acc_weighted_x` | $\sum w_i \cdot x_i$ | Weighted strike sum (for $\mu$) |
| `acc_weighted_x_sq` | $\sum w_i \cdot x_i^2$ | Weighted strike-squared sum (for $\sigma$) |

**Why LPs cannot move the curve:** Liquidity providers are pure collateral underwriters. If LP deposits could shift $\mu$ and $\sigma$, they would be a free manipulation lever — someone could move the curve without taking any directional risk. By restricting curve movement to bettors who put capital at risk on a position, the protocol is manipulation-resistant by construction. On Sui this is enforced structurally: `add_liquidity` never touches the curve accumulators.

**The prior weight mechanism:** The market owner seeds an initial $\mu$ and $\sigma$ (a prior belief). This seed is backed by a configurable `prior_weight` of virtual stake, so the first real bet cannot swing the curve to a single point. As more bets accumulate, the prior's influence naturally dilutes. Once trading begins (`trades_started`), `set_distribution` / `set_prior_weight` are locked.

**Pre-update pricing:** Each bet is priced against the curve state *before* that bet shifts it, ensuring traders see fair prices that aren't self-referentially affected by their own trade.

### 1.4 Settlement Against Reality

$\mu$ is the market's *belief*, not the boundary it settles on. A market resolves against an externally-observed final price, never against $\mu$. Continuum now supports three resolution paths, all gated on the market's scheduled close time (`resolves_at`, a `Clock` timestamp fixed at creation) having passed:

- **Trustless on-chain (price markets):** `market::resolve_with_pyth` reads a bound **Pyth Network** price feed directly on Sui — permissionless, no trusted submitter (see [2.7](#27-trustless-on-chain-resolution-the-pyth-oracle)).
- **Multi-agent AI oracle (non-price markets):** an off-chain LLM ensemble derives the final value for news/sports/qualitative markets and either auto-submits or escalates to a human (see [2.8](#28-decentralized-settlement-the-multi-agent-ai-oracle)).
- **Manual (owner):** the single-shot `market::set_final_price` or the two-phase `propose_resolution` → `execute_resolution` timelock (see [2.6](#26-market-resolution-manual-two-phase-timelock)).

Each position is judged against **its own strike**:
- A YES position at strike $X$ pays $1/token if and only if `final_price >= X`
- A NO position at strike $X$ pays $1/token if and only if `final_price < X`

This means a bet that moves $\mu$ around cannot change who wins — settlement is always against the real-world outcome, not the market's consensus.

### 1.5 AMM Model Comparison

The table below compares Continuum with the best binary AMMs currently in production, Polymarket and CPMM markets.

![Amm Market Comparison](./images/AmmComparison.png)

### 1.6 Conclusion

Continuum represents a paradigm shift in prediction market design: from discrete binary pools to a continuous, unified liquidity curve. By deriving prices from the Gaussian CDF and making the curve demand-responsive (bettors move it, LPs don't), the protocol achieves unified liquidity, continuous pricing, capital efficiency, and manipulation resistance in a single design. The Gaussian mathematics are computed entirely on-chain in Move, and Sui's object model lets each market exist as a self-contained shared object with native, type-safe collateral and position handling.

---

## 2. Architecture

On Sui, the protocol is a **single Move package** (`continuum`). Sui has no EVM-style proxies, no `msg.sender` storage mappings, and no cross-contract delegatecalls — so what would be four cooperating contracts elsewhere collapses into one module that plays the AMM, router, LP-accounting, and factory roles at once. Each market is a plain shared object. The backend provides real-time indexing and a REST + WebSocket API by reading `Market<T>` object state and the package's Move events, while the frontend delivers a quantitative-finance-inspired terminal UI.

### 2.1 High-Level Workflow

The diagram below shows how the stack fits together on Sui: a React frontend talks to an Express backend over REST + Socket.io; the backend reads the chain with `@mysten/sui`; and on **Sui Testnet** the single `continuum` package exposes a shared `Registry` and one shared `Market<T>` object per market. What were four cooperating EVM contracts (AMM + Router + LP token + Factory) and a set of per-market EIP-1167 proxy clones collapse into **one module** and **plain shared objects** — every field that used to be a separate proxy now lives *inside* the `Market<T>` object.

![Continuum Sui / Move architecture](./images/SuiArchitecture.png)

**User Journey:**

![User flow chart](./images/UserFlow.png)

### 2.2 Object Model: One Module, Shared Market Objects

Continuum is one module, `continuum::market`, built around a small set of Sui objects:

```
continuum::market
  ├── Registry (shared, created once in init)
  │     └── factory + discovery: counts markets, maps market_id → Market object id
  ├── Market<phantom T> (shared, one per market)
  │     ├── Balance<T> vault          ── all collateral custody
  │     ├── Gaussian curve params     ── mu, sigma, sigma_min, prior_weight
  │     ├── demand accumulators       ── acc_stake_weight, acc_weighted_x, acc_weighted_x_sq
  │     ├── LP bookkeeping            ── total_shares + Table<address, LpAccount>
  │     ├── per-token liabilities     ── Table<u256, Fp>
  │     └── settlement state          ── final_price, market_resolved, resolves_at
  ├── Position (owned: has key, store) ── a YES/NO bet; minted per buy, consumed on claim
  └── LpAccount (has store, in Market's Table) ── { shares, reward_debt }, keyed by address
```

| Role | How Continuum does it on Sui |
|:-----|:-----------------------------|
| AMM + Router + LP token + Factory | one `continuum::market` module |
| Per-market deployment | each market is a shared `Market<T>` object (no clones, no CREATE2) |
| Positions | owned `Position` objects, transferred natively |
| LP token (non-transferable) | per-address `LpAccount` rows in a `Table` — nothing to transfer |
| Collateral custody | a `Balance<T>` vault; collateral is any `Coin<T>` |
| Discovery | a shared `Registry` (`market_count` / `get_market` / `market_exists`) |

`T` is the collateral coin type — the real testnet/mainnet USDC coin type. The protocol mints no coin of its own.

**Module breakdown:**

| Source | Responsibility | Key Functions |
|:-------|:--------------|:-------------|
| `market.move` | Registry, market lifecycle, AMM/router/LP roles, settlement | `create_market`, `add_liquidity`, `remove_liquidity`, `buy_yes`, `buy_no`, `set_final_price`, `claim_winnings`, `release_losing_collateral` |
| `gaussian.move` | On-chain Gaussian math: PDF, CDF, erf, exp, sqrt | `normal_cdf`, `normal_pdf`, `erf`, `exp_wad`, `sqrt_wad` |
| `fixed_point.move` | Signed WAD fixed-point `Fp` over `u256` | `mul`, `div`, `add`, `sub`, `neg`, `abs`, comparisons |
| `position_market.move` | Kiosk + `TransferPolicy<Position>` — tradeable positions (market-open rule) | `list_position`, `delist_position`, `buy_listed_position`, `take_and_claim` |

### 2.3 Trade Execution Infrastructure

Trading in Continuum allows users to express beliefs about continuous outcomes by purchasing YES or NO tokens at any strike price.

**Core Functions:** `buy_yes(market, payment, target_mag, target_neg)` and `buy_no(market, payment, target_mag, target_neg)`.

Each buy takes the full stake as a `Coin<T>` payment, sends a 1% fee to LPs, underwrites the position with the rest, folds the bet into the curve accumulators, and mints a fresh `Position` object to the buyer. Prices are computed against the **pre-update** curve.

**Execution Flow:**

![User who bets follows these steps](./images/BettorFlow.png)

**Position identity:** each `(strike, direction)` pair maps to a deterministic token id via `derive_token_id` (keccak256 of `market_id ‖ strike_mag ‖ sign ‖ is_yes`), used to track per-token liabilities; the buyer's stake itself is a distinct owned `Position` object.

### 2.4 Liquidity Provision Infrastructure

Liquidity providers in Continuum are pure collateral underwriters — they fund the pool that pays out winning bets, and earn trading fees in return.

**Core Functions:** `add_liquidity(market, payment)` and `remove_liquidity(market, shares_to_remove)`.

**Key Design: Curve-Neutral Deposits**

Unlike traditional AMMs where LP deposits affect the trading curve, Continuum LP deposits are **strictly curve-neutral** — `add_liquidity` never touches `mu`/`sigma` or the demand accumulators. LPs always provide at the current $\mu/\sigma$ and never shift the curve. Deposits and withdrawals settle any pending fees first, and removal is solvency-checked against free liquidity.

![Add and remove liquidity flow diagrams](./images/LiquidityFlow.png)

### 2.5 Fee Distribution Infrastructure

Continuum uses a **MasterChef-style fee accumulator** to distribute trading fees to LPs proportionally without requiring gas-intensive iteration.

**Mechanism:**

- Each trade's 1% fee updates a global accumulator: `acc_fee_per_share`
- Each LP's pending fees = `shares * acc_fee_per_share / WAD - reward_debt`
- On deposit, `reward_debt` is set so new LPs don't claim old fees
- On withdrawal or `claim_fees`, pending fees are calculated and transferred

This pattern provides O(1) fee distribution regardless of the number of LPs.

### 2.6 Market Resolution: Manual Two-Phase Timelock

Every market resolves against an externally-observed final price once its scheduled close `resolves_at` has passed (enforced via the shared `&Clock`). Continuum offers **three resolution paths**, and the settlement math (Section [2.9](#29-settlement-infrastructure)) is identical regardless of which one supplies `final_price`:

| Path | Section | Who can call | Best for |
|:-----|:--------|:-------------|:---------|
| **Manual two-phase / single-shot** | 2.6 (this section) | Market owner | Any market; fallback |
| **Pyth on-chain oracle** | [2.7](#27-trustless-on-chain-resolution-the-pyth-oracle) | Permissionless | Financial / price markets |
| **Multi-agent AI oracle** | [2.8](#28-decentralized-settlement-the-multi-agent-ai-oracle) | Backend keeper | News / sports / qualitative markets |

The manual path uses a **two-phase timelock** to provide a dispute window. Both manual entry points additionally require the scheduled close `resolves_at` to have passed, enforced via the shared `&Clock`.

**Flow:**

1. **Propose:** Owner calls `propose_resolution(price, &Clock)` — starts a 24-hour timer
2. **Wait:** Anyone can inspect the proposal during the 24h window; owner can `cancel_resolution`
3. **Execute:** After the timer expires, `execute_resolution(market, &Clock)` finalizes the market
4. The market's `market_resolved` flag is set, disabling further trading and liquidity operations

A single-shot `set_final_price(market, price_mag, price_neg, &Clock)` is also available to the owner for immediate resolution once `resolves_at` has passed.

### 2.7 Trustless On-Chain Resolution: The Pyth Oracle

Financial markets — anything tracking a price — settle **trustlessly and entirely on-chain** through the **Pyth Network** pull oracle on Sui. There is no trusted submitter: once a market has closed, *anyone* can finalize it by reading the bound price feed.

At creation, a market may carry an optional **immutable 32-byte `price_feed_id`** (`create_market(..., price_feed_id, ...)`; empty = a manual-only market). Because the feed id is fixed for the market's lifetime, the settlement source can never be swapped out from under open positions.

**The entry point — `resolve_with_pyth<T>(market, price_info_object, &Clock, ctx)` — is permissionless** and enforces three on-chain guards before it will write a price:

1. **Closed:** `now >= resolves_at`, else aborts `EMarketNotClosed`.
2. **Right feed:** the supplied `PriceInfoObject`'s on-chain identifier must equal the market's `price_feed_id`, else aborts `EWrongPriceFeed` — so a BTC market can't be settled against the ETH feed.
3. **Fresh:** the price is read with `pyth::get_price_no_older_than` (`MAX_PRICE_AGE_SECS = 60`), else it is rejected as stale.

When the guards pass, `pyth_price_to_fp` converts Pyth's signed `(price · 10^expo)` into the protocol's signed-WAD `final_price` and the market emits `MarketResolved`. Per-position settlement (`claim_winnings` / `release_losing_collateral`) is unchanged.

**Pull-oracle mechanics.** Pyth is a *pull* oracle, so the price feed must be refreshed in the **same transaction** that resolves the market. The backend keeper (`chainService.resolveWithPyth`) uses `@pythnetwork/pyth-sui-js` (`SuiPriceServiceConnection` → Hermes, then `SuiPythClient.updatePriceFeeds`) to build **one atomic PTB** that first calls `pyth::update_single_price_feed` and then `resolve_with_pyth`, guaranteeing the staleness check always sees a fresh price.

> **Testnet beta channel.** Sui **testnet** Pyth/Wormhole run a different Wormhole guardian set than mainnet, so updates must come from the **beta Hermes** (`https://hermes-beta.pyth.network`) and testnet feed ids differ from mainnet (e.g. testnet BTC/USD ≠ mainnet BTC/USD). The defaults (`HERMES_ENDPOINT`, `PYTH_FEED_IDS`) target beta accordingly.

![Pyth oracle — trustless on-chain settlement](./images/PythOracleFlow.png)

### 2.8 Decentralized Settlement: The Multi-Agent AI Oracle

Markets that **don't** track an on-chain price — news, sports, qualitative or open-ended questions — can be resolved by a **multi-agent LLM settlement oracle** that lives in the backend. It is a port of Kota, *Multi-Agent AI Oracle Systems for Prediction Market Resolution* ([arXiv:2605.30802](https://arxiv.org/pdf/2605.30802)), implementing the paper's winning **Architecture A (independent aggregation)** with **agreement-based escalation**. Deliberation/debate is deliberately *not* used — the paper shows it degrades accuracy by propagating persuasive errors.

The AI oracle only ever *drives* the existing manual on-chain entry point (`set_final_price`); the contracts are unchanged, and it is **gated off by default** (`ORACLE_ENABLED=false`). The deeper design rationale lives in [DESIGN.md §8](./docs/DESIGN.md#8-future-plans-an-ai-oracle-for-resolution).

**Pipeline (keeper-driven):**

1. **Scan.** A worker scans DB markets that are past `resolves_at`, not yet resolved on-chain, with no prior resolution attempt.
2. **Gather evidence.** `retrievalService` builds a single shared, date-constrained evidence packet via Groq's agentic `groq/compound-mini` (built-in web search).
3. **Independent ensemble.** One sub-agent per `ORACLE_MODELS` id runs **in parallel over the same evidence** on GroqCloud — the default is a cross-family set (`llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`) chosen to decorrelate errors. Each agent emits a scalar `{value, confidence}`.
4. **Aggregate.** `aggregationService` computes a **confidence-weighted aggregate** plus an agreement check: `compositeScore = 1[agreement] + meanConfidence`.
5. **Decide.**
   - Agents agree within tolerance **and** mean confidence ≥ `ORACLE_CONFIDENCE_THRESHOLD` (0.91) → **`AUTO_RESOLVED`**.
   - Otherwise → **`ESCALATED`** to human arbitration.
   - Zero usable estimates → **`FAILED`**.
6. **Submit.** When `ORACLE_AUTO_SUBMIT=true`, an `AUTO_RESOLVED` decision is signed on-chain via `set_final_price` (`ORACLE_SIGNER_KEY`, which must be the market owner) → **`SUBMITTED`**. The event poller then writes `Market.finalPrice` from `MarketResolved`, and positions settle per-position via `claim_winnings` as usual.

Because auto-resolution writes an irreversible price, the thresholds are strict and an uncertain oracle **degrades to the manual flow** rather than guessing.

![Multi-agent AI oracle — settlement](./images/AiOracleFlow.png)

### 2.9 Settlement Infrastructure

After resolution — by *any* of the three paths above — participants settle positions through a **pull-based claiming** model.

**For Winners:**

- `claim_winnings(market, position)` consumes a winning `Position` object
- A YES position at strike $X$ wins if `final_price >= X`; a NO position wins if `final_price < X`
- The position is consumed and USDC is paid out from the market's collateral vault (1 USDC/token)

**For Losing Positions:**

- `release_losing_collateral(market, target_mag, target_neg, is_yes)` — permissionless
- Frees LP collateral that was locked against a position that lost
- Returns the collateral to the available liquidity pool for LP withdrawal

### 2.10 Tradeable Positions: The Kiosk Secondary Market

Because every bet is an **owned `Position` object** (not an ERC-1155 balance entry), a holder can do something binary AMMs make awkward: **sell a belief before the market resolves**. Continuum exposes a secondary "belief market" for positions using **Sui Kiosk** + a shared **`TransferPolicy<Position>`**, all in `continuum::position_market`.

**Core functions:** `list_position`, `delist_position`, `buy_listed_position`, `take_and_claim`.

**Flow:**

1. **List.** The holder calls `list_position(kiosk, price)`, which places and locks the `Position` in their Kiosk. It is now **LISTED** at a USDC price — an open, on-chain secondary market for that exact strike/direction belief.
2. **(Optional) Delist.** The seller can `delist_position` at any time to pull the listing and return the `Position` to plain ownership.
3. **Buy.** A buyer calls `buy_listed_position`, paying the listed price in USDC. The Kiosk yields the `Position` **plus a `TransferRequest<Position>`** that must be resolved before ownership can transfer.
4. **The market-open rule.** Confirming that request requires satisfying the shared `TransferPolicy<Position>`, whose rule asserts the underlying **market is still OPEN** (not resolved). If the market has already resolved, the purchase **aborts** — you cannot trade a position whose outcome is already known. (After resolution you don't *trade* a position, you *claim* it.)
5. **Settle the trade.** With the rule satisfied, `confirm_request` lets ownership transfer atomically: the seller receives USDC and the buyer becomes the new owner of the `Position`.
6. **Claim at resolution.** Once the market resolves, the new owner uses `take_and_claim` to take the position out of the Kiosk and redeem winnings (1 USDC/token) in one step.

The `TransferPolicy<Position>` (and its `TransferPolicyCap`) are created at publish by `position_market::init`; the shared policy object is required to confirm any Kiosk purchase of a `Position`. This makes "tradeable only while the market is live" a **structural** guarantee rather than a runtime check sprinkled across call sites.

![Tradeable positions — Sui Kiosk workflow](./images/KioskFlow.png)

---

## 3. Features

- **Unified Continuous Liquidity:** One pool serves all strike prices — no liquidity fragmentation. Any continuous strike price gets an instant, mathematically derived price from the Gaussian CDF.

- **Demand-Responsive Curve:** $\mu$ and $\sigma$ are stake-weighted aggregates of all bets. The curve tracks collective market belief and requires capital at risk to move — manipulation-resistant by construction.

- **Curve-Neutral LP Deposits:** Liquidity providers are pure collateral underwriters. Their deposits never shift the curve, preventing free manipulation via liquidity.

- **On-Chain Gaussian Mathematics:** Full CDF/PDF computation on-chain using an Abramowitz & Stegun erf approximation, a Taylor-series exponential, and integer Newton's-method square root — all in 18-decimal signed fixed-point WAD arithmetic (~11 significant digits).

- **Shared-Object Markets:** Each market is a plain Sui shared `Market<T>` object — no proxies, no CREATE2, no delegatecall. Markets are created permissionlessly and discovered via a shared `Registry`.

- **MasterChef Fee Distribution:** Trading fees (1% per trade) distributed to LPs proportionally via a global accumulator — O(1) gas regardless of LP count.

- **Non-Transferable LP Positions:** LP shares live as `LpAccount` rows in a per-market `Table` keyed by address — there is no token to transfer, simplifying fee accounting by construction.

- **Two-Phase Resolution with Timelock:** 24-hour dispute window between proposal and execution, gated by a scheduled `resolves_at` close time and enforced with Sui's shared `Clock`.

- **Trustless Pyth Settlement:** Price markets settle permissionlessly on-chain via `resolve_with_pyth`, which reads a bound **Pyth Network** feed — no trusted submitter, with feed-id, close-time, and 60-second freshness guards.

- **Multi-Agent AI Oracle:** Non-price markets resolve via an independent LLM ensemble (Architecture A, confidence-weighted aggregation, agreement-based escalation) that auto-submits high-confidence results and escalates the rest to human arbitration.

- **Tradeable Positions (Kiosk):** Owned `Position` objects can be resold on a secondary belief market via Sui Kiosk; a `TransferPolicy<Position>` market-open rule structurally blocks trading a resolved position.

- **Generic Collateral:** `Market<phantom T>` works with any `Coin<T>` — mock USDC locally, real USDC on mainnet, with no token-address wiring.

- **Real-Time Backend:** Express 5 + Socket.io server polls the package's Move events and reads `Market<T>` object state via `@mysten/sui`, maintains a database via Prisma, and broadcasts live curve updates to connected frontends.

- **Quantitative Terminal UI:** React + Vite frontend with d3-powered Gaussian curve visualization and a "signal/noise" design aesthetic inspired by quantitative finance terminals.

---

## 4. Technical Overview

| Layer | Technology |
|-------|------------|
| Smart Contracts | **Sui Move** (`edition = 2024.beta`), Sui framework — one `continuum` package |
| Monorepo | pnpm workspaces (JS packages) + a standalone Move package |
| Backend API | Node.js, TypeScript, Express 5, Socket.io, `@mysten/sui` |
| Database | Prisma ORM (SQLite for local dev, PostgreSQL in production) |
| Indexer | Sui event poller (RPC polling of the package's Move events) |
| Frontend | React + TypeScript + Vite + Tailwind + d3 |
| Shared Types | TypeScript package with Move package/function references |
| Deployment | Sui testnet (`sui client publish`) |

## Deep dive: design, internals & roadmap

The in-depth material — the product roadmap, the module-by-module walkthrough of how
the Gaussian math maps to Move, Sui/Move engineering practices, and the planned
multi-agent AI oracle for resolution — lives in **[docs/DESIGN.md](./docs/DESIGN.md)**:

* [5. Product roadmap: from hackathon PoC to consumer trading platform](./docs/DESIGN.md#5-product-roadmap-from-hackathon-poc-to-consumer-trading-platform)
* [6. Module-by-module: math meets Move](./docs/DESIGN.md#6-module-by-module-math-meets-move)
* [7. Sui & Move ecosystem best practices](./docs/DESIGN.md#7-sui--move-ecosystem-best-practices)
* [8. Future plans: an AI oracle for resolution](./docs/DESIGN.md#8-future-plans-an-ai-oracle-for-resolution)


---

## 9. Getting Started

Follow these instructions to set up the project locally for development and testing.

### 9.1 Prerequisites

- **Sui CLI** ([install guide](https://docs.sui.io/guides/developer/getting-started/sui-install)) with a testnet environment configured
- **Node.js** (v18+) and **pnpm** for the monorepo
- **SQLite** (bundled; no setup) for local backend dev, or **PostgreSQL** for production

### 9.2 Installation

Clone the repository and install all workspace dependencies:

```bash
git clone <repository_url>
cd Continuum
pnpm install
```

### 9.3 Building Contracts

The contracts are a single Sui Move package, compiled and tested with the Sui CLI:

```bash
cd packages/contracts
sui move build          # compile all source modules
sui move test           # run unit (math) + full market-lifecycle tests

# or from the repo root:
pnpm build:contracts
pnpm test:contracts
```

### 9.4 Running the Backend

```bash
cd packages/backend
cp .env.example .env     # fill in PACKAGE_ID, REGISTRY_ID, COLLATERAL_TYPE
pnpm install
pnpm start               # db:push → db:seed (discovers markets from chain) → start:api on :3001
```

The seed discovers every market from `MarketCreated` events; the event poller then keeps μ/σ, liquidity, positions, and resolution state in sync. Required env: `SUI_RPC_URL`, `PACKAGE_ID`, `REGISTRY_ID`, `COLLATERAL_TYPE`.

### 9.5 Running the Frontend

```bash
# Start the Vite dev server
pnpm --filter @continuum/frontend dev
```

> **Note:** the frontend's wallet/transaction layer is still being migrated to Sui (`@mysten/dapp-kit` + `@mysten/sui`). It consumes the backend's REST + Socket.io API for market state.

---

## 10. Deployment

### Contract Deployment (Sui Testnet)

```bash
# 1. Ensure you have a funded testnet address
sui client active-address
sui client faucet          # or https://faucet.sui.io
sui client gas

# 2. Build and publish the package
cd packages/contracts
sui move build
sui client publish --gas-budget 200000000
```

`init` runs at publish: `market::init` shares the `Registry` and `position_market::init` shares the `TransferPolicy<Position>`. The protocol mints no collateral coin. From the publish output, record the **package ID**, the shared **`Registry` object ID**, and the shared **`TransferPolicy<Position>` id**.

```bash
# 3. Create a market so the backend has something to index (real testnet USDC)
USDC=0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC
sui client call --package $PACKAGE_ID --module market --function create_market \
  --type-args $USDC \
  --args $REGISTRY_ID "What will BTC be at end of 2026?" 100000000000000000 <resolves_at_ms> "0x" \
  --gas-budget 100000000
# (sigma_min_mag is WAD; resolves_at is a Clock ms timestamp, must be > 0; "0x" = no Pyth feed.)
```

### Deployed Objects (Sui Testnet)

| Object | Id |
|--------|----|
| Package | `0x2863e293480bbe7acaaea17839492ff4f887f4eca0008f8331ec3fc15b397b31` |
| Registry (shared) | `0xb17e6ec492a09bbff6f08fa74e950e3c4580e4ccf6bb11769f39acd38132bcdd` |
| TransferPolicy\<Position\> (shared) | `0x3f5a208082982f916c2c37ceb4403f8be0347f18fce5c240c1b8d2aa5aa2dd93` |
| Collateral type | `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` (testnet USDC) |

---


## 11. Project License

This project is licensed under the **MIT License**.

---

## 12. References

- **Gaussian Distribution (Normal Distribution):** [Wikipedia — Normal Distribution](https://en.wikipedia.org/wiki/Normal_distribution)
- **Abramowitz & Stegun Error Function Approximation:** Handbook of Mathematical Functions, Formula 7.1.26
- **Sui Documentation:** [Sui Docs](https://docs.sui.io/)
- **The Move Programming Language:** [Move Book](https://move-book.com/)
- **Sui Object Model:** [Object Ownership](https://docs.sui.io/concepts/object-ownership)
- **MasterChef Fee Distribution Pattern:** [SushiSwap MasterChef](https://docs.sushi.com/)
- **Distribution Market Design:** [Paradigm Distribution Market Research](https://www.paradigm.xyz/2024/12/distribution-markets)
- **Prediction Market Design:** [Paradigm PM-AMM Research](https://www.paradigm.xyz/2024/11/pm-amm)
- **Multi-Agent AI Oracle (planned resolution layer):** Tarun Kota, *Design and Evaluation of Multi-Agent AI Oracle Systems for Prediction Market Resolution* — [arXiv:2605.30802](https://arxiv.org/pdf/2605.30802)
- **Pyth Network (pull oracle on Sui):** [Pyth on Sui Docs](https://docs.pyth.network/price-feeds/use-real-time-data/sui)
- **Sui Kiosk & TransferPolicy:** [Sui Kiosk Docs](https://docs.sui.io/standards/kiosk)
