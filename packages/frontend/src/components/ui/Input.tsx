import { forwardRef, InputHTMLAttributes } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

const cn = (...args: Parameters<typeof clsx>) => twMerge(clsx(...args))

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  suffix?: string
  prefix?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, suffix, prefix, className, type, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            className="text-xs font-display tracking-wider uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {prefix && (
            <span
              className="absolute left-3 text-sm font-mono select-none"
              style={{ color: 'var(--text-muted)' }}
            >
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            type={type}
            className={cn(
              'w-full border rounded py-2.5 px-3',
              'text-sm transition-colors duration-150',
              'focus:outline-none',
              type === 'number' && 'font-mono',
              prefix && 'pl-7',
              suffix && 'pr-14',
              className,
            )}
            style={{
              background: 'var(--bg-surface)',
              borderColor: error ? 'rgba(255,69,96,0.6)' : 'var(--border)',
              color: 'var(--text-primary)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(196,18,48,0.5)'
              e.currentTarget.style.background = 'var(--bg-surface-2)'
              props.onFocus?.(e)
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = error ? 'rgba(255,69,96,0.6)' : 'var(--border)'
              e.currentTarget.style.background = 'var(--bg-surface)'
              props.onBlur?.(e)
            }}
            {...props}
          />
          {suffix && (
            <span
              className="absolute right-3 text-xs font-mono select-none"
              style={{ color: 'var(--text-muted)' }}
            >
              {suffix}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-[#B42318] font-mono">{error}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'
