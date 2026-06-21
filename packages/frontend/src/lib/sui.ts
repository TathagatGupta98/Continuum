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

export interface UserKiosk {
  /** The shared `Kiosk` object id that holds the user's listed positions. */
  kioskId: string
  /** The owned `KioskOwnerCap` proving control of that kiosk. */
  capId: string
}

/**
 * Resolve the connected wallet's Kiosk by reading the `KioskOwnerCap` it owns
 * (the cap's `for` field points at its `Kiosk`). The Kiosk-based position market
 * needs both the kiosk id and the cap for list/delist/take flows; there is no
 * Kiosk SDK installed, so we read the cap object directly.
 *
 * Returns the first cap found — the position market assumes one kiosk per user
 * (the common case). Returns `null` when the user has no kiosk yet, in which
 * case `usePositionMarket.list` creates one inside the listing PTB.
 */
export async function getUserKiosk(owner: string): Promise<UserKiosk | null> {
  let cursor: string | null | undefined = undefined
  do {
    const page = await suiClient.getOwnedObjects({
      owner,
      filter: { StructType: '0x2::kiosk::KioskOwnerCap' },
      options: { showContent: true },
      cursor,
    })
    for (const o of page.data) {
      const content = o.data?.content
      if (!content || content.dataType !== 'moveObject') continue
      const kioskId = (content.fields as Record<string, unknown>).for
      if (typeof kioskId === 'string' && o.data?.objectId) {
        return { kioskId, capId: o.data.objectId }
      }
    }
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return null
}

/** On-chain owner of a `Market<T>` (used to gate the owner-controls panel). */
export async function getMarketOwner(objectId: string): Promise<string> {
  const obj = await suiClient.getObject({ id: objectId, options: { showContent: true } })
  const f = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields
  return String(f?.owner ?? '').toLowerCase()
}

export interface PositionListing {
  /** The seller's `Kiosk` holding the listed position. */
  kioskId: string
  /** The listed `Position` object id. */
  positionId: string
  /** Ask price in MIST (SUI, 9 decimals). */
  priceMist: bigint
  /** The market the position belongs to. */
  marketId: string
  /** Strike price (signed float). */
  strike: number
  /** YES (ABOVE) when true, NO (BELOW) when false. */
  isYes: boolean
  /** Tokens held (pays 1 USDC/token if it wins). */
  tokens: number
}

/**
 * Active `Position` listings on the Kiosk secondary market, reconstructed from
 * the framework's Kiosk events for the `Position` type (there is no Kiosk SDK or
 * dedicated indexer). Replays `ItemListed` / `ItemPurchased` / `ItemDelisted` in
 * chronological order — the last event per (kiosk, item) decides whether it is
 * still listed — then enriches each survivor with its on-chain position fields.
 * Optionally filtered to one market.
 */
export async function getPositionListings(
  marketId?: string | number,
): Promise<PositionListing[]> {
  const T = `${PACKAGE_ID}::market::Position`
  const kinds = ['ItemListed', 'ItemPurchased', 'ItemDelisted'] as const
  type Ev = { kind: (typeof kinds)[number]; kiosk: string; id: string; price?: string; ts: number; seq: bigint }
  const events: Ev[] = []

  for (const kind of kinds) {
    let cursor: { txDigest: string; eventSeq: string } | null | undefined = undefined
    do {
      const page = await suiClient.queryEvents({
        query: { MoveEventType: `0x2::kiosk::${kind}<${T}>` },
        cursor,
        limit: 200,
        order: 'ascending',
      })
      for (const e of page.data) {
        const pj = e.parsedJson as { kiosk: string; id: string; price?: string }
        events.push({
          kind,
          kiosk: pj.kiosk,
          id: pj.id,
          price: pj.price,
          ts: Number(e.timestampMs ?? 0),
          seq: BigInt(e.id.eventSeq),
        })
      }
      cursor = page.hasNextPage ? page.nextCursor : null
    } while (cursor)
  }

  // Replay chronologically; only `ItemListed` (re)activates, the others clear.
  events.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))
  const active = new Map<string, { kiosk: string; id: string; price: string }>()
  for (const e of events) {
    const key = `${e.kiosk}:${e.id}`
    if (e.kind === 'ItemListed') active.set(key, { kiosk: e.kiosk, id: e.id, price: e.price ?? '0' })
    else active.delete(key)
  }
  if (active.size === 0) return []

  const survivors = [...active.values()]
  const objs = await suiClient.multiGetObjects({
    ids: survivors.map((s) => s.id),
    options: { showContent: true },
  })
  const byId = new Map<string, Record<string, unknown>>()
  for (const o of objs) {
    const c = o.data?.content
    if (o.data && c && c.dataType === 'moveObject') {
      byId.set(o.data.objectId, c.fields as Record<string, unknown>)
    }
  }

  const want = marketId != null ? String(marketId) : null
  const out: PositionListing[] = []
  for (const s of survivors) {
    const f = byId.get(s.id)
    if (!f) continue // object vanished (purchased in same window) — skip
    const mId = String(f.market_id ?? '')
    if (want != null && mId !== want) continue
    const amountWad = BigInt((f.amount_wad as string) ?? 0)
    out.push({
      kioskId: s.kiosk,
      positionId: s.id,
      priceMist: BigInt(s.price),
      marketId: mId,
      strike: fpFieldToFloat(f.target_x),
      isYes: Boolean(f.is_yes),
      tokens: Number(amountWad) / WAD,
    })
  }
  return out
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
