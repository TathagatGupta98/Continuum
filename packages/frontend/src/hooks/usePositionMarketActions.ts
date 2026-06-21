import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePositionMarket } from '@/hooks/usePositionMarket'
import { useToast } from '@/components/ui/Toast'
import { formatTxError, isUserRejection } from '@/lib/errors'

type Kind = 'list' | 'delist' | 'buy' | 'claim'

const SUCCESS_MSG: Record<Kind, string> = {
  list: 'Position listed for sale',
  delist: 'Listing removed',
  buy: 'Position purchased — it’s now in your wallet',
  claim: 'Winnings claimed — collateral sent to your wallet',
}

/**
 * Wraps `usePositionMarket` with the cross-cutting concerns every secondary-market
 * surface needs: a per-item "acting" spinner key, one toast on completion, and
 * cache invalidation of everything a list/buy/delist touches. Shared by the
 * dashboard and the marketplace so both behave identically.
 */
export function usePositionMarketActions() {
  const pm = usePositionMarket()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [acting, setActing] = useState<{ id: string; kind: Kind } | null>(null)

  useEffect(() => {
    if (pm.step === 'confirmed') {
      toast('success', SUCCESS_MSG[acting?.kind ?? 'list'])
      for (const key of ['portfolio', 'markets', 'position-listings', 'user-kiosk', 'owned-positions']) {
        qc.invalidateQueries({ queryKey: [key] })
      }
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

  return {
    step: pm.step,
    acting,
    busy: acting !== null,
    list: (positionId: string, priceMist: bigint) => {
      setActing({ id: positionId, kind: 'list' })
      pm.list(positionId, priceMist)
    },
    delist: (positionId: string) => {
      setActing({ id: positionId, kind: 'delist' })
      pm.delist(positionId)
    },
    buy: (p: {
      sellerKioskId: string
      positionId: string
      marketObjectId: string
      priceMist: bigint
      collateralType?: string
    }) => {
      setActing({ id: p.positionId, kind: 'buy' })
      pm.buy(p)
    },
    takeAndClaim: (p: { positionId: string; marketObjectId: string; collateralType?: string }) => {
      setActing({ id: p.positionId, kind: 'claim' })
      pm.takeAndClaim(p)
    },
  }
}
