import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../models/db';
import { calculateExpectedPrices } from '../services/mathService';
import { getLpStats } from '../services/chainService';

const router = Router();

// Sui addresses are 0x + up to 64 hex chars (32 bytes; leading zeros may be trimmed).
const SUI_ADDR = /^0x[a-fA-F0-9]{1,64}$/;

/**
 * GET /api/users/:address/portfolio
 *
 * Returns all positions for a given wallet address, enriched with
 * current token value estimates and market state.
 */
router.get('/:address/portfolio', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = String(req.params.address);

    // Validate Sui address format
    if (!SUI_ADDR.test(address)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Sui address format',
      });
    }

    const positions = await prisma.position.findMany({
      where: { userAddress: address.toLowerCase() },
      include: { market: true },
    });

    // Enrich each position with current value estimate
    const enrichedPositions = positions.map((pos) => {
      const market = pos.market;
      let currentValue = 0;
      let status: 'active' | 'won' | 'lost' = 'active';

      if (market.isResolved) {
        // Resolved: settlement is per-position against the real-world final
        // price. YES wins iff finalPrice ≥ strike, NO wins iff finalPrice < strike.
        const isYes = pos.direction === 'ABOVE';
        const finalPrice = market.finalPrice ?? 0;
        const userWon = isYes ? finalPrice >= pos.targetValueX : finalPrice < pos.targetValueX;
        currentValue = userWon ? pos.tokensMinted : 0;
        status = userWon ? 'won' : 'lost';
      } else {
        // Not resolved: estimate value from current prices
        const prices = calculateExpectedPrices(
          pos.targetValueX,
          market.currentMu,
          market.currentSigma,
        );
        const currentPrice = pos.direction === 'ABOVE' ? prices.pYes : prices.pNo;
        currentValue = pos.tokensMinted * currentPrice;
      }

      return {
        positionId: pos.positionId,
        marketId: pos.marketId,
        marketTitle: market.title,
        direction: pos.direction,
        targetValueX: pos.targetValueX,
        tokensMinted: pos.tokensMinted,
        stakeAmount: pos.stakeAmount,
        currentValue,
        status,
        market: {
          title: market.title,
          objectId: market.objectId,
          collateralType: market.collateralType,
          currentMu: market.currentMu,
          currentSigma: market.currentSigma,
          totalLiquidity: market.totalLiquidity,
          isResolved: market.isResolved,
          finalPrice: market.finalPrice,
        },
      };
    });

    // ─── LP positions ────────────────────────────────────────────────────
    // Trade positions only cover users who bought YES/NO tokens. Liquidity
    // providers never create Position rows, so their on-chain LP balance must
    // be read directly. Scan every market and include any with a non-zero LP
    // balance for this wallet, enriched with pending fee rewards.
    const markets = await prisma.market.findMany();

    const lpPositionResults = await Promise.all(
      markets.map(async (market) => {
        try {
          if (!market.objectId) return null;
          const { lpTokenBalance: lpBalance, pendingRewards } = await getLpStats(
            market.objectId,
            market.collateralType,
            address,
          );
          if (lpBalance <= 0) return null;

          return {
            marketId: market.marketId,
            marketTitle: market.title,
            lpBalance,
            pendingRewards,
            market: {
              title: market.title,
              objectId: market.objectId,
              collateralType: market.collateralType,
              totalLiquidity: market.totalLiquidity,
              isResolved: market.isResolved,
              finalPrice: market.finalPrice,
            },
          };
        } catch (err) {
          // A single market's read failing shouldn't blank the whole portfolio
          console.error(`LP read failed for market ${market.marketId}:`, err);
          return null;
        }
      }),
    );

    const lpPositions = lpPositionResults.filter(
      (p): p is NonNullable<typeof p> => p !== null,
    );

    const totalValue = enrichedPositions.reduce((sum, p) => sum + p.currentValue, 0);

    res.status(200).json({
      success: true,
      data: {
        address,
        positionCount: enrichedPositions.length,
        positions: enrichedPositions,
        lpPositions,
        totalValue,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
