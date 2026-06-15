import { createContext, useContext, useEffect } from 'react'

interface ThemeContextValue {
  isDark: boolean
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  toggleTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

export function useThemeState() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
  }, [])

  return { isDark: false, toggleTheme: () => {} }
}
