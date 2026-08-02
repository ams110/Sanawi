/**
 * تظهر حين لا يجد التطبيق مفاتيح Supabase.
 *
 * البديل شاشة بيضاء وخطأ في وحدة التحكم لا يفهمه أحد. هذه تقول ما الناقص
 * وأين يُجلب وأين يوضع — بالضبط.
 */
export function SetupScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-5 py-10">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-border bg-surface p-6">
        <div>
          <h1 className="text-2xl font-bold text-brand">سنوي</h1>
          <p className="mt-1 text-sm text-text-muted">التطبيق مش مربوط بقاعدة البيانات بعد.</p>
        </div>

        <ol className="space-y-4 text-[15px] leading-relaxed text-text">
          <li className="flex gap-3">
            <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
              1
            </span>
            <span>
              افتح مشروعك على Supabase → <strong>SQL Editor</strong>، والصق ملفات{' '}
              <code className="rounded bg-surface-muted px-1.5 py-0.5 text-[13px]">
                supabase/migrations
              </code>{' '}
              بالترتيب واضغط Run.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
              2
            </span>
            <span>
              من <strong>Settings → API</strong> انسخ <code className="text-[13px]">Project URL</code> و{' '}
              <code className="text-[13px]">anon key</code>.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
              3
            </span>
            <span>
              اعمل ملف <code className="text-[13px]">.env</code> بجذر المشروع وحط فيه:
            </span>
          </li>
        </ol>

        <pre
          dir="ltr"
          className="overflow-x-auto rounded-xl bg-surface-muted p-3 text-[12px] leading-relaxed text-text"
        >
          <code>{`VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...`}</code>
        </pre>

        <p className="text-sm text-text-muted">
          بعدها أعد تشغيل <code className="text-[13px]">npm run dev</code> — Vite بيقرأ ملف{' '}
          <code className="text-[13px]">.env</code> عند الإقلاع بس.
        </p>
      </div>
    </div>
  )
}
