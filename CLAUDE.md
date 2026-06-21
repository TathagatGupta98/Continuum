# Continuum — Full Project Context

> **Migration status (updated 2026-06-20):** Continuum was originally built on **Arbitrum
> Stylus (Rust/WASM)** and has been ported to **Sui Move** for the **Sui Overflow** hackathon.
> The migration is **complete across all layers** — `packages/contracts` is a single Sui Move
> package (`continuum`), `packages/backend` reads `Market<T>` shared objects and polls the
> package's Move events via `@mysten/sui` (the viem/Goldsky path is gone), `packages/types`
> exports Move package/function references instead of EVM ABIs, and the **frontend is now on
> `@mysten/dapp-kit` + `@mysten/sui`** (PTBs replace ABI calls, owned `Position` / shared
> `Market<T>` objects replace ERC-1155 / proxy addresses, no ERC-20 approval step — the
> Wagmi/Viem/RainbowKit stack is gone). The package is **deployed and live on Sui testnet** and
> the backend and frontend are both wired to it. See `packages/frontend/CLAUDE.md` for the
> frontend architecture reference.
>
> **Live testnet deployment (Sui) — republished 2026-06-21** (this build adds the
> `position_market` module — Kiosk-based **tradeable positions** — so the package was
> redeployed; all ids below are the new instance, the pre-2026-06-21 ids are obsolete):
> - `PACKAGE_ID` = `0x024febde4e1e8e5d7a259ec836de90ebd596289e89a38c199cb7414f56f00200`
> - `REGISTRY_ID` (shared) = `0x3c585041337389132541ecee0c2d1425ad539e147d18ba1d34f768dd4f1c8cab`
> - `Market #0` (shared) = `0x7c17c24831ea92ec91389e61f5399c3005d9a1c511ceb76329e0a6b3825d7a09`
> - `TransferPolicy<Position>` (shared) = `0x80771b4652ad8cec31c94fc0237422890900227e18f69579400d28d5aeba8b74`
>   — created at publish by `position_market::init`, carries the market-open rule; required to
>   confirm a Kiosk purchase of a `Position`. Its `TransferPolicyCap` (owned by the deployer) =
>   `0x8e71a59e418b3c24c863aac1f98c253e44351208e11ff8555e53c03c0b7f54f8`.
> - `Publisher` (owned) = `0xed0c55a64ca5cc2fa319e4cad990a6b4a5d1e4346768a2408383f970e36350bf`;
>   `UpgradeCap` (owned) = `0xa75a5b2ba40f225597037916aaff01d98af790b53d1d19a32e89960cc9a976c4`.
> - `TreasuryCap<MOCK_USDC>` (owned) = `0xbffb37f5be5ff8081cd7d8024444618b8ae32014ad9f957761337d037b504620`
> - `COLLATERAL_TYPE` (default for new markets, updated 2026-06-21) =
>   `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` — Circle's
>   official testnet USDC (6 decimals, same as `MOCK_USDC`). Anyone can fund it via
>   faucet.circle.com or `sui client faucet --coin-type usdc`, no protocol-controlled
>   `TreasuryCap` mint required. `Market #0` above predates this switch and is permanently
>   pinned to `MOCK_USDC` (`T` is immutable per market); only markets created *after* this change
>   default to real testnet USDC. Per-market trading/LP/resolution always reads the market's own
>   `collateralType` from chain, so old and new markets coexist fine — only the
>   `create_market` default (frontend `useCreateMarket` / `COLLATERAL_TYPE` env) changed.
>
> **Backend env (Sui):** `SUI_RPC_URL`, `PACKAGE_ID`, `REGISTRY_ID`, `COLLATERAL_TYPE`
> (replaces the old `RPC_URL` + `FACTORY/AMM/ROUTER/USDC` addresses), plus the Pyth settlement
> ids `PYTH_STATE_ID` / `WORMHOLE_STATE_ID` / `HERMES_ENDPOINT` (testnet defaults baked in).
> Markets are keyed by the shared `Market<T>` **object id** (Prisma `Market.objectId`), not three
> EVM proxies; settlement is recorded as a per-position `finalPrice` (Prisma `Market.finalPrice`).
>
> **AI oracle (added 2026-06-20):** a **multi-agent LLM settlement oracle** now lives in the
> backend (`packages/backend/src/services/oracle/`), based on Kota, *Multi-Agent AI Oracle
> Systems for Prediction Market Resolution* (arXiv 2605.30802). It gathers a shared evidence
> packet, runs an **independent LLM ensemble** over it, **confidence-weighted aggregates**
> the result, and either **auto-submits `set_final_price`** on-chain or **escalates to human
> arbitration**. The ensemble runs over **GroqCloud** (via the `groq-sdk`) as a swarm of
> parallel sub-agents; `ORACLE_MODELS` defaults to a diverse Groq set
> (`llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`, `openai/gpt-oss-120b`,
> `openai/gpt-oss-20b`) for cross-model diversity, and retrieval uses Groq's agentic
> `groq/compound-mini` (built-in web search). It is **gated off by default**
> (`ORACLE_ENABLED=false`); see *AI Oracle (settlement layer)* below. This is the backend that
> *drives* the existing manual on-chain resolution entry points — the contracts are unchanged.
>
> **Pyth oracle (added 2026-06-20):** financial markets now settle **trustlessly on-chain** via a
> new Move entry point `market::resolve_with_pyth`, which reads a bound **Pyth Network** price feed
> (`PriceInfoObject`) on Sui — no trusted submitter. Markets carry an optional immutable 32-byte
> `price_feed_id` (set in `create_market`). The backend resolution keeper routes price-feed markets
> to Pyth and leaves non-price markets to the AI oracle. Move deps `Pyth` + `Wormhole` are added to
> `contracts/Move.toml`. See *Pyth oracle (on-chain settlement)* below. Unlike the AI oracle this
> **changes the contracts** (one new function + one field).

