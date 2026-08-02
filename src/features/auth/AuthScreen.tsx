import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

/**
 * رسائل Supabase إنجليزية وتقنية — نترجم ما يقع فعلاً منها.
 * ما لا نعرفه يمرّ كما هو: رسالة إنجليزية غامضة أفضل من رسالة عربية خاطئة.
 */
function humanError(message: string, t: TFunction): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login')) return t('auth.errors.invalidLogin')
  if (m.includes('already registered')) return t('auth.errors.alreadyRegistered')
  if (m.includes('password') && m.includes('6')) return t('auth.errors.shortPassword')
  if (m.includes('email') && m.includes('invalid')) return t('auth.errors.invalidEmail')
  if (m.includes('rate limit')) return t('auth.errors.rateLimit')
  return message
}

export function AuthScreen() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        // مع تفعيل تأكيد الإيميل لا تُنشأ جلسة فوراً — نوضّح ذلك بدل صمت مربك.
        if (!data.session) {
          setNotice(t('auth.confirmSent'))
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : String(err), t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-brand">{t('app.name')}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-text-muted">
            {t('app.tagline')}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-3xl border border-border bg-surface p-6">
          <div className="flex rounded-2xl bg-surface-muted p-1">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                mode === 'signin' ? 'bg-surface text-brand shadow-sm' : 'text-text-muted'
              }`}
            >
              {t('auth.signIn')}
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                mode === 'signup' ? 'bg-surface text-brand shadow-sm' : 'text-text-muted'
              }`}
            >
              {t('auth.signUp')}
            </button>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-text">{t('auth.email')}</span>
            <input
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg px-3 py-3 text-[15px] text-text outline-none focus:border-brand"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-text">{t('auth.password')}</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg px-3 py-3 text-[15px] text-text outline-none focus:border-brand"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-xl bg-brand-soft px-3 py-2.5 text-sm text-brand">
              {notice}
            </p>
          )}

          <Button type="submit" loading={loading} className="w-full">
            {mode === 'signup' ? t('auth.submitSignUp') : t('auth.submitSignIn')}
          </Button>
        </form>
      </div>
    </div>
  )
}
