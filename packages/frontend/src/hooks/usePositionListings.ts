import { useQuery } from '@tanstack/react-query'
import { getPositionListings, getUserKiosk } from '@/lib/sui'

/** Active `Position` listings on the Kiosk secondary market for one market. */
export function usePositionListings(marketId?: string | number) {
  return useQuery({
    queryKey: ['position-listings', String(marketId ?? 'all')],
    enabled: marketId != null,
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