## What is Continuum?

Continuum is a **unified continuous distribution prediction market protocol**. Originally
built on Arbitrum Stylus, it now targets **Sui** (Move). The name comes from its core
innovation: instead of creating many separate binary "yes/no" prediction pools (like
Polymarket), Continuum collapses all possible outcomes into a **single continuous liquidity
curve** governed by a Gaussian (normal) probability density function.

### The Core Idea

Traditional prediction markets create discrete binary pools: "Will BTC hit $100k? Yes/No." Each price point needs its own pool, fragmenting liquidity. Continuum replaces this with a single pool where the **probability of any outcome is derived from the cumulative distribution function (CDF) of a Gaussian distribution**:

- **P_YES(x)** = 1 − CDF(x, μ, σ) — probability that the outcome exceeds strike price x
- **P_NO(x)** = CDF(x, μ, σ) — probability that the outcome is at or below strike price x

Where μ (mu) is the market's expected value (mean) and σ (sigma) is the market's uncertainty (standard deviation).

**μ/σ are demand-responsive: bettors move the curve, LPs do not.** The owner seeds an initial μ/σ (a prior), and from then on every bet folds into a **stake-weighted distribution of strike prices** — `μ = Σ(wᵢ·xᵢ)/Σwᵢ`, `σ = sqrt(E[x²] − μ²)` where each bet contributes weight `wᵢ` = its net stake at strike `xᵢ`. This means the curve reflects the *aggregate belief of the market*, and moving it always requires putting capital at risk on a position (manipulation-resistant). **Liquidity providers are pure collateral/underwriters: their deposits never shift μ/σ** — a belief input without directional risk would be a free manipulation lever, so it is disallowed by construction (LP deposits simply never touch the curve accumulators). See *Key Design Decisions* for the full rationale.

**Settlement is against the real world, not μ.** μ is the market's *belief*, not the boundary it settles on. A market resolves against an externally-observed final price (manual for this hackathon PoC — no oracle), set via `market::set_final_price` (or the two-phase `propose_resolution` → `execute_resolution`). Each YES position at strike X pays $1/token iff `final_price ≥ X`. Resolution can only begin once the market's scheduled close time (`resolves_at`, a `Clock` timestamp fixed at creation) has passed.

### Why it matters

1. **Unified liquidity**: One pool serves all strike prices, not N separate pools
2. **Continuous pricing**: Any strike price gets an instant, mathematically derived price
3. **Capital efficiency**: LPs provide liquidity once; it covers the full outcome space
4. **On-chain math**: The Gaussian CDF is computed entirely on-chain using fixed-point WAD arithmetic and an Abramowitz & Stegun error function approximation

---

## Technical Stack

| Layer | Technology |
|-------|------------|
| Smart Contracts | **Sui Move** (`edition = 2024.beta`), Sui framework (`framework/testnet`) — one `continuum` package |
| Monorepo | pnpm workspaces (JS packages) + a standalone Move package |
| Backend API | Node.js, TypeScript, Express 5, Socket.io, `@mysten/sui` |
| AI oracle | `groq-sdk` → **GroqCloud** — multi-agent LLM ensemble (Llama/GPT-OSS sub-agents) for settlement (arXiv 2605.30802) |
| Price oracle | **Pyth Network** pull oracle on Sui (`Pyth`/`Wormhole` Move deps; `@pythnetwork/pyth-sui-js` + Hermes) — trustless on-chain settlement for financial markets |
| Database | Prisma ORM (SQLite for local dev, PostgreSQL in production) |
| Indexer | Sui event poller — RPC polling of the package's Move events via `@mysten/sui` |
| Frontend | React + TypeScript + Vite + Tailwind + d3 — wallet/tx layer on `@mysten/dapp-kit` + `@mysten/sui` (PTBs) |
| Shared Types | TypeScript package — Move package/function references (EVM ABIs removed) |
| Deployment | Sui testnet (`sui client publish`) |

---

## Monorepo Structure

```
Continuum/
├── packages/
│   ├── contracts/          # Sui Move package — the `continuum` protocol
│   │   ├── sources/
│   │   │   ├── fixed_point.move   # Signed WAD (1e18) fixed-point `Fp` over u256
│   │   │   ├── gaussian.move      # PDF / CDF / erf / exp / sqrt (port of math_core.rs)
│   │   │   ├── market.move        # Registry, Market<T>, Position, LP, trading, settlement
│   │   │   ├── position_market.move # Kiosk + TransferPolicy<Position> — tradeable positions
│   │   │   └── mock_usdc.move     # 6-decimal test collateral coin + faucet
│   │   ├── tests/
│   │   │   └── continuum_tests.move  # Unit (math) + full market-lifecycle tests
│   │   ├── Move.toml              # Package manifest (name = "continuum")
│   │   ├── Move.lock              # Resolved dependency lock
│   │   └── README.md             # Move-package design + build/test + logic-coverage map
│   │
│   ├── backend/            # Node.js API & real-time server — Sui (@mysten/sui event poller)
│   ├── frontend/           # React + Vite app — Sui (@mysten/dapp-kit + @mysten/sui, PTBs)
│   └── types/              # Shared TS types — Move package/function references
│
├── docs/                   # Project docs / diagrams (README + DESIGN.md)
├── images/                 # README/branding assets
├── package.json            # Root workspace config (build:contracts / test:contracts via sui)
├── pnpm-workspace.yaml      # JS workspace members (backend, frontend, types)
└── tsconfig.json           # Root TS config with path aliases
```

