/**
 * Aggregation + escalation for the multi-agent AI oracle.
 *
 * Adapts the paper's confidence-weighted independent aggregation and its
 * agreement-based escalation framework to Continuum's scalar settlement:
 *
 *  - aggregate  = confidence-weighted mean of agent estimates (median fallback).
 *  - agreement  = all agent estimates within a relative tolerance band (the
 *                 scalar analogue of the paper's unanimous-vote signal).
 *  - composite  = 1[agreement] + meanConfidence   (range 0..2).
 *  - auto-resolve only when agents agree AND meanConfidence ≥ threshold AND a
 *    quorum (≥2) of agents produced a usable estimate; otherwise ESCALATE to a
 *    human. Zero usable estimates → FAILED.
 *
 * Auto-resolution is strict on purpose: a single-model (or same-vendor) ensemble
 * has higher error correlation than a cross-model one, so escalation is the
 * safety net. Configure `ORACLE_MODELS` with several distinct OpenRouter models
 * to lower that correlation.
 */

import { config } from '../../config';
import type { AgentVote, EvidencePacket, OracleDecision, OracleStatus } from './types';

const MIN_QUORUM = 2;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : (((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

/** True when every estimate lies within `tolerance · max(|aggregate|, 1)`. */
function withinTolerance(values: number[], aggregate: number): boolean {
  if (values.length < MIN_QUORUM) return false;
  const spread = Math.max(...values) - Math.min(...values);
  const band = config.ORACLE_AGREEMENT_TOLERANCE * Math.max(Math.abs(aggregate), 1);
  return spread <= band;
}

/**
 * Reduce a set of independent agent votes into an escalation-scored decision.
 * Pure — no I/O. The caller persists the result and (optionally) submits.
 */
export function aggregate(marketId: string, votes: AgentVote[], evidence: EvidencePacket): OracleDecision {
  const valid = votes.filter((v): v is AgentVote & { value: number } => v.value !== null);

  // Mean confidence over the agents that actually produced an estimate.
  const meanConfidence = valid.length
    ? valid.reduce((s, v) => s + v.confidence, 0) / valid.length
    : 0;

  let aggregatedValue: number | null = null;
  let medianValue: number | null = null;
  let agreement = false;
  let status: OracleStatus;

  if (valid.length === 0) {
    status = 'FAILED';
  } else {
    const values = valid.map((v) => v.value);
    medianValue = median(values);

    // Confidence-weighted mean; fall back to median if all confidences are 0.
    const wsum = valid.reduce((s, v) => s + v.confidence, 0);
    aggregatedValue = wsum > 0
      ? valid.reduce((s, v) => s + v.confidence * v.value, 0) / wsum
      : medianValue;

    agreement = withinTolerance(values, aggregatedValue);

    const autoResolve =
      agreement &&
      valid.length >= MIN_QUORUM &&
      meanConfidence >= config.ORACLE_CONFIDENCE_THRESHOLD;

    status = autoResolve ? 'AUTO_RESOLVED' : 'ESCALATED';
  }

  const compositeScore = (agreement ? 1 : 0) + meanConfidence;

  return {
    marketId,
    status,
    aggregatedValue,
    medianValue,
    meanConfidence,
    agreement,
    compositeScore,
    votes,
    evidence,
  };
}
