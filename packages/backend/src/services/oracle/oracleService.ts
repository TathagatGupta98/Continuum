/**
 * Oracle orchestrator + resolution worker.
 *
 * Ties the pipeline together for one market:
 *   gather shared evidence → run the independent ensemble → aggregate + score →
 *   persist the audit row → (optionally) submit set_final_price on-chain.
 *
 * The worker is the "trigger" in the keeper-driven flow: Sui emits no event when
 * `resolves_at` is crossed, so each pass scans DB markets for ones that have
 * closed (`now >= resolves_at`), are not yet resolved on-chain, and have no
 * prior oracle attempt, then drives the pipeline. Settlement of individual
 * bettor positions stays on-chain (claim_winnings vs the submitted finalPrice).
 */

import { config } from '../../config';
import prisma from '../../models/db';
import type { OracleDecision } from './types';
import {
  getResolvesAt,
  getMarketState,
  submitFinalPrice,
  getPriceFeedId,
  resolveWithPyth,
} from '../chainService';
import { gatherEvidence } from './retrievalService';
import { runEnsemble } from './resolverService';
import { aggregate } from './aggregationService';

/** Persist a decision to the OracleResolution audit row (upsert by marketId). */
async function persist(decision: OracleDecision, error?: string): Promise<void> {
  const data = {
    status: decision.status,
    aggregatedValue: decision.aggregatedValue,
    medianValue: decision.medianValue,
    meanConfidence: decision.meanConfidence,
    agreement: decision.agreement,
    compositeScore: decision.compositeScore,
    agentVotesJson: JSON.stringify(decision.votes),
    evidenceJson: JSON.stringify(decision.evidence),
    txDigest: decision.txDigest ?? null,
    error: error ?? null,
  };
  await prisma.oracleResolution.upsert({
    where: { marketId: decision.marketId },
    create: { marketId: decision.marketId, ...data },
    update: data,
  });
}

/**
 * Run the full resolution pipeline for one market.
 * Idempotent-ish: callers should gate on existing rows; this always (re)computes.
 */
