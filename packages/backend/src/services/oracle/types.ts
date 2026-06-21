/**
 * Local oracle types for the backend.
 *
 * Mirrors the shared shapes in `@continuum/types` (EvidencePacket, AgentVote,
 * OracleDecision, …). Kept local because the backend's tsconfig `rootDir` is
 * `./src`, so importing the workspace `types` source directly trips TS6059.
 * The canonical/shared copy lives in `packages/types` for the frontend.
 */

export interface EvidenceSource {
  title: string;
  url: string;
  publishedDate?: string;
  snippet: string;
}

export interface EvidencePacket {
  marketId: string;
  question: string;
  query: string;
  retrievedAt: string;
  resolvesAt: number;
  sources: EvidenceSource[];
  summary?: string;
}

export interface AgentVote {
  model: string;
  value: number | null;
  confidence: number;
  reasoning: string;
  latencyMs: number;
  error?: string;
}

export type OracleStatus =
  | 'PENDING'
  | 'AUTO_RESOLVED'
  | 'ESCALATED'
  | 'SUBMITTED'
  | 'FAILED';

export interface OracleDecision {
  marketId: string;
  status: OracleStatus;
  aggregatedValue: number | null;
  medianValue: number | null;
  meanConfidence: number;
  agreement: boolean;
  compositeScore: number;
  votes: AgentVote[];
  evidence: EvidencePacket;
  txDigest?: string;
}
