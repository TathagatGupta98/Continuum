import { useState, useCallback } from 'react'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { useQueryClient } from '@tanstack/react-query'
import { suiClient, getUserKiosk } from '@/lib/sui'
import {
  positionTarget,
  kioskTarget,
  KIOSK_TYPE,
  SUI_COIN_TYPE,
  TRANSFER_POLICY_ID,
  COLLATERAL_TYPE,
} from '@/config/contracts'

/**
 * Wrapper over the `continuum::position_market` Move module — the Kiosk-based
 * secondary market for `Position` objects. Each method builds one atomic PTB:
 *
 *  - `list`        → place + list a position (creates the user's Kiosk if absent)
 *  - `delist`      → remove a listing, keeping the position in the kiosk
 *  - `buy`         → purchase a listed position (rule-checked: market must be open)
 *  - `takeAndClaim`→ reclaim a position from the kiosk and redeem winnings
 *
 * Kiosk purchases settle in SUI, so list prices / payments are SUI (MIST). The
 * shared `TransferPolicy<Position>` (`TRANSFER_POLICY_ID`) carries the
 * market-open rule and is required to confirm a purchase.
 */
export type PositionMarketStep =
  | 'idle'
  | 'listing'
  | 'delisting'
  | 'buying'
  | 'claiming'
  | 'confirmed'
  | 'error'

export function usePositionMarket() {
  const account = useCurrentAccount()
  const queryClient = useQueryClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [step, setStep] = useState<PositionMarketStep>('idle')
  const [txHash, setTxHash] = useState<string | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    queryClient.invalidateQueries({ queryKey: ['markets'] })
  }, [queryClient])

  const submit = useCallback(
    async (tx: Transaction) => {
      const { digest } = await signAndExecute({ transaction: tx })
      setTxHash(digest)
      await suiClient.waitForTransaction({ digest })
      return digest
    },
    [signAndExecute],
  )

  /**
   * List an owned `Position` for sale at `priceMist` (SUI/MIST). Reuses the
   * caller's existing Kiosk, or creates and shares one in the same PTB.
   */
  const list = useCallback(
    async (positionId: string, priceMist: bigint) => {
      if (!account) return
      setError(undefined)
      setStep('listing')
      try {
        const tx = new Transaction()
        const existing = await getUserKiosk(account.address)

        let kioskArg
        let capArg
        let created = false
        if (existing) {
          kioskArg = tx.object(existing.kioskId)
          capArg = tx.object(existing.capId)
        } else {
          // kiosk::new() → (Kiosk, KioskOwnerCap)
          const [kiosk, cap] = tx.moveCall({ target: kioskTarget('new') })
          kioskArg = kiosk
          capArg = cap
          created = true
        }

        // list_position(kiosk, cap, position, price)
        tx.moveCall({
          target: positionTarget('list_position'),
          arguments: [kioskArg, capArg, tx.object(positionId), tx.pure.u64(priceMist)],
        })

        if (created) {
          // Share the new kiosk so buyers can purchase from it, and keep the cap.
          tx.moveCall({
            target: '0x2::transfer::public_share_object',
            typeArguments: [KIOSK_TYPE],
            arguments: [kioskArg],
          })
          tx.transferObjects([capArg], account.address)
        }

        await submit(tx)
        setStep('confirmed')
        invalidate()
      } catch (e) {
        console.error('[usePositionMarket.list] failed:', e)
        setError(e instanceof Error ? e : new Error('Transaction failed'))
        setStep('error')
      }
    },
    [account, submit, invalidate],
  )

  /** Remove a listing; the position stays in the caller's kiosk. */
  const delist = useCallback(
    async (positionId: string) => {
      if (!account) return
      setError(undefined)
      setStep('delisting')
      try {
        const kiosk = await getUserKiosk(account.address)
        if (!kiosk) throw new Error('No kiosk found for this wallet')
        const tx = new Transaction()
        // delist_position(kiosk, cap, position_id)
        tx.moveCall({
          target: positionTarget('delist_position'),
          arguments: [tx.object(kiosk.kioskId), tx.object(kiosk.capId), tx.pure.id(positionId)],
        })
        await submit(tx)
        setStep('confirmed')
        invalidate()
      } catch (e) {
        console.error('[usePositionMarket.delist] failed:', e)
        setError(e instanceof Error ? e : new Error('Transaction failed'))
        setStep('error')
      }
    },
    [account, submit, invalidate],
  )

  /**
   * Buy a listed position from `sellerKioskId` for `priceMist` (SUI). The
   * contract proves the market-open rule against `marketObjectId` and delivers
   * the position to the buyer. Aborts on-chain if the market has resolved.
   */
  const buy = useCallback(
    async (params: {
      sellerKioskId: string
      positionId: string
      marketObjectId: string
      priceMist: bigint
      collateralType?: string
    }) => {
      if (!account) return
      setError(undefined)
      setStep('buying')
      try {
        if (!TRANSFER_POLICY_ID) {
          throw new Error('TRANSFER_POLICY_ID is not configured (set VITE_TRANSFER_POLICY_ID)')
        }
        const coinType = params.collateralType || COLLATERAL_TYPE
        const tx = new Transaction()
        // buy_listed_position<T>(seller_kiosk, policy, market, position_id, payment: Coin<SUI>)
        tx.moveCall({
          target: positionTarget('buy_listed_position'),
          typeArguments: [coinType],
          arguments: [
            tx.object(params.sellerKioskId),
            tx.object(TRANSFER_POLICY_ID),
            tx.object(params.marketObjectId),
            tx.pure.id(params.positionId),
            coinWithBalance({ type: SUI_COIN_TYPE, balance: params.priceMist }),
          ],
        })
        await submit(tx)
        setStep('confirmed')
        invalidate()
      } catch (e) {
        console.error('[usePositionMarket.buy] failed:', e)
        setError(e instanceof Error ? e : new Error('Transaction failed'))
        setStep('error')
      }
    },
    [account, submit, invalidate],
  )

  /**
   * Reclaim a position held in the caller's kiosk and redeem it for collateral
   * in one PTB (delists first if still listed). Requires the market resolved and
   * the position winning.
   */
  const takeAndClaim = useCallback(
    async (params: { positionId: string; marketObjectId: string; collateralType?: string }) => {
      if (!account) return
      setError(undefined)
      setStep('claiming')
      try {
        const kiosk = await getUserKiosk(account.address)
        if (!kiosk) throw new Error('No kiosk found for this wallet')
        const coinType = params.collateralType || COLLATERAL_TYPE
        const tx = new Transaction()
        // take_and_claim<T>(kiosk, cap, market, position_id)
        tx.moveCall({
          target: positionTarget('take_and_claim'),
          typeArguments: [coinType],
          arguments: [
            tx.object(kiosk.kioskId),
            tx.object(kiosk.capId),
            tx.object(params.marketObjectId),
            tx.pure.id(params.positionId),
          ],
        })
        await submit(tx)
        setStep('confirmed')
        invalidate()
      } catch (e) {
        console.error('[usePositionMarket.takeAndClaim] failed:', e)
        setError(e instanceof Error ? e : new Error('Transaction failed'))
        setStep('error')
      }
    },
    [account, submit, invalidate],
  )

  const reset = useCallback(() => {
    setStep('idle')
    setTxHash(undefined)
    setError(undefined)
  }, [])

  return { step, list, delist, buy, takeAndClaim, reset, txHash, error }
}
