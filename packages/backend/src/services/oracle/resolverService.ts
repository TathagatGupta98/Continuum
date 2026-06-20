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
 * The ensemble runs over GroqCloud. Each configured `ORACLE_MODELS` id is one
 * "sub-agent" dispatched in parallel; the default is a diverse, cross-family set
 * of Groq models, which recovers the low error correlation the paper relies on.
 */

import { config } from '../../config';
import type { AgentVote, EvidencePacket } from './types';
import { groqClient, formatEvidence } from './retrievalService';

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
  'Output ONLY a single JSON object (no markdown, no prose around it) with keys:',
  '`value` (number), `confidence` (number 0.0-1.0), and `reasoning` (string that',
  'cites the specific sources you used).',
].join('\n');

interface ParsedVote {
  value: number;
  confidence: number;
  reasoning: string;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Extract a JSON vote from a model response. Reasoning-style models can wrap or
 * precede the object with text even under json mode, so we fall back to the
 * first balanced `{…}` block.
 */
function parseVote(raw: string): ParsedVote | null {
  const tryParse = (s: string): ParsedVote | null => {
    try {
      const o = JSON.parse(s) as ParsedVote;
      return o && typeof o.value === 'number' ? o : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw.trim());
  if (direct) return direct;
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? tryParse(match[0]) : null;
}

/** Resolve a market with a single model. Never throws — returns a failure vote. */
async function resolveWithModel(
  model: string,
  evidenceText: string,
): Promise<AgentVote> {
  const start = Date.now();
  try {
    const resp = await groqClient().chat.completions.create({
      model,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `${evidenceText}\n\n` +
            'Based ONLY on the evidence above, what is the final settled value? ' +
            'Respond with a JSON object containing value, confidence, and reasoning.',
        },
      ],
    });

    const message = resp.choices[0]?.message;
    const raw = message?.content ?? '';
    const parsed = raw ? parseVote(raw) : null;
    if (!parsed || typeof parsed.value !== 'number') {
      return {
        model,
        value: null,
        confidence: 0,
        reasoning: raw.slice(0, 500),
        latencyMs: Date.now() - start,
        error: 'unparseable model output',
      };
    }
    return {
      model,
      value: parsed.value,
      confidence: clamp01(parsed.confidence),
      reasoning: parsed.reasoning ?? '',
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
