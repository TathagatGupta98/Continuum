/**
 * On-chain sync service — Sui edition.
 *
 * Replaces the old viem/Arbitrum watcher. Reads `Market<T>` shared-object state
 * and per-LP figures from the published `continuum` package, discovers markets
 * from the shared `Registry` + `MarketCreated` events, and polls the module's
 * events (Sui has no persistent websocket event subscription) to keep Prisma +
 * Socket.io in sync.
 *
 * Identity mapping vs. the EVM build:
 *   - three proxy addresses (AMM/Router/LP) → one `Market<T>` object id.
 *   - Factory                              → shared `Registry` object.
 *   - ERC-1155 positions                   → `TradeExecuted` events.
 *   - settlement winning_token_id          → per-position `finalPrice` compare.
 */

import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { config } from '../config';
import prisma from '../models/db';
import { broadcastMarketUpdate, broadcastMarketResolved, broadcastMarketCreated } from '../sockets/socketManager';
import { calculateExpectedPrices } from './mathService';

// ─── Shared Sui client ───────────────────────────────────────────────────────

export const suiClient = new SuiClient({ url: config.SUI_RPC_URL });

const PKG = config.PACKAGE_ID;
const MODULE = 'market';
// devInspect needs *some* sender; reads never touch its balance.
const INSPECT_SENDER = normalizeSuiAddress('0x0');

// ─── Fixed-point / unit conversion ───────────────────────────────────────────

const WAD = 1e18;

type FpJson = { mag: string | number; neg: boolean };

/** Convert a Move `Fp` object-field to a signed JS float (WAD → units). */
function fpToFloat(field: any): number {
  if (field == null) return 0;
  const inner: FpJson = field.fields ?? field;
  const mag = Number(BigInt(inner.mag ?? 0)) / WAD;
  return inner.neg ? -mag : mag;
}

/** Convert a raw WAD magnitude (decimal string, always non-negative) to a float. */
function wadMagToFloat(mag: string | number | bigint): number {
  return Number(BigInt(mag)) / WAD;
}

// ─── Object reads ────────────────────────────────────────────────────────────

export interface MarketState {
  mu: number;
  sigma: number;
  totalLiquidity: number;
  isResolved: boolean;
  finalPrice: number | null;
}

/**
 * Reads μ, σ, accounted liquidity and resolution state from a `Market<T>`
 * shared object. `totalLiquidity` is `available + locked` collateral in USDC
 * dollars (WAD-accounted, so dust-free), the Sui analogue of the EVM build's
 * "USDC balance held by the AMM proxy".
 */
export async function getMarketState(objectId: string): Promise<MarketState> {
  const obj = await suiClient.getObject({ id: objectId, options: { showContent: true } });
  const content = obj.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Object ${objectId} is not a Move object`);
  }
  const f: any = content.fields;

  const available = fpToFloat(f.available_liquidity);
  const locked = fpToFloat(f.locked_collateral);
  const resolved = Boolean(f.market_resolved);

  return {
    mu: fpToFloat(f.mu),
    sigma: fpToFloat(f.sigma),
    totalLiquidity: Math.max(0, available + locked),
    isResolved: resolved,
    finalPrice: resolved ? fpToFloat(f.final_price) : null,
  };
}

/** σ floor (sigma_min) for a market, as a JS float. */
export async function getSigmaMin(objectId: string): Promise<number> {
  const obj = await suiClient.getObject({ id: objectId, options: { showContent: true } });
  const f: any = (obj.data?.content as any)?.fields;
  return f ? fpToFloat(f.sigma_min) : 0;
}

/** On-chain market owner address (falls back to OWNER_ADDRESS if unreadable). */
export async function getMarketOwner(objectId: string): Promise<string> {
  try {
    const obj = await suiClient.getObject({ id: objectId, options: { showContent: true } });
    const f: any = (obj.data?.content as any)?.fields;
    return f?.owner ?? config.OWNER_ADDRESS;
  } catch {
    return config.OWNER_ADDRESS;
  }
}

/**
 * Extracts the collateral coin type `T` from a `Market<T>` object's type string,
 * e.g. `0x..::market::Market<0x..::mock_usdc::MOCK_USDC>` → the inner type.
 */
export async function getCollateralType(objectId: string): Promise<string> {
  const obj = await suiClient.getObject({ id: objectId, options: { showType: true } });
  const t = obj.data?.type ?? '';
  const m = t.match(/<(.+)>$/);
  return m?.[1] ?? config.COLLATERAL_TYPE;
}

// ─── devInspect view-function calls (per-LP figures) ─────────────────────────

/** Calls a `&Market<T>`-only u256 view via devInspect and returns it as bigint. */
async function inspectU256(
  objectId: string,
  collateralType: string,
  fn: string,
  extra: (tx: Transaction) => any[] = () => [],
): Promise<bigint> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PKG}::${MODULE}::${fn}`,
    typeArguments: [collateralType],
    arguments: [tx.object(objectId), ...extra(tx)],
  });
  const res = await suiClient.devInspectTransactionBlock({ sender: INSPECT_SENDER, transactionBlock: tx });
  const rv = res.results?.[0]?.returnValues?.[0];
  if (!rv) return 0n;
  const [bytes] = rv;
  return BigInt(bcs.u256().parse(Uint8Array.from(bytes)));
}

