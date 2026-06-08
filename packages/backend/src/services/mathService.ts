// @ts-ignore
import { jStat } from 'jstat';

/**
 * Calculates the expected probabilities/prices for YES and NO tokens based on the
 * continuous distribution AMM model (Gaussian).
 * 
 * @param x The target price strike
 * @param mu The current peak/mean of the distribution
 * @param sigma The current standard deviation
 */
export const calculateExpectedPrices = (x: number, mu: number, sigma: number) => {
  const safeSigma = Math.max(sigma, 0.000001); // Prevent division by zero
  
  // CDF gives the area under the curve up to X
  const cdf = jStat.normal.cdf(x, mu, safeSigma);
  
  // According to OmniCurve math:
  // P_NO = CDF(X)
  // P_YES = 1 - CDF(X)
  return {
    pYes: 1 - cdf,
    pNo: cdf,
  };
};

/**
 * Calculates expected prices + gross/fee cost breakdown for the staker UI price preview.
 * Mirrors the on-chain Router.buy_internal fee logic (C2: 1% fee on stake).
 *
 * @param x The target price strike
 * @param direction 'yes' or 'no'
 * @param mu The current peak/mean of the distribution
 * @param sigma The current standard deviation
 * @param stakeAmount Optional — if provided, computes grossCostWad and feeCostWad
 */
export const calculatePricePreview = (
  x: number,
  direction: 'yes' | 'no',
  mu: number,
  sigma: number,
  stakeAmount?: number,
) => {
  const { pYes, pNo } = calculateExpectedPrices(x, mu, sigma);
  const price = direction === 'yes' ? pYes : pNo;

  // Fee = 1% of stake (mirrors Router.buy_internal C2)
  const grossCostWad = stakeAmount ?? 0;
  const feeCostWad = grossCostWad * 0.01;
  const netStake = grossCostWad - feeCostWad;
  const tokensMinted = price > 0 ? netStake / price : 0;

  return { pYes, pNo, grossCostWad, feeCostWad, netStake, tokensMinted };
};
