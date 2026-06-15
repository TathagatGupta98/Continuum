import { ThemeContext, useThemeState } from '@/hooks/useTheme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isDark, toggleTheme } = useThemeState()
  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
