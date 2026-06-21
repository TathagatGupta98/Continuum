import { ReactNode } from 'react'

interface ListingCardProps {
  side: 'yes' | 'no'
  strike: number
  tokens: number
  /** Ask price in SUI. */
  priceSui: number
  /** Live curve params, to plot where this strike sits. */
  mu: number
  sigma: number
  /** Right-hand action(s) — Buy / Delist / Claim. */
  action: ReactNode
  /** Small label under the side (e.g. "Your listing" or a kiosk id). */
  note?: string
  /** Muted styling when the market is closed and the listing is inert. */
  dim?: boolean
}

const fmtPrice = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 0 : 2 })

/**
 * A position "ticket" — the signature unit of the secondary market. The strike
 * rail mirrors the Gaussian split that prices every bet: NO region left, YES
 * region right, with a marker where THIS position's strike falls on the live
 * curve. The asset literally carries its place on the curve.
 */
export function ListingCard({
  side,
  strike,
  tokens,
  priceSui,
  mu,
  sigma,
  action,
  note,
  dim,
}: ListingCardProps) {
  const yes = side === 'yes'
  const accent = yes ? 'var(--accent-yes)' : 'var(--accent-no)'

  // Where the strike sits on a μ ± 3σ band (clamped to the rail).
  const span = Math.max(sigma * 6, 1e-9)
  const lo = mu - sigma * 3
  const pct = Math.min(100, Math.max(0, ((strike - lo) / span) * 100))

  return (
    <div
      className="group relative flex items-stretch rounded-lg border overflow-hidden transition-all duration-200"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
        opacity: dim ? 0.62 : 1,
      }}
    >
      {/* Side rail — the ticket's stub. */}
      <div
        className="relative flex w-14 shrink-0 flex-col items-center justify-center gap-1"
        style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)` }}
      >
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
        <span
          className="font-display font-700 text-[11px] tracking-widest"
          style={{ color: accent }}
        >
          {yes ? 'YES' : 'NO'}
        </span>
        <span className="font-mono text-[9px]" style={{ color: 'var(--text-subtle)' }}>
          {yes ? '≥' : '<'}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 px-4 py-3 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-display uppercase tracking-widest" style={{ color: 'var(--text-subtle)' }}>
              Strike
            </p>
            <p className="font-mono text-base leading-tight" style={{ color: 'var(--text-primary)' }}>
              ${fmtPrice(strike)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-display uppercase tracking-widest" style={{ color: 'var(--text-subtle)' }}>
              Pays if it wins
            </p>
            <p className="font-mono text-sm leading-tight" style={{ color: 'var(--text-muted)' }}>
              {tokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
            </p>
          </div>
        </div>

        {/* Strike rail — the signature curve-split indicator. */}
        <div
          className="relative h-1.5 w-full rounded-full overflow-hidden"
          style={{ background: 'var(--bg-surface-2)' }}
          aria-hidden
        >
          <span
            className="absolute inset-y-0 left-0"
            style={{ width: `${pct}%`, background: 'color-mix(in srgb, var(--accent-no) 28%, transparent)' }}
          />
          <span
            className="absolute inset-y-0 right-0"
            style={{ width: `${100 - pct}%`, background: 'color-mix(in srgb, var(--accent-yes) 28%, transparent)' }}
          />
          <span
            className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded"
            style={{ left: `calc(${pct}% - 1px)`, background: accent }}
          />
        </div>
        {note && (
          <p className="font-mono text-[10px] truncate" style={{ color: 'var(--text-subtle)' }}>
            {note}
          </p>
        )}
      </div>

      {/* Price + action */}
      <div
        className="flex shrink-0 flex-col items-end justify-center gap-2 border-l px-4 py-3"
        style={{ borderColor: 'var(--border-dim)' }}
      >
        <div className="text-right">
          <p className="text-[10px] font-display uppercase tracking-widest" style={{ color: 'var(--text-subtle)' }}>
            Ask
          </p>
          <p className="font-mono text-base leading-tight" style={{ color: 'var(--accent-data)' }}>
            {fmtPrice(priceSui)} <span className="text-[11px]">SUI</span>
          </p>
        </div>
        {action}
      </div>
    </div>
  )
}
