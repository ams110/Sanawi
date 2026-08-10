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
import { BillsScreen } from '@/features/bills/BillsScreen'
import { ExpensesScreen } from '@/features/expenses/ExpensesScreen'
import { WealthHub } from '@/features/wealth/WealthHub'
import { WealthOverview } from '@/features/wealth/WealthOverview'
import { AssetsScreen } from '@/features/wealth/AssetsScreen'
import { PlansScreen } from '@/features/wealth/PlansScreen'
import { AccountsScreen } from '@/features/accounts/AccountsScreen'
import { FlowHub } from '@/features/flow/FlowHub'
import { ObligationsHub } from '@/features/obligations/ObligationsHub'
import { PartnersScreen } from '@/features/partners/PartnersScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { QuickAdd } from '@/features/quickadd/QuickAdd'
import { UpdateBanner } from '@/features/update/UpdateBanner'
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
  const { pathname } = useLocation()

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

  /*
   * الهامش السفلي يتّسع للزرّ العائم لا لشريط التبويبات وحده.
   *
   * ‏`pb-24` كان يكفي الشريط، والزرّ فوقه يمتدّ إلى 128px فيغطّي آخر سطرٍ في
   * الصفحة — و«آخر سطر» في شاشة الالتزام هو زرّ التراجع عن آخر إيداع، أي
   * أقربُ ما يحتاجه المستخدم بعد غلطة.
   */
  return (
    <div className="min-h-dvh bg-bg pb-36">
      <UpdateBanner />
      <Header />
      <main className="mx-auto max-w-lg">
        <Routes>
          <Route path="/" element={<Navigate to="/month" replace />} />
          <Route path="/month" element={<MonthScreen />} />

          {/*
           * المحاور: التبويب السفلي بابٌ، والمقاطع تحته غرف.
           *
           * سبعة تبويباتٍ صارت خمسة، ولا شاشة حُذفت — انتظمت الشاشات في
           * محاور بشريط مقاطع (HubTabs). كلُّ مقطعٍ مسارٌ فرعي حقيقي،
           * فالرابط العميق يعمل والذاكرة العضلية تُهاجَر بإعادة توجيه.
           */}
          <Route path="/flow" element={<FlowHub />}>
            <Route index element={<Navigate to="/flow/expenses" replace />} />
            <Route path="expenses" element={<ExpensesScreen />} />
            <Route path="income" element={<MoneyScreen />} />
            <Route path="bills" element={<BillsScreen />} />
          </Route>

          <Route path="/obligations" element={<ObligationsHub />}>
            <Route index element={<ObligationsScreen />} />
            <Route path="calendar" element={<CalendarScreen />} />
            <Route path="partners" element={<PartnersScreen />} />
          </Route>
          {/* صفحات التفاصيل خارج المحور: ملء شاشةٍ بزرّ رجوع، لا شريط مقاطع فوقها. */}
          <Route path="/obligations/new" element={<ObligationForm />} />
          <Route path="/obligations/:id" element={<ObligationDetail />} />
          <Route path="/obligations/:id/edit" element={<ObligationForm />} />

          <Route path="/wealth" element={<WealthHub />}>
            <Route index element={<WealthOverview />} />
            <Route path="accounts" element={<AccountsScreen />} />
            <Route path="assets" element={<AssetsScreen />} />
            <Route path="plans" element={<PlansScreen />} />
          </Route>

          <Route path="/reports" element={<InsightsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />

          {/*
           * إعادات توجيهٍ دائمة لا مؤقتة.
           *
           * المسارات القديمة محفوظةٌ في متصفحات 14 مستخدماً حقيقياً وفي
           * عضلات أصابعهم — والأسطر رخيصة. لا تُحذف.
           */}
          <Route path="/expenses" element={<Navigate to="/flow/expenses" replace />} />
          <Route path="/money" element={<Navigate to="/flow/income" replace />} />
          <Route path="/bills" element={<Navigate to="/flow/bills" replace />} />
          <Route path="/calendar" element={<Navigate to="/obligations/calendar" replace />} />
          <Route path="/insights" element={<Navigate to="/reports" replace />} />

          <Route path="*" element={<Navigate to="/month" replace />} />
        </Routes>
      </main>
      {/* الزرّ العائم يضيف مالاً — وفي الإعدادات لا مال يُضاف، فيغيب عنها. */}
      {pathname !== '/settings' && <QuickAdd />}
      <BottomNav />
    </div>
  )
}