> The Move package is **not** a pnpm workspace member (it has no `package.json`); it is built
> with the Sui CLI directly. Root scripts `pnpm build:contracts` / `pnpm test:contracts`
> shell into it.

---

## Smart Contract Architecture (Sui Move)

### Why the design collapsed from four contracts into one module

Sui has no EVM-style proxies, `msg.sender` storage mappings, or cross-contract
delegatecalls, so the four Stylus contracts collapse into **one Move package**:

| Stylus (EVM)                                                       | Sui Move                                            |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| `DistributionAmm` + `BinaryRouter` + `LpToken` + `ContinuumFactory` | one `continuum::market` module                    |
| EIP-1167 minimal-proxy clones per market                          | each market is a shared `Market<T>` object          |
| ERC-1155 positions                                                | owned `Position` objects (native transfer)          |
| ERC-20 LP token (non-transferable)                                | per-address `LpAccount` rows in a `Table`           |
| `IERC20` USDC custody                                             | a `Balance<T>` vault; collateral is any `Coin<T>`   |
| `I256` 18-decimal WAD math                                        | `fixed_point::Fp` (signed magnitude over `u256`)    |
| Factory clone + registry                                          | `create_market<T>` + a shared `Registry`            |

The economic model is **unchanged**: a single Gaussian curve prices every strike, the curve
is demand-responsive (bettors move μ/σ, LPs never do), settlement is pull-based against a
real-world final price, and fees are distributed MasterChef-style.

### Object model

- **`Registry`** (shared, created once in `init`) — factory + discovery. Counts markets and
  maps `market_id → Market` object address.
- **`Market<phantom T>`** (shared, one per market) — owns the collateral `Balance<T>` vault,
  the Gaussian curve params, LP accounting, per-token liabilities, and settlement state.
  `T` is the collateral coin type (real USDC on testnet, `mock_usdc::MOCK_USDC` locally).
- **`Position`** (owned, `has key, store`) — a YES/NO bet. Each `buy_*` mints a fresh
  `Position` to the buyer; `claim_winnings` consumes one. Replaces ERC-1155 balances.
- **`LpAccount`** (`has store`, lives in a `Table<address, LpAccount>` inside the market) —
  `{ shares, reward_debt }`. Keyed by address ⇒ LP positions are non-transferable by
  construction. MasterChef pending fees = `shares·acc_fee_per_share/WAD − reward_debt`.

### Build System

A single Sui Move package; no feature flags. Compile and test with the Sui CLI:

```bash
cd packages/contracts
sui move build          # compile all four source modules
sui move test           # run unit + lifecycle tests
```

---

## Module Details

### `continuum::market` (market.move)

The single module that plays the AMM, Router, LP-token, and Factory roles.

**Curve / number encoding.** All curve/price numbers are **signed WAD** passed as
`(magnitude: u256, neg: bool)` — e.g. μ = −2.5 → `mu_mag = 2_500_000_000_000_000_000`,
`mu_neg = true`. Collateral `Coin<T>` amounts are plain 6-decimal USDC units (`u64`); the
module scales them to WAD internally (`× 1e12`, constant `USDC_SCALE`).

**Key `Market<T>` fields** (signed WAD via `Fp` unless noted):
- `owner`, `pending_owner` — two-step ownership (mirrors the Stylus `pending_owner`).
- `market_id: u64`, `title: String`.
- `mu`, `sigma`, `sigma_min`, `prior_weight` — Gaussian curve + its prior backing.
- `acc_stake_weight` (Σwᵢ), `acc_weighted_x` (Σwᵢxᵢ), `acc_weighted_x_sq` (Σwᵢxᵢ²),
  `trades_started: bool` — demand-weighted curve accumulators; **only bettors touch these**.
- `available_liquidity`, `locked_collateral`, `acc_fee_per_share` — liquidity + fee accrual.
- `vault: Balance<T>` — all collateral custody.
- `total_shares: u256`, `lp_accounts: Table<address, LpAccount>` — LP bookkeeping.
- `token_liabilities: Table<u256, Fp>` — per-token-id encumbered collateral.
- `final_price`, `market_resolved: bool`, `resolves_at: u64` — settlement + scheduled close.
- `proposed_final_price`, `resolution_time: u64` — two-phase 24h timelock state.

**Entry / public functions:**
- `create_market<T>(registry, title, sigma_min_mag, resolves_at, price_feed_id, ctx)` —
  **permissionless**; shares a new `Market<T>`. `resolves_at` (ms, `Clock` time) is mandatory and
  must be `> 0`; it gates every resolution path and is fixed for the market's lifetime.
  `price_feed_id` is an optional 32-byte Pyth feed id (empty = manual-only market); when set the
  market can settle trustlessly via `resolve_with_pyth`. Both `resolves_at` and `price_feed_id`
  are fixed at creation so the settlement source can't be swapped under open positions.
- `transfer_ownership<T>` / `accept_ownership<T>` — two-step ownership transfer.
- `set_distribution<T>(market, mu_mag, mu_neg, sigma_mag, ctx)` — owner, pre-trading: seed the
  prior μ/σ and the stake-weighted accumulators with `prior_weight` of virtual stake.
