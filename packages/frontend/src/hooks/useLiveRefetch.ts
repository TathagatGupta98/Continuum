import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { socket } from '@/lib/socket'

/**
 * Global socket listener — mount once (in Root). The backend emits
 * `marketsChanged` to all clients whenever any market changes on-chain
 * (market created, stake placed, liquidity added/removed), after it has
 * updated the DB. Invalidating here refetches at exactly the right moment.
 */
export function useLiveRefetch() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const onMarketsChanged = (data?: { marketId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['markets'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      if (data?.marketId) {
        queryClient.invalidateQueries({ queryKey: ['market', data.marketId] })
        queryClient.invalidateQueries({ queryKey: ['lp-stats', data.marketId] })
      }
    }

    socket.on('marketsChanged', onMarketsChanged)
    return () => {
      socket.off('marketsChanged', onMarketsChanged)
    }
  }, [queryClient])
}
