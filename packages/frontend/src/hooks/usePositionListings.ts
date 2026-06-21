import { useQuery } from '@tanstack/react-query'
import { getPositionListings, getUserKiosk } from '@/lib/sui'

/**
 * Active `Position` listings on the Kiosk secondary market. Pass a `marketId` for
 * one market (the per-market panel), or omit it for **every** market (the global
 * marketplace).
 */
export function usePositionListings(marketId?: string | number) {
  return useQuery({
    queryKey: ['position-listings', String(marketId ?? 'all')],
    staleTime: 10_000,
    refetchInterval: 20_000,
    queryFn: () => getPositionListings(marketId),
  })
}

/** The connected wallet's Kiosk (id + owner cap), or null if none exists yet. */
export function useUserKiosk(address?: string) {
  return useQuery({
    queryKey: ['user-kiosk', address],
    enabled: !!address,
    staleTime: 15_000,
    queryFn: () => getUserKiosk(address!),
  })
}