export interface LpStats {
  lpTokenBalance: number;
  accFeePerShare: number;
  rewardDebt: number;
  pendingRewards: number;
}

/**
 * Reads an LP's shares, the global fee accumulator, reward debt and pending
 * fees for one market via the contract's own view functions. The MasterChef
 * math lives on-chain, so `pendingRewards` is read directly (not recomputed).
 */
export async function getLpStats(
  objectId: string,
  collateralType: string,
  user: string,
): Promise<LpStats> {
  const addrArg = (tx: Transaction) => [tx.pure.address(user)];
  const [shares, acc, debt, pending] = await Promise.all([
    inspectU256(objectId, collateralType, 'lp_balance', addrArg),
    inspectU256(objectId, collateralType, 'acc_fee_per_share'),
    inspectU256(objectId, collateralType, 'reward_debt', addrArg),
    inspectU256(objectId, collateralType, 'pending_fees', addrArg),
  ]);
  return {
    lpTokenBalance: wadMagToFloat(shares),
    accFeePerShare: wadMagToFloat(acc),
    rewardDebt: wadMagToFloat(debt),
    pendingRewards: wadMagToFloat(pending),
  };
}

// ─── Event ingestion ─────────────────────────────────────────────────────────

interface WatchableMarket {
  marketId: string;
  objectId: string;
  collateralType: string;
}

const EVENT_TYPE = (name: string) => `${PKG}::${MODULE}::${name}`;

/** Strip the module prefix from a full event type → bare event name. */
function eventName(type: string): string {
  const parts = type.split('::');
  return parts[parts.length - 1] ?? type;
}

/**
 * Reconstructs all Position rows for a market from its full TradeExecuted event
 * history. The live poller only sees events after its cursor, so trades that
 * landed while the backend was down would otherwise never reach the portfolio.
 * This reads every TradeExecuted event for the market, aggregates by
 * deterministic positionId, and writes ABSOLUTE totals (idempotent on restart).
 */