- `set_prior_weight<T>(market, weight_mag, ctx)` — owner, pre-trading: tune prior stickiness.
- `set_sigma_min<T>(market, min_mag, ctx)` — owner; **not** gated on `trades_started` (matches
  Stylus): the σ floor can be retuned any time, applies on the next `recompute_curve`.
- `add_liquidity<T>(market, payment: Coin<T>, ctx)` — deposit collateral, receive LP shares.
  **Curve-neutral**: liquidity never moves μ/σ. Settles pending fees first.
- `remove_liquidity<T>(market, shares_to_remove, ctx)` — burn shares, withdraw collateral
  (solvency-checked against free liquidity).
- `claim_fees<T>(market, ctx)` — claim accrued trading fees for the caller.
- `buy_yes<T>` / `buy_no<T>(market, payment, target_mag, target_neg, ctx)` — trade; full stake
  in `payment`, 1% fee to LPs, rest underwrites the position and folds into the curve. Mints a
  `Position` to the sender. Prices against the **pre-update** curve.
- `set_final_price<T>(market, price_mag, price_neg, &Clock, ctx)` — owner, single-shot; records
  the real-world outcome. Requires `now ≥ resolves_at`.
- `propose_resolution` → `execute_resolution` (with `cancel_resolution`) — two-phase 24h
  timelock path; both honor `resolves_at` and the dispute window via `&Clock`.
- `resolve_with_pyth<T>(market, price_info_object, &Clock, ctx)` — **permissionless** trustless
  settlement for financial markets. Reads the market's bound Pyth `PriceInfoObject` (asserts its
  on-chain identifier matches `price_feed_id`), converts the Pyth price `(price · 10^expo)` to the
  signed-WAD `final_price`, and resolves — no trusted submitter. Requires `now ≥ resolves_at` and
  a fresh feed (`MAX_PRICE_AGE_SECS = 60`); Pyth being a *pull* oracle, the caller must refresh the
  feed (`pyth::update_single_price_feed`) in the same PTB. Internal helpers: `pyth_price_to_fp`
  (Pyth `Price` → `Fp`), `pyth_i64_magnitude`, `pow10`.
- `claim_winnings<T>(market, position, ctx)` — redeem a winning `Position` for collateral
  (1 USDC/token); consumes the object. YES wins iff `final_price ≥ strike`, NO iff `< strike`.
- `release_losing_collateral<T>(market, target_mag, target_neg, is_yes, ctx)` — permissionless;
  frees LP collateral locked by a losing token id.
- `sweep_dust<T>(market, ctx)` — owner recovers USDC rounding dust (floored above 1 USDC,
  capped at 10 USDC).

**Internal:** `buy_internal`, `distribute_fee`, `claim_fees_internal`, `underwrite`
(locks collateral + folds the bet into the accumulators), `recompute_curve`
(μ = Σwx/Σw, σ = sqrt(E[x²]−μ²) floored at `sigma_min`), `add_liability` / `reduce_liability`,
LP-table helpers, and `derive_token_id` (keccak256 of `market_id ‖ strike_mag ‖ sign ‖ is_yes`).

**Views (for indexers/frontend):** `get_mu`, `get_sigma`, `get_price`, `is_resolved`,
`final_price`, `resolves_at`, `market_id`, `owner`, `pending_owner`, `title`, `total_shares`,
`lp_balance`, `vault_value`, `sigma_min`, `prior_weight`, `acc_stake_weight`,
`acc_fee_per_share`, `available_liquidity`, `locked_collateral`, `trades_started`,
`resolution_time`, `reward_debt`, `pending_fees`, `compute_token_id`, `position_info`, plus
the registry views `market_count`, `get_market`, `market_exists`.

**Events:** `MarketCreated`, `CurveUpdated`, `LiquidityAdded`, `LiquidityRemoved`,
`TradeExecuted`, `FeeDistributed`, `MarketResolved`, `WinningsClaimed`.

### `continuum::fixed_point` (fixed_point.move)

Signed WAD (1e18) fixed-point `Fp { mag: u256, neg: bool }` (zero normalized to non-negative).
Sui Move has no native signed integer, and the Gaussian math needs signed values
(`x − mu` is often negative, `erf` is odd). Ops: `from`, `zero`, `wad`, `wad_u256`, `mag`,
`is_neg`, `is_zero`, `to_u256` (asserts non-negative), `neg`, `abs`, `add`, `sub`,
`mul` (WAD multiply `a·b/1e18`), `div` (WAD divide; ÷0 → 0), `div_int`, and comparisons
`eq/lt/gt/le/ge`.

### `continuum::gaussian` (gaussian.move)

On-chain Gaussian math, a direct port of the Stylus `math_core.rs`: `normal_pdf`, `normal_cdf`
(0..1 WAD), `erf` (Abramowitz & Stegun 5-coefficient approximation), `exp_wad` (Taylor series,
clamped), and `sqrt_wad` (used to derive σ from variance). All over `Fp`.

### `continuum::mock_usdc` (mock_usdc.move)

A minimal 6-decimal mock USDC for local testing and a concrete `T` to instantiate `Market<T>`.
`MOCK_USDC` one-time-witness + `coin::create_currency` (6 decimals); `mint` and entry-friendly
`faucet`. On testnet/mainnet, instantiate markets with the **real** USDC coin type instead.

---

## Typical lifecycle (PTBs / TS SDK)

1. `market::create_market<USDC>(registry, title, sigma_min, resolves_at, price_feed_id)` — anyone;
   shares a `Market<USDC>`. `resolves_at` is the mandatory scheduled close (`Clock` ms, `> 0`);
   `price_feed_id` is an optional 32-byte Pyth feed id (empty = manual market).
