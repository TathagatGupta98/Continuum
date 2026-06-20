/**
 * Evidence retrieval layer for the multi-agent AI oracle.
 *
 * Mirrors the paper's design (Kota, arXiv 2605.30802): a SINGLE shared evidence
 * packet is gathered once and handed identically to every resolver agent, which
 * isolates reasoning capability from retrieval quality. Retrieval uses Claude's
 * server-side `web_search` tool; results are temporally constrained to the
 * market's scheduled close (`resolves_at`) to avoid leaking post-close info.
 *
 * Continuum settles to a scalar `finalPrice`, so the question we research is
 * "what real-world value did the market's underlying settle at" rather than a
 * binary yes/no.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import type { EvidencePacket, EvidenceSource } from './types';

// Retrieval uses the strongest model for query formulation + synthesis. The
// _20260209 web_search variant (dynamic filtering) requires Opus 4.6+/Sonnet 4.6.
const RETRIEVAL_MODEL = 'claude-opus-4-8';

let client: Anthropic | null = null;

/** Lazily construct the Anthropic client (key from config or env). */
export function anthropicClient(): Anthropic {
  if (!client) {
    client = config.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
      : new Anthropic();
  }
  return client;
}

/**
 * Gather a shared, date-constrained evidence packet for a market question.
 *
 * @param marketId   Continuum market id (for packet bookkeeping).
 * @param question   The resolution question (market title / criteria).
 * @param resolvesAt Scheduled close in ms (Clock time); bounds the evidence.
 */
export async function gatherEvidence(params: {
  marketId: string;
  question: string;
  resolvesAt: number;
}): Promise<EvidencePacket> {
  const { marketId, question, resolvesAt } = params;
  const resolveDateIso = new Date(resolvesAt).toISOString().slice(0, 10);
  const query = `What is the actual real-world result/value for: ${question}`;

  const system = [
    'You are an evidence-gathering researcher for a prediction-market settlement',
    'oracle. Your job is to find authoritative, primary sources establishing the',
    'real-world outcome of the question — official results, government data,',
    'exchange/price data, reputable reporting.',
    '',
    `TEMPORAL CONSTRAINT: the market closed on ${resolveDateIso}. Only rely on`,
    'information that was observable on or before that date. Explicitly disregard',
    'forecasts, predictions, or any reporting published after the close.',
    '',
    'After searching, write a concise synthesis (3-6 sentences) of what the',
    'evidence shows about the settled value, citing the key sources. Do NOT guess',
    'a final number yourself — downstream agents do that. Surface the facts.',
  ].join('\n');

  const resp = await anthropicClient().messages.create({
    model: RETRIEVAL_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
    system,
    messages: [
      {
        role: 'user',
        content: `${query}\n\nSearch for and synthesize the authoritative evidence.`,
      },
    ],
  });

  const sources: EvidenceSource[] = [];
  let summary = '';

  for (const block of resp.content) {
    if (block.type === 'text') {
      summary += block.text;
    } else if (block.type === 'web_search_tool_result') {
      const content = (block as { content?: unknown }).content;
      // Error results arrive as a single object; success results as a list.
      if (Array.isArray(content)) {
        for (const r of content as Array<Record<string, unknown>>) {
          if (r.type === 'web_search_result') {
            sources.push({
              title: String(r.title ?? ''),
              url: String(r.url ?? ''),
              ...(r.page_age ? { publishedDate: String(r.page_age) } : {}),
              snippet: '',
            });
          }
        }
      }
    }
  }

  return {
    marketId,
    question,
    query,
    retrievedAt: new Date().toISOString(),
    resolvesAt,
    sources: sources.slice(0, config.ORACLE_MAX_SOURCES),
    summary: summary.trim(),
  };
}

/** Render an evidence packet to the plain-text block handed to each agent. */
export function formatEvidence(packet: EvidencePacket): string {
  const lines: string[] = [];
  lines.push(`QUESTION: ${packet.question}`);
  lines.push(
    `MARKET CLOSE (resolves_at): ${new Date(packet.resolvesAt).toISOString()}`,
  );
  if (packet.summary) {
    lines.push('', 'RESEARCHER SYNTHESIS:', packet.summary);
  }
  lines.push('', `SOURCES (${packet.sources.length}):`);
  packet.sources.forEach((s, i) => {
    const date = s.publishedDate ? ` (${s.publishedDate})` : '';
    lines.push(`  [${i + 1}] ${s.title}${date}`);
    if (s.url) lines.push(`      ${s.url}`);
    if (s.snippet) lines.push(`      ${s.snippet}`);
  });
  return lines.join('\n');
}