export async function backfillTradePositions(market: WatchableMarket): Promise<void> {
  const { marketId, objectId } = market;

  let cursor: any = null;
  const trades: any[] = [];
  do {
    const page = await suiClient.queryEvents({
      query: { MoveEventType: EVENT_TYPE('TradeExecuted') },
      cursor,
      order: 'ascending',
    });
    for (const ev of page.data) {
      const j: any = ev.parsedJson;
      if (String(j.market_id) === marketId) trades.push(j);
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  if (trades.length === 0) return;

  const state = await getMarketState(objectId);

  type Agg = ReturnType<typeof aggregateTrade> & object;
  const byId = new Map<string, Agg>();

  for (const j of trades) {
    const agg = aggregateTrade(j, marketId, state);
    if (!agg) continue;
    const existing = byId.get(agg.positionId);
    if (existing) {
      existing.tokensMinted += agg.tokensMinted;
      existing.stakeAmount += agg.stakeAmount;
    } else {
      byId.set(agg.positionId, agg);
    }
  }

  for (const agg of byId.values()) {
    await prisma.user.upsert({
      where: { walletAddress: agg.userAddress },
      create: { walletAddress: agg.userAddress },
      update: {},
    });
    await prisma.position.upsert({
      where: { positionId: agg.positionId },
      create: { ...agg },
      update: { tokensMinted: agg.tokensMinted, stakeAmount: agg.stakeAmount },
    });
  }

  console.log(`📦 Trade backfill — market ${marketId}: ${byId.size} position(s) from ${trades.length} TradeExecuted event(s)`);
}

/** Maps a TradeExecuted event payload to a Position aggregate row. */
function aggregateTrade(j: any, marketId: string, state: MarketState) {
  if (j.user === undefined || j.target_mag === undefined || j.is_yes === undefined || j.tokens_minted === undefined) {
    return null;
  }
  const user = String(j.user).toLowerCase();
  const isYes = Boolean(j.is_yes);
  const tokensMinted = wadMagToFloat(j.tokens_minted);
  const targetValueX = (j.target_neg ? -1 : 1) * wadMagToFloat(j.target_mag);
  const prices = calculateExpectedPrices(targetValueX, state.mu, state.sigma);
  const price = isYes ? prices.pYes : prices.pNo;
  // Approximate stake: price × tokens × 1.01 fee, in USDC raw (6 decimals).
  const stakeAmount = Math.ceil(price * tokensMinted * 1.01 * 1e6);
  const direction: 'ABOVE' | 'BELOW' = isYes ? 'ABOVE' : 'BELOW';
  const positionId = `${user}-${marketId}-${direction}-${Math.round(targetValueX * 1000)}`;
  return { positionId, userAddress: user, marketId, targetValueX, direction, tokensMinted, stakeAmount };
}

/** Upserts a market row from a MarketCreated event (or registry reconciliation). */
async function handleMarketCreatedOnChain(marketId: string, objectId: string, title: string): Promise<void> {
  if (config.EXCLUDED_MARKET_IDS.includes(marketId)) {
    console.log(`🚫 Market ${marketId} is excluded — ignoring MarketCreated`);
    return;
  }
  console.log(`🆕 MarketCreated — market ${marketId} (object: ${objectId})`);

  let mu = 0, sigma = 0, totalLiquidity = 0, minVarianceBound = 0;
  let collateralType = config.COLLATERAL_TYPE;
  try {
    const state = await getMarketState(objectId);
    mu = state.mu; sigma = state.sigma; totalLiquidity = state.totalLiquidity;
    minVarianceBound = await getSigmaMin(objectId);
    collateralType = await getCollateralType(objectId);
  } catch (err) {
    console.warn(`⚠️  Could not read initial state for market ${marketId}:`, err);
  }

  await prisma.market.upsert({
    where: { marketId },
    update: { objectId, collateralType, currentMu: mu, currentSigma: sigma, totalLiquidity, minVarianceBound },
    create: {
      marketId,
      title: title || `Market #${marketId}`,
      category: 'general',
      currentMu: mu,
      currentSigma: sigma,
      totalLiquidity,
      minVarianceBound,
      objectId,
      collateralType,
    },
  });

  await backfillTradePositions({ marketId, objectId, collateralType });
  broadcastMarketCreated(marketId);
}

/** Re-reads a market's μ/σ/liquidity from chain and broadcasts the update. */
async function syncMarketState(marketId: string, objectId: string): Promise<void> {
  const state = await getMarketState(objectId);
  await prisma.market.update({
    where: { marketId },
    data: {
      currentMu: state.mu,
      currentSigma: state.sigma,
      totalLiquidity: state.totalLiquidity,
      ...(state.isResolved ? { isResolved: true, finalPrice: state.finalPrice } : {}),
    },
  });
  broadcastMarketUpdate(marketId, {
    currentMu: state.mu,
    currentSigma: state.sigma,
    totalLiquidity: state.totalLiquidity,
  });
}

/** Dispatch a single decoded Sui event to its Prisma handler. */
async function handleEvent(type: string, j: any): Promise<void> {
  const name = eventName(type);
  const marketId = j.market_id !== undefined ? String(j.market_id) : undefined;

  switch (name) {
    case 'MarketCreated':
      await handleMarketCreatedOnChain(String(j.market_id), String(j.market), String(j.title ?? ''));
      break;

    case 'CurveUpdated':
    case 'LiquidityAdded':
    case 'LiquidityRemoved':
    case 'FeeDistributed': {
      if (!marketId) return;
      const market = await prisma.market.findUnique({ where: { marketId } });
      if (market?.objectId) await syncMarketState(marketId, market.objectId);
      break;
    }

    case 'TradeExecuted': {
      if (!marketId) return;
      const market = await prisma.market.findUnique({ where: { marketId } });
      if (!market?.objectId) return;
      await syncMarketState(marketId, market.objectId);

      const state = await getMarketState(market.objectId);
      const agg = aggregateTrade(j, marketId, state);
      if (!agg) return;
      await prisma.user.upsert({
        where: { walletAddress: agg.userAddress },
        create: { walletAddress: agg.userAddress },
        update: {},
      });
      await prisma.position.upsert({
        where: { positionId: agg.positionId },
        create: { ...agg },
        update: {
          tokensMinted: { increment: agg.tokensMinted },
          stakeAmount: { increment: agg.stakeAmount },
        },
      });
      console.log(`📝 Position upserted — ${agg.userAddress} ${agg.direction} @${agg.targetValueX.toFixed(2)}`);
      break;
    }

    case 'MarketResolved': {
      if (!marketId) return;
      const finalPrice = (j.final_neg ? -1 : 1) * wadMagToFloat(j.final_mag);
      await prisma.market.update({
        where: { marketId },
        data: { isResolved: true, finalPrice },
      });
      broadcastMarketResolved(marketId, { winningTokenId: String(finalPrice) });
      console.log(`🏁 MarketResolved — market ${marketId}, finalPrice ${finalPrice}`);
      break;
    }

    default:
      // WinningsClaimed and any others need no DB mutation.
      break;
  }
}

// ─── Poller ──────────────────────────────────────────────────────────────────

let pollTimer: NodeJS.Timeout | null = null;
let eventCursor: any = null;
let polling = false;

/** One poll pass: drains all new module events since the last cursor. */
async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    let cursor = eventCursor;
    // First boot: queryEvents with a null cursor returns oldest-first; we want
    // to start from the tip, so on the very first pass we fast-forward.
    do {
      const page = await suiClient.queryEvents({
        query: { MoveModule: { package: PKG, module: MODULE } },
        cursor,
        order: 'ascending',
      });
      for (const ev of page.data) {
        try {
          await handleEvent(ev.type, ev.parsedJson);
        } catch (err) {
          console.error(`❌ Event handler error (${ev.type}):`, err);
        }
      }
      if (page.data.length > 0) cursor = page.nextCursor;
      if (!page.hasNextPage) break;
    } while (cursor);
    eventCursor = cursor;
  } catch (err) {
    console.error('❌ Event poll failed:', err);
  } finally {
    polling = false;
  }
}

