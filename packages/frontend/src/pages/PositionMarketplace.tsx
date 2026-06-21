import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { useMarkets } from '@/hooks/useMarkets'
import { usePositionListings, useUserKiosk } from '@/hooks/usePositionListings'
import { usePositionMarketActions } from '@/hooks/usePositionMarketActions'
import { ListingCard } from '@/components/market/ListingCard'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConnectButton } from '@/components/wallet/ConnectButton'
import { mistToSui, shortAddr } from '@/lib/math'
import type { Market } from '@/lib/api'

/**
 * Global secondary market: every open `Position` listing across all markets,
 * bought peer-to-peer through Kiosk. The market-open rule is enforced on-chain,
 * so a settled position can never be sold here.
 */
export default function PositionMarketplace() {
  const address = useCurrentAccount()?.address
  const { data: listings = [], isLoading } = usePositionListings()
  const { data: markets = [] } = useMarkets()
  const { data: userKiosk } = useUserKiosk(address)
  const actions = usePositionMarketActions()

  const marketById = useMemo(() => {
    const m = new Map<string, Market>()
    for (const mk of markets) m.set(String(mk.marketId), mk)
    return m
  }, [markets])

  // Only buyable listings: market known + still open + not the viewer's own.
  const rows = listings
    .map((l) => ({ listing: l, market: marketById.get(String(l.marketId)) }))
    .filter((r) => r.market && !r.market.isResolved)
    .filter((r) => !userKiosk || r.listing.kioskId !== userKiosk.kioskId)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-display tracking-[0.2em] uppercase" style={{ color: 'var(--text-subtle)' }}>
            Secondary market
          </p>
          <h1 className="font-display font-800 text-3xl mt-1" style={{ color: 'var(--text-primary)' }}>
            Position Marketplace
          </h1>
          <p className="font-mono text-xs mt-2 max-w-xl leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Buy open positions other traders have listed. Prices are in SUI; the on-chain rule
            blocks any sale once a market has settled, so you can never buy a resolved position.
          </p>
        </div>
        <Badge variant="live">{rows.length} listed</Badge>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg animate-pulse" style={{ background: 'var(--bg-surface-2)' }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="text-center py-16 border rounded-xl"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <p className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>
            No positions are listed for sale right now.
          </p>
          <Link
            to="/dashboard"
            className="inline-block mt-3 text-xs font-mono hover:underline"
            style={{ color: 'var(--accent-data)' }}
          >
            List one of your positions →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map(({ listing, market }) => (
            <div key={listing.positionId} className="space-y-1.5">
              <Link
                to={`/markets/${listing.marketId}`}
                className="block font-display text-xs tracking-wide line-clamp-1 hover:underline px-1"
                style={{ color: 'var(--text-muted)' }}
              >
                {market!.title || `Market #${listing.marketId}`}
              </Link>
              <ListingCard
                side={listing.isYes ? 'yes' : 'no'}
                strike={listing.strike}
                tokens={listing.tokens}
                priceSui={mistToSui(listing.priceMist)}
                mu={market!.currentMu}
                sigma={market!.currentSigma}
                note={`Seller kiosk ${shortAddr(listing.kioskId)}`}
                action={
                  !address ? (
                    <ConnectButton />
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      className="px-4 py-1.5"
                      disabled={actions.busy}
                      loading={actions.acting?.id === listing.positionId}
                      onClick={() =>
                        actions.buy({
                          sellerKioskId: listing.kioskId,
                          positionId: listing.positionId,
                          marketObjectId: market!.objectId,
                          priceMist: listing.priceMist,
                          collateralType: market!.collateralType,
                        })
                      }
                    >
                      Buy
                    </Button>
                  )
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
