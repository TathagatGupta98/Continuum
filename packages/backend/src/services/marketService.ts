import prisma from '../models/db';

export const getMarkets = async (filters: { category?: string; active?: boolean }) => {
  const where: any = {};
  
  if (filters.category) {
    where.category = filters.category;
  }
  
  if (filters.active !== undefined) {
    if (filters.active) {
      where.totalLiquidity = { gt: 0 };
    }
  }

  return prisma.market.findMany({
    where,
    orderBy: { totalLiquidity: 'desc' },
  });
};

export const getMarketDetails = async (marketId: string) => {
  return prisma.market.findUnique({
    where: { marketId },
    include: {
      positions: true,
    }
  });
};
