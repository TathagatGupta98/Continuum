-- CreateEnum
CREATE TYPE "RolePreference" AS ENUM ('STAKER', 'LP');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('ABOVE', 'BELOW');

-- CreateTable
CREATE TABLE "User" (
    "walletAddress" TEXT NOT NULL,
    "rolePreference" "RolePreference" NOT NULL DEFAULT 'STAKER',
    "globalAccumulatorSnapshot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalLiquidityProvided" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateTable
CREATE TABLE "Market" (
    "marketId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currentMu" DOUBLE PRECISION NOT NULL,
    "currentSigma" DOUBLE PRECISION NOT NULL,
    "totalLiquidity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "globalAccumulator" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minVarianceBound" DOUBLE PRECISION NOT NULL,
    "ammAddress" TEXT NOT NULL DEFAULT '',
    "routerAddress" TEXT NOT NULL DEFAULT '',
    "lpTokenAddress" TEXT NOT NULL DEFAULT '',
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "winningTokenId" TEXT,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("marketId")
);

-- CreateTable
CREATE TABLE "Position" (
    "positionId" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "targetValueX" DOUBLE PRECISION NOT NULL,
    "direction" "Direction" NOT NULL,
    "tokensMinted" DOUBLE PRECISION NOT NULL,
    "stakeAmount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("positionId")
);

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userAddress_fkey" FOREIGN KEY ("userAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("marketId") ON DELETE RESTRICT ON UPDATE CASCADE;