/**
 * Reconciles the DB against the on-chain `Registry`, backfills positions, then
 * starts the event poller. Returns a single stop function for graceful shutdown.
 */
export async function startChainWatcher(): Promise<Array<() => void>> {
  // ─── Discover every market from the Registry via MarketCreated events ────
  try {
    let cursor: any = null;
    do {
      const page = await suiClient.queryEvents({
        query: { MoveEventType: EVENT_TYPE('MarketCreated') },
        cursor,
        order: 'ascending',
      });
      for (const ev of page.data) {
        const j: any = ev.parsedJson;
        const marketId = String(j.market_id);
        if (config.EXCLUDED_MARKET_IDS.includes(marketId)) continue;
        const existing = await prisma.market.findUnique({ where: { marketId } });
        if (existing?.objectId) {
          // Refresh live state on boot so the persisted row is correct.
          try { await syncMarketState(marketId, existing.objectId); } catch { /* keep */ }
          continue;
        }
        await handleMarketCreatedOnChain(marketId, String(j.market), String(j.title ?? ''));
      }
      cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor);
  } catch (err) {
    console.error('❌ Registry reconciliation failed:', err);
  }

  // ─── Fast-forward the event cursor to the tip so the poller only handles
  // NEW events (historical state was reconciled above). ───
  try {
    const tip = await suiClient.queryEvents({
      query: { MoveModule: { package: PKG, module: MODULE } },
      order: 'descending',
    });
    eventCursor = tip.data[0]?.id ?? null;
  } catch (err) {
    console.error('❌ Could not establish event tip cursor:', err);
  }

  pollTimer = setInterval(() => { void pollOnce(); }, config.EVENT_POLL_INTERVAL_MS);
  console.log(`⛓️  Sui event poller active — package ${PKG}, every ${config.EVENT_POLL_INTERVAL_MS}ms`);

  return [() => { if (pollTimer) clearInterval(pollTimer); }];
}
