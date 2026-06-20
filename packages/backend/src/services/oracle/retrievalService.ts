/**
 * Evidence retrieval layer for the multi-agent AI oracle.
 *
 * Mirrors the paper's design (Kota, arXiv 2605.30802): a SINGLE shared evidence
 * packet is gathered once and handed identically to every resolver agent, which
 * isolates reasoning capability from retrieval quality. Retrieval runs through
 * GroqCloud using an agentic model with built-in web search (`groq/compound` by
 * default); the prompt temporally constrains results to the market's scheduled
 * close (`resolves_at`) to avoid leaking post-close info.
 *
 * Continuum settles to a scalar `finalPrice`, so the question we research is
 * "what real-world value did the market's underlying settle at" rather than a
 * binary yes/no.
 */

import Groq from 'groq-sdk';
import { config } from '../../config';
import type { EvidencePacket, EvidenceSource } from './types';

let client: Groq | null = null;

/** Lazily construct the Groq client (shared by retrieval + the ensemble). */
export function groqClient(): Groq {
  if (!client) {
    client = new Groq({
      apiKey: config.GROQ_API_KEY,
      ...(config.GROQ_BASE_URL ? { baseURL: config.GROQ_BASE_URL } : {}),
    });
  }
  return client;
}

/** Web-search-enabled retrieval model (agentic; e.g. `groq/compound`). */
function retrievalModel(): string {
  return config.ORACLE_RETRIEVAL_MODEL;
}

// Groq's agentic (compound) models surface the searches they ran under
// `message.executed_tools`. The exact shape isn't strongly typed by the SDK, so
// we defensively pull title/url/snippet out of whatever the tool returned.
interface ExecutedTool {
  type?: string;
  // Compound returns search hits either as a structured array or a JSON string.
  search_results?: { results?: RawSearchResult[] } | RawSearchResult[];
  output?: unknown;
}

interface RawSearchResult {
  title?: string;
  url?: string;
  link?: string;
  content?: string;
  snippet?: string;
  date?: string;
  published_date?: string;
}

/** Coerce one raw search hit into our EvidenceSource shape. */
function toSource(r: RawSearchResult): EvidenceSource | null {
  const url = r.url ?? r.link;
  if (!url) return null;
  return {
    title: r.title ?? '',
    url,
    snippet: r.content ?? r.snippet ?? '',
    ...(r.date || r.published_date ? { publishedDate: r.date ?? r.published_date } : {}),
  };
}

/** Pull every web-search hit out of a compound message's executed_tools. */
function extractSources(executedTools: ExecutedTool[]): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  for (const tool of executedTools) {
    let raw: RawSearchResult[] = [];
    const sr = tool.search_results;
    if (Array.isArray(sr)) {
      raw = sr;
    } else if (sr && Array.isArray(sr.results)) {
      raw = sr.results;
    } else if (typeof tool.output === 'string') {
      // Some tool outputs arrive as a JSON string; parse best-effort.
      try {
        const parsed = JSON.parse(tool.output) as { results?: RawSearchResult[] };
        if (Array.isArray(parsed.results)) raw = parsed.results;
      } catch {
        /* not JSON — ignore */
      }
    }
    for (const r of raw) {
      const s = toSource(r);
      if (s) sources.push(s);
    }
  }
  return sources;
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
    'oracle. Use web search to find authoritative, primary sources establishing',
    'the real-world outcome of the question — official results, government data,',
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

  const resp = await groqClient().chat.completions.create({
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

  const executedTools =
    (message as { executed_tools?: ExecutedTool[] } | undefined)?.executed_tools ?? [];
  const sources = extractSources(executedTools);

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
