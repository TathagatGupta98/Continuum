import { useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { useQuery } from '@tanstack/react-query'
import { Tabs } from '@/components/ui/Tabs'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useLP } from '@/hooks/useLP'
import { api } from '@/lib/api'
import { floatToWad, wadToFloat } from '@/lib/math'
import { formatTxError, isUserRejection } from '@/lib/errors'
import { explorerUrl } from '@/config/sui'
import { getMarketSeedState } from '@/lib/sui'
import type { Market } from '@/lib/api'

const TABS = [
  { label: 'Deposit', value: 'deposit' },
  { label: 'Withdraw', value: 'withdraw' },
  { label: 'Claim Fees', value: 'claim' },
]

interface LPPanelProps {
  market: Market
}

export function LPPanel({ market }: LPPanelProps) {
  const address = useCurrentAccount()?.address
  const [tab, setTab] = useState('deposit')
  const [depositAmount, setDepositAmount] = useState('')
  const sigmaDefault = market.currentSigma > market.minVarianceBound ? market.currentSigma : ''
  const [targetMu, setTargetMu] = useState(market.currentMu > 0 ? String(market.currentMu) : '')
  const [targetSigma, setTargetSigma] = useState(sigmaDefault ? String(sigmaDefault) : '')
  const [withdrawAmount, setWithdrawAmount] = useState('')

  const { step, add, remove, claim, reset, txHash, error } = useLP({
    marketId: market.marketId,
    objectId: market.objectId,
    collateralType: market.collateralType,
  })

  // On-chain seed state: an unseeded market (σ = 0) can only be initialized by
  // its creator via set_distribution — LP deposits never move the curve. On Sui
  // every field is a public Move object field (no raw storage-slot reads needed).
  const { data: seedState } = useQuery({
    queryKey: ['market-seed-state', market.objectId],
    enabled: !!market.objectId,
    staleTime: 30_000,
    queryFn: () => getMarketSeedState(market.objectId),
  })

  const unseeded = seedState ? !seedState.seeded : market.currentSigma <= 0
  const canSeed =
    unseeded &&
    !!address &&
    !!seedState &&
    (seedState.owner === address.toLowerCase() || seedState.pendingOwner === address.toLowerCase())
  const sigmaMin = Math.max(seedState?.sigmaMin ?? 0, market.minVarianceBound)

  // Total LP shares (WAD u256) read from the market object — the Sui analogue of
  // the EVM LP-token totalSupply.
  const totalSupply = seedState?.totalShares

  const { data: lpStats } = useQuery({
    queryKey: ['lp-stats', market.marketId, address],
    queryFn: () => api.getLpStats(market.marketId, address!),
    enabled: !!address,
    staleTime: 30_000,
  })

  const totalSupplyFloat = totalSupply ? wadToFloat(totalSupply) : 0
  const totalLiqFloat = market.totalLiquidity

  const depositAmt = parseFloat(depositAmount) || 0
  const estimatedShares =
    totalSupplyFloat > 0 && totalLiqFloat > 0
      ? (depositAmt / totalLiqFloat) * totalSupplyFloat
      : depositAmt

  const lpBalance = lpStats?.lpTokenBalance ?? 0
  const withdrawAmt = parseFloat(withdrawAmount) || 0
  const estimatedUsdc =
    totalSupplyFloat > 0 ? (withdrawAmt / totalSupplyFloat) * totalLiqFloat : 0
  const exceedsBalance = withdrawAmt > lpBalance

  const isWorking =
    step === 'approving' || step === 'accepting' || step === 'seeding' || step === 'submitting'
  const isConfirmed = step === 'confirmed'

  const parsedMu = parseFloat(targetMu)
  const parsedSigma = parseFloat(targetSigma)
  const sigmaError =
    canSeed && targetSigma !== '' && parsedSigma <= sigmaMin
      ? `σ must be > ${sigmaMin} (contract minimum)`
      : undefined

  const needsDistribution = canSeed && (!(parsedMu > 0) || !(parsedSigma > 0))

  const handleDeposit = () => {
    if (!depositAmt || sigmaError || needsDistribution) return
    add(depositAmt, canSeed ? { mu: parsedMu, sigma: parsedSigma } : undefined)
  }

  const handleWithdraw = () => {
    if (!withdrawAmt) return
    remove(floatToWad(withdrawAmt))
  }

  if (!address) {
    return (
      <div className="px-6 py-12 text-center space-y-2">
        <p className="text-sm font-mono text-[rgba(35,24,18,0.40)]">
          Connect your wallet to provide liquidity
        </p>
        <p className="text-xs font-mono text-[rgba(35,24,18,0.28)]">
          LPs earn 1% of every trade's volume
        </p>
      </div>
    )
  }

  return (
    <div>
      <Tabs tabs={TABS} active={tab} onChange={(v) => { setTab(v); reset() }} />

      <div className="px-6 pb-6 pt-4 space-y-6">

        {/* LP Stats bar */}
        {lpStats && (
          <div className="grid grid-cols-3 gap-3 p-4 rounded-lg bg-[rgba(62,44,30,0.03)] border border-[rgba(62,44,30,0.10)]">
            <div className="text-center">
              <p className="text-[9px] font-display tracking-widest text-[rgba(35,24,18,0.45)] uppercase mb-1">
                Your LP Balance
              </p>
              <p className="font-mono text-sm text-[#C8102E] font-600">
                {lpStats.lpTokenBalance.toFixed(4)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[9px] font-display tracking-widest text-[rgba(35,24,18,0.45)] uppercase mb-1">
                Pending Fees
              </p>
              <p className="font-mono text-sm text-[#0B7A52] font-600">
                ${lpStats.pendingRewards.toFixed(4)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[9px] font-display tracking-widest text-[rgba(35,24,18,0.45)] uppercase mb-1">
                Pool TVL
              </p>
              <p className="font-mono text-sm text-[rgba(35,24,18,0.80)]">
                ${totalLiqFloat.toFixed(2)}
              </p>
            </div>
          </div>
        )}

        {/* ── Deposit tab ──────────────────────────────────────── */}
        {tab === 'deposit' && (
          <>
            {/* Explainer */}
            <div className="rounded-lg bg-[rgba(200,16,46,0.06)] border border-[rgba(200,16,46,0.15)] px-4 py-3.5 space-y-1">
              <p className="text-xs font-display tracking-wider text-[#C8102E] uppercase">
                How LP deposits work
              </p>
              <p className="text-[11px] font-mono text-[rgba(35,24,18,0.55)] leading-relaxed">
                Your USDC becomes collateral that backs every trade in this market.
                You receive LP tokens representing your share of the pool, and earn
                <span className="text-[#C8102E]"> 1% of every trade</span> in proportion to your share.
              </p>
            </div>

            <Input
              label="Amount to deposit"
              type="number"
              placeholder="0.00"
              suffix="USDC"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
            />

            {canSeed ? (
              <div className="space-y-3">
                <p className="text-[11px] font-mono text-[rgba(35,24,18,0.45)] leading-relaxed">
                  You created this market and its curve isn't seeded yet. Set the initial
                  distribution below — it will be applied on-chain (setDistribution) before
                  your deposit.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Initial μ — expected price"
                    type="number"
                    placeholder="e.g. 95000"
                    value={targetMu}
                    onChange={(e) => setTargetMu(e.target.value)}
                  />
                  <Input
                    label={`Initial σ (min: ${sigmaMin})`}
                    type="number"
                    placeholder={`> ${sigmaMin}`}
                    value={targetSigma}
                    error={sigmaError}
                    onChange={(e) => setTargetSigma(e.target.value)}
                  />
                </div>
                {needsDistribution && depositAmt > 0 && (
                  <p className="text-xs font-mono text-[#C8102E] bg-[rgba(200,16,46,0.06)] border border-[rgba(200,16,46,0.18)] rounded-lg p-3">
                    Set μ and σ above to initialize the pool distribution.
                  </p>
                )}
              </div>
            ) : unseeded ? (
              <div className="rounded-lg bg-[rgba(62,44,30,0.03)] border border-[rgba(62,44,30,0.10)] px-4 py-3">
                <p className="text-[11px] font-mono text-[rgba(35,24,18,0.50)] leading-relaxed">
                  This market's probability curve hasn't been seeded by its creator yet.
                  You can still deposit collateral, but trading stays unavailable until
                  the creator sets the initial μ/σ.
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-[rgba(62,44,30,0.03)] border border-[rgba(62,44,30,0.10)] px-4 py-3">
                <p className="text-[11px] font-mono text-[rgba(35,24,18,0.50)] leading-relaxed">
                  The curve is live and driven by bets. Your deposit will be added at
                  the current distribution.
                </p>
              </div>
            )}

            {depositAmt > 0 && (
              <div className="flex items-center justify-between text-xs font-mono px-1">
                <span className="text-[rgba(35,24,18,0.50)]">Estimated LP tokens you'll receive</span>
                <span className="text-[#231812] font-600">{estimatedShares.toFixed(4)} OCLP</span>
              </div>
            )}

            <Button
              variant="primary"
              className="w-full"
              loading={isWorking}
              disabled={!depositAmt || isWorking || !!sigmaError || needsDistribution}
              onClick={handleDeposit}
            >
              {step === 'approving'
                ? 'Approving USDC...'
                : step === 'accepting'
                  ? 'Accepting market ownership...'
                  : step === 'seeding'
                    ? 'Seeding the curve (setDistribution)...'
                    : 'Add Liquidity'}
            </Button>
          </>
        )}

        {/* ── Withdraw tab ─────────────────────────────────────── */}
        {tab === 'withdraw' && (
          <>
            {/* Explainer */}
            <div className="rounded-lg bg-[rgba(62,44,30,0.03)] border border-[rgba(62,44,30,0.10)] px-4 py-3.5 space-y-1">
              <p className="text-xs font-display tracking-wider text-[rgba(35,24,18,0.60)] uppercase">
                How withdrawals work
              </p>
              <p className="text-[11px] font-mono text-[rgba(35,24,18,0.50)] leading-relaxed">
                Burn your LP tokens to reclaim your proportional share of pool collateral.
                The USDC you receive may differ from your deposit if the pool's size changed.
              </p>
            </div>

            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[rgba(35,24,18,0.55)]">Your LP balance</span>
              <button
                type="button"
                className="font-mono text-[#C8102E] hover:underline disabled:no-underline disabled:opacity-40"
                disabled={lpBalance <= 0}
                onClick={() => setWithdrawAmount(String(lpBalance))}
              >
                {lpBalance.toFixed(4)} OCLP · Max
              </button>
            </div>

            <Input
              label="LP token amount to burn"
              type="number"
              placeholder="0.00"
              value={withdrawAmount}
              error={exceedsBalance ? 'Amount exceeds your LP balance' : undefined}
              onChange={(e) => setWithdrawAmount(e.target.value)}
            />

            {withdrawAmt > 0 && !exceedsBalance && (
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-[rgba(35,24,18,0.55)]">Estimated USDC received</span>
                  <span className="text-[#C8102E] font-600">${estimatedUsdc.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[rgba(35,24,18,0.55)]">Network fee</span>
                  <span className="text-[rgba(35,24,18,0.70)]">Paid in SUI (shown in wallet)</span>
                </div>
              </div>
            )}

            <Button
              variant="ghost"
              className="w-full"
              loading={isWorking}
              disabled={!withdrawAmt || isWorking || exceedsBalance}
              onClick={handleWithdraw}
            >
              Remove Liquidity
            </Button>
          </>
        )}

        {/* ── Claim tab ────────────────────────────────────────── */}
        {tab === 'claim' && (
          <>
            {/* Explainer */}
            <div className="rounded-lg bg-[rgba(11,122,82,0.05)] border border-[rgba(11,122,82,0.18)] px-4 py-3.5 space-y-1">
              <p className="text-xs font-display tracking-wider text-[rgba(11,122,82,0.80)] uppercase">
                How fee claims work
              </p>
              <p className="text-[11px] font-mono text-[rgba(35,24,18,0.50)] leading-relaxed">
                1% of every trade is distributed to LPs in proportion to their pool share.
                Claiming does <span className="text-[#231812]">not</span> remove your liquidity —
                your OCLP tokens remain intact.
              </p>
            </div>

            <div className="rounded-xl border border-[rgba(11,122,82,0.30)] bg-[rgba(11,122,82,0.08)] p-5 text-center space-y-1">
              <p className="text-xs font-display tracking-widest text-[rgba(35,24,18,0.55)] uppercase">
                Pending Fees
              </p>
              <p className="font-mono text-3xl text-[#0B7A52] font-600">
                ${lpStats?.pendingRewards.toFixed(6) ?? '0.000000'}
              </p>
              <p className="text-xs font-mono text-[rgba(35,24,18,0.45)]">
                USDC earned from trading activity
              </p>
            </div>

            <Button
              variant="ghost"
              className="w-full border-[#0B7A52] text-[#0B7A52] hover:bg-[rgba(11,122,82,0.08)]"
              loading={isWorking}
              disabled={isWorking || (lpStats?.pendingRewards ?? 0) <= 0}
              onClick={claim}
            >
              Claim Fees
            </Button>
          </>
        )}

        {/* ── Error ────────────────────────────────────────────── */}
        {error && (
          <p
            className={`text-xs font-mono rounded-lg p-3 border ${
              isUserRejection(error)
                ? 'text-[rgba(35,24,18,0.70)] bg-[rgba(62,44,30,0.03)] border-[rgba(62,44,30,0.14)]'
                : 'text-[#B42318] bg-[rgba(180,35,24,0.07)] border-[rgba(180,35,24,0.18)]'
            }`}
          >
            {formatTxError(error)}
          </p>
        )}

        {/* ── Confirmed ────────────────────────────────────────── */}
        {isConfirmed && (
          <div className="text-center space-y-3 py-2">
            <p className="text-sm font-mono text-[#0B7A52]">Transaction confirmed!</p>
            {txHash && (
              <a
                href={explorerUrl('txblock', txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-[rgba(35,24,18,0.55)] hover:text-[#C8102E] block"
              >
                View on SuiVision ↗
              </a>
            )}
            <Button variant="muted" size="sm" onClick={reset} className="w-full">
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
