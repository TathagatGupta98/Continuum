import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../models/db';
import { resolveMarket, resolvePythMarket } from '../services/oracle/oracleService';

const router = Router();

/** Shape an OracleResolution DB row into an API response (parse JSON columns). */
function serialize(row: {
  marketId: string;
  status: string;
  aggregatedValue: number | null;
  medianValue: number | null;
  meanConfidence: number | null;
  agreement: boolean;
  compositeScore: number | null;
  agentVotesJson: string | null;
  evidenceJson: string | null;
  txDigest: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const safeParse = (s: string | null) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  return {
    marketId: row.marketId,
    status: row.status,
    aggregatedValue: row.aggregatedValue,
    medianValue: row.medianValue,
    meanConfidence: row.meanConfidence,
    agreement: row.agreement,
    compositeScore: row.compositeScore,
    votes: safeParse(row.agentVotesJson) ?? [],
    evidence: safeParse(row.evidenceJson),
    txDigest: row.txDigest,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * GET /api/oracle/escalations
 * Human-arbitration queue: markets the ensemble could not auto-resolve
 * (split / low-confidence) plus pipeline failures.
 */
router.get('/escalations', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.oracleResolution.findMany({
      where: { status: { in: ['ESCALATED', 'FAILED'] } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ success: true, count: rows.length, data: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/oracle/:marketId
 * The oracle resolution (votes, evidence, score, status) for one market.
 */
router.get('/:marketId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const marketId = String(req.params.marketId);
    const row = await prisma.oracleResolution.findUnique({ where: { marketId } });
    if (!row) {
      return res.status(404).json({ success: false, error: 'No oracle resolution for this market' });
    }
    res.json({ success: true, data: serialize(row) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/oracle/:marketId/resolve
 * Manually trigger (or re-run) the resolution pipeline for a market. Useful for
 * re-attempting a FAILED market or forcing resolution outside the worker cadence.
 */
router.post('/:marketId/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const marketId = String(req.params.marketId);
    const market = await prisma.market.findUnique({ where: { marketId } });
    if (!market) {
      return res.status(404).json({ success: false, error: 'Market not found' });
    }
    const decision = await resolveMarket(marketId);
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/oracle/:marketId/resolve-pyth
 * Trustless on-chain settlement for a Pyth-bound (financial) market: refreshes
 * the bound Pyth feed and calls `market::resolve_with_pyth` in one PTB. The Move
 * call is permissionless (the backend signer only pays gas), and the market must
 * have closed (`now >= resolves_at`) or the contract aborts. Used by the
 * frontend "Resolve via Pyth" button; the worker covers automated settlement.
 */
router.post('/:marketId/resolve-pyth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const marketId = String(req.params.marketId);
    const result = await resolvePythMarket(marketId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
