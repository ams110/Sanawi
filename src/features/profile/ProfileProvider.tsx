import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Profile } from '@/lib/db/types'
import { useAuth } from '@/features/auth/AuthProvider'
import { failureText } from '@/lib/i18n/failure'
import { ensureProfile } from './api'

interface ProfileContextValue {
  profile: Profile | null
  loading: boolean
  /** خطأ في جلب الملف — لا يعني بالضرورة أن التطبيق معطّل. */
  error: string | null
  refresh: () => Promise<void>
  /** تحديث محلي فوري بعد كتابة ناجحة، بلا انتظار جولة شبكة. */
  patchLocal: (patch: Partial<Profile>) => void
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }
    try {
      setError(null)
      setProfile(await ensureProfile(user.id))
    } catch (err) {
      setError(failureText(err, t, t('profile.loadFailed')))
    } finally {
      setLoading(false)
    }
  }, [t, user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const patchLocal = useCallback((patch: Partial<Profile>) => {
    setProfile((current) => (current ? { ...current, ...patch } : current))
  }, [])

  return (
    <ProfileContext.Provider value={{ profile, loading, error, refresh, patchLocal }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile خارج ProfileProvider')
  return ctx
}
