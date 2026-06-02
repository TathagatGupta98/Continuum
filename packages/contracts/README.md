# Continuum — Sui Move contracts

A Move port of the Continuum continuous-distribution prediction-market protocol,
originally written for Arbitrum Stylus (Rust/WASM). This package targets the
**Sui** blockchain for the SUI hackathon.

## Why the design changed

Sui has no EVM-style proxies, `msg.sender` storage mappings, or cross-contract
delegatecalls, so the four Stylus contracts collapse into **one Move package**:

| Stylus (EVM)                              | Sui Move                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `DistributionAmm` + `BinaryRouter` + `LpToken` + `ContinuumFactory` | one `market` module                       |
| EIP-1167 minimal-proxy clones per market  | each market is a shared `Market<T>` object           |
| ERC-1155 positions                        | owned `Position` objects                             |
| ERC-20 LP token (non-transferable)        | per-address `LpAccount` rows in a `Table`            |
| `IERC20` USDC custody                     | a `Balance<T>` vault; collateral is any `Coin<T>`    |
| `I256` 18-decimal WAD math                | `fixed_point::Fp` (signed magnitude over `u256`)     |
| Factory clone + registry                  | `create_market<T>` + a shared `Registry`             |

The economic model is unchanged: a single Gaussian curve prices every strike,
the curve is **demand-responsive** (bettors move μ/σ via stake-weighted
accumulators, liquidity providers never do), settlement is **pull-based against
a real-world final price**, and fees are distributed MasterChef-style.

## Modules

| File                  | Role                                                                 |
| --------------------- | ------------------------------------------------------------------- |
| `fixed_point.move`    | Signed WAD (1e18) fixed-point `Fp` over `u256`.                     |
| `gaussian.move`       | PDF / CDF / erf / exp / sqrt — port of `math_core.rs`.              |
| `market.move`         | `Registry`, `Market<T>`, `Position`, LP accounting, trading, settle.|
| `mock_usdc.move`      | 6-decimal test collateral coin + faucet.                            |

## Build & test

Requires the [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install).

```bash
cd packages/move
sui move build          # compile
sui move test           # run the unit + lifecycle tests
```

## Deploy (testnet)

```bash
sui client publish --gas-budget 200000000
```

Then drive it with PTBs / the TS SDK:

1. `market::create_market<USDC>(registry, title, sigma_min, resolves_at)` — anyone; shares a
   `Market<USDC>`. `resolves_at` is the mandatory scheduled close (`Clock` time, ms): the market
   cannot be resolved before it. Must be `> 0`.
2. `market::set_distribution(market, mu_mag, mu_neg, sigma_mag)` — owner, pre-trading; seeds the prior μ/σ.
   (Also pre-trading: `set_prior_weight`. `set_sigma_min` is owner-only but, like
   Stylus, may be retuned at any time.)
3. `market::add_liquidity(market, coin)` — deposit collateral, receive LP shares (curve-neutral).
4. `market::buy_yes / buy_no(market, coin, target_mag, target_neg)` — trade; mints a `Position`.
5. Resolve, either path — both refuse to start before the market's `resolves_at` (checked via
   `&Clock`):
   - immediate: `market::set_final_price(market, price_mag, price_neg, &Clock)` — owner records the outcome.
   - two-phase (24h timelock, Key Design Decision #5): `propose_resolution(…, &Clock)` →
     `execute_resolution(market, &Clock)`, with `cancel_resolution` during the window.
6. `market::claim_winnings(market, position)` — redeem a winning `Position` for collateral.
7. `market::release_losing_collateral(market, …)` — permissionless; frees LP capital from losing tokens.
8. Admin: `transfer_ownership`/`accept_ownership` (two-step), `claim_fees`, `remove_liquidity`, `sweep_dust`.

### Number encoding

All curve/price numbers are **signed WAD** passed as `(magnitude: u256, neg: bool)`.
e.g. μ = −2.5 → `mu_mag = 2_500_000_000_000_000_000`, `mu_neg = true`.
Collateral `Coin<T>` amounts are plain 6-decimal USDC units (`u64`); the module
scales them to WAD internally (`× 1e12`).

## Logic coverage vs. the Stylus contracts

Every behavioral function from the four Rust contracts is represented:

- **`math_core.rs`** → `fixed_point` + `gaussian` (pdf/cdf/erf/exp/sqrt, WAD ops,
  `safe_to_u256` → `fp::to_u256`).
- **`DistributionAmm`** → `set_distribution`, `set_prior_weight`, `set_sigma_min`,
  `add_liquidity`, `remove_liquidity`, `claim_fees`, `distribute_fee`,
  `underwrite_trade`, `recompute_curve`, `payout_winnings` (→ `claim_winnings`),
  `release_collateral` (→ `release_losing_collateral`), `propose/cancel/execute_resolution`
  (24h timelock via `Clock`), `sweep_dust`, two-step ownership, `get_price_for_x`.
- **`BinaryRouter`** → `buy_yes`/`buy_no`, `set_final_price`, `claim_winnings`,
  `release_losing_collateral`, `compute_token_id`, token-id derivation (keccak256).
- **`LpToken`** → per-address `LpAccount` rows (non-transferable by construction);
  `mint`/`burn` are `add_liquidity`/`remove_liquidity`; `totalSupply`/`balanceOf`
  are `total_shares`/`lp_balance`.
- **`ContinuumFactory`** → `create_market` + shared `Registry` with `market_count`
  / `get_market` / `market_exists` lookups and on-chain `title`.

### Dropped on purpose (EVM-only plumbing, no behavior)

- **EIP-1167 clone bytecode / CREATE2 salts** — markets are plain shared objects.
- **ERC-1155 / ERC-165 surface** (`safeTransferFrom`, `setApprovalForAll`,
  `supportsInterface`, `TransferSingle`) — positions are owned Sui objects that
  transfer natively.
- **Setter wiring** (`set_amm_address`, `set_router_address`, `set_lp_token`,
  `set_usdc_token`, implementation setters) — there is one object, and collateral
  is the generic type `T`, so there is nothing to wire.

Generic over the collateral coin `T`; instantiate with real USDC on testnet.
