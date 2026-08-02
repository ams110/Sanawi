import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'

/** رسائل Supabase إنجليزية وتقنية — نترجم ما يقع فعلاً منها. */
function humanError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login')) return 'الإيميل أو كلمة السر غلط'
  if (m.includes('already registered')) return 'هالإيميل مسجّل من قبل — سجّل دخول بدل ما تفتح حساب'
  if (m.includes('password') && m.includes('6')) return 'كلمة السر لازم 6 حروف على الأقل'
  if (m.includes('email') && m.includes('invalid')) return 'الإيميل مش مكتوب صح'
  if (m.includes('rate limit')) return 'جرّبت كتير بسرعة — استنى دقيقة وجرّب كمان مرة'
  return message
}

export function AuthScreen() {
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
          setNotice('بعتنالك إيميل تأكيد. افتحه وبعدها سجّل دخول.')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-brand">سنوي</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-text-muted">
            الالتزامات السنوية الكبيرة، مقسّمة على شهور — فما بتفاجئك.
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
              تسجيل دخول
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                mode === 'signup' ? 'bg-surface text-brand shadow-sm' : 'text-text-muted'
              }`}
            >
              حساب جديد
            </button>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-text">الإيميل</span>
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
            <span className="text-sm font-semibold text-text">كلمة السر</span>
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
            {mode === 'signup' ? 'افتح حساب' : 'ادخل'}
          </Button>
        </form>
      </div>
    </div>
  )
}
