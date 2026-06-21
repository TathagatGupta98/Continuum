/**
 * Database seed script — Sui edition.
 *
 * Usage:  pnpm db:seed
 *
 * Flow:
 *   1. Connect to a Sui full node.
 *   2. WIPE the Market/Position/OracleResolution tables, so the database is
 *      fully reconstructed from chain on every run (the chain is the single
 *      source of truth; nothing persists across restarts but the schema). This
 *      is why excluded markets disappear cleanly — there are no stale rows to
 *      leave behind.
 *   3. Discover every market from the package's `MarketCreated` events
 *      (the shared `Registry` mirrors the same set).
 *   4. For each non-excluded market: read μ/σ/σ_min/liquidity from the
 *      `Market<T>` object and its collateral type, then write it into Prisma.
 *
 * Trade positions are reconstructed separately by `pnpm db:backfill` (run right
 * after this in the `start` flow), which replays on-chain `TradeExecuted` logs.
 *
 * Titles always come from the on-chain `MarketCreated` event — the frontend's
 * PATCH /metadata route can still relabel a market's category at runtime, but
 * the title shown is always the on-chain one.
 */

import { SuiClient } from '@mysten/sui/client';
import { config } from '../config';
import prisma from '../models/db';
import { getMarketState, getSigmaMin, getCollateralType } from '../services/chainService';

async function seed() {
  console.log('🌱 Starting database seed (Sui)...\n');

  const client = new SuiClient({ url: config.SUI_RPC_URL });

  // ─── Wipe the DB so it is rebuilt purely from chain ───
  // Order matters: Position/OracleResolution reference Market (no cascade in the
  // schema). The User table is left intact (chain-address keyed, no stale state).
  const [delPos, delOracle, delMarkets] = await prisma.$transaction([
    prisma.position.deleteMany({}),
    prisma.oracleResolution.deleteMany({}),
    prisma.market.deleteMany({}),
  ]);
  console.log(
    `🧹 Wiped DB — ${delMarkets.count} market(s), ${delPos.count} position(s), ` +
      `${delOracle.count} oracle row(s)\n`,
  );

  // ─── Discover markets from MarketCreated events ───
  const created: Array<{ marketId: string; objectId: string; title: string }> = [];
  let cursor: any = null;
  do {
    const page = await client.queryEvents({
      query: { MoveEventType: `${config.PACKAGE_ID}::market::MarketCreated` },
      cursor,
      order: 'ascending',
    });
    for (const ev of page.data) {
      const j: any = ev.parsedJson;
      created.push({ marketId: String(j.market_id), objectId: String(j.market), title: String(j.title ?? '') });
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  console.log(`📊 Discovered ${created.length} market(s) on-chain\n`);
  if (created.length === 0) {
    console.log('⚠️  No markets found. Nothing to seed.');
    return;
  }

  for (const { marketId, objectId, title } of created) {
    if (config.EXCLUDED_MARKET_IDS.includes(marketId)) {
      console.log(`─── Market #${marketId} ─── 🚫 excluded — skipping\n`);
      continue;
    }
    console.log(`─── Market #${marketId} ───`);
    console.log(`  Object:   ${objectId}`);

    let currentMu = 0, currentSigma = 0, totalLiquidity = 0, minVarianceBound = 0;
    let isResolved = false;
    let finalPrice: number | null = null;
    let collateralType = config.COLLATERAL_TYPE;

    try {
      const state = await getMarketState(objectId);
      currentMu = state.mu;
      currentSigma = state.sigma;
      totalLiquidity = state.totalLiquidity;
      isResolved = state.isResolved;
      finalPrice = state.finalPrice;
      minVarianceBound = await getSigmaMin(objectId);
      collateralType = await getCollateralType(objectId);
    } catch (err) {
      console.warn(`  ⚠️  Could not read state:`, err);
    }

    console.log(`  μ: ${currentMu}  σ: ${currentSigma}  σ_min: ${minVarianceBound}`);
    console.log(`  Liquidity: ${totalLiquidity}  Resolved: ${isResolved}`);

    const market = await prisma.market.upsert({
      where: { marketId },
      update: {
        currentMu, currentSigma, totalLiquidity, minVarianceBound,
        objectId, collateralType, isResolved, finalPrice,
      },
      create: {
        marketId,
        title: title || `Market #${marketId}`,
        category: 'general',
        currentMu, currentSigma, totalLiquidity, minVarianceBound,
        objectId, collateralType, isResolved, finalPrice,
      },
    });

    console.log(`  ✅ Upserted "${market.title}" (id: ${market.marketId})\n`);
  }

  console.log('🎉 Seed complete!');
}

seed()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
