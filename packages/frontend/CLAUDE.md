# Continuum Frontend — Architecture Reference

This is the React + TypeScript frontend for Continuum (formerly OmniCurve), a Gaussian
continuous-distribution prediction-market protocol on **Sui**. The frontend connects to the
backend API (port 3001), a Socket.io real-time feed, and the published `continuum` Move
package on Sui testnet via **`@mysten/dapp-kit` + `@mysten/sui`**.

> **Migrated from EVM.** This app was originally built on Arbitrum Sepolia with
> Wagmi/Viem/RainbowKit. The wallet + transaction layer is now Sui: PTBs (programmable
> transaction blocks) replace ABI contract calls, owned `Position` / shared `Market<T>`
> objects replace ERC-1155 / proxy addresses, and there is **no ERC-20 approval step**.
> Anything referencing AMM/Router/LP proxy addresses, `approve`, gas-fee overrides, or
> Arbiscan in older notes is obsolete.

---

## Aesthetic Direction: "Signal / Noise"

A quantitative finance terminal where probability is a measurable signal. The Gaussian curve
is never decoration — it *is* the UI. Think oscilloscope readouts crossed with a research
terminal.

### Design Tokens (CSS Variables in `src/styles/globals.css`)

```css
--bg-base:        #060810;     /* deep cosmic blue-black */
--bg-surface:     rgba(255,255,255,0.04);
--bg-surface-2:   rgba(255,255,255,0.07);
--border:         rgba(255,255,255,0.08);
--text-primary:   #E2DDD4;     /* warm off-white */
--text-muted:     rgba(226,221,212,0.45);
--accent-yes:     #22D3A3;     /* teal-mint — YES / above-threshold */
--accent-no:      #FF4560;     /* signal red — NO / below-threshold */
--accent-data:    #FFB800;     /* amber — prices, key numbers */
--accent-data-dim: rgba(255,184,0,0.15);
--grid-line:      rgba(255,255,255,0.04); /* graph-paper background */
```

### Typography

Loaded from Google Fonts in `index.html`:
- `Syne` (400, 600, 700, 800) — display, headings, nav
- `JetBrains Mono` (400, 500) — ALL numbers, prices, addresses, percentages
- `DM Serif Text` (400, italic) — body copy, descriptions

**Rule:** Every numeric value rendered in the UI uses `JetBrains Mono`. Never a sans-serif
font for data.

### Background Texture

Faint graph-paper grid via CSS `background-image` on `body`:
```css
background-image:
  linear-gradient(var(--grid-line) 1px, transparent 1px),
  linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
background-size: 40px 40px;
```

---

## Tech Stack

| Package | Purpose |
|---|---|
| `vite` + `@vitejs/plugin-react` | Build tool |
| `react` + `react-dom` (v18) | UI framework |
| `react-router-dom` v6 | Routing |
| `@mysten/dapp-kit` | Wallet connect UI + React hooks (sign/execute, accounts) |
| `@mysten/sui` | `SuiClient`, `Transaction` (PTB) builder, coin intents, BCS |
| `@tanstack/react-query` v5 | Server-state caching (also required by dapp-kit) |
| `socket.io-client` v4 | Real-time from backend |
| `d3` v7 | Gaussian curve SVG math + rendering |
| `framer-motion` v11 | All animations |
| `react-hook-form` v7 + `zod` v3 | Form validation |
| `tailwindcss` v3 | Styling |
| `clsx` + `tailwind-merge` | Conditional class utilities |

> **Version pin:** `@mysten/sui` is pinned to the exact version `@mysten/dapp-kit` bundles
> (currently `1.38.0`). A mismatch makes the two packages resolve *different* `Transaction`
> classes and TypeScript rejects passing a PTB to `useSignAndExecuteTransaction`. Keep them in
> lockstep when bumping either.

---

## Directory Structure

