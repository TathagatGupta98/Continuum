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