2. `market::set_distribution(market, mu_mag, mu_neg, sigma_mag)` — owner, pre-trading; seeds the
   prior μ/σ. (Also pre-trading: `set_prior_weight`. `set_sigma_min` retunable any time.)
3. `market::add_liquidity(market, coin)` — deposit collateral, receive LP shares (curve-neutral).
4. `market::buy_yes / buy_no(market, coin, target_mag, target_neg)` — trade; mints a `Position`.
5. Resolve (all paths refuse to start before `resolves_at`, checked via `&Clock`):
   - **Pyth (trustless, price markets):** refresh the bound feed then
     `market::resolve_with_pyth(market, price_info_object, &Clock)` — permissionless.
   - manual immediate: `market::set_final_price(market, price_mag, price_neg, &Clock)` — owner.
   - manual two-phase (24h timelock): `propose_resolution(…, &Clock)` → `execute_resolution(market,
     &Clock)`, with `cancel_resolution` during the window.
6. `market::claim_winnings(market, position)` — redeem a winning `Position` for collateral.
7. `market::release_losing_collateral(market, …)` — permissionless; frees LP capital.
8. Admin: `transfer_ownership`/`accept_ownership`, `claim_fees`, `remove_liquidity`, `sweep_dust`.

---

## Deployment (Sui)

The Move package is **deployed and live on Sui testnet** (IDs in the migration-status block at
the top of this file). To (re)deploy a fresh instance:

```bash
cd packages/contracts
sui move build
sui client publish --gas-budget 200000000
```

`init` runs at publish: it creates and shares the `Registry`, and (since `mock_usdc` is included)
mints the `TreasuryCap<MOCK_USDC>` to the publisher. After publishing, record the **package
ID** and the **`Registry` object ID**, and put them in `packages/backend/.env` (`PACKAGE_ID` /
`REGISTRY_ID`). For `COLLATERAL_TYPE`, prefer Circle's real testnet USDC type (see the
migration-status block) so any wallet can fund itself from a public faucet; only fall back to
the freshly-minted `mock_usdc::MOCK_USDC` (and its `TreasuryCap` object ID) for local testing
where you control the mint. Then create at least one market (`market::create_market<T>`) so the
backend seed has something to index. The current testnet IDs are already in the backend `.env`.

> **Legacy (Arbitrum Sepolia) addresses** for the old Stylus deployment live only in the git
> history now (they have been removed from the README and root config). They are **obsolete** for
> the Sui build — do not reference them in new code.

---

## Backend Architecture *(migrated to Sui — live)*

> The backend reads Sui objects/events via `@mysten/sui`. It is keyed off `PACKAGE_ID`,
> `REGISTRY_ID`, and `COLLATERAL_TYPE` (no viem, ABIs, Goldsky, or proxy addresses). On
> `pnpm start` it runs `db:push → db:seed → start:api`: the seed discovers every market from
> `MarketCreated` events, then the event poller keeps μ/σ, liquidity, positions, and resolution
> state in sync.

Single TypeScript stack — Express 5 + Socket.io + Prisma + `@mysten/sui`.

### REST API Routes
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server liveness check |
| GET | `/api/markets` | List all markets (`?category=&active=`) |
| GET | `/api/markets/:id` | Market detail + positions |
| PATCH | `/api/markets/:id/metadata` | Set off-chain title + category |
| GET | `/api/markets/:id/price?x=&direction=` | Price preview: `{pYes, pNo, grossCostWad, feeCostWad}` |
| GET | `/api/markets/:id/lp-stats?address=` | LP balance, accFeePerShare, pending rewards |
| POST | `/api/markets/:id/settle` | Owner-only: returns `winning_token_id` |
| GET | `/api/users/:address/portfolio` | All positions + current value for a wallet |
| GET | `/api/oracle/escalations` | AI-oracle human-arbitration queue (`ESCALATED` + `FAILED`) |
| GET | `/api/oracle/:marketId` | One market's oracle resolution (votes, evidence, score, status) |
| POST | `/api/oracle/:marketId/resolve` | Manually trigger / re-run the AI oracle pipeline |
| GET | `/api/docs` | OpenAPI-style JSON schema |

> The old `POST /api/webhooks/goldsky` route and the Goldsky HMAC middleware (EVM-indexer
> specific) have been dropped in favor of the Sui event poller.

### Socket.io Events
- Client emits `joinMarket(marketId)` → server emits current state from Prisma.
- Client emits `requestPrice({marketId, x, direction})` → server emits `priceUpdate` to that socket.
- Server broadcasts `marketStateUpdated` and `marketResolved` on every chain event.

### Services (Sui)
- **`chainService.ts`** — `@mysten/sui` client reading `Market<T>` object fields and polling the
  module's events (`CurveUpdated`, `LiquidityAdded/Removed`, `TradeExecuted`, `MarketResolved`).
- **`indexerService.ts`** — Sui event ingester (poller); reconciles DB state from chain events.
- **`mathService.ts`** — Gaussian CDF via jStat for off-chain price preview; the math is identical
  to `gaussian.move`.
