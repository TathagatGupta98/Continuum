import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { useQuery } from '@tanstack/react-query'
import { Transaction } from '@mysten/sui/transactions'
import { useMarket } from '@/hooks/useMarket'
import { useMarketSocket } from '@/hooks/useMarketSocket'
import { usePortfolio } from '@/hooks/usePortfolio'
import { useSpotPrice, detectSpotSymbol } from '@/hooks/useSpotPrice'
import { useTheme } from '@/hooks/useTheme'
import { GaussianChart } from '@/components/market/GaussianChart'
import { StakerPanel } from '@/components/market/StakerPanel'
import { LPPanel } from '@/components/market/LPPanel'
import { Tabs } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { shortAddr } from '@/lib/math'
import { getMarketOwner } from '@/lib/sui'
import { target } from '@/config/contracts'
import { explorerUrl } from '@/config/sui'

const TRADE_TABS = [
  { label: 'Trade', value: 'trade' },
  { label: 'Provide Liquidity', value: 'lp' },
]


const DARK = {
  loadSkeleton:   'bg-[rgba(10,10,10,0.50)]',
  errorText:      'text-[#B42318]',
  heading:        'text-[#F2F2F2]',
  badgeNum:       'text-[rgba(242,242,242,0.50)]',
  statsStrip:     'border-[rgba(255,255,255,0.12)] bg-[rgba(10,10,10,0.45)] backdrop-blur-md',
  statLabel:      'text-[rgba(242,242,242,0.45)]',
  statMu:         'text-[#C8102E]',
  statSigma:      'text-[#F2F2F2]',
  statLiq:        'text-[#F2F2F2]',
  chartCard:      'bg-[rgba(10,10,10,0.55)] backdrop-blur-md border-[rgba(255,255,255,0.12)]',
  yesResolved:    'bg-[rgba(11,122,82,0.10)] border-[rgba(11,122,82,0.30)]',
  yesResolvedTxt: 'text-[#0B7A52]',
  noResolved:     'bg-[rgba(180,35,24,0.10)] border-[rgba(180,35,24,0.30)]',
  noResolvedTxt:  'text-[#B42318]',
  resolvedSub:    'text-[rgba(242,242,242,0.55)]',
  noPositions:    'text-[rgba(242,242,242,0.45)]',
  ownerBox:       'border-[rgba(200,16,46,0.35)] bg-[rgba(200,16,46,0.08)]',
  ownerLabel:     'text-[#C8102E]',
  panelCard:      'bg-[rgba(10,10,10,0.60)] backdrop-blur-md border-[rgba(255,255,255,0.12)]',
  infoCard:       'border-[rgba(255,255,255,0.10)] bg-[rgba(10,10,10,0.45)] backdrop-blur-md',
  infoHeading:    'text-[rgba(242,242,242,0.45)]',
  infoLabel:      'text-[rgba(242,242,242,0.45)]',
  infoLink:       'text-[rgba(242,242,242,0.70)] hover:text-[#C8102E]',
  liveIndicator:  'bg-[#0B7A52]',
  liveTxt:        'text-[#0B7A52]',
  divider:        'border-[rgba(255,255,255,0.08)]',
} as const

const LIGHT = {
  loadSkeleton:   'bg-[rgba(253,248,238,0.35)]',
  errorText:      'text-[#B42318]',
  heading:        'text-[#231812]',
  badgeNum:       'text-[rgba(35,24,18,0.50)]',
  statsStrip:     'border-[rgba(62,44,30,0.14)] bg-white shadow-[0_8px_28px_rgba(62,44,30,0.10)]',
  statLabel:      'text-[rgba(35,24,18,0.45)]',
  statMu:         'text-[#C8102E]',
  statSigma:      'text-[#231812]',
  statLiq:        'text-[#231812]',
  chartCard:      'bg-white border-[rgba(62,44,30,0.14)] shadow-[0_8px_28px_rgba(62,44,30,0.10)]',
  yesResolved:    'bg-[rgba(11,122,82,0.08)] border-[rgba(11,122,82,0.30)]',
  yesResolvedTxt: 'text-[#0B7A52]',
  noResolved:     'bg-[rgba(180,35,24,0.08)] border-[rgba(180,35,24,0.30)]',
  noResolvedTxt:  'text-[#B42318]',
  resolvedSub:    'text-[rgba(35,24,18,0.55)]',
  noPositions:    'text-[rgba(35,24,18,0.45)]',
  ownerBox:       'border-[rgba(200,16,46,0.30)] bg-[rgba(200,16,46,0.06)]',
  ownerLabel:     'text-[#C8102E]',
  panelCard:      'bg-white border-[rgba(62,44,30,0.14)] shadow-[0_8px_28px_rgba(62,44,30,0.10)]',
  infoCard:       'border-[rgba(62,44,30,0.14)] bg-white shadow-[0_8px_28px_rgba(62,44,30,0.10)]',
  infoHeading:    'text-[rgba(35,24,18,0.45)]',
  infoLabel:      'text-[rgba(35,24,18,0.45)]',
  infoLink:       'text-[rgba(35,24,18,0.65)] hover:text-[#C8102E]',
  liveIndicator:  'bg-[#0B7A52]',
  liveTxt:        'text-[#0B7A52]',
  divider:        'border-[rgba(62,44,30,0.08)]',
} as const

