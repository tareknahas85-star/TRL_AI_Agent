import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

export type Palette = 'default' | 'syrian'

type ThemeContextValue = { theme: Theme; toggleTheme: () => void; palette: Palette; togglePalette: () => void }

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'theme'
const PALETTE_KEY = 'palette'

function getInitialPalette(): Palette {
  try {
    return localStorage.getItem(PALETTE_KEY) === 'syrian' ? 'syrian' : 'default'
  } catch {
    return 'default'
  }
}

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage unavailable: use the default
  }
  return 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [palette, setPalette] = useState<Palette>(getInitialPalette)

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('syrian', palette === 'syrian')
    try {
      localStorage.setItem(PALETTE_KEY, palette)
    } catch {
      // ignore
    }
  }, [palette])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
  }, [theme])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const togglePalette = () => setPalette((p) => (p === 'syrian' ? 'default' : 'syrian'))

  return <ThemeContext.Provider value={{ theme, toggleTheme, palette, togglePalette }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