```
packages/frontend/
├── CLAUDE.md
├── package.json
├── vite.config.ts          ← proxy /api/* and /socket.io/* to localhost:3001
├── tsconfig.json
├── tailwind.config.ts      ← design tokens wired to CSS variables
├── postcss.config.js
├── index.html              ← Google Fonts imports
└── src/
    ├── main.tsx            ← Providers: QueryClient → SuiClient → Wallet → Router
    ├── App.tsx             ← React Router routes
    ├── config/
    │   ├── sui.ts          ← networkConfig + explorerUrl (SuiVision)
    │   └── contracts.ts    ← PACKAGE_ID / REGISTRY_ID / COLLATERAL_TYPE / CLOCK_ID + target()
    ├── lib/
    │   ├── api.ts          ← typed REST client
    │   ├── sui.ts          ← shared read-only SuiClient + Market object readers
    │   ├── socket.ts       ← singleton Socket.io client
    │   ├── errors.ts       ← Move abort-code → friendly copy
    │   └── math.ts         ← client-side Gaussian CDF + WAD helpers
    ├── hooks/
    │   ├── useMarkets.ts        useMarket.ts        useMarketSocket.ts
    │   ├── usePriceSocket.ts    usePortfolio.ts     useLiveRefetch.ts
    │   ├── useSpotPrice.ts      useTheme.ts
    │   ├── useTrade.ts          useLP.ts            useCreateMarket.ts
    ├── components/
    │   ├── layout/   { Navbar, PageWrapper }
    │   ├── ui/       { Button, Input, Slider, Badge, Modal, Tooltip, Toast, Tabs, … }
    │   ├── wallet/   { ConnectButton }       ← dapp-kit ConnectModal
    │   └── market/   { GaussianChart, MarketCard, StrikeSlider, StakerPanel, LPPanel,
    │                   CreateMarketModal }
    ├── pages/        { Landing, Marketplace, MarketDetail, UserDashboard, Docs }
    └── styles/globals.css
```

---

## Config & Infrastructure

### `src/config/contracts.ts`

On Sui there are **no ABIs** — callers build PTBs against fully-qualified
`package::module::function` targets and read shared objects by id. Values come from env (with
the live testnet deployment as fallback) so a redeploy only changes env:

```ts
export const PACKAGE_ID     // VITE_PACKAGE_ID
export const REGISTRY_ID    // VITE_REGISTRY_ID — the shared continuum::market::Registry
export const COLLATERAL_TYPE// VITE_COLLATERAL_TYPE — the coin type T (mock_usdc::MOCK_USDC)
export const CLOCK_ID = '0x6' // shared Clock, required by every resolution entry function
export const target = (name) => `${PACKAGE_ID}::market::${name}` // Move-call target builder
```

`marketTarget` / `MARKET_FUNCTIONS` / `MARKET_EVENTS` helpers live in `@omnicurve/types` —
the single source of truth shared with the backend indexer.

### `src/config/sui.ts`

`createNetworkConfig` for localnet/devnet/testnet/mainnet; the active network is
`VITE_SUI_NETWORK` (defaults to `testnet`) and feeds dapp-kit's `SuiClientProvider`.
`explorerUrl(kind, id)` builds SuiVision links (`txblock` / `object` / `account`).

### `src/lib/sui.ts`

