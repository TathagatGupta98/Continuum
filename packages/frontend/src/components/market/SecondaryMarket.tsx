import { useEffect, useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { ListingCard } from './ListingCard'
import { SellPositionModal } from './SellPositionModal'
import { usePositionMarket } from '@/hooks/usePositionMarket'
import { usePositionListings, useUserKiosk } from '@/hooks/usePositionListings'
import { getOwnedPositions, type OwnedPosition, type PositionListing } from '@/lib/sui'
import { mistToSui, suiToMist, shortAddr } from '@/lib/math'
import { formatTxError, isUserRejection } from '@/lib/errors'

interface SecondaryMarketProps {
  market: { objectId: string; marketId: string; collateralType: string }
  mu: number
  sigma: number
  resolved: boolean
  finalPrice: number | null
}

const SUCCESS_MSG: Record<string, string> = {
  list: 'Position listed for sale',
  delist: 'Listing removed',
  buy: 'Position purchased — it’s now in your wallet',
  claim: 'Winnings claimed — collateral sent to your wallet',
}

const isWinner = (l: { isYes: boolean; strike: number }, finalPrice: number | null) =>
  finalPrice != null && (l.isYes ? finalPrice >= l.strike : finalPrice < l.strike)

export function SecondaryMarket({ market, mu, sigma, resolved, finalPrice }: SecondaryMarketProps) {
  const address = useCurrentAccount()?.address
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const pm = usePositionMarket()

  const [sellTarget, setSellTarget] = useState<OwnedPosition | null>(null)
  const [acting, setActing] = useState<{ id: string; kind: keyof typeof SUCCESS_MSG } | null>(null)

  const { data: listings = [] } = usePositionListings(market.marketId)
  const { data: userKiosk } = useUserKiosk(address)
  const { data: owned = [] } = useQuery({
    queryKey: ['owned-positions', market.marketId, address],
    enabled: !!address,
    staleTime: 15_000,
    queryFn: () => getOwnedPositions(address!, market.marketId),
  })

  const myKioskId = userKiosk?.kioskId
  const mine = listings.filter((l) => myKioskId && l.kioskId === myKioskId)
  const others = listings.filter((l) => !myKioskId || l.kioskId !== myKioskId)

  // React to the shared tx hook: one toast + refresh per completed action.
  useEffect(() => {
    if (pm.step === 'confirmed') {
      toast('success', SUCCESS_MSG[acting?.kind ?? 'list'])
      queryClient.invalidateQueries({ queryKey: ['position-listings', market.marketId] })
      queryClient.invalidateQueries({ queryKey: ['owned-positions', market.marketId, address] })
      queryClient.invalidateQueries({ queryKey: ['user-kiosk', address] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      setSellTarget(null)
      setActing(null)
      pm.reset()
    } else if (pm.step === 'error') {
      if (!isUserRejection(pm.error)) {
        toast('error', pm.error ? formatTxError(pm.error) : 'Transaction failed')
      }
      setActing(null)
      pm.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pm.step])

  const busy = acting !== null

  const onSell = (priceSui: number) => {
    if (!sellTarget) return
    setActing({ id: sellTarget.objectId, kind: 'list' })
    pm.list(sellTarget.objectId, suiToMist(priceSui))
  }
  const onDelist = (l: PositionListing) => {
    setActing({ id: l.positionId, kind: 'delist' })
    pm.delist(l.positionId)
  }
  const onBuy = (l: PositionListing) => {
    setActing({ id: l.positionId, kind: 'buy' })
    pm.buy({
      sellerKioskId: l.kioskId,
      positionId: l.positionId,
      marketObjectId: market.objectId,
      priceMist: l.priceMist,
      collateralType: market.collateralType,
    })
  }
  const onClaim = (l: PositionListing) => {
    setActing({ id: l.positionId, kind: 'claim' })
    pm.takeAndClaim({
      positionId: l.positionId,
      marketObjectId: market.objectId,
      collateralType: market.collateralType,
    })
  }

  const Empty = ({ children }: { children: React.ReactNode }) => (
    <p className="font-mono text-xs py-3" style={{ color: 'var(--text-subtle)' }}>
      {children}
    </p>
  )

  const SubHead = ({ children, count }: { children: React.ReactNode; count?: number }) => (
    <div className="flex items-center gap-2 mb-3">
      <h4 className="font-display font-600 text-xs tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
        {children}
      </h4>
      {count != null && count > 0 && (
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-subtle)' }}>
          {count}
        </span>
      )}
    </div>
  )

  return (
    <div
      className="border rounded-xl p-6 space-y-7"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-700 text-lg" style={{ color: 'var(--text-primary)' }}>
            Secondary Market
          </h3>
          <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
            Trade positions before settlement. Listings settle in SUI; the market-open rule is
            enforced on-chain.
          </p>
        </div>
        <Badge variant={resolved ? 'resolved' : 'live'}>{resolved ? 'Closed' : 'Open'}</Badge>
      </div>

      {!address ? (
        <Empty>Connect your wallet to buy or sell positions.</Empty>
      ) : (
        <>
          {/* Your sellable positions (only meaningful while the market is open). */}
          {!resolved && (
            <section>
              <SubHead count={owned.length}>Your positions</SubHead>
              {owned.length === 0 ? (
                <Empty>No open positions in this market to sell.</Empty>
              ) : (
                <div className="space-y-2">
                  {owned.map((p) => (
                    <div
                      key={p.objectId}
                      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-dim)' }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant={p.isYes ? 'yes' : 'no'}>{p.isYes ? 'YES' : 'NO'}</Badge>
                        <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
                          ${p.targetX.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-subtle)' }}>
                          {p.tokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC payout
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-4 py-2"
                        disabled={busy}
                        loading={acting?.id === p.objectId}
                        onClick={() => setSellTarget(p)}
                      >
                        Sell
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Your active listings. */}
          {mine.length > 0 && (
            <section>
              <SubHead count={mine.length}>Your listings</SubHead>
              <div className="space-y-2.5">
                {mine.map((l) => {
                  const win = isWinner(l, finalPrice)
                  return (
                    <ListingCard
                      key={l.positionId}
                      side={l.isYes ? 'yes' : 'no'}
                      strike={l.strike}
                      tokens={l.tokens}
                      priceSui={mistToSui(l.priceMist)}
                      mu={mu}
                      sigma={sigma}
                      note="Your listing"
                      dim={resolved && !win}
                      action={
                        resolved ? (
                          win ? (
                            <Button
                              variant="primary"
                              size="sm"
                              className="px-4 py-1.5"
                              disabled={busy}
                              loading={acting?.id === l.positionId}
                              onClick={() => onClaim(l)}
                            >
                              Claim
                            </Button>
                          ) : (
                            <span className="font-mono text-[10px]" style={{ color: 'var(--text-subtle)' }}>
                              No payout
                            </span>
                          )
                        ) : (
                          <Button
                            variant="muted"
                            size="sm"
                            className="px-4 py-1.5"
                            disabled={busy}
                            loading={acting?.id === l.positionId}
                            onClick={() => onDelist(l)}
                          >
                            Delist
                          </Button>
                        )
                      }
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Open listings from other sellers. */}
          <section>
            <SubHead count={others.length}>Open listings</SubHead>
            {others.length === 0 ? (
              <Empty>No positions listed by others yet.</Empty>
            ) : (
              <div className="space-y-2.5">
                {others.map((l) => (
                  <ListingCard
                    key={l.positionId}
                    side={l.isYes ? 'yes' : 'no'}
                    strike={l.strike}
                    tokens={l.tokens}
                    priceSui={mistToSui(l.priceMist)}
                    mu={mu}
                    sigma={sigma}
                    note={`Kiosk ${shortAddr(l.kioskId)}`}
                    dim={resolved}
                    action={
                      resolved ? (
                        <span className="font-mono text-[10px]" style={{ color: 'var(--text-subtle)' }}>
                          Closed
                        </span>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          className="px-4 py-1.5"
                          disabled={busy}
                          loading={acting?.id === l.positionId}
                          onClick={() => onBuy(l)}
                        >
                          Buy
                        </Button>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <SellPositionModal
        open={sellTarget !== null}
        onClose={() => setSellTarget(null)}
        position={sellTarget}
        mu={mu}
        sigma={sigma}
        submitting={acting?.kind === 'list' && pm.step === 'listing'}
        onList={onSell}
      />
    </div>
  )
}
