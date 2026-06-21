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
/** The Kiosk-based secondary market for `Position` objects. */
export const POSITION_MARKET_MODULE = 'position_market' as const;

/** Build the `package::market::name` target for a Move call. */
export const marketTarget = (pkg: string, name: string) =>
  `${pkg}::${MARKET_MODULE}::${name}` as const;

/** Build the `package::position_market::name` target for a Move call. */
export const positionMarketTarget = (pkg: string, name: string) =>
  `${pkg}::${POSITION_MARKET_MODULE}::${name}` as const;

/** Entry / public functions on `continuum::position_market`. */
export const POSITION_MARKET_FUNCTIONS = [
  'list_position',
  'delist_position',
  'buy_listed_position',
  'take_and_claim',
] as const;
export type PositionMarketFunction = (typeof POSITION_MARKET_FUNCTIONS)[number];

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
  'resolve_with_pyth',
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

// ─── Pyth Network (on-chain price oracle, Sui) ───────────────────────────────
// `market::resolve_with_pyth` reads a Pyth `PriceInfoObject` to settle financial
// markets trustlessly. Pyth is a pull oracle: a caller fetches a signed price
// update from Hermes and refreshes the feed object in the same PTB before
// resolving. These are the Sui Beta-channel (testnet) deployment ids + the
// Hermes endpoint, shared by the frontend resolve flow and the backend keeper.
// Override per-network via env (PYTH_* / VITE_PYTH_*).

export interface PythConfig {
  /** Pyth Sui package id. */
  pythPackageId: string;
  /** Shared Pyth `State` object id. */
  pythStateId: string;
  /** Wormhole Sui package id (Pyth's VAA-verification dependency). */
  wormholePackageId: string;
  /** Shared Wormhole `State` object id. */
  wormholeStateId: string;
  /** Hermes REST endpoint serving signed price updates. */
  hermesEndpoint: string;
}

/**
 * Pyth Sui testnet (Beta channel) deployment. Testnet runs a separate Wormhole
 * guardian set from mainnet, so it pairs with the BETA Hermes — and its price
 * feeds have *different ids* than mainnet (see `PYTH_FEED_IDS` below).
 */
export const PYTH_TESTNET: PythConfig = {
  pythPackageId: '0xabf837e98c26087cba0883c0a7a28326b1fa3c5e1e2c5abdb486f9e8f594c837',
  pythStateId: '0x243759059f4c3111179da5878c12f68d612c21a8d54d85edc86164bb18be1c7c',
  wormholePackageId: '0xf47329f4344f3bf0f8e436e2f7b485466cff300f12a166563995d3888c296a94',
  wormholeStateId: '0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790',
  hermesEndpoint: 'https://hermes-beta.pyth.network',
};

/** Pyth Sui mainnet (Stable channel) deployment. */
export const PYTH_MAINNET: PythConfig = {
  pythPackageId: '0x04e20ddf36af412a4096f9014f4a565af9e812db9a05cc40254846cf6ed0ad91',
  pythStateId: '0x1f9310238ee9298fb703c3419030b35b22bb1cc37113e3bb5007c99aec79e5b8',
  wormholePackageId: '0x5306f64e312b581766351c07af79c72fcb1cd25147157fdc2f8ad76de9a3fb6a',
  wormholeStateId: '0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c',
  hermesEndpoint: 'https://hermes.pyth.network',
};

/**
 * Common Pyth price-feed ids (32-byte hex, 0x-prefixed) — **Beta/testnet** ids,
 * since the live deployment is on Sui testnet. These differ from the mainnet
 * ids; see `PYTH_FEED_IDS_MAINNET`. A market binds one of these at creation and
 * settles against it via `market::resolve_with_pyth`.
 */
export const PYTH_FEED_IDS = {
  'BTC/USD': '0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b',
  'ETH/USD': '0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6',
  'SUI/USD': '0x50c67b3fd225db8912a424dd4baed60ffdde625ed2feaaf283724f9608fea266',
  'SOL/USD': '0xfe650f0367d4a7ef9815a593ea15d36593f0643aaaf0149bb04be67ab851decd',
} as const;

/** The same feeds' **mainnet** ids (for a mainnet deployment). */
export const PYTH_FEED_IDS_MAINNET = {
  'BTC/USD': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH/USD': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'SUI/USD': '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
  'SOL/USD': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
} as const;

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

// ─── Multi-agent AI oracle (settlement) ──────────────────────────────────────
// Continuum settles to a single scalar `finalPrice`; the oracle estimates that
// real-world value with an ensemble of LLM agents over a shared evidence packet
// (independent aggregation — no debate), then either auto-submits when the agents
// agree at high confidence or escalates to human arbitration. Based on Kota,
// "Multi-Agent AI Oracle Systems for Prediction Market Resolution" (arXiv 2605.30802).

/** One source in the shared, date-filtered evidence packet. */
export interface EvidenceSource {
  title: string;
  url: string;
  /** ISO date the source was published (used for the temporal filter). */
  publishedDate?: string;
  /** Extracted highlight / snippet relevant to the question. */
  snippet: string;
}

/** The identical evidence handed to every agent — isolates reasoning from retrieval. */
export interface EvidencePacket {
  marketId: string;
  /** The resolution question / market title the evidence was gathered for. */
  question: string;
  /** Search query used to retrieve the sources. */
  query: string;
  /** ISO timestamp the packet was assembled. */
  retrievedAt: string;
  /** Market scheduled close (`resolves_at`, ms). Evidence is filtered to ≤ this. */
  resolvesAt: number;
  sources: EvidenceSource[];
  /** Optional researcher synthesis of the sources, passed to every agent. */
  summary?: string;
}

/** One agent's independent scalar estimate of the market's final value. */
export interface AgentVote {
  /** Model id, e.g. `deepseek/deepseek-r1`. */
  model: string;
  /** Estimated real-world final value in market units (signed); null on failure. */
  value: number | null;
  /** Agent self-reported confidence, 0..1. */
  confidence: number;
  /** Natural-language reasoning grounded in the evidence packet. */
  reasoning: string;
  latencyMs: number;
  /** Structured failure message instead of throwing; present when value is null. */
  error?: string;
}

export type OracleStatus =
  | 'PENDING'
  | 'AUTO_RESOLVED'
  | 'ESCALATED'
  | 'SUBMITTED'
  | 'FAILED';

/** Aggregated, escalation-scored decision produced by the oracle pipeline. */
export interface OracleDecision {
  marketId: string;
  status: OracleStatus;
  /** Confidence-weighted aggregate of agent estimates (signed market units). */
  aggregatedValue: number | null;
  /** Median of agent estimates (robust fallback aggregate). */
  medianValue: number | null;
  /** Mean of agent confidences (0..1). */
  meanConfidence: number;
  /** True when every agent estimate is within the tolerance band. */
  agreement: boolean;
  /** 1[agreement] + meanConfidence (range 0..2). */
  compositeScore: number;
  votes: AgentVote[];
  evidence: EvidencePacket;
  /** Digest of the on-chain set_final_price tx, once submitted. */
  txDigest?: string;
}
