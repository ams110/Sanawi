import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

/**
 * تحديث يدوي لكل الشاشات.
 *
 * البيانات تُجلب مرة واحدة عند فتح الشاشة، فلا يظهر ما تغيّر من جهاز آخر
 * ولا ما عدّله المستخدم في شاشة أخرى. داخل تطبيق مغلّف لا يوجد زر تحديث
 * المتصفح ولا سحب لأسفل، فبدون هذا لا سبيل إلى بيانات جديدة إلا إغلاق
 * التطبيق وفتحه.
 *
 * العدّاد يدخل في مصفوفة اعتماديات كل شاشة، فزيادته تعيد الجلب في كل مكان.
 */
interface RefreshContextValue {
  token: number
  refresh: () => void
  /** تُستعمل لإظهار الدوران في الزر ريثما تنتهي الشاشة من الجلب. */
  busy: boolean
  setBusy: (busy: boolean) => void
}

const RefreshContext = createContext<RefreshContextValue | null>(null)

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(0)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    setBusy(true)
    setToken((t) => t + 1)
  }, [])

  return (
    <RefreshContext.Provider value={{ token, refresh, busy, setBusy }}>
      {children}
    </RefreshContext.Provider>
  )
}

export function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext)
  if (!ctx) throw new Error('useRefresh خارج RefreshProvider')
  return ctx
}
