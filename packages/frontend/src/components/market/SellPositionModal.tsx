import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ListingCard } from './ListingCard'
import type { OwnedPosition } from '@/lib/sui'

interface SellPositionModalProps {
  open: boolean
  onClose: () => void
  position: OwnedPosition | null
  mu: number
  sigma: number
  submitting: boolean
  /** Called with the ask price in SUI. */
  onList: (priceSui: number) => void
}

/**
 * Set an ask price (SUI) and list an owned position on the Kiosk market. Shows a
 * live ticket preview of exactly what buyers will see.
 */
export function SellPositionModal({
  open,
  onClose,
  position,
  mu,
  sigma,
  submitting,
  onList,
}: SellPositionModalProps) {
  const [price, setPrice] = useState('')
  const priceNum = Number(price)
  const valid = Number.isFinite(priceNum) && priceNum > 0

  if (!position) return null

  return (
    <Modal open={open} onClose={onClose} title="List position for sale">
      <div className="px-6 py-5 space-y-5">
        <p className="text-xs font-mono leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Your position is escrowed in your Kiosk and stays yours until a buyer pays your ask.
          Trades settle in SUI. You can delist any time before it sells.
        </p>

        {/* Live preview of the listing buyers will see. */}
        <ListingCard
          side={position.isYes ? 'yes' : 'no'}
          strike={position.targetX}
          tokens={position.tokens}
          priceSui={valid ? priceNum : 0}
          mu={mu}
          sigma={sigma}
          note="Preview"
          action={null}
        />

        <Input
          label="Ask price"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.1"
          suffix="SUI"
          placeholder="0.0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />

        <div
          className="rounded-md border px-3 py-2.5 text-[11px] font-mono leading-relaxed"
          style={{
            borderColor: 'var(--border-dim)',
            background: 'var(--bg-surface-2)',
            color: 'var(--text-subtle)',
          }}
        >
          Buyers can only purchase while this market is open. Once it resolves, the listing is
          frozen on-chain — no one can buy a settled position.
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="muted" className="flex-1 py-2.5" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1 py-2.5"
            loading={submitting}
            disabled={!valid || submitting}
            onClick={() => onList(priceNum)}
          >
            List for {valid ? priceNum : 0} SUI
          </Button>
        </div>
      </div>
    </Modal>
  )
}
