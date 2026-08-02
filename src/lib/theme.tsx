import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'sanawi.theme'

interface ThemeContextValue {
  preference: ThemePreference
  /** الثيم المطبَّق فعلاً بعد حلّ خيار «النظام». */
  resolved: 'light' | 'dark'
  setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStored(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    /* التخزين محجوب (تصفح خاص) — نكمل بالافتراضي. */
  }
  return 'system'
}

function resolve(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored)
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(readStored()))

  useEffect(() => {
    const apply = () => {
      const next = resolve(preference)
      setResolved(next)
      document.documentElement.classList.toggle('dark', next === 'dark')
    }
    apply()

    // نتابع تغيّر إعداد النظام فقط حين يكون الاختيار «النظام».
    if (preference !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* لا يضر: الاختيار يبقى فعّالاً لهذه الجلسة. */
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme خارج ThemeProvider')
  return ctx
}