export async function resolveMarket(marketId: string): Promise<OracleDecision> {
  const market = await prisma.market.findUnique({ where: { marketId } });
  if (!market) throw new Error(`market ${marketId} not found`);
  if (!market.objectId) throw new Error(`market ${marketId} has no on-chain objectId`);

  console.log(
    `\n🔮 ─── Oracle resolution START — market ${marketId} ───\n` +
      `   question: "${market.title}"\n` +
      `   models:   [${config.ORACLE_MODELS.join(', ')}]`,
  );

  // Mark in-progress so concurrent passes don't double-fire.
  await prisma.oracleResolution.upsert({
    where: { marketId },
    create: { marketId, status: 'PENDING' },
    update: { status: 'PENDING', error: null },
  });

  const resolvesAt = await getResolvesAt(market.objectId);

  let decision: OracleDecision;
  try {
    console.log(`🔮 [1/3] gathering evidence (closed ${new Date(resolvesAt).toISOString()})…`);
    const evidence = await gatherEvidence({
      marketId,
      question: market.title,
      resolvesAt,
    });
    console.log(
      `🔮 [1/3] evidence ready — ${evidence.sources.length} source(s)` +
        `${evidence.summary ? ', synthesis present' : ', NO synthesis'}`,
    );
    if (evidence.sources.length === 0) {
      console.warn('🔮 [1/3] ⚠ no sources retrieved — agents will be low-confidence');
    }

    console.log(`🔮 [2/3] running ${config.ORACLE_MODELS.length}-agent ensemble…`);
    const votes = await runEnsemble(evidence);
    for (const v of votes) {
      if (v.error) {
        console.warn(`🔮 [2/3]   ✗ ${v.model} — ${v.error} (${v.latencyMs}ms)`);
      } else {
        console.log(
          `🔮 [2/3]   ✓ ${v.model} — value=${v.value}, conf=${v.confidence.toFixed(2)} (${v.latencyMs}ms)`,
        );
      }
    }

    console.log('🔮 [3/3] aggregating votes…');
    decision = aggregate(marketId, votes, evidence);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: OracleDecision = {
      marketId,
      status: 'FAILED',
      aggregatedValue: null,
      medianValue: null,
      meanConfidence: 0,
      agreement: false,
      compositeScore: 0,
      votes: [],
      evidence: {
        marketId,
        question: market.title,
        query: '',
        retrievedAt: new Date().toISOString(),
        resolvesAt,
        sources: [],
      },
    };
    await persist(failed, message);
    console.error(
      `🔮 ❌ Oracle FAILED — market ${marketId}\n` +
        `   reason: ${message}\n` +
        `   (evidence/ensemble threw — see stack below)`,
    );
    console.error(err);
    return failed;
  }

  // Auto-submit on-chain when configured and the ensemble cleared the bar.
  if (decision.status === 'AUTO_RESOLVED' && config.ORACLE_AUTO_SUBMIT && decision.aggregatedValue !== null) {
    try {
      const digest = await submitFinalPrice({
        objectId: market.objectId,
        collateralType: market.collateralType,
        value: decision.aggregatedValue,
      });
      decision = { ...decision, status: 'SUBMITTED', txDigest: digest };
      console.log(
        `🔮 ✅ Oracle SUBMITTED on-chain — market ${marketId} @ finalPrice=${decision.aggregatedValue}\n` +
          `   tx: ${digest}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await persist(decision, `auto-submit failed: ${message}`);
      console.error(
        `🔮 ❌ Oracle auto-submit FAILED — market ${marketId}\n` +
          `   reason: ${message}\n` +
          `   (decision was AUTO_RESOLVED @ ${decision.aggregatedValue} but the on-chain tx failed)`,
      );
      console.error(err);
      return decision;
    }
  } else {
    const icon = decision.status === 'AUTO_RESOLVED' ? '✅' : decision.status === 'FAILED' ? '❌' : '⚠️';
    const reason =
      decision.status === 'FAILED'
        ? 'no agent produced a usable estimate'
        : decision.status === 'ESCALATED'
          ? !decision.agreement
            ? 'agents disagree (estimates outside tolerance band) → human arbitration'
            : `mean confidence ${decision.meanConfidence.toFixed(2)} < threshold ${config.ORACLE_CONFIDENCE_THRESHOLD} → human arbitration`
          : config.ORACLE_AUTO_SUBMIT
            ? 'cleared the bar (auto-submit will run)'
            : 'cleared the bar, but ORACLE_AUTO_SUBMIT=false → not submitted on-chain';
    console.log(
      `🔮 ${icon} Oracle ${decision.status} — market ${marketId}\n` +
        `   value=${decision.aggregatedValue}, conf=${decision.meanConfidence.toFixed(2)}, ` +
        `agree=${decision.agreement}, score=${decision.compositeScore.toFixed(2)}\n` +
        `   reason: ${reason}`,
    );
  }

  await persist(decision);
  return decision;
}

// ─── Pyth settlement (financial markets) ─────────────────────────────────────

/** True when the keeper should auto-settle Pyth-bound markets on-chain. */
function pythResolutionActive(): boolean {
  return config.PYTH_RESOLUTION_ENABLED && Boolean(config.ORACLE_SIGNER_KEY);
}

/**
 * Settle a price-feed-bound market trustlessly via `market::resolve_with_pyth`.
 * No LLM ensemble: Pyth *is* the oracle. Records the attempt in the same
 * OracleResolution audit table (status SUBMITTED / FAILED) so the keeper won't
 * re-fire it on the next pass.
 */
async function resolveViaPyth(
  market: { marketId: string; objectId: string; collateralType: string },
  feedId: string,
): Promise<void> {
  console.log(`🛰️  Pyth resolution START — market ${market.marketId}, feed ${feedId}`);

  await prisma.oracleResolution.upsert({
    where: { marketId: market.marketId },
    create: { marketId: market.marketId, status: 'PENDING' },
    update: { status: 'PENDING', error: null },
  });

  try {
    const digest = await resolveWithPyth({
      objectId: market.objectId,
      collateralType: market.collateralType,
      feedId,
    });
    await prisma.oracleResolution.update({
      where: { marketId: market.marketId },
      data: {
        status: 'SUBMITTED',
        txDigest: digest,
        // Pyth is a single trusted on-chain source: full confidence, no spread.
        meanConfidence: 1,
        agreement: true,
        compositeScore: 2,
        agentVotesJson: JSON.stringify([{ model: 'pyth-network', feedId }]),
        evidenceJson: JSON.stringify({ oracle: 'pyth', feedId, endpoint: config.HERMES_ENDPOINT }),
        error: null,
      },
    });
    console.log(`🛰️  ✅ Pyth SUBMITTED on-chain — market ${market.marketId}\n   tx: ${digest}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.oracleResolution.update({
      where: { marketId: market.marketId },
      data: { status: 'FAILED', error: `pyth: ${message}` },
    });
    console.error(`🛰️  ❌ Pyth resolution FAILED — market ${market.marketId}\n   reason: ${message}`);
  }
}

// ─── Resolution worker ───────────────────────────────────────────────────────

let workerTimer: NodeJS.Timeout | null = null;
let scanning = false;

/** One scan pass: resolve every market that has closed and has no oracle row yet. */
async function scanOnce(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const now = Date.now();
    const candidates = await prisma.market.findMany({
      where: { isResolved: false, oracleResolution: { is: null }, objectId: { not: '' } },
    });

    for (const market of candidates) {
      // Confirm on-chain it really has closed and isn't already resolved.
      const resolvesAt = await getResolvesAt(market.objectId);
      if (!resolvesAt || now < resolvesAt) continue;
      const state = await getMarketState(market.objectId).catch(() => null);
      if (state?.isResolved) continue;

      try {
        // Route by settlement source: a market bound to a Pyth price feed
        // settles trustlessly on-chain; everything else falls to the AI oracle.
        const feedId = pythResolutionActive() ? await getPriceFeedId(market.objectId) : '';
        if (feedId) {
          await resolveViaPyth(market, feedId);
        } else if (config.ORACLE_ENABLED) {
          await resolveMarket(market.marketId);
        }
      } catch (err) {
        console.error(`🔮 Oracle scan error — market ${market.marketId}:`, err);
      }
    }
  } catch (err) {
    console.error('🔮 Oracle scan failed:', err);
  } finally {
    scanning = false;
  }
}

/**
 * Start the resolution worker. No-op (returns a no-op stopper) when the oracle
 * is disabled. Returns a stop function for graceful shutdown.
 */
export function startResolutionWorker(): () => void {
  const pythActive = pythResolutionActive();
  // The worker drives two settlement sources: the AI oracle (non-price markets)
  // and Pyth (financial markets). Start it if either is live.
  if (!config.ORACLE_ENABLED && !pythActive) {
    console.log(
      '🔮 Resolution worker not started — ORACLE_ENABLED=false and Pyth resolution inactive ' +
        '(set PYTH_RESOLUTION_ENABLED=true + ORACLE_SIGNER_KEY to settle price markets)',
    );
    return () => {};
  }
  if (config.ORACLE_ENABLED && config.ORACLE_AUTO_SUBMIT && !config.ORACLE_SIGNER_KEY) {
    console.warn('🔮 ORACLE_AUTO_SUBMIT is on but ORACLE_SIGNER_KEY is unset — submissions will fail');
  }
  workerTimer = setInterval(() => { void scanOnce(); }, config.ORACLE_POLL_INTERVAL_MS);
  console.log(
    `🔮 Resolution worker active — every ${config.ORACLE_POLL_INTERVAL_MS}ms` +
      ` | AI oracle=${config.ORACLE_ENABLED} (models [${config.ORACLE_MODELS.join(', ')}], auto-submit=${config.ORACLE_AUTO_SUBMIT})` +
      ` | Pyth=${pythActive}`,
  );
  return () => { if (workerTimer) clearInterval(workerTimer); };
}
