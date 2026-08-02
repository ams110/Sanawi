import { useMemo, useState, type ReactNode } from 'react'
import { calculateObligation } from '@/lib/obligations/calc'
import { formatMoney, formatMonthYear, formatMonthsRemaining } from '@/lib/format'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { BridgeNotice } from '@/components/ui/BridgeNotice'
import { useTheme, type ThemePreference } from '@/lib/theme'

/**
 * شاشة معاينة مؤقتة للمرحلة 1.
 * غرضها الوحيد أن يرى المستخدم محرّك الحسابات وهو يعمل قبل ربط قاعدة البيانات،
 * وستُستبدل بشاشة «إضافة التزام» الحقيقية حالما تجهز جداول Supabase.
 */

const STATUS_TEXT = {
  on_track: { label: 'ملحّق', className: 'bg-brand-soft text-brand' },
  slightly_behind: { label: 'متأخر شوي', className: 'bg-accent-soft text-accent' },
  behind: { label: 'متأخر', className: 'bg-danger-soft text-danger' },
} as const

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'النظام' },
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'غامق' },
]

function addMonths(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export default function App() {
  const [name, setName] = useState('تأمين السيارة')
  const [totalAmount, setTotalAmount] = useState(6000)
  const [monthsAhead, setMonthsAhead] = useState(3)
  const [recurrenceMonths, setRecurrenceMonths] = useState(12)
  const [fundBalance, setFundBalance] = useState(0)
  const [sharePercent, setSharePercent] = useState(100)

  const nextDueDate = useMemo(() => addMonths(monthsAhead), [monthsAhead])

  const calc = useMemo(
    () =>
      calculateObligation({
        totalAmount,
        mySharePercent: sharePercent,
        myFundBalance: fundBalance,
        nextDueDate,
        recurrenceMonths,
        cycleStartDate: new Date().toISOString().slice(0, 10),
      }),
    [totalAmount, sharePercent, fundBalance, nextDueDate, recurrenceMonths],
  )

  const status = STATUS_TEXT[calc.status]

  return (
    <div className="min-h-dvh bg-bg pb-16">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-5 py-3">
          <div>
            <h1 className="text-lg font-bold text-text">سنوي</h1>
            <p className="text-xs text-text-muted">معاينة محرّك الحسابات — المرحلة 1</p>
          </div>
          <ThemeSwitch />
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-5 px-5 py-6">
        {/* الرقم الرئيسي: يُقرأ في نصف ثانية */}
        <section className="rounded-3xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-text-muted">قسطك الشهري لهاد الالتزام</p>
          <p className="num mt-2 text-6xl font-bold leading-none text-brand">
            {formatMoney(calc.monthlyInstallment)}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className={`rounded-full px-3 py-1 font-semibold ${status.className}`}>
              {status.label}
            </span>
            <span className="text-text-muted">
              {formatMonthsRemaining(calc.monthsRemaining, calc.isOverdue)} ·{' '}
              {formatMonthYear(nextDueDate)}
            </span>
          </div>
        </section>

        {calc.isBridge && (
          <BridgeNotice
            bridgeInstallment={calc.monthlyInstallment}
            normalInstallment={calc.normalInstallment}
            monthsRemaining={calc.monthsRemaining}
            recurrenceMonths={recurrenceMonths}
          />
        )}

        {/* كارت الالتزام كما سيظهر في شاشة الالتزامات */}
        <section className="rounded-3xl border border-border bg-surface p-4">
          <div className="flex items-center gap-4">
            <ProgressRing progress={calc.progress} status={calc.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-text">{name || 'بدون اسم'}</p>
              {/* لا نضع .num على سطر مختلط: اتجاه LTR يقلب موضع الكلمة العربية بينهما. */}
              <p className="text-sm text-text-muted">
                <span className="num">{formatMoney(fundBalance)}</span>
                {' من '}
                <span className="num">{formatMoney(calc.myTotal)}</span>
              </p>
            </div>
            <div className="text-end">
              <p className="num text-lg font-bold text-text">
                {formatMoney(calc.monthlyInstallment)}
              </p>
              <p className="text-xs text-text-muted">بالشهر</p>
            </div>
          </div>
          {sharePercent < 100 && (
            <p className="mt-3 rounded-xl bg-surface-muted px-3 py-2 text-[13px] text-text-muted">
              مشترك: حصتك <span className="num">{sharePercent}%</span> من{' '}
              <span className="num">{formatMoney(totalAmount)}</span>
            </p>
          )}
        </section>

        {/* المدخلات — معاينة حية: كل تغيير ينعكس فوراً فوق */}
        <section className="space-y-4 rounded-3xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold text-text-muted">جرّب الأرقام</h2>

          <Field label="اسم الالتزام">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand"
            />
          </Field>

          <Field label="المبلغ الكامل" hint={formatMoney(totalAmount)}>
            <input
              type="number"
              inputMode="numeric"
              value={totalAmount}
              onChange={(e) => setTotalAmount(Math.max(0, Number(e.target.value) || 0))}
              className="num w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] text-text outline-none focus:border-brand"
            />
          </Field>

          <Slider
            label="الموعد الجاي"
            hint={`${monthsAhead} شهر`}
            min={1}
            max={24}
            value={monthsAhead}
            onChange={setMonthsAhead}
          />

          <Field label="الدورية">
            <div className="flex gap-2">
              {[12, 6, 3, 0].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRecurrenceMonths(m)}
                  className={`flex-1 rounded-xl border px-2 py-2 text-sm font-semibold transition ${
                    recurrenceMonths === m
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-border bg-bg text-text-muted'
                  }`}
                >
                  {m === 0 ? 'مرة وحدة' : `${m} شهور`}
                </button>
              ))}
            </div>
          </Field>

          <Slider
            label="اللي جمعته لهلأ"
            hint={formatMoney(fundBalance)}
            min={0}
            max={Math.max(1, totalAmount)}
            step={50}
            value={fundBalance}
            onChange={setFundBalance}
          />

          <Slider
            label="حصتك من الالتزام"
            hint={`${sharePercent}%`}
            min={10}
            max={100}
            step={5}
            value={sharePercent}
            onChange={setSharePercent}
          />
        </section>
      </main>
    </div>
  )
}

function ThemeSwitch() {
  const { preference, setPreference } = useTheme()
  return (
    <div className="flex rounded-xl border border-border bg-surface p-0.5">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setPreference(opt.value)}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
            preference === opt.value ? 'bg-brand-soft text-brand' : 'text-text-muted'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-text">{label}</span>
        {hint && <span className="num text-sm text-text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Slider({
  label,
  hint,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string
  hint: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (next: number) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-brand)]"
      />
    </Field>
  )
}
