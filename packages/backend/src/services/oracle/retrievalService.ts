/**
 * Evidence retrieval layer for the multi-agent AI oracle.
 *
 * Mirrors the paper's design (Kota, arXiv 2605.30802): a SINGLE shared evidence
 * packet is gathered once and handed identically to every resolver agent, which
 * isolates reasoning capability from retrieval quality. Retrieval runs through
 * OpenRouter using the model's `:online` web-search plugin; the prompt
 * temporally constrains results to the market's scheduled close (`resolves_at`)
 * to avoid leaking post-close info.
 *
 * Continuum settles to a scalar `finalPrice`, so the question we research is
 * "what real-world value did the market's underlying settle at" rather than a
 * binary yes/no.
 */

import OpenAI from 'openai';
import { config } from '../../config';
import type { EvidencePacket, EvidenceSource } from './types';

let client: OpenAI | null = null;

/** Lazily construct the OpenRouter (OpenAI-compatible) client. */
export function openrouterClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.OPENROUTER_API_KEY,
      baseURL: config.OPENROUTER_BASE_URL,
    });
  }
  return client;
}

/**
 * Web-search-enabled model id. OpenRouter's `:online` suffix attaches its web
 * plugin to any model, returning `url_citation` annotations on the message.
 */
function retrievalModel(): string {
  const base = config.ORACLE_RETRIEVAL_MODEL;
  return base.endsWith(':online') ? base : `${base}:online`;
}

// OpenRouter annotates web-grounded answers with url_citation objects.
interface UrlCitationAnnotation {
  type: 'url_citation';
  url_citation: { url?: string; title?: string; content?: string };
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

  const resp = await openrouterClient().chat.completions.create({
    model: retrievalModel(),
    max_tokens: 4096,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `${query}\n\nSearch for and synthesize the authoritative evidence.`,
      },
    ],
  });

  const message = resp.choices[0]?.message;
  const summary = (message?.content ?? '').trim();

  const sources: EvidenceSource[] = [];
  const annotations =
    (message as { annotations?: UrlCitationAnnotation[] } | undefined)
      ?.annotations ?? [];
  for (const a of annotations) {
    if (a.type === 'url_citation' && a.url_citation?.url) {
      sources.push({
        title: a.url_citation.title ?? '',
        url: a.url_citation.url,
        snippet: a.url_citation.content ?? '',
      });
    }
  }

  return {
    marketId,
    question,
    query,
    retrievedAt: new Date().toISOString(),
    resolvesAt,
    sources: sources.slice(0, config.ORACLE_MAX_SOURCES),
    summary,
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
