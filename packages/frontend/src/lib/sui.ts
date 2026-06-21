import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { SUI_NETWORK } from '@/config/sui'
import { PACKAGE_ID } from '@/config/contracts'

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

export interface OwnedPosition {
  /** Real on-chain `Position` object id — what claim_winnings consumes. */
  objectId: string
  /** Strike price (signed float). */
  targetX: number
  /** YES (ABOVE) when true, NO (BELOW) when false. */
  isYes: boolean
  /** Tokens held (WAD); pays 1 USDC/token if the position wins. */
  amountWad: bigint
  /** Tokens held as a display float. */
  tokens: number
}

/**
 * Fetch the connected wallet's owned `Position` objects for one market, read
 * straight from chain. The backend collapses every buy into a single aggregate
 * row keyed by `user-market-direction-strike` and drops the real object ids, so
 * claiming (which consumes a specific `Position` object) must read the actual
 * owned objects here. Paginates through all pages.
 */
export async function getOwnedPositions(
  owner: string,
  marketId: string | number,
): Promise<OwnedPosition[]> {
  const out: OwnedPosition[] = []
  const wantMarket = String(marketId)
  let cursor: string | null | undefined = undefined
  do {
    const page = await suiClient.getOwnedObjects({
      owner,
      filter: { StructType: `${PACKAGE_ID}::market::Position` },
      options: { showContent: true },
      cursor,
    })
    for (const o of page.data) {
      const content = o.data?.content
      if (!content || content.dataType !== 'moveObject') continue
      const f = content.fields as Record<string, unknown>
      if (String(f.market_id ?? '') !== wantMarket) continue
      const amountWad = BigInt((f.amount_wad as string) ?? 0)
      out.push({
        objectId: o.data!.objectId,
        targetX: fpFieldToFloat(f.target_x),
        isYes: Boolean(f.is_yes),
        amountWad,
        tokens: Number(amountWad) / WAD,
      })
    }
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return out
}

/** On-chain owner of a `Market<T>` (used to gate the owner-controls panel). */
export async function getMarketOwner(objectId: string): Promise<string> {
  const obj = await suiClient.getObject({ id: objectId, options: { showContent: true } })
  const f = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields
  return String(f?.owner ?? '').toLowerCase()
}

export interface MarketPythState {
  /** Bound Pyth feed id as 0x-hex, or '' for a manual / AI-oracle market. */
  priceFeedId: string
  /** Whether the market binds a Pyth feed (⇒ settles trustlessly on-chain). */
  hasPriceFeed: boolean
  /** Scheduled close (Clock ms). Resolution can only run once now ≥ this. */
  resolvesAt: number
}

/**
 * Read the settlement-source fields the backend doesn't persist: the bound Pyth
 * `price_feed_id` and the scheduled close `resolves_at`. Drives whether the
 * "Resolve via Pyth" button shows and whether the market has closed. A
 * `vector<u8>` object-field comes back as an array of byte values; mirrors the
 * backend `chainService.getPriceFeedId` hex encoding.
 */
export async function getMarketPythState(objectId: string): Promise<MarketPythState> {
  const obj = await suiClient.getObject({ id: objectId, options: { showContent: true } })
  const f = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields
  const raw = f?.price_feed_id
  const priceFeedId =
    Array.isArray(raw) && raw.length > 0
      ? '0x' + raw.map((b: number) => (b & 0xff).toString(16).padStart(2, '0')).join('')
      : ''
  return {
    priceFeedId,
    hasPriceFeed: priceFeedId !== '',
    resolvesAt: Number(f?.resolves_at ?? 0),
  }
}