A shared read-only `SuiClient` plus object readers for state the backend doesn't persist.
Replaces the EVM build's raw storage-slot reads — **every field is a public Move object
field on Sui**:
- `getMarketSeedState(objectId)` → `{ seeded, owner, pendingOwner, sigmaMin, totalShares }`
  (parses the `Market<T>` object's `sigma`, `owner`, `pending_owner`, `sigma_min`,
  `total_shares` fields; `fpFieldToFloat` mirrors the backend's WAD `Fp` decoding).
- `getMarketOwner(objectId)` → on-chain owner address (gates the owner-controls panel).

### `src/lib/api.ts`

Typed `fetch` wrapper; throws `ApiError` on non-2xx. The `Market` shape now carries
`objectId` (the shared `Market<T>` object id), `collateralType` (the coin type `T`), and
`finalPrice` — **replacing** `ammAddress` / `routerAddress` / `lpTokenAddress` /
`winningTokenId`. Routes: `getMarkets`, `getMarket`, `getPricePreview`, `getLpStats`,
`updateMarketMetadata`, `getPortfolio` (unchanged — chain-agnostic).

### `src/lib/socket.ts` / `useMarketSocket` / `usePriceSocket` / `useLiveRefetch`

Unchanged by the migration — purely backend/Socket.io driven. `connectSocket()` runs once
in `main.tsx` after providers mount.

### `src/lib/math.ts`

Mirror of the on-chain Gaussian CDF (Abramowitz & Stegun erf) for instant local estimates,
plus fixed-point helpers:
```ts
floatToWad(n)         // n * 1e18
floatToWadParts(n)    // → { mag: bigint, neg: boolean }  — signed WAD for Move args
wadToFloat(w) / usdcToWad / wadToUsdc / usdcDisplayToRaw(n) // n * 1e6 (raw USDC, 6dp)
```

---

## Provider Tree (`src/main.tsx`)

```
QueryClientProvider
  └ SuiClientProvider networks={networkConfig} defaultNetwork={SUI_NETWORK}
      └ WalletProvider autoConnect
          └ ThemeProvider
              └ RouterProvider
```
Import `@mysten/dapp-kit/dist/index.css` once here.

---

## Wallet (`src/components/wallet/ConnectButton.tsx`)

dapp-kit `ConnectModal` (custom trigger Button) when disconnected; a styled address chip that
disconnects on click when connected. Uses `useCurrentAccount` / `useDisconnectWallet`.
Throughout the app, `const address = useCurrentAccount()?.address` replaces wagmi's
`useAccount()`. `useCurrentWallet().connectionStatus === 'connecting'` gates the dashboard's
reconnect skeleton.

---

## Transaction Hooks (PTBs)

All three sign + execute with dapp-kit's `useSignAndExecuteTransaction`, then
`suiClient.waitForTransaction({ digest })` before invalidating React Query caches. Collateral
is supplied with `coinWithBalance({ type: collateralType, balance })` from
`@mysten/sui/transactions`, which auto-selects/merges/splits the user's coins — **there is no
approve step**.

### `useTrade({ marketId, objectId, collateralType })`
One PTB: `buy_yes` / `buy_no<T>(market, payment: Coin<T>, target_mag, target_neg)`.
`target_*` is the strike as signed WAD via `floatToWadParts(strikeX)`; `payment` is
`coinWithBalance` for the raw-USDC (6dp) stake. The contract carves the 1% fee and derives the
token amount itself. Steps: `idle → buying → confirmed | error` (`approving`/`approved` are
retained in the type only for parity).

### `useLP({ marketId, objectId, collateralType })`
- **`add(amountUsdc, seed?)`** — when `seed` is supplied on an *unseeded* market and the caller
  is the (pending) owner, `accept_ownership` (only if pending) + `set_distribution` are batched
  into the **same atomic PTB** as `add_liquidity` — a single signature. Otherwise just
  `add_liquidity<T>(market, payment)`.
- **`remove(sharesWad)`** — `remove_liquidity<T>(market, shares_to_remove: u256)` (WAD).
- **`claim()`** — `claim_fees<T>(market)`.

Steps: `idle | accepting | seeding | submitting | confirmed | error` (`approving` retained for
parity; seeding+deposit being atomic means the button shows `seeding` then `confirmed`).

### `useCreateMarket()`
`create_market<T>(registry, title: vector<u8>, sigma_min_mag: u256, resolves_at: u64, price_feed_id: vector<u8>)`:
1. Build PTB; `title` as UTF-8 `vector<u8>`, `sigma_min` as WAD, `resolves_at` mandatory/immutable,
   and `price_feed_id` an optional 0x-hex Pyth feed id parsed to `vector<u8>` (empty = manual
   market). `create(sigmaMin, resolvesAtMs, meta?, priceFeedId?)` — the `CreateMarketModal` "Pyth
   Price Feed" dropdown maps a selection to a feed id from `PYTH_FEED_IDS` (`@omnicurve/types`).
   A market bound to a feed settles trustlessly via `market::resolve_with_pyth` after close.
2. Wait with `showEvents: true`; pull `market_id` from the `MarketCreated` event.
3. `api.updateMarketMetadata(marketId, { title, category })` (retried; non-fatal) so the
   market shows its question + category instead of "Market #N".
4. `navigate('/markets')`.

---

## UI Primitives (`src/components/ui/`)

`Button` (variants: `primary` amber fill, `ghost` amber border, `danger`, `muted`; loading
spinner; disabled opacity) · `Input` (`label`/`error`/`suffix`/`prefix`, mono for numbers) ·
`Slider` (teal-left/red-right track, continuous `onChange`) · `Modal` (portal + Framer
scale/fade) · `Toast` (bottom-right stack, success/error/pending, 5s auto-dismiss) · `Tabs`
(Framer `layoutId` underline) · `Badge`.

---

## GaussianChart (`src/components/market/GaussianChart.tsx`)

The most important component. Props: `{ mu, sigma, strikeX?, direction?, liquidity?, spotX?,
spotLabel?, width?, height?, mini? }` (all in display units — already WAD-divided).

Rendering: domain `[mu−4σ, mu+4σ]`, 300 PDF samples, D3 `scaleLinear` + `area`; when `strikeX`
set, two fills (NO left/red, YES right/teal at ~15%); curve stroke 2px with teal drop-shadow;
dashed amber μ line; animated strike line with P(YES)/P(NO) labels; optional `spotX` reference
line (live spot from `useSpotPrice`, demo-only, never drives pricing). Path transitions
`400ms easeCubicInOut` on μ/σ change; strike line updates instantly. `ResizeObserver` for
responsive width.

---

## Market Interaction Components

### StakerPanel
Strike slider (μ±3σ) → direction toggle (YES/NO) → USDC stake → live price preview
(`usePriceSocket`, debounced 50ms, local-estimate fallback) → trade preview → `useTrade`.
Underwriting guard: blocks when P(direction) ≈ 0 or the bet's worst-case payout exceeds pool
liquidity. Resolved markets show "Market resolved — Final price $X" (settlement is
per-position, not a single winning side). Confirmation links to **SuiVision** via
`explorerUrl('txblock', digest)`.

### LPPanel
Tabs Deposit | Withdraw | Claim. On-chain seed state via a `['market-seed-state', objectId]`
React Query calling `getMarketSeedState`:
- `unseeded = !seedState.seeded` (σ = 0); `canSeed = unseeded && wallet ∈ {owner, pendingOwner}`.
- `sigmaMin = max(seedState.sigmaMin, market.minVarianceBound)`; LP-share estimate uses
  `totalShares` (WAD) from the same read (Sui analogue of LP-token `totalSupply`).
- **Deposit:** if `canSeed`, shows μ/σ inputs (σ > σ-min) passed to `useLP.add(amount, {mu,sigma})`
  → atomic seed+deposit. Otherwise informational notes (unseeded-not-creator, or live curve).
- **Withdraw:** LP-amount input → `remove(floatToWad(amount))`. (Network fee is shown by the
  wallet — no client-side gas estimate on Sui.)
- **Claim:** pending fees from `api.getLpStats` → `claim()`.

### CreateMarketModal
`react-hook-form` + Zod: `title` (≥4 chars), `category` (Crypto/Macro/Sports/Other), `sigmaMin`
(> 0). Submits `create(sigmaMin, { title, category })`.

---

## Pages

- **Landing** — animated Gaussian hero, "Every Outcome, One Curve", CTAs to `/markets` and
  `/docs`, stats bar (totals from `useMarkets`), Sui/Move tech strip.
- **Marketplace** — search + category tabs + Active/Resolved toggle, `MarketCard` grid,
  `[+ Create Market]` when a wallet is connected.
- **MarketDetail** (`/markets/:marketId`) — header + μ/σ/liquidity strip, live `GaussianChart`
  (fed by `useMarketSocket`), Trade/LP tab panels, on-chain object links (Market object +
  collateral package on SuiVision). **Resolution** (owner-only, two-phase): a final-price
  input → `propose_resolution(price_mag, price_neg, Clock)` → after the 24h timelock,
  `execute_resolution(Clock)`. **Claiming:** the resolved banner lists the wallet's winning
  positions (YES if `finalPrice ≥ strike`, NO if `finalPrice < strike`) and calls
  `claim_winnings<T>(market, position)` with the owned `Position` object id.
- **UserDashboard** (`/dashboard`) — wallet card + portfolio value, Open Positions table, LP
  Positions table. Redirects/prompts when no wallet.
- **Docs** — static explainer with an interactive mini-chart.

---

## Critical Invariants — Never Get These Wrong

### WAD / USDC Conversions
| Operation | Formula |
|---|---|
| User input "$100" → raw USDC | `100 * 1_000_000n` (6 decimals) |
| Raw USDC → WAD | `rawUsdc * 1_000_000_000_000n` (×1e12) |
| WAD → raw USDC | `wad / 1_000_000_000_000n` |
| WAD → display float | `Number(wad) / 1e18` |
| Strike float → signed WAD arg | `floatToWadParts(x)` → `{ mag, neg }` |

### Signed values & Move args
Curve/price numbers are **signed WAD** passed to Move as two args: `(magnitude: u256,
neg: bool)` — e.g. μ = −2.5 → `mag = 2_500_000_000_000_000_000n, neg = true`. Use
`floatToWadParts`. Collateral amounts are plain raw USDC `u64` (the contract scales by 1e12).

### Coins & payment
Build payment with `coinWithBalance({ type: collateralType, balance })`. **No `approve`** —
Sui coins are objects, merged/split inside the PTB. `buy_*` takes the full stake; the contract
carves the 1% fee and derives tokens.

### Market seeding — creator flow
A fresh market has μ=0, σ=0 and no trading until the **owner** seeds it via `set_distribution`
(σ > σ-min). `add_liquidity` is curve-neutral (LPs never move μ/σ). On Sui the creator *is* the
owner immediately (no factory hand-off), so `accept_ownership` is only needed if ownership was
explicitly transferred and the caller is `pending_owner`. `useLP.add(amount, {mu,sigma})`
batches accept (if pending) + `set_distribution` + `add_liquidity` into one PTB when `canSeed`.
`trades_started` locks `set_distribution` / `set_prior_weight` once the first trade executes.

### Reading market object fields
`getMarketSeedState` / `getMarketOwner` read public `Market<T>` object fields via
`SuiClient.getObject({ showContent: true })` — `owner`, `pending_owner`, `sigma`, `sigma_min`,
`total_shares`. `Fp` fields are `{ mag, neg }`; decode with `fpFieldToFloat`. No storage-slot
hacks (the EVM build's `pending_owner @0x1` / `sigma_min @0x4` reads are gone).

### Settlement & claiming (per-position, real-world price)
Settlement records an externally-observed **final price**; win/lose is decided **per `Position`**,
not a single winning side:
- YES (`ABOVE`) wins iff `finalPrice ≥ strike`; NO (`BELOW`) wins iff `finalPrice < strike`.
- **Pyth (trustless, price markets):** `resolve_with_pyth` reads the bound Pyth feed on-chain —
  permissionless, driven by the backend keeper today (a frontend "Resolve via Pyth" button is TODO).
- Manual: owner `set_final_price` (immediate) or `propose_resolution → execute_resolution` (24h
  timelock); both require `now ≥ resolves_at` and the shared `Clock` (`CLOCK_ID = 0x6`).
- `claim_winnings<T>(market, position)` consumes the owned `Position` object (pass its id).
- `release_losing_collateral` is permissionless post-resolution.

### Errors (`src/lib/errors.ts`)
`formatTxError` maps Move abort codes (`MoveAbort(..., <code>)`) from `continuum::market`
(`EUnauthorized=0 … EInvalidResolutionTime=19`) to friendly copy, plus RPC/gas/coin-balance
heuristics. `isUserRejection` detects wallet declines so they render neutrally.

### Socket lifecycle
`connectSocket()` once in `main.tsx`. `useMarketSocket` joins/leaves rooms (dedup server-side);
`usePriceSocket` debounces 50ms.

---

## Environment Variables

```
VITE_API_BASE_URL=                # empty → Vite proxies /api + /socket.io to :3001
VITE_SUI_NETWORK=testnet
VITE_PACKAGE_ID=0x76ab321b6eebc96d730897da0360a650f9b0449128b3961014b20064c7ef7549
VITE_REGISTRY_ID=0xbc9655167e9a4b605dac143bf6153f9532e5dd2ebf70eecf51613c1e13138b23
VITE_COLLATERAL_TYPE=0x76ab32…::mock_usdc::MOCK_USDC
```

---

## Commands

```bash
pnpm --filter @omnicurve/frontend dev      # Vite dev server (port 5173)
pnpm --filter @omnicurve/frontend build    # tsc --noEmit + vite build
```

## Explorer Links

Build with `explorerUrl(kind, id)` from `src/config/sui.ts` (SuiVision, network-aware):
`txblock` for digests, `object` for shared/owned objects, `account` for addresses.