/*
 * خمسة أبوابٍ لا سبع شاشات.
 *
 * السبعة كانت حدّاً فيزيائياً (55px للتبويب) لا سقفاً للميزات — فكلّ
 * ميزةٍ جديدة كانت تُدفن في شاشةٍ قائمة. الخمسة أبوابُ محاور: «الحركة»
 * تضمّ ما يدخل ويخرج يومياً، و«الالتزامات» قائمتَها وتقويمَها، و«الثروة»
 * نالت أخيراً تبويبها بأربع صفحات، و«تقارير» بابُ التحليل وما سيُبنى فوقه.
 *
 * «الشهر» و«التزامات» في موقعيهما القديمين عمداً: ذاكرة 14 مستخدماً
 * العضلية أثمن من ترتيبٍ أنظف نظرياً.
 */
const TABS = [
  { to: '/month', key: 'nav.month', icon: '📊' },
  { to: '/flow', key: 'nav.flow', icon: '🛒' },
  { to: '/obligations', key: 'nav.obligations', icon: '🎯' },
  { to: '/wealth', key: 'nav.wealth', icon: '💼' },
  { to: '/reports', key: 'nav.reports', icon: '🔍' },
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
                // خمسة تبويبات = 78px لكل واحد على شاشة 390px — يتّسع 11px.
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

/*
 * الهيدر زرّان لا سبعة.
 *
 * كانت أزرار الثيم الثلاثة و«خروج» محشورةً فيه بخطّ 12px — أهدافُ لمسٍ
 * صغيرة تُضغط مرةً في الشهر وتزاحم اسم التطبيق كلَّ يوم. صارت كلها في
 * شاشة الإعدادات، وبقي هنا ما يُستعمل فعلاً: التحديث وبوابة الإعدادات.
 */
function Header() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const inSettings = pathname === '/settings'
  /*
   * الرجوع لصفحات التفاصيل وحدها.
   *
   * المحاور ومقاطعها كلها «أعلى التطبيق» فتحمل اسمه؛ ما يحتاج رجوعاً
   * هو صفحات ملء الشاشة: تفاصيل الالتزام إلى قائمته، والإعدادات إلى
   * لوحة الشهر. والتقويم والشركاء غرفتان في محور الالتزامات لا تفاصيل.
   */
  const OBLIGATION_HUB_TABS = ['/obligations/calendar', '/obligations/partners']
  const obligationDeep =
    pathname.startsWith('/obligations/') && !OBLIGATION_HUB_TABS.includes(pathname)

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-5 py-3">
        {inSettings ? (
          <Link to="/month" className="text-sm font-bold text-brand">
            ← {t('common.back')}
          </Link>
        ) : obligationDeep ? (
          <Link to="/obligations" className="text-sm font-bold text-brand">
            ← {t('obligations.backToList')}
          </Link>
        ) : (
          <h1 className="text-lg font-bold text-brand">{t('app.name')}</h1>
        )}

        <div className="flex items-center gap-2">
          <RefreshButton />
          <Link
            to="/settings"
            aria-label={t('settings.open')}
            aria-current={inSettings ? 'page' : undefined}
            className={`flex size-9 items-center justify-center rounded-xl border transition ${
              inSettings
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-border bg-surface text-text-muted'
            }`}
          >
            <span className="text-base leading-none" aria-hidden="true">
              ⚙
            </span>
          </Link>
        </div>
      </div>
    </header>
  )
}
