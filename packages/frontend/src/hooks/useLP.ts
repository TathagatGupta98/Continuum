import { useState, useCallback } from 'react'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { useQueryClient } from '@tanstack/react-query'
import { suiClient, getMarketSeedState } from '@/lib/sui'
import { target, COLLATERAL_TYPE } from '@/config/contracts'
import { floatToWad, floatToWadParts, usdcDisplayToRaw } from '@/lib/math'

// 'approving' is retained from the EVM flow for type-compatibility; Sui has no
// ERC-20 approval. On Sui, seed + deposit are batched into one atomic PTB.
export type LPStep = 'idle' | 'approving' | 'accepting' | 'seeding' | 'submitting' | 'confirmed' | 'error'

interface UseLPOptions {
  marketId: string
  /** Shared `Market<T>` object id. */
  objectId: string
  /** Collateral coin type `T` (falls back to the configured default). */
  collateralType?: string
}

/** Initial μ/σ for an unseeded market — applied via set_distribution (owner only). */
export interface SeedParams {
  mu: number
  sigma: number
}

export function useLP({ marketId, objectId, collateralType }: UseLPOptions) {
  const account = useCurrentAccount()
  const queryClient = useQueryClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [step, setStep] = useState<LPStep>('idle')
  const [txHash, setTxHash] = useState<string | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const coinType = collateralType || COLLATERAL_TYPE

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['market', marketId] })
    queryClient.invalidateQueries({ queryKey: ['markets'] })
    queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    queryClient.invalidateQueries({ queryKey: ['lp-stats', marketId] })
    queryClient.invalidateQueries({ queryKey: ['market-seed-state', objectId] })
  }, [queryClient, marketId, objectId])

  const submit = useCallback(
    async (tx: Transaction) => {
      const { digest } = await signAndExecute({ transaction: tx })
      setTxHash(digest)
      await suiClient.waitForTransaction({ digest })
    },
    [signAndExecute],
  )

  /**
   * Deposit collateral. When `seed` is supplied on an unseeded market and the
   * caller is the (pending) owner, the seeding — accept_ownership (if pending) +
   * set_distribution — is batched into the same atomic PTB as add_liquidity.
   * LP deposits themselves never move the curve, so seeding MUST go through
   * set_distribution.
   */
  const add = useCallback(
    async (amountUsdc: number, seed?: SeedParams) => {
      if (!account) return
      setError(undefined)
      const me = account.address.toLowerCase()
      try {
        const tx = new Transaction()

        let seeding = false
        if (seed) {
          const state = await getMarketSeedState(objectId)
          const isOwner = state.owner === me
          const isPending = state.pendingOwner === me
          if (!state.seeded && (isOwner || isPending)) {
            if (!isOwner && isPending) {
              tx.moveCall({
                target: target('accept_ownership'),
                typeArguments: [coinType],
                arguments: [tx.object(objectId)],
              })
            }
            const { mag, neg } = floatToWadParts(seed.mu)
            tx.moveCall({
              target: target('set_distribution'),
              typeArguments: [coinType],
              arguments: [
                tx.object(objectId),
                tx.pure.u256(mag),
                tx.pure.bool(neg),
                tx.pure.u256(floatToWad(seed.sigma)),
              ],
            })
            seeding = true
          }
        }

        // add_liquidity<T>(market, payment: Coin<T>)
        tx.moveCall({
          target: target('add_liquidity'),
          typeArguments: [coinType],
          arguments: [
            tx.object(objectId),
            coinWithBalance({ type: coinType, balance: usdcDisplayToRaw(amountUsdc) }),
          ],
        })

        setStep(seeding ? 'seeding' : 'submitting')
        await submit(tx)
        setStep('confirmed')
        invalidate()
      } catch (e) {
        console.error('[useLP.add] failed:', e)
        setError(e instanceof Error ? e : new Error('Transaction failed'))
        setStep('error')
      }
    },
    [account, objectId, coinType, submit, invalidate],
  )

  const remove = useCallback(
    async (sharesWad: bigint) => {
      if (!account) return
      setError(undefined)
      try {
        setStep('submitting')
        const tx = new Transaction()
        // remove_liquidity<T>(market, shares_to_remove: u256)
        tx.moveCall({
          target: target('remove_liquidity'),
          typeArguments: [coinType],
          arguments: [tx.object(objectId), tx.pure.u256(sharesWad)],
        })
        await submit(tx)
        setStep('confirmed')
        invalidate()
      } catch (e) {
        console.error('[useLP.remove] failed:', e)
        setError(e instanceof Error ? e : new Error('Transaction failed'))
        setStep('error')
      }
    },
    [account, objectId, coinType, submit, invalidate],
  )

  const claim = useCallback(async () => {
    if (!account) return
    setError(undefined)
    try {
      setStep('submitting')
      const tx = new Transaction()
      // claim_fees<T>(market)
      tx.moveCall({
        target: target('claim_fees'),
        typeArguments: [coinType],
        arguments: [tx.object(objectId)],
      })
      await submit(tx)
      setStep('confirmed')
      invalidate()
    } catch (e) {
      console.error('[useLP.claim] failed:', e)
      setError(e instanceof Error ? e : new Error('Transaction failed'))
      setStep('error')
    }
  }, [account, objectId, coinType, submit, invalidate])

  const reset = useCallback(() => {
    setStep('idle')
    setTxHash(undefined)
    setError(undefined)
  }, [])

  return { step, add, remove, claim, reset, txHash, error }
}
