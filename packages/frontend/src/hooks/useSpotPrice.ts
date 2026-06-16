import { useQuery } from '@tanstack/react-query'

/**
 * Live spot price (USD) for the market chart's vertical reference line.
 *
 * This is a demo/PoC convenience — OmniCurve has no on-chain oracle. The price is
 * shown purely as a vertical marker on the Gaussian chart so traders can compare the
 * market's belief (μ) against the real world. It does NOT drive pricing or settlement.
 *
 * Source: Coinbase public spot API (CORS-friendly, no key). Falls back to a constant
 * if the request fails so the chart line always renders.
 */
export type SpotSymbol = 'BTC' | 'ETH'

const FALLBACK_USD: Record<SpotSymbol, number> = {
  BTC: 100_000,
  ETH: 3_500,
}

/**
 * Infers which asset a market tracks from its (off-chain) title, e.g.
 * "What will the price of BTC by the end of 2026" → 'BTC'.
 */
export function detectSpotSymbol(title?: string): SpotSymbol | undefined {
  if (!title) return undefined
  const t = title.toLowerCase()
  if (/\bbtc\b|bitcoin/.test(t)) return 'BTC'
  if (/\beth\b|ethereum/.test(t)) return 'ETH'
  return undefined
}

async function fetchSpotUsd(symbol: SpotSymbol): Promise<number> {
  const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`)
  if (!res.ok) throw new Error(`spot fetch ${res.status}`)
  const json = (await res.json()) as { data?: { amount?: string } }
  const amount = Number(json?.data?.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('bad spot payload')
  return amount
}

export function useSpotPrice(symbol: SpotSymbol | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['spot-usd', symbol],
    queryFn: () => fetchSpotUsd(symbol!),
    enabled: symbol !== undefined,
    refetchInterval: 30_000,
    staleTime: 30_000,
    retry: 1,
  })

  return {
    spotUsd: symbol ? (data ?? FALLBACK_USD[symbol]) : undefined,
    isLive: data !== undefined,
    isLoading,
    error,
  }
}
