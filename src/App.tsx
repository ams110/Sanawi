import { BrowserRouter, Navigate, Route, Routes, Link, useLocation } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { AuthScreen } from '@/features/auth/AuthScreen'
import { SetupScreen } from '@/components/SetupScreen'
import { ObligationsScreen } from '@/features/obligations/ObligationsScreen'
import { ObligationForm } from '@/features/obligations/ObligationForm'
import { ObligationDetail } from '@/features/obligations/ObligationDetail'
import { ProfileProvider, useProfile } from '@/features/profile/ProfileProvider'
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen'
import { MonthScreen } from '@/features/month/MonthScreen'
import { CalendarScreen } from '@/features/calendar/CalendarScreen'
import { MoneyScreen } from '@/features/money/MoneyScreen'
import { InsightsScreen } from '@/features/insights/InsightsScreen'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { RefreshProvider, useRefresh } from '@/lib/refresh'
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
        <ProfileProvider>
          <RefreshProvider>
            <Shell />
          </RefreshProvider>
        </ProfileProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

function Shell() {
  const { session, loading } = useAuth()
  const { profile, loading: profileLoading } = useProfile()

  if (loading || (session && profileLoading)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <span className="size-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (!session) return <AuthScreen />

  // المقدمة تسبق كل شيء ولا تُعرض إلا لمن لم يكملها.
  // فشل جلب الملف لا يحبس المستخدم: نكمل إلى التطبيق بدل شاشة عالقة.
  if (profile && !profile.onboarding_completed) return <OnboardingScreen />

  return (
    <div className="min-h-dvh bg-bg pb-24">
      <Header />
      <main className="mx-auto max-w-lg">
        <Routes>
          <Route path="/" element={<Navigate to="/month" replace />} />
          <Route path="/month" element={<MonthScreen />} />
          <Route path="/calendar" element={<CalendarScreen />} />
          <Route path="/money" element={<MoneyScreen />} />
          <Route path="/insights" element={<InsightsScreen />} />
          <Route path="/obligations" element={<ObligationsScreen />} />
          <Route path="/obligations/new" element={<ObligationForm />} />
          <Route path="/obligations/:id" element={<ObligationDetail />} />
          <Route path="/obligations/:id/edit" element={<ObligationForm />} />
          <Route path="*" element={<Navigate to="/month" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}

const TABS = [
  { to: '/month', key: 'nav.month', icon: '📊' },
  { to: '/obligations', key: 'nav.obligations', icon: '🎯' },
  { to: '/calendar', key: 'nav.calendar', icon: '📅' },
  { to: '/money', key: 'nav.money', icon: '💰' },
  { to: '/insights', key: 'insights.tab', icon: '🔍' },
] as const

/**
 * تنقّل سفلي: الإبهام يصل إلى أسفل الشاشة لا إلى أعلاها،
 * والتطبيق يُستعمل من التلفون بيد واحدة في 95% من الوقت.
 */
function BottomNav() {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 backdrop-blur">
      <ul className="mx-auto flex max-w-lg items-stretch pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => {
          const active = pathname === tab.to || pathname.startsWith(`${tab.to}/`)
          return (
            <li key={tab.to} className="flex-1">
              <Link
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition ${
                  active ? 'text-brand' : 'text-text-muted'
                }`}
              >
                <span className="text-lg leading-none" aria-hidden="true">
                  {tab.icon}
                </span>
                {t(tab.key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** زر التحديث: هدف لمس كامل لا أيقونة صغيرة — يُضغط بالإبهام أثناء المشي. */
function RefreshButton() {
  const { t } = useTranslation()
  const { refresh, busy } = useRefresh()

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={busy}
      aria-label={t('common.refresh')}
      className="flex size-9 items-center justify-center rounded-xl border border-border bg-surface text-text-muted transition disabled:opacity-50"
    >
      <span className={`text-base leading-none ${busy ? 'animate-spin' : ''}`} aria-hidden="true">
        ⟳
      </span>
    </button>
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
  const isTab = TABS.some((tab) => tab.to === pathname)

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-5 py-3">
        {isTab ? (
          <h1 className="text-lg font-bold text-brand">{t('app.name')}</h1>
        ) : (
          <Link to="/obligations" className="text-sm font-bold text-brand">
            ← {t('obligations.backToList')}
          </Link>
        )}

        <div className="flex items-center gap-2">
          <RefreshButton />
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