- **`oracle/` (AI settlement oracle)** — `retrievalService.ts` (shared, date-constrained evidence via
  Groq's agentic `groq/compound-mini` web search; exports the shared `groqClient`), `resolverService.ts`
  (independent Groq ensemble — one sub-agent per `ORACLE_MODELS` id, JSON-object output with a balanced-`{…}` fallback parser),
  `aggregationService.ts` (confidence-weighted aggregate + agreement + escalation score),
  `oracleService.ts` (orchestrator + keeper worker — routes Pyth-bound markets to
  `resolveViaPyth`, others to the AI ensemble), `types.ts` (local copy of the shared oracle
  shapes). `chainService.ts` also gained the **signing path** (`submitFinalPrice`, `getResolvesAt`,
  `oracleSignerAddress`) and the **Pyth path** (`resolveWithPyth`, `getPriceFeedId`, via
  `@pythnetwork/pyth-sui-js`). See *AI Oracle (settlement layer)* and *Pyth oracle (on-chain
  settlement)*.

### Database (Prisma; SQLite local / PostgreSQL prod)
Models `User`, `Market`, `Position`, `OracleResolution` (+ `OracleStatus` enum) — the schema is
largely chain-agnostic. `Market.objectId` is the shared `Market<T>` object id (replacing the three
EVM proxy addresses); positions are Sui object ids; settlement is recorded as `Market.finalPrice`.
`OracleResolution` (one row per market, `Market.oracleResolution`) is the AI-oracle audit row:
`status`, `aggregatedValue`/`medianValue`, `meanConfidence`, `agreement`, `compositeScore`,
`agentVotesJson`, `evidenceJson`, `txDigest`.

### AI Oracle (settlement layer) *(added 2026-06-20)*
A multi-agent LLM oracle that derives a market's settlement value, ported from Kota,
*Multi-Agent AI Oracle Systems for Prediction Market Resolution* (arXiv 2605.30802). It implements
the paper's winning **Architecture A (independent aggregation)** and its **agreement-based
escalation** — deliberation/debate is deliberately *not* used (the paper shows it degrades accuracy
via persuasive error propagation).

**Locked design decisions:**
1. **Scalar estimation** — Continuum settles to one `finalPrice`, so each agent estimates the
   real-world value at `resolves_at` (signed, market units); the aggregate maps directly to
   `market::set_final_price`. (Not per-strike binary like the paper.)
2. **Groq sub-agent swarm** — the ensemble runs over GroqCloud (`groq-sdk`); each `ORACLE_MODELS`
   id is one sub-agent dispatched in parallel over the same evidence. The default is a cross-family
   Groq set (`llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`,
   `openai/gpt-oss-120b`, `openai/gpt-oss-20b`) chosen to decorrelate errors while clearing Groq's
   free-tier per-model TPM caps. The paper's caveat is that single-model / same-vendor ensembles have
   higher error correlation, so escalation thresholds are kept strict.
3. **Immediate `set_final_price`** on auto-resolve (no two-phase timelock) — irreversible, hence
   strict thresholds + the escalation safety net.

**Flow (keeper/poller-driven):** Sui emits no event when `resolves_at` is crossed, so a worker
(`startResolutionWorker`, off unless `ORACLE_ENABLED=true`) scans DB markets for ones past
`resolves_at`, not resolved on-chain, with no prior attempt → gather shared evidence → run the
ensemble in parallel → confidence-weighted aggregate → if agents agree within tolerance **and**
mean confidence ≥ `ORACLE_CONFIDENCE_THRESHOLD` (0.91) → `AUTO_RESOLVED`; else `ESCALATED` to a
human; zero usable estimates → `FAILED`. `compositeScore = 1[agreement] + meanConfidence`. When
`ORACLE_AUTO_SUBMIT=true`, an `AUTO_RESOLVED` decision is signed on-chain (`ORACLE_SIGNER_KEY`,
must be the market owner) → `SUBMITTED`; the event poller then writes `Market.finalPrice` from
`MarketResolved`, and bettor positions settle per-position via `claim_winnings` as usual.

**Env (all in `config.ts`/`.env`, oracle off by default):** `ORACLE_ENABLED`, `GROQ_API_KEY`,
`GROQ_BASE_URL` (optional; unset → groq-sdk default), `ORACLE_RETRIEVAL_MODEL` (default
`groq/compound-mini`, an agentic model with built-in web search), `ORACLE_MODELS` (default the
four-model Groq set above), `ORACLE_POLL_INTERVAL_MS`, `ORACLE_CONFIDENCE_THRESHOLD`,
`ORACLE_AGREEMENT_TOLERANCE`, `ORACLE_AUTO_SUBMIT`, `ORACLE_SIGNER_KEY`, `ORACLE_MAX_SOURCES`.

**Notes / constraints:** the resolver requests Groq's `response_format: { type: 'json_object' }`
(plain JSON mode, not a JSON schema) and parses the result with a balanced-`{…}` fallback, because
reasoning-style models can wrap/precede the object with prose even under JSON mode. Retrieval reads
the search hits Groq's compound system exposes under `message.executed_tools` to build the evidence
sources. The heavier `groq/compound` retrieval model injects full fetched pages and can exceed the
free-tier per-request token cap, so `groq/compound-mini` is the default; likewise low-TPM models
(e.g. `qwen/*`, `llama-3.1-8b-instant`) can 413 on a full evidence packet under the free tier — a
per-agent failure the aggregator tolerates (it drops the vote, quorum is ≥2). Oracle types are mirrored in `packages/types` but the backend uses a
**local `oracle/types.ts`** because its tsconfig `rootDir: ./src` rejects cross-package source
imports (TS6059). Still TODO: a KalshiBench-style eval harness to calibrate thresholds, and a live
end-to-end run.

### Pyth oracle (on-chain settlement) *(added 2026-06-20)*
A **trustless, on-chain** settlement path for financial markets, using the **Pyth Network** pull
oracle on Sui. This is a Move-level change (one new entry function), not a new service: it closes
the "no on-chain oracle" gap directly in the resolution path. Pyth handles price markets; the AI
oracle is the layer for non-price markets (news, sports, …).

**Contracts (`market.move`).** Markets carry an optional immutable 32-byte `price_feed_id` (set in
`create_market`, empty = manual market). `resolve_with_pyth<T>(market, price_info_object, &Clock,
ctx)` is **permissionless**: once `resolves_at` has passed, anyone may settle by reading the bound
Pyth feed — it asserts the supplied `PriceInfoObject`'s on-chain identifier equals `price_feed_id`
(so BTC can't be settled against the ETH feed), reads a fresh price
(`pyth::get_price_no_older_than`, `MAX_PRICE_AGE_SECS = 60`), converts Pyth's signed
`(price · 10^expo)` to the signed-WAD `final_price` (`pyth_price_to_fp`), and emits `MarketResolved`.
Per-position settlement (`claim_winnings` / `release_losing_collateral`) is unchanged. Move deps:
`Pyth` (`sui-contract-testnet`) + `Wormhole` (`sui/testnet`) in `Move.toml`, with `override = true`
on the Sui framework dep so all three share one framework rev. Unit tests cover the price→WAD
conversion (`pyth_price_to_fp_for_testing`) for positive and negative prices.

**Backend.** `chainService.resolveWithPyth({objectId, collateralType, feedId})` uses
`@pythnetwork/pyth-sui-js` (`SuiPriceServiceConnection` → Hermes, `SuiPythClient.updatePriceFeeds`)
to build one PTB that refreshes the feed *and* calls `resolve_with_pyth` atomically (so the
staleness check always passes); `getPriceFeedId(objectId)` reads the bound feed. The resolution
keeper (`oracleService.scanOnce`) routes each closed market by settlement source: a market with a
`price_feed_id` → `resolveViaPyth` (records a `SUBMITTED`/`FAILED` `OracleResolution` audit row,
`agentVotesJson = [{model:'pyth-network', feedId}]`); otherwise → the AI ensemble. The keeper now
starts when `ORACLE_ENABLED` **or** Pyth is active (`PYTH_RESOLUTION_ENABLED` + `ORACLE_SIGNER_KEY`,
which signs gas for the permissionless call). Env (`config.ts`): `PYTH_RESOLUTION_ENABLED` (default
true), `PYTH_STATE_ID`, `WORMHOLE_STATE_ID`, `HERMES_ENDPOINT` (testnet defaults baked in).

> **Dependency note:** `@pythnetwork/pyth-sui-js` bundles `@mysten/sui ^1.3.0`, which pnpm resolved
> to a *separate* copy (1.38.0) from the backend's 1.45.2 — causing `Transaction`/`SuiClient`
> type-identity errors. Fixed with a scoped root `pnpm.overrides` entry
> (`@pythnetwork/pyth-sui-js>@mysten/sui: 1.45.2`) so the SDK shares the backend's version; the
> frontend's dapp-kit-pinned 1.38.0 is untouched.

**Shared types / frontend.** `packages/types` exports `PYTH_TESTNET` / `PYTH_MAINNET` configs,
`PYTH_FEED_IDS` (**beta/testnet** ids — what the live deployment uses) and `PYTH_FEED_IDS_MAINNET`.
`useCreateMarket` takes an optional `priceFeedId`; the `CreateMarketModal` has a "Pyth Price Feed"
dropdown that binds a feed at creation.

> **Beta channel (testnet) — critical.** Sui **testnet** Pyth/Wormhole run a *different Wormhole
> guardian set* than mainnet, so price updates must come from the **beta Hermes**
> (`https://hermes-beta.pyth.network`), and testnet feed ids **differ from mainnet** (e.g. testnet
> BTC/USD = `0xf9c0172b…ea31b`, not the mainnet `0xe62df6c8…415b43`). Using the mainnet Hermes on
> testnet aborts in Wormhole VAA verification (`dynamic_field::borrow_child_object`, guardian-set
> lookup). `HERMES_ENDPOINT` + `PYTH_FEED_IDS` default to beta accordingly; a mainnet deployment
> must switch both to the mainnet values.

**Verified end-to-end on testnet (2026-06-20).** `resolve_with_pyth` settled live BTC/USD on-chain
twice: via the SDK directly (final_price ≈ $63,761.99, tx `9x8tvNTW…`) and via the **shipped backend
code path** `chainService.resolveWithPyth` (final_price ≈ $63,779.06, tx `CBy9CYff…`). The keeper is
wired (`ORACLE_SIGNER_KEY` set to the owner key) so price markets auto-settle after close.

**Still TODO:** a frontend "Resolve via Pyth" button (the backend keeper covers automated
settlement today).

---

## Known Issues & Gaps

### Migration status (Sui)
- **Migration complete across all layers.** Contracts, backend/indexer, shared types, **and the
  frontend** are on Sui; the package is deployed to testnet and both backend and frontend are
  wired to it. The frontend wallet/tx layer is `@mysten/dapp-kit` + `@mysten/sui` (PTBs for
  `buy_yes`/`buy_no`/`add_liquidity`/`create_market`, object-ID-based reads via `SuiClient`); the
  old EVM ABI imports in `packages/frontend/src/config/contracts.ts` are gone. See
  `packages/frontend/CLAUDE.md` for the frontend architecture reference.

### Carried over from the protocol design (not bugs in the Move port)
- **No slippage protection**: trades have no max-cost parameter.
- **1% fee hardcoded**: no governance or per-market configuration.
- **Oracle integration**: now two layers. **Financial markets settle trustlessly on-chain** via
  `market::resolve_with_pyth`, which reads a bound **Pyth** price feed (no trusted submitter) — see
  *Pyth oracle (on-chain settlement)*. **Non-price markets** (news, sports, …) still resolve
  through the manual `set_final_price` / two-phase entry points, optionally driven off-chain by the
  multi-agent **AI oracle** (see *AI Oracle (settlement layer)*; gated off by default, escalates
  low-confidence / split cases to human arbitration). The backend resolution keeper routes each
  closed market by settlement source: Pyth-bound → `resolve_with_pyth`, otherwise → AI oracle.
- **Manual title metadata**: `MarketCreated` carries the on-chain `title`, but any richer
  off-chain metadata (category, description) is still DB-side.

### Improvements the Move port already bakes in vs. the old Stylus binary
- **`claim_fees` WAD→USDC conversion** is correct in Move (`fp::mag(pending) / USDC_SCALE`).
- **No raw-byte revert decoding needed** — Move uses typed `abort` codes (see the `E*` consts
  in `market.move`; e.g. `ETimelockActive = 17`, `EMarketNotClosed = 18`, `ENoPriceFeed = 20`,
  `EWrongPriceFeed = 21`).
- **No proxy/getter gaps** — every field has a public view; nothing is hidden behind a missing
  ABI export.

---

## Development Commands

```bash
# Workspace (JS packages: backend, frontend, types)
pnpm install

# Contracts (Sui Move) — requires the Sui CLI
#   https://docs.sui.io/guides/developer/getting-started/sui-install
pnpm build:contracts          # = cd packages/contracts && sui move build
pnpm test:contracts           # = cd packages/contracts && sui move test
# or directly:
cd packages/contracts && sui move build
cd packages/contracts && sui move test

# Publish to the active Sui env (testnet)
cd packages/contracts && sui client publish --gas-budget 200000000

# Backend (Sui — live)
pnpm --filter @continuum/backend start             # db:push → db:seed → start:api (port 3001)
pnpm --filter @continuum/backend start:api         # Express server only (port 3001)
pnpm --filter @continuum/backend db:seed           # Seed DB (discovers markets from chain)

# Frontend (Sui — @mysten/dapp-kit + @mysten/sui)
pnpm --filter @continuum/frontend dev              # Vite dev server (port 5173)
pnpm --filter @continuum/frontend build            # tsc + vite build
```

---

## Key Design Decisions

1. **Gaussian CDF for pricing**: probability = area under the Gaussian curve, computed on-chain
   via an Abramowitz & Stegun erf approximation with a Taylor-series exponential
   (`continuum::gaussian`). Same algorithm as the Stylus `math_core.rs`.

2. **Demand-responsive curve (bettors only)**: μ/σ are a stake-weighted distribution of strike
   prices. The owner seeds an initial μ/σ (held with `prior_weight` of virtual stake); every bet
   contributes `(weight = net stake, x = strike)` to running accumulators, and `recompute_curve`
   derives `μ = Σwx/Σw`, `σ = sqrt(E[x²]−μ²)` (floored at `sigma_min`). Moving the curve always
   requires capital at risk — manipulation-resistant by construction. **LPs cannot move the
   curve**: `add_liquidity` is curve-neutral. Pricing is *pre-update* (the bet is priced against
   the curve before it shifts it). `trades_started` locks `set_distribution`/`set_prior_weight`
   once trading begins.

3. **MasterChef-style fee distribution**: trading fees accrue to LPs via a global accumulator;
   each LP's pending fees = `shares · acc_fee_per_share / WAD − reward_debt`.

4. **Non-transferable LP positions** — by construction on Sui: `LpAccount` rows live in a
   `Table` keyed by address, so there is no token to transfer (no ERC-20 surface to disable).

5. **Two-phase resolution with timelock**: `propose_resolution` starts a 24h `Clock` window →
   `execute_resolution` after it elapses; `cancel_resolution` aborts during the window. Both the
   immediate and two-phase paths additionally require the scheduled close `resolves_at` to have
   passed (`EMarketNotClosed`). Timelock and close are enforced with the shared `&Clock`.

6. **WIN/LOSE is the real-world price, per position — not μ**: `set_final_price` records an
   externally-observed outcome (manual; no oracle). Each `Position` is judged against **its own
   strike**: YES wins iff `final_price ≥ X`, NO wins iff `final_price < X`. μ is only belief, so
   a bet that drags μ cannot change who wins.

7. **USDC (6 decimals) vs WAD (18 decimals)**: internal accounting is WAD (1e18) via `Fp`;
   `Coin<T>` amounts are 6-decimal units scaled by `USDC_SCALE` (1e12). `sweep_dust` recovers
   rounding remainders.

8. **Markets are shared objects, not proxies**: each `Market<T>` is a plain Sui shared object —
   no EIP-1167 clones, no CREATE2, no delegatecall. Discovery is via the shared `Registry`
   (`market_count` / `get_market` / `market_exists`). Collateral is the generic type `T`, so
   there is no token-address wiring to do.

9. **Generic collateral**: `Market<phantom T>` works with any `Coin<T>`. The frontend/backend
   default (`COLLATERAL_TYPE`) is Circle's real testnet USDC so anyone can fund a wallet from a
   public faucet; `mock_usdc::MOCK_USDC` remains available (and still backs `Market #0`) for
   local testing where a protocol-controlled mint is preferable.