export default function MarketDetail() {
  const { marketId } = useParams<{ marketId: string }>()
  const address = useCurrentAccount()?.address
  const { isDark } = useTheme()
  const T = isDark ? DARK : LIGHT

  const { data: market, isLoading, error } = useMarket(marketId)
  const { liveState, isResolved: socketResolved } = useMarketSocket(marketId)
  const { data: portfolio } = usePortfolio(address)
  const spotSymbol = detectSpotSymbol(market?.title)
  const { spotUsd } = useSpotPrice(spotSymbol)
  const [activeTab, setActiveTab] = useState('trade')
  const [strikeX, setStrikeX] = useState<number | undefined>()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()

  // The backend doesn't persist the market owner; read it from the shared
  // `Market<T>` object to gate the owner-controls panel.
  const { data: onChainOwner } = useQuery({
    queryKey: ['market-owner', market?.objectId],
    enabled: !!market?.objectId,
    staleTime: 60_000,
    queryFn: () => getMarketOwner(market!.objectId),
  })

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-14 space-y-5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`h-16 rounded-lg animate-pulse transition-colors duration-300 ${T.loadSkeleton}`} />
        ))}
      </div>
    )
  }

  if (error || !market) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-24 text-center">
        <p className={`font-mono transition-colors duration-300 ${T.errorText}`}>Market not found</p>
      </div>
    )
  }

  const mu = liveState?.currentMu ?? market.currentMu
  const sigma = liveState?.currentSigma ?? market.currentSigma
  const liquidity = Math.max(0, liveState?.totalLiquidity ?? market.totalLiquidity)
  const resolved = socketResolved || market.isResolved
  const finalPrice = market.finalPrice
  const isOwner = !!address && !!onChainOwner && address.toLowerCase() === onChainOwner

  // Resolution is handled off-app for now — an AI oracle will drive it (TODO).
  // The owner-facing two-phase resolution panel was removed pending that work.

  // Redeem one winning Position object for collateral (consumes the object).
  const handleClaimWinnings = async (positionId: string) => {
    const tx = new Transaction()
    // claim_winnings<T>(market, position)
    tx.moveCall({
      target: target('claim_winnings'),
      typeArguments: [market.collateralType],
      arguments: [tx.object(market.objectId), tx.object(positionId)],
    })
    await signAndExecute({ transaction: tx })
  }

  // A position wins iff: YES (ABOVE) and final ≥ strike, or NO (BELOW) and final < strike.
  const claimablePositions = (portfolio?.positions ?? []).filter((p) => {
    if (String(p.marketId) !== String(market.marketId)) return false
    if (finalPrice == null) return false
    return p.direction === 'ABOVE' ? finalPrice >= p.targetValueX : finalPrice < p.targetValueX
  })

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-12 space-y-8">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          {resolved ? (
            <Badge variant="resolved">Resolved</Badge>
          ) : (
            <Badge variant="live">Live</Badge>
          )}
          <span className={`text-xs font-mono transition-colors duration-300 ${T.badgeNum}`}>
            #{market.marketId}
          </span>
          <span className={`text-xs font-mono uppercase tracking-wider transition-colors duration-300 ${T.badgeNum}`}>
            {market.category}
          </span>
          {liveState && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse transition-colors duration-300 ${T.liveIndicator}`} />
              <span className={`text-xs font-mono transition-colors duration-300 ${T.liveTxt}`}>Live feed</span>
            </div>
          )}
        </div>
        <h1 className={`font-display font-700 text-3xl sm:text-4xl tracking-tight leading-tight transition-colors duration-300 ${T.heading}`}>
          {market.title}
        </h1>
      </div>

      {/* ── Stats strip ────────────────────────────────────────────── */}
      <div className={`flex flex-wrap items-center gap-8 px-6 py-4 rounded-xl border transition-colors duration-300 ${T.statsStrip}`}>
        <div>
          <p className={`text-[10px] font-display tracking-widest uppercase mb-1 transition-colors duration-300 ${T.statLabel}`}>
            Market Mean (μ)
          </p>
          <p className={`font-mono text-xl transition-colors duration-300 ${T.statMu}`}>
            {mu.toLocaleString()}
          </p>
        </div>
        <div>
          <p className={`text-[10px] font-display tracking-widest uppercase mb-1 transition-colors duration-300 ${T.statLabel}`}>
            Uncertainty (σ)
          </p>
          <p className={`font-mono text-xl transition-colors duration-300 ${T.statSigma}`}>
            {sigma.toLocaleString()}
          </p>
        </div>
        <div>
          <p className={`text-[10px] font-display tracking-widest uppercase mb-1 transition-colors duration-300 ${T.statLabel}`}>
            Total Liquidity
          </p>
          <p className={`font-mono text-xl transition-colors duration-300 ${T.statLiq}`}>
            ${liquidity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="ml-auto text-right hidden sm:block">
          <p className={`text-[10px] font-display tracking-widest uppercase mb-1 transition-colors duration-300 ${T.statLabel}`}>
            How it works
          </p>
          <p className={`text-xs font-mono transition-colors duration-300 ${T.badgeNum}`}>
            μ shifts as traders bet · σ reflects disagreement
          </p>
        </div>
      </div>

      {/* ── Resolution banner ──────────────────────────────────────── */}
      {resolved && (
        <div className={`rounded-xl border p-5 flex items-center justify-between flex-wrap gap-4 transition-colors duration-300 ${T.yesResolved}`}>
          <div>
            <p className={`font-display font-700 text-base transition-colors duration-300 ${T.yesResolvedTxt}`}>
              Market Resolved{finalPrice != null
                ? ` — Final price $${finalPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : ''}
            </p>
            <p className={`text-xs font-mono mt-1 transition-colors duration-300 ${T.resolvedSub}`}>
              Winning positions (YES if final ≥ strike, NO if final &lt; strike) can claim below
            </p>
          </div>
          {address && (
            claimablePositions.length > 0 ? (
              <div className="flex flex-col gap-2 items-end">
                {claimablePositions.map((p) => (
                  <Button
                    key={p.positionId}
                    variant={p.direction === 'ABOVE' ? 'ghost' : 'danger'}
                    size="sm"
                    className={p.direction === 'ABOVE' ? 'border-[#0B7A52] text-[#0B7A52]' : ''}
                    onClick={() => handleClaimWinnings(p.positionId)}
                  >
                    Claim @ {p.targetValueX.toLocaleString()} ({p.tokensMinted.toFixed(2)} tokens)
                  </Button>
                ))}
              </div>
            ) : (
              <p className={`text-xs font-mono transition-colors duration-300 ${T.noPositions}`}>
                No winning positions to claim
              </p>
            )
          )}
        </div>
      )}

      {/* ── Main two-column grid ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">

        {/* Left column: chart + contract info */}
        <div className="space-y-6">
          <div className={`border rounded-xl p-6 transition-colors duration-300 ${T.chartCard}`}>
            <p className={`text-[10px] font-display tracking-widest uppercase mb-4 transition-colors duration-300 ${T.statLabel}`}>
              Probability Distribution
            </p>
            <GaussianChart
              mu={mu}
              sigma={sigma}
              strikeX={strikeX}
              liquidity={liquidity}
              height={320}
              {...(spotSymbol && spotUsd !== undefined
                ? { spotX: spotUsd, spotLabel: `${spotSymbol} $${spotUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` }
                : {})}
            />
            <p className={`text-[11px] font-mono mt-4 leading-relaxed transition-colors duration-300 ${T.statLabel}`}>
              The curve shows the market's collective belief about where the final price will land.
              Your strike price splits it into a YES region (right) and NO region (left).
            </p>
          </div>

          {/* On-chain objects */}
          <div className={`border rounded-xl p-6 space-y-4 transition-colors duration-300 ${T.infoCard}`}>
            <h3 className={`font-display font-600 text-xs tracking-widest uppercase transition-colors duration-300 ${T.infoHeading}`}>
              On-chain Objects
            </h3>
            {[
              { label: 'Market', kind: 'object' as const, id: market.objectId },
              { label: 'Collateral', kind: 'object' as const, id: market.collateralType.split('::')[0] },
            ].map(({ label, kind, id }) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <span className={`text-xs font-display uppercase tracking-wider transition-colors duration-300 ${T.infoLabel}`}>
                  {label}
                </span>
                <a
                  href={explorerUrl(kind, id)}
                  target="_blank"
                  rel="noreferrer"
                  className={`font-mono text-xs transition-colors duration-200 ${T.infoLink}`}
                >
                  {shortAddr(id)} ↗
                </a>
              </div>
            ))}
          </div>
        </div>

        {/* Right column: trade / LP panel (sticky) */}
        {!resolved && (
          <div className="lg:sticky lg:top-6">
            <div className={`border rounded-xl overflow-hidden transition-colors duration-300 ${T.panelCard}`}>
              <div className="px-6 pt-6 pb-2">
                <h2 className={`font-display font-700 text-lg mb-1 transition-colors duration-300 ${T.heading}`}>
                  {activeTab === 'trade' ? 'Place Your Bet' : 'Provide Liquidity'}
                </h2>
                <p className={`text-xs font-mono transition-colors duration-300 ${T.statLabel}`}>
                  {activeTab === 'trade'
                    ? 'Pick a price target, a direction, and your stake.'
                    : 'Deposit USDC to back trades and earn fees.'
                  }
                </p>
              </div>
              <Tabs tabs={TRADE_TABS} active={activeTab} onChange={setActiveTab} />
              {activeTab === 'trade' ? (
                <StakerPanel market={{ ...market, currentMu: mu, currentSigma: sigma }} onStrikeChange={setStrikeX} />
              ) : (
                <LPPanel market={{ ...market, currentMu: mu, currentSigma: sigma, totalLiquidity: liquidity }} />
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
