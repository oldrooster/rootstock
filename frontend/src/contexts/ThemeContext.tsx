import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('rootstock_theme') as Theme) || 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('rootstock_theme', theme)
    } catch {}
    // Apply CSS variables on the root element so theme cascades automatically
    const root = document.documentElement
    if (theme === 'light') {
      root.style.setProperty('--bg',      '#f0f2f8')
      root.style.setProperty('--bg-card', '#ffffff')
      root.style.setProperty('--bg-deep', '#e8eaf0')
      root.style.setProperty('--border',  '#d0d4e0')
      root.style.setProperty('--text',    '#1a1a2e')
      root.style.setProperty('--muted',   '#5a6070')
      root.style.setProperty('--primary', '#4a7ef8')
    } else {
      root.style.setProperty('--bg',      '#0f0f1a')
      root.style.setProperty('--bg-card', '#1a1a2e')
      root.style.setProperty('--bg-deep', '#0f0f1a')
      root.style.setProperty('--border',  '#2a2a3e')
      root.style.setProperty('--text',    '#e0e0e0')
      root.style.setProperty('--muted',   '#8890a0')
      root.style.setProperty('--primary', '#7c9ef8')
    }
  }, [theme])

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

/**
 * Helper: returns a style value that adapts to the current theme.
 *
 * Usage:
 *   const { themed } = useThemeStyles()
 *   style={{ background: themed('#1a1a2e', '#ffffff') }}
 */
export function useThemeStyles() {
  const { theme } = useTheme()
  const themed = (dark: string, light: string) => theme === 'dark' ? dark : light
  return { theme, themed }
}
