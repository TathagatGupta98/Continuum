import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /api/docs
 *
 * Returns an OpenAPI-style JSON schema describing all available endpoints
 * for frontend developers.
 */
router.get('/', (req: Request, res: Response) => {
  const docs = {
    openapi: '3.0.0',
    info: {
      title: 'Continuum Backend API',
      version: '1.0.0',
      description: 'REST API for the Continuum prediction market protocol (Sui).',
    },
    basePath: '/api',
    endpoints: [
      {
        path: '/api/health',
        method: 'GET',
        description: 'Health check',
        response: { status: 'OK', timestamp: 'ISO 8601 string' },
      },
      {
        path: '/api/markets',
        method: 'GET',
        description: 'List all markets with optional filtering',
        queryParams: {
          category: { type: 'string', required: false, description: 'Filter by market category' },
          active: { type: 'boolean', required: false, description: 'Filter by active status (has liquidity)' },
        },
        response: { success: true, data: ['Market[]'] },
      },
      {
        path: '/api/markets/:marketId',
        method: 'GET',
        description: 'Get detailed market info including positions',
        params: { marketId: { type: 'string', required: true } },
        queryParams: {
          x: { type: 'number', required: false, description: 'Target strike price for price calculation' },
        },
        response: { success: true, data: { '...market': 'Market', expectedPrices: '{ pYes, pNo } | null' } },
      },
      {
        path: '/api/markets/:id/price',
        method: 'GET',
        description: 'Price preview for the staker UI — returns expected prices and fee breakdown',
        params: { id: { type: 'string', required: true, description: 'Market ID' } },
        queryParams: {
          x: { type: 'number', required: true, description: 'Target price strike value' },
          direction: { type: 'string', enum: ['yes', 'no'], required: true, description: 'Trade direction' },
          stakeAmount: { type: 'number', required: false, description: 'Stake amount for fee calculation (WAD float)' },
        },
        response: {
          success: true,
          data: {
            pYes: 'number (0-1)',
            pNo: 'number (0-1)',
            grossCostWad: 'number',
            feeCostWad: 'number',
            netStake: 'number',
            tokensMinted: 'number',
          },
        },
      },
      {
        path: '/api/users/:address/portfolio',
        method: 'GET',
        description: 'Get all positions for a wallet address with current value estimates',
        params: { address: { type: 'string', required: true, description: 'Sui wallet address (0x...)' } },
        response: {
          success: true,
          data: {
            address: 'string',
            positionCount: 'number',
            positions: [{
              positionId: 'string',
              marketId: 'string',
              direction: 'ABOVE | BELOW',
              tokensMinted: 'number',
              stakeAmount: 'number',
              currentValue: 'number',
              status: 'active | won | lost',
            }],
          },
        },
      },
      {
        path: '/api/markets/:id/lp-stats',
        method: 'GET',
        description: 'LP statistics — on-chain LP token balance, accumulated fees, and pending rewards',
        params: { id: { type: 'string', required: true, description: 'Market ID' } },
        queryParams: {
          address: { type: 'string', required: true, description: 'LP Sui wallet address (0x...)' },
        },
        response: {
          success: true,
          data: {
            marketId: 'string',
            lpTokenBalance: 'number (WAD float)',
            accFeePerShare: 'number (WAD float)',
            rewardDebt: 'number (WAD float)',
            pendingRewards: 'number (WAD float)',
          },
        },
      },
      {
        path: '/api/markets/:id/settle',
        method: 'POST',
        description: 'Owner-only settlement preview. Settlement is per-position against the real-world final price on-chain; this only reports μ and the implied side. Does NOT send a chain transaction.',
        params: { id: { type: 'string', required: true, description: 'Market ID' } },
        headers: {
          'x-owner-address': { type: 'string', required: true, description: 'Sui market owner address for authorization' },
        },
        body: {
          finalPrice: { type: 'number', required: true, description: 'The final outcome price' },
        },
        response: {
          success: true,
          data: {
            marketId: 'string',
            finalPrice: 'number',
            globalMu: 'number',
            impliedSide: 'YES | NO (informational, not a settlement guarantee)',
          },
        },
      },
      {
        path: '/api/oracle/escalations',
        method: 'GET',
        description: 'Human-arbitration queue: oracle resolutions the ensemble could not auto-resolve (ESCALATED) plus pipeline failures (FAILED).',
        response: {
          success: true,
          count: 'number',
          data: '[OracleResolution]  // status, aggregatedValue, meanConfidence, agreement, compositeScore, votes, evidence',
        },
      },
      {
        path: '/api/oracle/:marketId',
        method: 'GET',
        description: "A market's multi-agent oracle resolution: per-agent votes, shared evidence packet, confidence-weighted aggregate, agreement + composite escalation score, status, and tx digest.",
        params: { marketId: { type: 'string', required: true, description: 'Market ID' } },
        response: {
          success: true,
          data: {
            marketId: 'string',
            status: 'PENDING | AUTO_RESOLVED | ESCALATED | SUBMITTED | FAILED',
            aggregatedValue: 'number | null  (confidence-weighted settlement value)',
            medianValue: 'number | null',
            meanConfidence: 'number (0..1)',
            agreement: 'boolean',
            compositeScore: 'number (1[agreement] + meanConfidence, 0..2)',
            votes: '[{ model, value, confidence, reasoning, latencyMs, error? }]',
            evidence: '{ question, query, retrievedAt, resolvesAt, sources, summary }',
            txDigest: 'string | null',
          },
        },
      },
      {
        path: '/api/oracle/:marketId/resolve',
        method: 'POST',
        description: 'Manually trigger (or re-run) the AI oracle pipeline for a market — gather shared evidence, run the independent LLM ensemble, aggregate, and (if ORACLE_AUTO_SUBMIT) submit set_final_price on-chain.',
        params: { marketId: { type: 'string', required: true, description: 'Market ID' } },
        response: { success: true, data: 'OracleDecision' },
      },
    ],
    socketEvents: {
      client: {
        joinMarket: { payload: 'marketId: string', description: 'Subscribe to real-time updates for a market' },
        leaveMarket: { payload: 'marketId: string', description: 'Unsubscribe from market updates' },
      },
      server: {
        marketStateUpdated: {
          payload: '{ currentMu, currentSigma, totalLiquidity }',
          description: 'Emitted to market room when on-chain state changes',
        },
        marketResolved: {
          payload: '{ winningTokenId }  // carries the settlement finalPrice as a string',
          description: 'Emitted to market room when market is resolved',
        },
      },
    },
    rateLimit: {
      window: '1 minute',
      maxRequests: 100,
      scope: 'Per IP, all /api/* routes',
    },
  };

  res.status(200).json(docs);
});

export default router;
