import { Request, Response, NextFunction } from 'express';
import * as marketService from '../services/marketService';
import { calculateExpectedPrices } from '../services/mathService';

export const getMarkets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, active } = req.query;
    
    const filters: { category?: string; active?: boolean } = {};
    if (category) filters.category = category as string;
    if (active === 'true') filters.active = true;
    if (active === 'false') filters.active = false;
    
    const markets = await marketService.getMarkets(filters);
    
    res.status(200).json({
      success: true,
      data: markets,
    });
  } catch (error) {
    next(error);
  }
};

export const getMarketDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { marketId } = req.params;
    const xParam = req.query.x as string | undefined;
    
    const market = await marketService.getMarketDetails(marketId as string);
    
    if (!market) {
      return res.status(404).json({ success: false, error: 'Market not found' });
    }
    
    let expectedPrices = null;
    
    // If x is provided, optimistically calculate the prices using mathService
    if (xParam && !isNaN(Number(xParam))) {
      expectedPrices = calculateExpectedPrices(
        Number(xParam), 
        market.currentMu, 
        market.currentSigma
      );
    }
    
    res.status(200).json({
      success: true,
      data: {
        ...market,
        expectedPrices,
      },
    });
  } catch (error) {
    next(error);
  }
};
