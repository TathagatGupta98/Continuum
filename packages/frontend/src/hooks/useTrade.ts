import { useState, useCallback } from 'react'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { useQueryClient } from '@tanstack/react-query'
import { suiClient } from '@/lib/sui'
import { target, COLLATERAL_TYPE, CLOCK_ID } from '@/config/contracts'
import { floatToWadParts } from '@/lib/math'

// 'approving'/'approved' are retained from the EVM flow for type-compatibility,
// but Sui has no ERC-20 approval step — a buy goes straight to 'buying'.
export type TradeStep = 'idle' | 'approving' | 'approved' | 'buying' | 'confirmed' | 'error'

interface TradeParams {
  direction: 'yes' | 'no'
  strikeX: number
  // Raw USDC (6 decimals) the user stakes. The contract derives the token
  // amount itself and carves the 1% fee out of this stake.
  stakeUsdc: bigint
}

interface UseTradeOptions {
  marketId: string
  /** Shared `Market<T>` object id. */
  objectId: string
  /** Collateral coin type `T` (falls back to the configured default). */
  collateralType?: string
}

export function useTrade({ marketId, objectId, collateralType }: UseTradeOptions) {
  const account = useCurrentAccount()
  const queryClient = useQueryClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [step, setStep] = useState<TradeStep>('idle')
  const [pendingParams, setPendingParams] = useState<TradeParams | null>(null)
  const [txHash, setTxHash] = useState<string | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const coinType = collateralType || COLLATERAL_TYPE

  const execute = useCallback(
    async (params: TradeParams) => {
      if (!account) return
      setError(undefined)
      setPendingParams(params)

      try {
        setStep('buying')
        const { mag, neg } = floatToWadParts(params.strikeX)
        const fn = params.direction === 'yes' ? 'buy_yes' : 'buy_no'

        const tx = new Transaction()
        // buy_*<T>(market, payment: Coin<T>, target_mag, target_neg, clock)
        tx.moveCall({
          target: target(fn),
          typeArguments: [coinType],
          arguments: [
            tx.object(objectId),
            // Auto-selects/merges/splits the user's collateral coins to exactly
            // the staked amount (replaces the EVM approve → transferFrom flow).
            coinWithBalance({ type: coinType, balance: params.stakeUsdc }),
            tx.pure.u256(mag),
            tx.pure.bool(neg),
            // Shared Clock (0x6): the contract closes trading once the market is
            // resolved or its scheduled close (resolves_at) has passed.
            tx.object(CLOCK_ID),
          ],
        })

        const { digest } = await signAndExecute({ transaction: tx })
        setTxHash(digest)
        // Wait for the trade to be indexed before refetching — invalidating on
        // submit would just refetch pre-trade state.
        await suiClient.waitForTransaction({ digest })
        setStep('confirmed')

        queryClient.invalidateQueries({ queryKey: ['market', marketId] })
        queryClient.invalidateQueries({ queryKey: ['markets'] })
        queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Transaction failed'))
        setStep('error')
      }
    },
    [account, objectId, coinType, marketId, signAndExecute, queryClient],
  )

  const reset = useCallback(() => {
    setStep('idle')
    setTxHash(undefined)
    setError(undefined)
    setPendingParams(null)
  }, [])

  return {
    step,
    execute,
    reset,
    txHash,
    error,
    isWaitingForTx: step === 'buying',
    pendingParams,
  }
}
