import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'
import { ToastProvider } from '@/components/ui/Toast'
import { useTheme } from '@/hooks/useTheme'
import LiquidChromeBackground from '@/components/ui/LiquidChromeBackground'
import { explorerUrl } from '@/config/sui'
import { REGISTRY_ID } from '@/config/contracts'

export default function PageWrapper() {
  const { isDark } = useTheme()

  useEffect(() => {
    document.body.classList.add('chrome-bg')
    return () => document.body.classList.remove('chrome-bg')
  }, [])

  return (
    <ToastProvider>
      <LiquidChromeBackground isDark={isDark} />
      <div className="min-h-screen flex flex-col transition-colors duration-300">
        <Navbar />
        <main className="flex-1">
          <Outlet />
        </main>
        <footer className={`border-t py-8 mt-16 transition-colors duration-300 ${
          isDark
            ? 'border-[rgba(255,255,255,0.14)]'
            : 'border-[rgba(62,44,30,0.18)]'
        }`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className={`text-xs font-mono transition-colors duration-300 ${
              isDark ? 'text-[rgba(242,242,242,0.55)]' : 'text-[rgba(35,24,18,0.50)]'
            }`}>
              OmniCurve — Sui Testnet
            </p>
            <div className={`flex items-center gap-4 text-xs font-mono transition-colors duration-300 ${
              isDark ? 'text-[rgba(242,242,242,0.55)]' : 'text-[rgba(35,24,18,0.50)]'
            }`}>
              <a
                href={explorerUrl('object', REGISTRY_ID)}
                target="_blank"
                rel="noreferrer"
                className={`transition-colors duration-200 ${
                  isDark ? 'hover:text-[#C8102E]' : 'hover:text-[#C8102E]'
                }`}
              >
                Registry ↗
              </a>
              <span>·</span>
              <span>v0.1.0</span>
            </div>
          </div>
        </footer>
      </div>
    </ToastProvider>
  )
}
