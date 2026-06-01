/**
 * Shared Continuum types & on-chain references (Sui edition).
 *
 * Replaces the old EVM ABI exports. On Sui there are no ABIs — callers build
 * PTBs against fully-qualified `package::module::function` targets and read
 * `package::module::Event` types. These helpers centralize those references so
 * the backend indexer and the frontend tx layer agree on one source of truth.
 *
 * `PACKAGE_ID` is filled in at publish time (env: PACKAGE_ID / VITE_PACKAGE_ID).
 */

export const MARKET_MODULE = 'market' as const;
export const MOCK_USDC_MODULE = 'mock_usdc' as const;

/** Build the `package::market::name` target for a Move call. */
export const marketTarget = (pkg: string, name: string) =>
  `${pkg}::${MARKET_MODULE}::${name}` as const;

/** Entry / public functions on `continuum::market`. */
export const MARKET_FUNCTIONS = [
  'create_market',
  'transfer_ownership',
  'accept_ownership',
  'set_distribution',
  'set_prior_weight',
  'set_sigma_min',
  'add_liquidity',
  'remove_liquidity',
  'claim_fees',
  'buy_yes',
  'buy_no',
  'set_final_price',
  'propose_resolution',
  'cancel_resolution',
  'execute_resolution',
  'claim_winnings',
  'release_losing_collateral',
  'sweep_dust',
] as const;
export type MarketFunction = (typeof MARKET_FUNCTIONS)[number];

/** Event struct names emitted by `continuum::market`. */
export const MARKET_EVENTS = [
  'MarketCreated',
  'CurveUpdated',
  'LiquidityAdded',
  'LiquidityRemoved',
  'TradeExecuted',
  'FeeDistributed',
  'MarketResolved',
  'WinningsClaimed',
] as const;
export type MarketEvent = (typeof MARKET_EVENTS)[number];

/** Build the full `package::market::Event` type string for an event filter. */
export const marketEventType = (pkg: string, event: MarketEvent) =>
  `${pkg}::${MARKET_MODULE}::${event}` as const;

// ─── Shared domain types ─────────────────────────────────────────────────────

/** Signed WAD value encoded as the contract's `Fp { mag, neg }`. */
export interface Fp {
  mag: string; // u256 as a decimal string
  neg: boolean;
}

export type Direction = 'ABOVE' | 'BELOW'; // ABOVE = YES, BELOW = NO

export interface MarketView {
  marketId: string;
  objectId: string;
  collateralType: string;
  title: string;
  category: string;
  currentMu: number;
  currentSigma: number;
  totalLiquidity: number;
  minVarianceBound: number;
  isResolved: boolean;
  finalPrice: number | null;
}
