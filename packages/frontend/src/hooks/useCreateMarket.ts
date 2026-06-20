import { useState, useCallback } from 'react'
import { Transaction } from '@mysten/sui/transactions'
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { suiClient } from '@/lib/sui'
import { target, REGISTRY_ID, COLLATERAL_TYPE } from '@/config/contracts'
import { api } from '@/lib/api'
import { floatToWad } from '@/lib/math'

export type CreateStep = 'idle' | 'submitting' | 'confirmed' | 'error'

/** Parse a 0x-prefixed hex string into bytes; empty/undefined → empty array. */
function hexToBytes(hex?: string): Uint8Array {
  if (!hex) return new Uint8Array(0)
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length === 0) return new Uint8Array(0)
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function useCreateMarket() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const account = useCurrentAccount()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [step, setStep] = useState<CreateStep>('idle')
  const [txHash, setTxHash] = useState<string | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const create = useCallback(
    async (
      sigmaMin: number,
      resolvesAtMs: number,
      meta?: { title: string; category?: string },
      // Optional Pyth price-feed id (0x-prefixed 32-byte hex). When set, the
      // market settles trustlessly via `resolve_with_pyth` against this feed;
      // empty → a manual market (`set_final_price` / two-phase).
      priceFeedId?: string,
    ) => {
      if (!account) return
      setError(undefined)
      try {
        // `create_market` needs a scheduled close time (Clock ms). Every
        // resolution path is gated on it and it can't be changed after creation,
        // so it must be a real future timestamp picked by the creator.
        const resolvesAt = Math.floor(resolvesAtMs)
        if (!Number.isFinite(resolvesAt) || resolvesAt <= Date.now()) {
          throw new Error('Resolution time must be a date in the future')
        }
        setStep('submitting')
        const titleBytes = Array.from(new TextEncoder().encode(meta?.title ?? ''))
        const feedBytes = hexToBytes(priceFeedId)
        if (feedBytes.length !== 0 && feedBytes.length !== 32) {
          throw new Error('Pyth price-feed id must be a 0x-prefixed 32-byte hex string')
        }

        const tx = new Transaction()
        // create_market<T>(registry, title: vector<u8>, sigma_min_mag, resolves_at, price_feed_id)
        tx.moveCall({
          target: target('create_market'),
          typeArguments: [COLLATERAL_TYPE],
          arguments: [
            tx.object(REGISTRY_ID),
            tx.pure.vector('u8', titleBytes),
            tx.pure.u256(floatToWad(sigmaMin)),
            tx.pure.u64(BigInt(resolvesAt)),
            tx.pure.vector('u8', Array.from(feedBytes)),
          ],
        })

        const { digest } = await signAndExecute({ transaction: tx })
        setTxHash(digest)
        const res = await suiClient.waitForTransaction({ digest, options: { showEvents: true } })

        // Pull the new market id from the MarketCreated event, then store the
        // category off-chain so the market shows its question and category
        // instead of the "Market #N" placeholder.
        if (meta?.title) {
          try {
            const created = res.events?.find((e) => e.type.endsWith('::market::MarketCreated'))
            const marketId =
              created && (created.parsedJson as { market_id?: string | number })?.market_id != null
                ? String((created.parsedJson as { market_id: string | number }).market_id)
                : undefined
            if (marketId) {
              // Retry a few times: the backend indexer may be mid-upsert right
              // after the tx is indexed, and a lost PATCH leaves the market as
              // "Market #N" forever.
              let lastErr: unknown
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  await api.updateMarketMetadata(marketId, meta)
                  lastErr = undefined
                  break
                } catch (err) {
                  lastErr = err
                  await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
                }
              }
              if (lastErr) throw lastErr
            }
          } catch (metaErr) {
            // Metadata is cosmetic — never fail the creation flow over it.
            console.warn('[createMarket] could not store market metadata:', metaErr)
          }
        }

        setStep('confirmed')
        queryClient.invalidateQueries({ queryKey: ['markets'] })
        navigate('/markets')
      } catch (e) {
        console.error('[createMarket] failed:', e)
        setError(e instanceof Error ? e : new Error('Transaction failed'))
        setStep('error')
      }
    },
    [account, signAndExecute, queryClient, navigate],
  )

  const reset = useCallback(() => {
    setStep('idle')
    setTxHash(undefined)
    setError(undefined)
  }, [])

  return { step, create, reset, txHash, error }
}
