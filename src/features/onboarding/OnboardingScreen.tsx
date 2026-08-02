import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/features/profile/ProfileProvider'
import { completeOnboarding } from '@/features/profile/api'
import { TemplatePicker } from '@/features/obligations/TemplatePicker'
import { createObligation, listTemplates, track } from '@/features/obligations/api'
import { Button } from '@/components/ui/Button'
import type { ObligationTemplate } from '@/lib/db/types'

/**
 * أول تشغيل: شاشتا شرح ثم إضافة أول التزام من القوالب.
 *
 * الهدف الوحيد أن يرى المستخدم قسطه الشهري في أقل من دقيقتين من التسجيل.
 * كل ما لا يخدم ذلك مؤجَّل: لا دخل، لا مجموعات، لا إعدادات.
 * وزر "تخطّى" ظاهر دائماً — احتجاز المستخدم في مقدمة يجعله يغلق التطبيق.
 */
export function OnboardingScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { patchLocal } = useProfile()
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [templates, setTemplates] = useState<ObligationTemplate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // فشل جلب القوالب لا يحبس المستخدم: يكمل إلى الفورم اليدوي.
    listTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [])

  const finish = async (destination: string) => {
    if (!user) return
    patchLocal({ onboarding_completed: true })
    // لا ننتظر الكتابة: تأخّرها لا يبرّر تأخير المستخدم، وفشلها يعيد المقدمة
    // مرة واحدة في أسوأ الأحوال — أهون من شاشة تحميل معلّقة.
    void completeOnboarding(user.id).catch(() => {})
    navigate(destination, { replace: true })
  }

  const pickTemplate = async (tpl: ObligationTemplate) => {
    if (!user) return
    setBusy(true)
    setError(null)

    const months = tpl.default_recurrence_months || 12
    const due = new Date()
    due.setMonth(due.getMonth() + months)

    const suggested =
      tpl.suggested_min != null && tpl.suggested_max != null
        ? Math.round((Number(tpl.suggested_min) + Number(tpl.suggested_max)) / 2)
        : 0

    try {
      const created = await createObligation(
        {
          name: tpl.name_ar,
          category: tpl.category,
          total_amount: suggested,
          next_due_date: due.toISOString().slice(0, 10),
          recurrence_months: tpl.default_recurrence_months,
          my_share_percent: 100,
          group_id: null,
          notes: null,
        },
        user.id,
      )
      void track(user.id, 'onboarding_first_obligation', { category: tpl.category })
      // يهبط مباشرةً على التفاصيل: هناك الرقم الذي جاء من أجله.
      await finish(`/obligations/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.createFailed'))
      setBusy(false)
    }
  }

  const STEPS = [
    { title: t('onboarding.step1Title'), body: t('onboarding.step1Body'), icon: '😰' },
    { title: t('onboarding.step2Title'), body: t('onboarding.step2Body'), icon: '🧮' },
  ]

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-brand' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => void finish('/obligations')}
          className="text-sm font-semibold text-text-muted"
        >
          {t('onboarding.skip')}
        </button>
      </header>

      <main className="flex flex-1 flex-col justify-center px-6 pb-10">
        {step < 2 ? (
          <div className="space-y-5 text-center">
            <p className="text-6xl" aria-hidden="true">
              {STEPS[step]!.icon}
            </p>
            <h1 className="text-2xl font-bold text-text">{STEPS[step]!.title}</h1>
            <p className="text-[16px] leading-relaxed text-text-muted">{STEPS[step]!.body}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-text">{t('onboarding.step3Title')}</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-text-muted">
                {t('onboarding.step3Body')}
              </p>
            </div>

            {error && (
              <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}

            <div className={busy ? 'pointer-events-none opacity-50' : undefined}>
              <TemplatePicker
                templates={templates}
                onPick={(tpl) => void pickTemplate(tpl)}
                onSkip={() => void finish('/obligations/new')}
              />
            </div>
          </div>
        )}
      </main>

      {step < 2 && (
        <footer className="px-6 pb-10">
          <Button onClick={() => setStep(step + 1)} className="w-full">
            {step === 1 ? t('onboarding.start') : t('onboarding.next')}
          </Button>
        </footer>
      )}
    </div>
  )
}
