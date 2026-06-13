import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { SUI_NETWORK } from '@/config/sui'

/**
 * Shared read-only Sui client for ad-hoc object reads outside React Query's
 * dapp-kit hooks (e.g. fetching a market's on-chain owner / seed state before a
 * PTB). Mirrors the field parsing the backend `chainService` uses.
 */
export const suiClient = new SuiClient({ url: getFullnodeUrl(SUI_NETWORK) })

const WAD = 1e18

type FpJson = { mag: string | number; neg: boolean }

/** Convert a Move `Fp` object-field to a signed JS float (WAD → units). */
export function fpFieldToFloat(field: unknown): number {
  if (field == null) return 0
  const inner = ((field as { fields?: FpJson }).fields ?? field) as FpJson
  const mag = Number(BigInt(inner.mag ?? 0)) / WAD
  return inner.neg ? -mag : mag
}

export interface MarketSeedState {
  /** σ > 0 ⇒ the creator has seeded the curve via set_distribution. */
  seeded: boolean
  owner: string
  pendingOwner: string
  /** σ floor (sigma_min) as a float. */
  sigmaMin: number
  /** Total LP shares (WAD u256) as a bigint, for share-estimate math. */
  totalShares: bigint
}

/**
 * Read the bits of a `Market<T>` shared object the LP/owner flows need that the
 * backend doesn't persist: seed state, owner, pending owner, σ floor and total
 * shares. Replaces the EVM build's raw storage-slot reads (pending_owner @0x1,
 * sigma_min @0x4) — every field has a public Move object field on Sui.
 */
export async function getMarketSeedState(objectId: string): Promise<MarketSeedState> {
  const obj = await suiClient.getObject({ id: objectId, options: { showContent: true } })
  const content = obj.data?.content
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Object ${objectId} is not a Move object`)
  }
  const f = content.fields as Record<string, unknown>
  const sigma = fpFieldToFloat(f.sigma)
  return {
    seeded: sigma > 0,
    owner: String(f.owner ?? '').toLowerCase(),
    pendingOwner: String(f.pending_owner ?? '0x0').toLowerCase(),
    sigmaMin: fpFieldToFloat(f.sigma_min),
    totalShares: BigInt((f.total_shares as string) ?? 0),
  }
}

/** On-chain owner of a `Market<T>` (used to gate the owner-controls panel). */
export async function getMarketOwner(objectId: string): Promise<string> {
  const obj = await suiClient.getObject({ id: objectId, options: { showContent: true } })
  const f = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields
  return String(f?.owner ?? '').toLowerCase()
}
