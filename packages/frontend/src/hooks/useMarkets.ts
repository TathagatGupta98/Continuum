import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useMarkets(params?: { category?: string; active?: boolean }) {
  return useQuery({
    queryKey: ['markets', params],
    queryFn: () => api.getMarkets(params),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // The backend is on Render's free tier and may be cold-starting (~50s) on
    // the first request. Retry with backoff so a slow/failed first hit recovers
    // on its own instead of surfacing an error.
    retry: 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
  })
}
