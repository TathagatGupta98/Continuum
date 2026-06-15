import { motion } from 'framer-motion'

interface Tab {
  label: string
  value: string
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (value: string) => void
  className?: string
}

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  return (
    <div
      className={`flex gap-0 ${className}`}
      style={{ borderBottom: '1px solid var(--border-dim)' }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className="relative px-5 py-3 text-sm font-display tracking-wide transition-colors duration-150"
          style={{
            color: active === tab.value ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
          onMouseEnter={(e) => {
            if (active !== tab.value)
              (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            if (active !== tab.value)
              (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
          }}
        >
          {tab.label}
          {active === tab.value && (
            <motion.div
              layoutId="tab-indicator"
              className="absolute bottom-0 left-0 right-0 h-px bg-[#C8102E]"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
        </button>
      ))}
    </div>
  )
}
