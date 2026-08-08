import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/features/profile/ProfileProvider'
import { updateProfile } from '@/features/profile/api'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { Button } from '@/components/ui/Button'
import { failureText } from '@/lib/i18n/failure'
import { BackupSection, UpdateSection } from '@/features/backup/BackupSection'

const THEME_OPTIONS = [
  { value: 'system', key: 'theme.system' },
  { value: 'light', key: 'theme.light' },
  { value: 'dark', key: 'theme.dark' },
] as const satisfies readonly { value: ThemePreference; key: string }[]

/**
 * شاشة الإعدادات — الحساب والمظهر والبيانات في مكانٍ واحد.
 *
 * كانت أزرار الثيم و«خروج» محشورةً في الهيدر بخطّ 12px، والنسخ الاحتياطي
 * والتحديث أسفل شاشة الدخل حيث لا يخطر لأحدٍ أن يبحث عنهما. المجموعات هنا
 * على نسق إعدادات الهاتف نفسه: من يفتحها يعرف أين ينظر بلا تعلّم.
 */
export function SettingsScreen() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const { profile } = useProfile()
  const { preference, setPreference } = useTheme()

  return (
    <div className="space-y-5 px-5 py-6">
      <h1 className="text-xl font-bold text-text">{t('settings.title')}</h1>

      <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
        <h2 className="text-sm font-bold text-text">{t('settings.accountSection')}</h2>

        <NameField />

        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2.5">
          <span className="text-sm font-semibold text-text-muted">{t('settings.email')}</span>
          {/* الإيميل من الجلسة لا من الملف: هو ما سجّل به فعلاً. */}
          <span className="num truncate text-sm text-text" dir="ltr">
            {user?.email}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2.5">
          <span className="text-sm font-semibold text-text-muted">{t('settings.currency')}</span>
          <span className="num text-sm text-text">{profile?.currency}</span>
        </div>
      </section>

      <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
        <h2 className="text-sm font-bold text-text">{t('settings.appearanceSection')}</h2>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPreference(opt.value)}
              aria-pressed={preference === opt.value}
              className={`min-h-12 flex-1 rounded-xl border px-2 text-sm font-semibold transition ${
                preference === opt.value
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-bg text-text-muted'
              }`}
            >
              {t(opt.key)}
            </button>
          ))}
        </div>
      </section>

      <BackupSection />
      <UpdateSection />

      <Button type="button" variant="danger" className="w-full" onClick={() => void signOut()}>
        {t('settings.signOut')}
      </Button>
    </div>
  )
}

/**
 * الاسم يُحفظ بزرّ لا عند كل حرف — كتابة القاعدة أبطأ من الكتابة على اللوحة،
 * وزرّ «انحفظ ✓» هو ما يقول إن الاسم وصل فعلاً.
 */
function NameField() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { profile, patchLocal } = useProfile()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // الحقل يتبع الملف حين يصل أو يتحدّث — القيمة الأولى تُلتقط قبل أن يكتمل
  // الجلب أحياناً، فيبقى الحقل فارغاً واسمُ صاحبه محفوظٌ في القاعدة.
  useEffect(() => setName(profile?.display_name ?? ''), [profile?.display_name])

  const dirty = name.trim() !== (profile?.display_name ?? '')

  const save = async () => {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const trimmed = name.trim()
      await updateProfile(user.id, { display_name: trimmed || null })
      patchLocal({ display_name: trimmed || null })
      setSaved(true)
    } catch (err) {
      setError(failureText(err, t, t('settings.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-surface-muted px-3 py-2.5">
          <span className="shrink-0 text-sm font-semibold text-text-muted">
            {t('settings.name')}
          </span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
            placeholder={t('settings.namePlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none"
          />
        </label>
        {(dirty || saved) && (
          <Button type="button" variant="secondary" loading={busy} disabled={!dirty} onClick={() => void save()}>
            {saved && !dirty ? t('settings.saved') : t('common.save')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
