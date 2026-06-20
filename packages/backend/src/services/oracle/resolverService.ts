/**
 * Multi-agent resolver — the LLM ensemble.
 *
 * Implements the paper's winning architecture (Architecture A: Independent
 * Aggregation). Every agent receives the SAME evidence packet and resolves the
 * market independently and in parallel — no debate / deliberation round, which
 * the paper shows degrades accuracy via persuasive error propagation.
 *
 * Continuum settles to a scalar, so each agent returns a numeric estimate of the
 * market's real-world final value (signed, market units) plus a self-reported
 * confidence and evidence-grounded reasoning.
 *
 * Ensemble is Claude-only by product decision; to claw back the diversity the
 * paper relies on (low error correlation), we span distinct model tiers
 * (Opus / Sonnet / Haiku) rather than N identical calls.
 */

import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../../config';
import type { AgentVote, EvidencePacket } from '@omnicurve/types';
import { anthropicClient, formatEvidence } from './retrievalService';

const SYSTEM_PROMPT = [
  'You are an expert prediction-market settlement oracle. You determine the',
  "real-world FINAL VALUE that a market's underlying settled at, based ONLY on",
  'the evidence provided.',
  '',
  'Instructions:',
  '1. Read the question and the evidence carefully.',
  '2. Determine the single numeric value the question settled at, in the same',
  '   units the question is expressed in (e.g. a price, an index level, a count).',
  '3. Base your answer strictly on definitive evidence describing an outcome that',
  '   has already occurred. Do not rely on forecasts or post-close information.',
  '4. If the evidence is thin, ambiguous, or contradictory, still give your best',
  '   numeric estimate but lower your confidence accordingly.',
  '5. Rate confidence from 0.0 (very uncertain) to 1.0 (certain).',
  '',
  'Output: a JSON object with `value` (number), `confidence` (0.0-1.0), and',
  '`reasoning` (cite the specific sources you used).',
].join('\n');

// Structured output schema. Numeric range constraints are validated client-side
// (the API strips them); we additionally clamp confidence below.
const VoteSchema = z.object({
  value: z.number(),
  confidence: z.number(),
  reasoning: z.string(),
});

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Resolve a market with a single model. Never throws — returns a failure vote. */
async function resolveWithModel(
  model: string,
  evidenceText: string,
): Promise<AgentVote> {
  const start = Date.now();
  try {
    const resp = await anthropicClient().messages.parse({
      model,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `${evidenceText}\n\n` +
            'Based ONLY on the evidence above, what is the final settled value? ' +
            'Respond with value, confidence, and reasoning.',
        },
      ],
      output_config: { format: zodOutputFormat(VoteSchema) },
    });

    const parsed = resp.parsed_output;
    if (!parsed) {
      return {
        model,
        value: null,
        confidence: 0,
        reasoning: '',
        latencyMs: Date.now() - start,
        error: 'no parsed output (refusal or schema mismatch)',
      };
    }
    return {
      model,
      value: parsed.value,
      confidence: clamp01(parsed.confidence),
      reasoning: parsed.reasoning,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      model,
      value: null,
      confidence: 0,
      reasoning: '',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run the full ensemble over a shared evidence packet, independently and in
 * parallel. Returns one AgentVote per configured model (failures included).
 */
export async function runEnsemble(packet: EvidencePacket): Promise<AgentVote[]> {
  const evidenceText = formatEvidence(packet);
  return Promise.all(
    config.ORACLE_MODELS.map((model) => resolveWithModel(model, evidenceText)),
  );
}
