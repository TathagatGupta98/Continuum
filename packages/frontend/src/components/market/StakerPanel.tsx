import { useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { StrikeSlider } from './StrikeSlider'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { usePriceSocket } from '@/hooks/usePriceSocket'
import { useTrade } from '@/hooks/useTrade'
import { usdcDisplayToRaw } from '@/lib/math'
import { formatTxError, isUserRejection } from '@/lib/errors'
import { explorerUrl } from '@/config/sui'
import type { Market } from '@/lib/api'

interface StakerPanelProps {
  market: Market
  onStrikeChange?: (x: number) => void
}

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="w-5 h-5 shrink-0 rounded-full bg-[rgba(200,16,46,0.12)] border border-[rgba(200,16,46,0.28)] flex items-center justify-center text-[10px] font-mono text-[#C8102E] font-600">
        {n}
      </span>
      <p className="text-xs font-display tracking-wider text-[rgba(35,24,18,0.60)] uppercase">
        {label}
      </p>
    </div>
  )
}

export function StakerPanel({ market, onStrikeChange }: StakerPanelProps) {
  const address = useCurrentAccount()?.address
  const mu = market.currentMu
  const sigma = market.currentSigma

  const [strikeX, setStrikeX] = useState(mu)
  const [direction, setDirection] = useState<'yes' | 'no'>('yes')
  const [stakeAmount, setStakeAmount] = useState('')

  const { pYes, pNo, isLoading: priceLoading } = usePriceSocket({
    marketId: market.marketId,
    x: strikeX,
    direction,
    mu,
    sigma,
  })

  const { step, execute, reset, txHash, error } = useTrade({
    marketId: market.marketId,
    objectId: market.objectId,
    collateralType: market.collateralType,
  })

  const stake = parseFloat(stakeAmount) || 0
  const prob = direction === 'yes' ? pYes : pNo
  const feeCost = stake * 0.01
  const netStake = stake - feeCost
  const tokensOut = prob > 0 ? netStake / prob : 0

  // The AMM locks the bet's worst-case payout (each token redeems for $1, the
  // net stake is already in the pot) and reverts with AmmCallFailed when that
  // exceeds the pool's liquidity. Catch it here so the bet is never sent.
  const liability = tokensOut > 0 ? tokensOut - netStake : 0
  const probTooSmall = stake > 0 && prob < 0.001
  const exceedsPool = stake > 0 && liability > market.totalLiquidity
  const cannotUnderwrite = probTooSmall || exceedsPool

  const handleStrikeChange = (v: number) => {
    setStrikeX(v)
    onStrikeChange?.(v)
  }

  const handleExecute = async () => {
    if (!address || stake <= 0) return
    await execute({
      direction,
      strikeX,
      stakeUsdc: usdcDisplayToRaw(stake),
    })
  }

  const isConfirmed = step === 'confirmed'
  const isWorking = step === 'approving' || step === 'buying'

  if (market.isResolved) {
    return (
      <div className="px-6 py-10 text-center space-y-2">
        <p className="font-mono text-sm text-[rgba(35,24,18,0.65)]">
          Market resolved — trading closed.
        </p>
        {market.finalPrice != null && (
          <p className="font-mono text-base text-[#0B7A52]">
            Final price: ${market.finalPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="px-6 pb-6 pt-4 space-y-7">

      {/* ── Step 1: Target price ─────────────────────────────── */}
      <div>
        <StepLabel n={1} label="Set your target price" />
        <StrikeSlider
          value={strikeX}
          min={mu - 3 * sigma}
          max={mu + 3 * sigma}
          mu={mu}
          sigma={sigma}
          onChange={handleStrikeChange}
        />
        <p className="mt-2.5 text-[11px] font-mono text-[rgba(35,24,18,0.38)] leading-relaxed">
          Drag the slider to pick the price level you're betting on.
          The chart on the left updates as you move it.
        </p>
      </div>

      <div className="border-t border-[rgba(62,44,30,0.07)]" />

      {/* ── Step 2: Direction ────────────────────────────────── */}
      <div>
        <StepLabel n={2} label="Choose your direction" />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => setDirection('yes')}
            className={`py-3 rounded-lg border text-sm font-mono font-600 transition-all ${
              direction === 'yes'
                ? 'bg-[rgba(11,122,82,0.14)] border-[rgba(11,122,82,0.55)] text-[#0B7A52]'
                : 'border-[rgba(62,44,30,0.18)] text-[rgba(35,24,18,0.55)] hover:border-[rgba(11,122,82,0.35)] hover:text-[#0B7A52]'
            }`}
          >
            YES ↑
          </button>
          <button
            onClick={() => setDirection('no')}
            className={`py-3 rounded-lg border text-sm font-mono font-600 transition-all ${
              direction === 'no'
                ? 'bg-[rgba(180,35,24,0.14)] border-[rgba(180,35,24,0.55)] text-[#B42318]'
                : 'border-[rgba(62,44,30,0.18)] text-[rgba(35,24,18,0.55)] hover:border-[rgba(180,35,24,0.35)] hover:text-[#B42318]'
            }`}
          >
            NO ↓
          </button>
        </div>

        {/* Direction explainer */}
        <div className="grid grid-cols-2 gap-3 text-[11px] font-mono text-[rgba(35,24,18,0.38)]">
          <p className={`leading-snug transition-colors ${direction === 'yes' ? 'text-[rgba(11,122,82,0.65)]' : ''}`}>
            YES wins if final price lands at or above your strike
          </p>
          <p className={`leading-snug transition-colors ${direction === 'no' ? 'text-[rgba(180,35,24,0.65)]' : ''}`}>
            NO wins if final price lands below your strike
          </p>
        </div>

        {/* Dynamic bet question */}
        <div className={`mt-4 rounded-lg border px-4 py-3.5 transition-all ${
          direction === 'yes'
            ? 'bg-[rgba(11,122,82,0.05)] border-[rgba(11,122,82,0.25)]'
            : 'bg-[rgba(180,35,24,0.05)] border-[rgba(180,35,24,0.25)]'
        }`}>
          <p className="text-[10px] font-display tracking-widest text-[rgba(35,24,18,0.40)] uppercase mb-1.5">
            You're staking on
          </p>
          <p className={`font-mono text-base font-600 leading-snug ${direction === 'yes' ? 'text-[#0B7A52]' : 'text-[#B42318]'}`}>
            {direction === 'yes'
              ? `Final price ≥ $${strikeX.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : `Final price < $${strikeX.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            }
          </p>
          <p className="text-[11px] text-[rgba(35,24,18,0.35)] mt-1 leading-tight">
            This question will appear on your dashboard after you trade.
          </p>
        </div>
      </div>

      <div className="border-t border-[rgba(62,44,30,0.07)]" />

      {/* ── Step 3: Stake amount ─────────────────────────────── */}
      <div>
        <StepLabel n={3} label="Enter your stake" />
        <Input
          type="number"
          placeholder="0.00"
          suffix="USDC"
          value={stakeAmount}
          onChange={(e) => setStakeAmount(e.target.value)}
          min="0"
          step="1"
        />
        <p className="mt-2.5 text-[11px] font-mono text-[rgba(35,24,18,0.38)] leading-relaxed">
          This is the total USDC you'll spend. A 1% protocol fee is deducted before tokens are minted.
        </p>
      </div>

      {/* ── Price preview ────────────────────────────────────── */}
      {stake > 0 && (
        <div className="rounded-lg border border-[rgba(62,44,30,0.14)] bg-[rgba(62,44,30,0.03)] p-4 space-y-3">
          <p className="text-[10px] font-display tracking-widest text-[rgba(35,24,18,0.45)] uppercase">
            Trade Preview
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-display tracking-widest text-[rgba(35,24,18,0.50)] uppercase mb-1">
                P(YES)
              </p>
              <p className={`font-mono text-sm font-600 ${priceLoading ? 'opacity-40' : ''} text-[#0B7A52]`}>
                {(pYes * 100).toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] font-display tracking-widest text-[rgba(35,24,18,0.50)] uppercase mb-1">
                P(NO)
              </p>
              <p className={`font-mono text-sm font-600 ${priceLoading ? 'opacity-40' : ''} text-[#B42318]`}>
                {(pNo * 100).toFixed(2)}%
              </p>
            </div>
          </div>
          <div className="border-t border-[rgba(62,44,30,0.10)] pt-3 space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-[rgba(35,24,18,0.55)]">Total cost</span>
              <span className="text-[#C8102E] font-600">${stake.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[rgba(35,24,18,0.55)]">Protocol fee (1%)</span>
              <span className="text-[rgba(35,24,18,0.55)]">−${feeCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-[rgba(62,44,30,0.10)]">
              <span className="text-[rgba(35,24,18,0.55)]">Tokens you receive</span>
              <span className="text-[#231812] font-600">{tokensOut.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Underwriting guard ───────────────────────────────── */}
      {cannotUnderwrite && (
        <p className="text-xs font-mono rounded-lg p-3 border text-[#B42318] bg-[rgba(180,35,24,0.07)] border-[rgba(180,35,24,0.18)]">
          {probTooSmall
            ? `P(${direction.toUpperCase()}) is ≈0 at this strike — the price rounds to zero on-chain. Move the strike closer to μ (${mu.toLocaleString()}).`
            : `The pool can't underwrite this bet: its worst-case payout is $${liability.toFixed(2)}, but the pool only holds $${market.totalLiquidity.toFixed(2)}. Lower your stake or move the strike closer to μ.`}
        </p>
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

      {/* ── CTA ──────────────────────────────────────────────── */}
      {!address ? (
        <p className="text-xs font-mono text-center text-[rgba(35,24,18,0.50)] py-2">
          Connect your wallet to trade
        </p>
      ) : isConfirmed ? (
        <div className="text-center space-y-3 py-2">
          <p className="text-sm font-mono text-[#0B7A52]">Trade confirmed!</p>
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
            New Trade
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {isWorking && (
            <div className="flex items-center justify-center gap-3 text-xs font-mono text-[rgba(35,24,18,0.55)] py-1">
              <span className={step === 'approving' ? 'text-[#C8102E]' : 'opacity-30'}>Approve</span>
              <span className="opacity-20">→</span>
              <span className={step === 'buying' ? 'text-[#C8102E]' : 'opacity-30'}>Confirm</span>
              <span className="opacity-20">→</span>
              <span className="opacity-30">Done</span>
            </div>
          )}
          <Button
            variant={direction === 'yes' ? 'ghost' : 'danger'}
            className={`w-full ${direction === 'yes' ? 'border-[#0B7A52] text-[#0B7A52] hover:bg-[rgba(11,122,82,0.08)]' : ''}`}
            loading={isWorking}
            disabled={!stake || isWorking || cannotUnderwrite}
            onClick={handleExecute}
          >
            {step === 'approving'
              ? 'Approving USDC...'
              : step === 'buying'
                ? 'Confirming...'
                : `Buy ${direction.toUpperCase()}`}
          </Button>
        </div>
      )}
    </div>
  )
}
