import { BrowserRouter, Navigate, Route, Routes, Link, useLocation } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { AuthScreen } from '@/features/auth/AuthScreen'
import { SetupScreen } from '@/components/SetupScreen'
import { ObligationsScreen } from '@/features/obligations/ObligationsScreen'
import { ObligationForm } from '@/features/obligations/ObligationForm'
import { ObligationDetail } from '@/features/obligations/ObligationDetail'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

// الاستيراد الكسول يبقي المعاينة خارج الحزمة الرئيسية.
const ComponentPreview = lazy(() =>
  import('@/dev/ComponentPreview').then((m) => ({ default: m.ComponentPreview })),
)

function DevPreview() {
  return (
    <div className="min-h-dvh bg-bg">
      <Suspense fallback={null}>
        <ComponentPreview />
      </Suspense>
    </div>
  )
}

export default function App() {
  // معاينة المكوّنات في التطوير فقط: تُحذف من حزمة الإنتاج لأن الشرط ثابت
  // عند البناء، فيزيلها التقليم مع المكوّن كله.
  if (import.meta.env.DEV && window.location.pathname === '/preview') {
    return <DevPreview />
  }

  // بلا مفاتيح لا فائدة من المصادقة ولا من التوجيه: نوجّه المستخدم للإعداد.
  if (!isSupabaseConfigured) return <SetupScreen />

  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  )
}

function Shell() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <span className="size-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (!session) return <AuthScreen />

  return (
    <div className="min-h-dvh bg-bg pb-8">
      <Header />
      <main className="mx-auto max-w-lg">
        <Routes>
          <Route path="/" element={<Navigate to="/obligations" replace />} />
          <Route path="/obligations" element={<ObligationsScreen />} />
          <Route path="/obligations/new" element={<ObligationForm />} />
          <Route path="/obligations/:id" element={<ObligationDetail />} />
          <Route path="/obligations/:id/edit" element={<ObligationForm />} />
          <Route path="*" element={<Navigate to="/obligations" replace />} />
        </Routes>
      </main>
    </div>
  )
}

const THEME_OPTIONS = [
  { value: 'system', key: 'theme.system' },
  { value: 'light', key: 'theme.light' },
  { value: 'dark', key: 'theme.dark' },
] as const satisfies readonly { value: ThemePreference; key: string }[]

function Header() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const { preference, setPreference } = useTheme()
  const { pathname } = useLocation()
  const isHome = pathname === '/obligations'

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-5 py-3">
        {isHome ? (
          <h1 className="text-lg font-bold text-brand">{t('app.name')}</h1>
        ) : (
          <Link to="/obligations" className="text-sm font-bold text-brand">
            ← {t('obligations.backToList')}
          </Link>
        )}

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border bg-surface p-0.5">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPreference(opt.value)}
                className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                  preference === opt.value ? 'bg-brand-soft text-brand' : 'text-text-muted'
                }`}
              >
                {t(opt.key)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-xs font-semibold text-text-muted"
          >
            {t('theme.signOut')}
          </button>
        </div>
      </div>
    </header>
  )
}
