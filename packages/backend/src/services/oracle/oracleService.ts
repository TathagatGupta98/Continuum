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

  // Mark in-progress so concurrent passes don't double-fire.
  await prisma.oracleResolution.upsert({
    where: { marketId },
    create: { marketId, status: 'PENDING' },
    update: { status: 'PENDING', error: null },
  });

  const resolvesAt = await getResolvesAt(market.objectId);

  let decision: OracleDecision;
  try {
    const evidence = await gatherEvidence({
      marketId,
      question: market.title,
      resolvesAt,
    });
    const votes = await runEnsemble(evidence);
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
    console.error(`🔮 Oracle FAILED — market ${marketId}: ${message}`);
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
      console.log(`🔮 Oracle SUBMITTED — market ${marketId} @ ${decision.aggregatedValue} (tx ${digest})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await persist(decision, `auto-submit failed: ${message}`);
      console.error(`🔮 Oracle auto-submit failed — market ${marketId}: ${message}`);
      return decision;
    }
  } else {
    console.log(
      `🔮 Oracle ${decision.status} — market ${marketId} ` +
        `(value=${decision.aggregatedValue}, conf=${decision.meanConfidence.toFixed(2)}, ` +
        `agree=${decision.agreement}, score=${decision.compositeScore.toFixed(2)})`,
    );
  }

  await persist(decision);
  return decision;
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
        await resolveMarket(market.marketId);
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
  if (!config.ORACLE_ENABLED) {
    console.log('🔮 Oracle disabled (ORACLE_ENABLED=false) — resolution worker not started');
    return () => {};
  }
  if (config.ORACLE_AUTO_SUBMIT && !config.ORACLE_SIGNER_KEY) {
    console.warn('🔮 ORACLE_AUTO_SUBMIT is on but ORACLE_SIGNER_KEY is unset — submissions will fail');
  }
  workerTimer = setInterval(() => { void scanOnce(); }, config.ORACLE_POLL_INTERVAL_MS);
  console.log(
    `🔮 Oracle resolution worker active — every ${config.ORACLE_POLL_INTERVAL_MS}ms, ` +
      `models [${config.ORACLE_MODELS.join(', ')}], auto-submit=${config.ORACLE_AUTO_SUBMIT}`,
  );
  return () => { if (workerTimer) clearInterval(workerTimer); };
}
