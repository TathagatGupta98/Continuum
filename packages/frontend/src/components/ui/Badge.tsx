import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

const cn = (...args: Parameters<typeof clsx>) => twMerge(clsx(...args))

interface BadgeProps {
  variant?: 'yes' | 'no' | 'live' | 'resolved' | 'muted' | 'amber'
  children: React.ReactNode
  className?: string
}

export function Badge({ variant = 'muted', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono rounded-sm tracking-wide',
        {
          'bg-[rgba(11,122,82,0.15)] text-[#0B7A52] border border-[rgba(11,122,82,0.45)]':
            variant === 'yes' || variant === 'live',
          'bg-[rgba(180,35,24,0.15)] text-[#B42318] border border-[rgba(180,35,24,0.45)]':
            variant === 'no' || variant === 'resolved',
          'bg-[rgba(200,16,46,0.15)] text-[#C8102E] border border-[rgba(200,16,46,0.45)]':
            variant === 'amber',
        },
        className,
      )}
      style={
        variant === 'muted'
          ? {
              background: 'var(--bg-surface-2)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }
          : undefined
      }
    >
      {variant === 'live' && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#0B7A52] animate-pulse" />
      )}
      {children}
    </span>
  )
}
