import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { dailyAllowance, type MonthPanel as MonthPanelView, type MonthPanelInput } from '@/lib/budget/month'

/**
 * الرقم الواحد — من نداءٍ واحد.
 *
 * اللوحة تستقبل نتيجة `buildMonthPanel` التي بناها `MonthScreen` ولا تعيد
 * بناءها: كل بطاقةٍ على الشاشة تقرأ من نفس النتيجة، فيستحيل أن تقول بطاقتان
 * شيئين متناقضين — وهي العلّة التي وُلد منها تدقيق آب 2026 كلّه. (ش1، ش2)
 *
 * **والأساس صار الواصل** (خطة `docs/income-actual-plan.md`). والعالمان
 * مفصولان بصراً لا بالاسم وحده: كتلةُ الواقع (وصل / خرج / بإيدك) ثم كتلةُ
 * الخطة (لسه لازم يطلع)، والرقم الكبير بينهما هو الكفاية — وله عنوانٌ يقول
 * ما هو، لا «الباقي» مطلقاً.
 */
export function MonthPanel({ input, panel: p }: { input: MonthPanelInput; panel: MonthPanelView }) {
  const { t } = useTranslation()
  // «يومية الصرف» من نفس `coverage` المعروض فوقها — مصدرٌ واحد فلا تناقض.
  const allowance = dailyAllowance(p.coverage, input.daysElapsed, input.daysInMonth)

  return (
    <section className="space-y-4 rounded-3xl border border-border bg-surface p-5">
      <p className="text-sm font-semibold text-text-muted">{t('panel.title')}</p>

      <p className={`num text-5xl font-black ${p.isShort ? 'text-danger' : 'text-brand'}`}>
        {formatMoney(p.coverage)}
      </p>

      {/*
       * الأحمر يسمّي سببه (قاعدة 4).
       *
       * «لسه ما وصلك شي» تسبق كل شيء: من فتح التطبيق في الثالث من الشهر
       * وراتبه آخره كان يقرأ اتّهاماً لصرفه — وهو لم يصرف شيئاً يُذكر.
       */}
      {p.shortfallCause && (
        <div className="space-y-1 rounded-2xl bg-danger-soft px-4 py-3">
          <p className="text-sm font-bold text-danger">
            {t(`panel.short.${p.shortfallCause}`, { amount: formatMoney(Math.abs(p.coverage)) })}
          </p>
          <p className="text-[13px] text-text">{t(`panel.shortHint.${p.shortfallCause}`)}</p>
        </div>
      )}

      {/*
       * الإسقاط يمدّ الصرف وحده — الدخل لا يُسقَط، فلا يَعِد التطبيق بمالٍ
       * لا يعرف أنه آتٍ. ولا يُعرض حين يكون الحاضر ناقصاً أصلاً: تحذيرٌ عن
       * آخر الشهر فوق تحذيرٍ عن اليوم يُغرق الأهمّ في الأقلّ.
       */}
      {!p.isShort && (
        <p
          className={`rounded-2xl px-4 py-3 text-sm font-bold ${
            p.projectedIsShort ? 'bg-danger-soft text-danger' : 'bg-surface-muted text-text'
          }`}
        >
          {p.projectedIsShort
            ? t('panel.projectionBad', { amount: formatMoney(Math.abs(p.projectedCoverage)) })
            : t('panel.projection', { amount: formatMoney(p.projectedCoverage) })}
        </p>
      )}

      <p className="text-sm text-text-muted">
        {allowance > 0
          ? t('panel.allowance', { amount: formatMoney(allowance) })
          : t('panel.allowanceZero')}
      </p>

      {/*
       * ── عالم الواقع ──
       *
       * كلُّ مجموعٍ يليه تفصيلُه المزاح: من يقرأ «طلع من إيدك 3,500» يسأل
       * فوراً «على شو؟»، وجوابٌ في مكانٍ آخر من الشاشة جوابٌ لا يُقرأ.
       */}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-bold text-text-muted">{t('panel.realityTitle')}</p>
        <Row label={t('panel.received')} amount={p.received} tone="income" />
        <Row label={t('panel.paidOut')} amount={p.paidOut} tone="spent" strong />
        <div className="space-y-1 ps-4">
          <Row label={t('panel.depositsPaid')} amount={input.depositsPaid} muted />
          <Row label={t('panel.billsPaid')} amount={input.billsPaid} muted />
          <Row label={t('panel.expenses')} amount={p.spent} muted />
        </div>
        <Row label={t('panel.inHand')} amount={p.inHand} strong />
        {/* حدّ الصدق: هذا ليس رصيدك — بطاقة الحسابات تحته هي التي تقوله. */}
        <p className="text-xs text-text-muted">{t('panel.inHandHint')}</p>
      </div>

      {/* ── عالم الخطة ── */}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-bold text-text-muted">{t('panel.planTitle')}</p>
        <Row label={t('panel.stillDue')} amount={p.stillDue} strong />
        <div className="space-y-1 ps-4">
          <Row label={t('panel.pendingCommitments')} amount={input.pendingCommitments} muted />
          <Row label={t('panel.savings')} amount={input.savingsTarget} muted />
        </div>
      </div>
    </section>
  )
}

function Row({
  label,
  amount,
  tone,
  strong,
  muted,
}: {
  label: string
  amount: number
  tone?: 'income' | 'spent'
  /** مجموعٌ يقود كتلته — يظهر ولو كان صفراً. */
  strong?: boolean
  /** سطرُ تفصيلٍ تحت مجموعه. */
  muted?: boolean
}) {
  // الصفر يُخفى من التفصيل وحده: سطرُ تفصيلٍ بصفرٍ يشغل مساحةً ولا يحمل
  // خبراً، أمّا «وصلك 0» فهو الخبر كلّه — وإخفاؤه يجعل اللوحة تبدو ناقصةً
  // لا صادقة، ويترك القارئ يظنّ أن التطبيق لا يعرف بدل أن يعرف أنه صفر.
  if (amount === 0 && (muted || (tone !== 'income' && !strong))) return null

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`min-w-0 truncate ${muted ? 'text-xs' : 'text-sm'} text-text-muted`}>
        {label}
      </span>
      <span
        className={`num shrink-0 ${muted ? 'text-xs font-semibold' : 'text-sm'} ${
          strong ? 'font-black' : muted ? '' : 'font-bold'
        } ${tone === 'income' ? 'text-brand' : tone === 'spent' ? 'text-accent' : 'text-text'}`}
      >
        {formatMoney(amount)}
      </span>
    </div>
  )
}
