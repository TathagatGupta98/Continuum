# Continuum — Design & Deep Dive

> This document holds the in-depth design rationale for Continuum: the product roadmap,
> the module-by-module walkthrough of how the Gaussian math maps to Move, Sui/Move
> engineering practices, and the forward-looking plans for an AI oracle.
>
> For the protocol overview, the core mathematical formulas, the architecture diagrams,
> and setup/deployment instructions, see the **[README](../README.md)**.

## Table of Contents

* [5. Product roadmap: from hackathon PoC to consumer trading platform](#5-product-roadmap-from-hackathon-poc-to-consumer-trading-platform)
* [6. Module-by-module: math meets Move](#6-module-by-module-math-meets-move)
* [7. Sui & Move ecosystem best practices](#7-sui--move-ecosystem-best-practices)
* [8. Future plans: an AI oracle for resolution](#8-future-plans-an-ai-oracle-for-resolution)
  * [8.1 The resolution pipeline](#81-the-resolution-pipeline)
  * [8.2 How it plugs into the existing contracts](#82-how-it-plugs-into-the-existing-contracts)

---

## 5. Product roadmap: from hackathon PoC to consumer trading platform

This section reframes Continuum as a long-term consumer product rather than a one-shot
hackathon submission — what's solid enough to build on today, and the roadmap for
turning a mathematically rigorous AMM into a trading experience people actually want to
use daily, including a forward bet on AI agents and agentic commerce as a primary
distribution channel for prediction markets.

### 5.1 What's live today

The hackathon build is a complete, working vertical slice — not a demo with mocked
pieces. Concretely, the following are implemented and deployed on Sui testnet:

- **The full Gaussian pricing engine on-chain** — `normal_cdf`, `erf`, `exp_wad`,
  `sqrt_wad`, all in signed fixed-point WAD arithmetic, unit-tested to ~11 significant
  digits against reference values (Sections 2-3).
- **Demand-responsive curve dynamics** — the stake-weighted μ/σ accumulator update,
  prior seeding, and pre-update pricing guarantee (Section 2.2, 3.3).
- **Per-strike positions as owned objects** — each `buy_*` mints a fresh `Position`
  object to the buyer; each `(strike, YES/NO)` pair gets a deterministic, keccak256-derived
  token id used for liability tracking. No enumeration of "markets" needed.
- **Curve-neutral liquidity provisioning** with MasterChef-style O(1) fee distribution
  to LPs, and non-transferable LP positions (per-address `LpAccount` rows in a `Table`)
  that keep `reward_debt` accounting sound.
- **A two-phase resolution timelock** (24h dispute window, gated by a scheduled
  `resolves_at` close time) plus pull-based claiming for both winners (`claim_winnings`)
  and LPs whose collateral was locked against losing positions (`release_losing_collateral`).
- **Permissionless market creation** — anyone can call `create_market<T>`, which shares a
  new `Market<T>` object and registers it in the shared `Registry`. No clone factory, no
  CREATE2 — markets are plain shared objects.
- **A real-time backend** — an Express/Socket.io server that polls the package's Move
  events via `@mysten/sui` and reads `Market<T>` object state, with Prisma persistence,
  feeding a React/d3 terminal UI showing the live curve.

In short: the *hard part* — getting rigorous, demand-responsive Gaussian pricing to run
cheaply and correctly on-chain — is done. Everything in 5.2 and 5.3 is about the layers
*around* that core: how people discover, enter, and exit positions, and who (or what)
places the trades.

### 5.2 Trading experience roadmap

The current trading flow (`buy_yes(market, payment, target_mag, target_neg)` / `buy_no(...)`,
manual `set_final_price`, pull-based claims) is correct but minimal — a power user's flow, not
a consumer one. Planned improvements, roughly in order of how directly they touch the
existing module:

- **Oracle-based resolution.** Replace the owner-set `set_final_price` with a Pyth/Switchboard
  price feed (both have first-class Sui support) or an optimistic-oracle integration. This is
  the single highest-priority change for trust — "the operator decides who wins" is acceptable
  for a hackathon PoC and unacceptable for a product handling real capital. The two-phase
  timelock (`propose_resolution` / `execute_resolution`) is already structured to slot an
  oracle read in place of the manual final price.
- **Limit and conditional orders.** Today every trade executes immediately at the
  current CDF price. A natural extension: an off-chain order book / intent layer where
  users specify "buy YES at strike $X if the implied price drops below $0.30," matched
  off-chain and settled through `buy_internal` only when the condition is met — similar
  to how many perp DEXs separate intent expression from on-chain execution. Sui's
  programmable transaction blocks (PTBs) make multi-step conditional settlement natural.
- **Multi-strike position management ("baskets").** Since every `(strike, direction)` is
  its own deterministic token id and each buy mints an independent `Position` object, a
  natural UX layer is letting a user express a *view on the shape of the distribution* —
  e.g. "I think the curve should be narrower than the market currently implies" — as a
  single PTB that buys/sells across several strikes in one transaction (a batching helper,
  not a math change).
- **Multi-asset collateral.** `Market<phantom T>` is already generic over the collateral
  coin type, so supporting additional collateral (other stables, or yield-bearing assets)
  is a matter of instantiating markets with a different `T` — and would let LPs earn baseline
  yield on idle `available_liquidity` between trades, a meaningful capital-efficiency unlock
  given that, structurally, most of the pool sits unused at any given strike.
- **Curve analytics and "market microstructure" tooling.** The frontend already plots
  μ/σ live; the roadmap extends this to historical curve replay, per-strike implied
  volatility (derivable from `normal_pdf`, which is implemented but currently unused —
  see Section 6.1), and slippage previews via `get_price` before a trade is signed.
- **Mobile-first redesign.** The current "quant terminal" aesthetic is intentionally
  power-user-facing. A consumer mobile app would foreground a small number of curated
  markets, simple "thermometer" visualizations of the current belief curve instead of
  raw Gaussian plots, push notifications on resolution and large curve moves, and
  one-tap position sizing.

### 5.3 AI agents and agentic commerce

This is the part of the roadmap that's less "finish the AMM" and more "rethink who the
AMM's counterparty is." A continuous, mathematically well-defined pricing curve — one
that returns a price for *any* strike via a single `normal_cdf` call — is unusually
well-suited to being queried and acted on by autonomous agents, for a simple reason:
agents need machine-readable, composable price functions, not "go look at an order book
and eyeball the spread." Continuum's `get_price(market, x, is_yes)` view is already exactly
that.

- **Natural-language trading agents.** A conversational interface ("I think ETH ends
  2026 between $4,000 and $6,000, put $50 on that") that decomposes a stated belief into
  a basket of `buy_yes`/`buy_no` calls across strikes — effectively letting a user
  express a *distribution* in plain language and having an agent translate it into the
  position basket from 5.2. This is a thin layer over existing Move calls plus an LLM
  that maps natural-language probability statements to (strike, stake) pairs, assembled
  into a single PTB.
- **Autonomous market-making / LP agents.** Because LP deposits are strictly
  curve-neutral (Section 2.2) and curve health is fully observable on-chain
  (`get_mu`, `get_sigma`, `available_liquidity`, `locked_collateral`), an agent
  could manage LP capital across *multiple* Continuum markets — entering/exiting based
  on fee accrual rate (`acc_fee_per_share`), pool utilization
  (`locked_collateral / (locked_collateral + available_liquidity)`), and `sigma_min`
  proximity (a market whose σ is pinned at the floor is signaling either very strong
  consensus or insufficient real activity) — without ever needing permission to move the
  curve, since LP deposits structurally can't.
- **Belief-aware portfolio agents.** An agent that holds a calibrated forecast for an
  underlying (e.g. from an external model or aggregated data) could continuously compare
  its own implied (μ, σ) against the market's current `get_mu`/`get_sigma` and
  size positions proportional to the *divergence* — essentially an automated "trade
  against the consensus when you have a better-calibrated prior" strategy, which is a
  natural fit for Continuum specifically because the market's belief is *itself* a
  Gaussian (μ, σ) that's directly comparable to an agent's own forecast distribution, not
  a discrete probability that needs reinterpretation.
- **Agent-to-agent settlement and agentic commerce rails.** As agent-native payment
  protocols mature, Continuum's pull-based claim model (`claim_winnings`,
  `release_losing_collateral`) is already permissionless and stateless enough to be called
  by an agent's wallet without any bespoke integration — and since a `Position` is just an
  owned Sui object, it can be held, transferred, or settled by an agent's address natively.
  The roadmap item here is less "change the contracts" and more "publish reference agent
  SDKs (TypeScript and Python) that build the PTBs for `buy_yes`/`buy_no`/`claim_winnings`
  so agent frameworks can integrate against Continuum as a standard primitive."
- **Agent-readable market metadata and discovery.** For agents to *find* relevant
  markets (not just trade ones they're told about), the backend's REST layer
  would expose a standardized, machine-readable schema describing each market's question,
  current (μ, σ), resolution criteria, and time-to-resolution — effectively an
  "llms.txt for prediction markets" that lets an agent enumerate tradeable beliefs across
  many Continuum markets (via the `Registry`) and reason about which ones are relevant to
  whatever task it's performing.

### 5.4 Sequencing and dependencies

Roughly: **oracle resolution** unblocks everything else, since no serious capital (human
or agent) should be staked against a manually-resolved market. **Multi-strike
baskets and `get_price`-based previews** are the shared infrastructure that both
the consumer UX (5.2) and the natural-language/portfolio agents (5.3) build on — so
basket-order PTBs are the highest-leverage near-term change. **Agent SDKs and metadata
schemas** can be built in parallel with the UX work since they consume the same read-only
surface (`get_mu`, `get_sigma`, `get_price`, `acc_fee_per_share`) that already exists today.

## 6. Module-by-module: math meets Move

### 6.1 `gaussian.move` — the numerical kernel

This module has zero contract state and zero external calls — it is pure functions over
`Fp` (the signed fixed-point type from `fixed_point.move`), which is exactly what makes it
cheap to call from `market.move` and trivial to unit-test with `sui move test`.

| Formula | Function | Notes |
|---|---|---|
| `mul(a,b) = a*b/1e18`, `div(a,b) = a*1e18/b` | `fixed_point::mul`, `fixed_point::div` | All other functions are built from these two; `div` returns `0` on divide-by-zero rather than aborting |
| `e^x = sum_{n} x^n/n!` | `exp_wad` | Iterative term update avoids recomputing `x^n` and `n!` from scratch each iteration; input clamped to a safe range to keep the series from overflowing `u256` |
| `erf(x) ~ 1 - poly(t)*e^{-x^2}`, `t = 1/(1+px)` | `erf` | Handles sign separately (`erf` is odd) so the polynomial only needs to be evaluated for `x >= 0` |
| `Phi(z) = (1 + erf(z/sqrt2))/2` | `normal_cdf` | Guards `sigma <= 0` up front — a degenerate distribution returns `0` rather than dividing by zero |
| `phi(z) = e^{-z^2/2} / (sigma*sqrt(2*pi))` | `normal_pdf` | Currently unused by the market module (which only needs the CDF for pricing) but exposed for potential future use (e.g. marginal-price / slippage estimates) |
| integer Newton's method `sqrt` | `sqrt_wad` | Used to derive σ from variance; returns `0` for non-positive inputs |

**A subtle but important design choice:** because Move has no native signed integer, all of
this math runs over `fixed_point::Fp { mag: u256, neg: bool }` — a signed-magnitude value
where zero is normalized to non-negative. The Gaussian math fundamentally needs signed
values (`x − μ` is routinely negative, and `erf` is an odd function), so a signed wrapper
over `u256` is the foundation everything else rests on. The `exp_wad` input clamp and the
unit-clamping inside `normal_cdf`/`normal_pdf` are the guardrails that keep intermediate
products inside `u256`'s range before they reach `mul`/`div`.

### 6.2 `market.move` — curve state, collateral, and the whole protocol

On Sui there is no AMM/Router/Factory split — `market.move` is the single module that owns
the three accumulators from Section 2.2 and is the *only* place `recompute_curve` is called
from. A `Market<T>` is a shared object; collateral lives in its `Balance<T>` vault.

**`set_distribution(market, mu_mag, mu_neg, sigma_mag, ctx)`** — owner-only, pre-trading.
Implements the prior-seeding identity directly:

```move
// prior weight backs the owner-seeded (mu0, sigma0) with virtual stake
let pw = market.prior_weight;                 // E[x^2] = mu^2 + sigma^2
let ex2 = fp::add(fp::mul(mu, mu), fp::mul(sigma, sigma));
market.acc_stake_weight = pw;
market.acc_weighted_x = fp::mul(pw, mu);      // Sw*x = pw * mu
market.acc_weighted_x_sq = fp::mul(pw, ex2);  // Sw*x^2 = pw * (mu^2 + sigma^2)
```

This is the exact `Σwx ← w_prior·μ₀`, `Σwx² ← w_prior·(μ₀²+σ₀²)` seeding from Section 2.2 —
reconstructing μ/σ from these three numbers via `recompute_curve` reproduces `(μ₀, σ₀)`
exactly, by construction. The function also guards `sigma <= sigma_min` (variance floor) and
`trades_started` (the prior can't be re-seeded once real bets exist — `set_prior_weight` has
the same guard).

**`recompute_curve`** (private, called at the end of every `underwrite`) is Section 2.2's
formulas verbatim:

```move
let mu = fp::div(market.acc_weighted_x, total_weight);        // mu = Swx / Sw
let ex2 = fp::div(market.acc_weighted_x_sq, total_weight);    // E[x^2] = Swx2 / Sw
let variance = fp::sub(ex2, fp::mul(mu, mu));                  // Var = E[x^2] - mu^2
let mut sigma = if (fp::is_neg(variance)) fp::zero()
                else gaussian::sqrt_wad(variance);
if (fp::lt(sigma, market.sigma_min)) sigma = market.sigma_min; // sigma floor
```

The variance-sign guard before calling `sqrt_wad` is necessary because fixed-point rounding
in `div`/`mul` can occasionally produce a `variance` that is a tiny negative number even when
the true variance is `~0` — `sqrt_wad` is only defined for non-negative inputs, so this avoids
feeding it a spurious negative and instead floors directly to `sigma_min`.

**`underwrite`** — the only function that updates the accumulators, and only when the bet's
net stake (weight) is positive:

```move
market.acc_stake_weight = fp::add(market.acc_stake_weight, weight);
market.acc_weighted_x = fp::add(market.acc_weighted_x, fp::mul(weight, target_x));
market.acc_weighted_x_sq = fp::add(market.acc_weighted_x_sq, fp::mul(weight, x_sq));
recompute_curve(market);
```

This is `Σw ← Σw + wᵢ`, `Σwx ← Σwx + wᵢ·xᵢ`, `Σwx² ← Σwx² + wᵢ·xᵢ²` — an O(1) running
update, no loop over historical bets. Note also the **collateral accounting** that happens in
the same call, independent of the curve math: `available_liquidity += premium - liability` and
`locked_collateral += liability`. This makes `underwrite` the single atomic point where "a bet
was placed" simultaneously (a) reserves the worst-case payout from the LP pool and (b) updates
the market's belief — a clean separation of *solvency* bookkeeping from *pricing* bookkeeping,
both inside one state transition.

**`get_price`** is the read-only mirror of the buy-path pricing logic — `1 - normal_cdf(x, μ, σ)`
for YES, `normal_cdf(x, μ, σ)` for NO — exposed as a public view so the frontend/backend can
preview prices for arbitrary strikes without simulating a trade.

**Fee distribution (`distribute_fee` / `claim_fees_internal`)** is the MasterChef pattern —
not Gaussian math, but worth noting because it's the other piece of "rigorous" accounting in
this module: `acc_fee_per_share += fee · 1e18 / total_shares`, and each LP's claimable amount
is `shares · acc_fee_per_share / 1e18 - reward_debt`. This is O(1) regardless of LP count, the
standard SushiSwap MasterChef trick. Because WAD accounting is exact and `Coin<T>` amounts are
6-decimal, the WAD→USDC conversion at claim time (`fp::mag(pending) / USDC_SCALE`) is the one
place rounding dust can appear — recovered by the owner via `sweep_dust`.

### 6.3 Trade execution — pricing and the pre-update guarantee

`buy_internal` is where Section 1.2's pricing formula is actually evaluated against live
state, and where the **pre-update pricing** guarantee from the README is enforced by *ordering
within a single function* — far simpler than the cross-contract call ordering this required
elsewhere:

```move
// 1. read the curve BEFORE this trade shifts it
let mu = market.mu;
let sigma = market.sigma;
let p_no = gaussian::normal_cdf(target_price, mu, sigma);
// 2. price off that pre-trade curve: P_YES = 1 - Phi(z), P_NO = Phi(z)
let price = if (is_yes) fp::sub(fp::wad(), p_no) else p_no;
// ...
// 3. THEN underwrite, which folds the bet into the accumulators and recomputes the curve
underwrite(market, token_id, target_price, net_stake, tokens_minted);
```

Because steps 1-2 (price computation) read `market.mu`/`market.sigma` *before* step 3
(`underwrite`, which triggers `recompute_curve`), a trader's own bet cannot retroactively
cheapen or inflate the price they pay — the price they see is the price the market had the
instant before their trade landed. On Sui this is just sequential reads-then-writes inside one
Move function; there is no cross-contract call to reason about.

**Token sizing** implements `tokens = net_stake / price` in WAD terms:

```move
let fee = stake / 100;                      // 1% fee
let net_stake = stake - fee;
let tokens_minted = fp::div(net_stake, price);   // tokens = net_stake / price
```

Because `price ∈ (0, 1]` (WAD), `tokens_minted >= net_stake` always — a token that costs $0.20
yields 5 tokens per $1 of net stake, each worth $1 if it wins, so the market's maximum liability
for this position is `tokens_minted · $1`, which is exactly the liability added in `underwrite`.
The `div`-by-zero guard (`div` returns `0`) is the backstop against the CDF ever returning exactly
zero (which would only happen at `z → -∞`, i.e. an absurdly extreme strike relative to sigma).

**Settlement** (`claim_winnings`) applies Section 1.4's rule directly — `final_price >= target_x`
for YES, `final_price < target_x` for NO — consumes the winning `Position` object, and pays exactly
`1 USDC` per WAD-token (`fp::mag(amount) / USDC_SCALE`). This is the $1-per-winning-token
normalization that complementarity (`P_YES + P_NO = 1`) was designed to support: every token,
regardless of its strike, redeems at the same fixed $1, so the market's total liability across all
strikes is just the sum of winning token supplies, independent of how spread out those strikes were.

**Token identity** (`derive_token_id`) is `keccak256(market_id ‖ target_x_mag ‖ sign ‖ is_yes)` —
a content-addressed id for the continuum of (strike, direction) pairs, used to track per-token
liabilities in a `Table<u256, Fp>`. This is the on-chain analogue of "infinite strikes, one pool":
there is no enumerable list of markets-within-the-market; any `(x, is_yes)` a trader chooses
deterministically hashes to its own id. The buyer's stake itself is returned as an owned `Position`
object, Sui's native replacement for a fungible position balance.

### 6.4 Market creation — shared objects instead of clones

This is the one piece of the system with no Gaussian math at all, and on Sui it is dramatically
simpler than the proxy-clone machinery it replaces. `create_market<T>` is **permissionless**: it
constructs a fresh `Market<T>`, initializes its vault and curve defaults, registers it in the
shared `Registry` (incrementing `market_count` and mapping `market_id → Market` object id), and
calls `transfer::share_object` to make it a shared object usable by anyone.

There is no factory bytecode, no CREATE2 salt derivation, no per-market proxy trio to wire
together, and no implementation/proxy split — adding a market is just allocating one more shared
object. Discovery, which the EVM build needed a factory registry for, is the `Registry`'s
`market_count` / `get_market` / `market_exists` views. Because `T` is a phantom type parameter,
the collateral coin is fixed at the type level — there is no token-address wiring step at all.

**Two-step ownership** (`transfer_ownership` + `accept_ownership`) is implemented with a
`pending_owner` field: the current owner nominates a successor, and the transfer only completes
when the nominee calls `accept_ownership`. This is the standard "Ownable2Step" safety pattern,
written directly in Move.

### 6.5 LP accounting — non-transferable by construction

There is no LP token contract at all. LP shares live as `LpAccount { shares, reward_debt }` rows
inside a `Table<address, LpAccount>` on the `Market<T>` object, keyed by the provider's address.
Section 1's manipulation-resistance argument depends on `add_liquidity`/`remove_liquidity` being
the *only* way LP share balances change (so that `claim_fees_internal`'s `reward_debt` bookkeeping
always sees a balance that moved only through deposit/withdraw) — and on Sui this is true *by
construction*: there is no token object representing a share, so there is nothing to transfer
between addresses. A buyer of "used" LP shares can't claim fees they didn't earn because no such
transfer can exist in the first place. This closes off the desync at the type level rather than
relying on a hardcoded `transfer → revert` in an ERC-20-shaped contract.

---

## 7. Sui & Move ecosystem best practices

Continuum's central pitch is "rigorous continuous-distribution pricing that's expensive or
awkward elsewhere becomes clean and cheap here." The codebase backs this up with several
concrete Sui/Move patterns worth calling out:

**Signed fixed-point over a `u256` magnitude.** Move has neither floating point nor a native
signed integer, but the Gaussian math fundamentally needs signed values. `fixed_point.move`
supplies `Fp { mag: u256, neg: bool }` with WAD (1e18) scaling and the full set of signed ops
(`add`, `sub`, `mul`, `div`, `neg`, `abs`, comparisons), with zero normalized to non-negative.
This is the same WAD convention used across DeFi, so the `mul`/`div` helpers are a familiar mental
model, while the arithmetic runs as native `u256` operations.

**The object model replaces four contracts.** Sui's object model lets a single `Market<T>` shared
object hold the vault, curve state, LP table, and liabilities together — eliminating the proxy
factory, the cross-contract `delegatecall` wiring, and the separate LP-token and router contracts
that a non-object chain would force. Positions are owned objects (native transfer, native
ownership), and LP shares are table rows (non-transferable for free). Less surface area, fewer
cross-contract trust edges, and no ABI to keep in sync between contracts.

**Generic collateral via a phantom type.** `Market<phantom T>` parameterizes the whole market over
its collateral coin type. Local and testnet markets use `mock_usdc::MOCK_USDC`; mainnet markets use
the real USDC coin type — with no token-address configuration and no risk of pointing a market at
the wrong ERC-20, because the type system fixes it.

**Pre-update pricing is just statement ordering.** The "price against the curve before the bet
shifts it" guarantee (Section 6.3) reduces, on Sui, to reading `market.mu`/`market.sigma` before
calling `underwrite` within one Move function — no read-only-vs-mutating cross-contract call
distinction to reason about. A reviewer can see the guarantee directly in the function body.

**Typed abort codes instead of raw-byte reverts.** Failure modes use named `const E* : u64`
abort codes (e.g. `ETimelockActive`, `EMarketNotClosed`) and `assert!(cond, E*)`. Callers and
indexers get a stable, decodable error number with no raw-bytes revert decoding — the Move VM
aborts cleanly and the transaction reverts atomically.

**Time and timelocks via the shared `Clock`.** The scheduled close (`resolves_at`) and the 24h
resolution dispute window are enforced by passing Sui's shared `&Clock` object into the resolution
entry functions and comparing against `clock::timestamp_ms`. No off-chain keeper or oracle is needed
for the *timing* of resolution — only the *final price* itself is owner-supplied, which the README is
upfront about as a hackathon simplification rather than a production design.

**`Balance<T>` for custody, `Coin<T>` at the edges.** The market holds collateral as a `Balance<T>`
(a storable, non-transferable value type) in its vault, and only converts to/from `Coin<T>` (the
owned, transferable object) at deposit and payout boundaries. This is the idiomatic Sui split between
internal value accounting and the user-facing coin object.

**Every field has a public view.** Unlike a proxy/getter setup where an indexer can be blocked by a
missing ABI export, every relevant `Market<T>` field is exposed through a `public fun` view
(`get_mu`, `get_sigma`, `get_price`, `vault_value`, `lp_balance`, `pending_fees`, …), plus the
`Registry` views — so the backend can reconstruct full market state from object reads alone.

## 8. Future plans: an AI oracle for resolution

Everything in Sections 6–7 is about getting *pricing* right and fully trustless on-chain.
The one piece Continuum still resolves **manually** is the *outcome* itself: today the
market owner calls `market::set_final_price(final_price, &Clock)` by hand (Section 1.4). That is an
honest hackathon simplification — and it is also the single highest-leverage thing to
remove before the protocol handles real capital. "The operator decides who wins" is
acceptable for a PoC and unacceptable for a product.

Our planned answer is **not** a single price feed and **not** a single large language
model, but a **multi-agent AI oracle**, following Kota, *Design and Evaluation of
Multi-Agent AI Oracle Systems for Prediction Market Resolution*
([arXiv:2605.30802](https://arxiv.org/pdf/2605.30802)). The paper's central observation is
that a lone model is a fragile oracle:

> "Single AI models are prone to hallucinations, sycophancy, and systematic biases that
> undermine oracle reliability."

The remedy is redundancy and disagreement *by design* — a panel of architecturally
diverse models that argue, vote with calibrated weights, and are explicitly allowed to
**decline** when they are not sure:

> "Multiple AI agents debate competing resolutions, exposing errors through adversarial
> discussion."

> "Agent predictions are aggregated using weighted voting schemes that account for
> confidence calibration."

> "Confidence thresholds enable oracles to abstain when uncertainty exceeds acceptable
> bounds."

The crux for Continuum is that this machinery has to produce exactly **one** thing: a
single `final_price` (plus a calibrated confidence), or an **abstention** that quietly
hands control back to the existing human-dispute path. The diversity, the debate, and the
weighted vote all exist to make that one number trustworthy — and the model *monoculture*
defense the paper stresses (uncorrelated architectures so failures don't line up) is what
keeps the panel from confidently agreeing on the same wrong answer.

### 8.1 The resolution pipeline

The paper's pipeline maps cleanly onto Continuum's settlement, because settlement only
ever needs that one output:

```
Question intake          market question + resolution criteria (off-chain metadata)
        │                normalized into a single resolvable prompt
        ▼
Evidence gathering   ┌─ each agent independently retrieves sources and
& verification       │  fact-checks them for credibility
        │            └─ "validate information credibility through fact-checking"
        ▼
Multi-agent          ┌─ α  β  γ  δ   ← architecturally diverse models
deliberation         │  └─ debate competing resolutions, surface each other's errors
(adversarial debate) └─ "expose errors through adversarial discussion"
        ▼
Consensus            ┌─ confidence-weighted vote over agent verdicts
aggregation          └─ → candidate final_price + aggregate confidence
        ▼
Confidence           ┌─ confidence ≥ τ ?  ── no ──▶ ABSTAIN (fall back to manual /
thresholding         │                              24h dispute window)
(selective abstain)  └─ yes ──▶ accept
        ▼
Resolution output ───▶ market::set_final_price(final_price, &Clock)
                       (then the existing per-position settlement of Section 1.4)
```

| Stage | Paper term | What it does | Continuum binding |
|:------|:-----------|:-------------|:------------------|
| 1 | Question intake | Turns the market's question + resolution criteria into one normalized prompt | Sourced from the off-chain market metadata (`title`, resolution rule) |
| 2 | Evidence gathering & verification | Each agent retrieves and credibility-checks sources independently | Off-chain; reduces single-source failure |
| 3 | Multi-agent deliberation | Diverse models debate competing resolutions, exposing each other's errors | The redundancy + monoculture defense layer |
| 4 | Consensus aggregation | Confidence-weighted vote → a single candidate `final_price` | Produces the one number settlement needs |
| 5 | Confidence thresholding | Abstain if aggregate confidence < τ; otherwise accept | Maps to "don't resolve, dispute instead" |
| 6 | Resolution output | Writes the accepted price on-chain | `market::set_final_price` → Section 1.4 payout rules |

### 8.2 How it plugs into the existing contracts

Crucially, this is a change *around* the module, not *to* the pricing core. The
two-phase resolution timelock (`propose_resolution` → 24h → `execute_resolution`,
Section 2.6) was deliberately built so an oracle read can slot in where the manual
final price is supplied today — the *timing* of resolution is already trustless
on-chain (enforced via the shared `Clock` and the `resolves_at` close), and only the
*final price* is owner-supplied. Three properties make the integration low-risk:

- **Settlement math is unchanged.** The oracle only ever supplies `final_price`; the
  per-position rule (`final_price ≥ X` for YES, `< X` for NO, Section 1.4) and the
  $1-per-winning-token payout stay exactly as they are. The AI never touches μ/σ or
  pricing — belief and settlement remain cleanly separated.
- **Abstention is a first-class outcome.** When the panel's aggregate confidence falls
  below the threshold, the oracle writes nothing and the market simply remains in its
  pre-resolution state, leaving the 24-hour timelock and human dispute path in control.
  An uncertain oracle degrades to today's manual flow rather than guessing.
- **The timelock *is* the dispute window.** Because `propose_resolution` already starts a
  24h timer that anyone can inspect and the owner can `cancel_resolution` during, an
  incorrect oracle resolution can be caught and cancelled before `execute_resolution`
  finalizes it — the same safety rail the paper's confidence thresholding is designed to
  complement.

The animated walkthrough of this exact pipeline lives in the frontend protocol docs
(`/docs`), where each stage of the paper's workflow is drawn and explained as you scroll.
