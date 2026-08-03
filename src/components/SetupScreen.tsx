import { useTranslation } from 'react-i18next'

/**
 * تظهر حين لا يجد التطبيق مفاتيح Supabase.
 *
 * البديل شاشة بيضاء وخطأ في وحدة التحكم لا يفهمه أحد. هذه تقول ما الناقص
 * وأين يُجلب وأين يوضع — بالضبط.
 */
export function SetupScreen() {
  const { t } = useTranslation()
  const steps = [t('setup.step1'), t('setup.step2'), t('setup.step3')]

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-5 py-10">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-border bg-surface p-6">
        <div>
          <h1 className="text-2xl font-bold text-brand">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('setup.title')}</p>
        </div>

        <ol className="space-y-4 text-[15px] leading-relaxed text-text">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <pre
          dir="ltr"
          className="overflow-x-auto rounded-xl bg-surface-muted p-3 text-[12px] leading-relaxed text-text"
        >
          <code>{`VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...`}</code>
        </pre>

        <p className="text-sm text-text-muted">{t('setup.restart')}</p>
      </div>
    </div>
  )
}
