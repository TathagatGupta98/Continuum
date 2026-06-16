import { NavLink, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ConnectButton } from '@/components/wallet/ConnectButton'

const navLinks = [
  { to: '/markets', label: 'Markets' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/docs', label: 'Docs' },
]

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur-md bg-[rgba(250,244,232,0.88)] border-[rgba(62,44,30,0.16)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 group">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="4" fill="rgba(200,16,46,0.10)" />
            <path
              d="M4 24 Q8 8 16 8 Q24 8 28 24"
              stroke="#C8102E"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="16" cy="8" r="2" fill="#2B1D14" />
            <line x1="16" y1="8" x2="16" y2="24" stroke="rgba(43,29,20,0.40)" strokeWidth="1" strokeDasharray="2 2" />
          </svg>
          <span className="font-display font-800 text-sm tracking-wider text-[#231812] group-hover:text-[#C8102E] transition-colors duration-200">
            OMNI<span className="text-[#C8102E]">CURVE</span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="hidden sm:flex items-center gap-1">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `relative px-4 py-2 text-xs font-display tracking-wider uppercase transition-colors duration-200 rounded ${
                  isActive
                    ? 'text-[#C8102E]'
                    : 'text-[rgba(35,24,18,0.62)] hover:text-[#231812]'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <motion.span
                    className="block"
                    whileHover={{ y: -1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  >
                    {link.label}
                  </motion.span>
                  {isActive && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute bottom-0.5 left-3 right-3 h-[1.5px] rounded-full bg-[#C8102E]"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <ConnectButton />
      </div>
    </header>
  )
}
