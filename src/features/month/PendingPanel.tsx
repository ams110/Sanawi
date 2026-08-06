import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import type { PendingItem, PendingNote, PendingResult } from '@/lib/month/pending'
import { DepositField } from '@/features/record/DepositField'
import type { ObligationWithCalc } from '@/features/obligations/api'

/**
 * «ضلّ عليك» — الشاشة الأولى تبدأ الكلام.
 *
 * كان التطبيق يستقبل ولا يبادر: يفتحه صاحبه فيقرأ ثلاثة أرقامٍ كبيرة لا
 * يترتّب على أيٍّ منها فعل، والسؤال الذي فتحه لأجله — «شو لازم أعمل؟» — بلا
 * جواب في التطبيق كلّه. وهو يعرف الجواب سلفاً: القسط محسوبٌ ومعروض، والراتب
 * محفوظٌ برقمه، وأيُّ صندوقٍ لم يستلم قسطه محسوبٌ ومختبَر — ثم يُوضع أمامه
 * حقلٌ فارغ ويُطلب منه أن يكتب بإصبعه رقماً يعرفه التطبيق.
 *
 * فتقلب هذه اللوحة الاتجاه: التطبيق يبدأ برقمه، والمستخدم يردّ بضغطة.
 *
 * ولا تملك مسار كتابةٍ خاصاً بها: سطر الصندوق هو `DepositField` نفسه — بحارسه
 * وردّه وتراجعه. فلا تصير باباً رابعاً للإيداع بلا حارس، وهي العلّة نفسها التي
 * وُلدت منها.
 */

const KIND_ICON: Record<PendingItem['kind'], string> = {
  deposit: '🎯',
  bill: '🧾',
  income: '💰',
}

function NoteLine({ note }: { note: PendingNote }) {
  const { t } = useTranslation()

  const text =
    note.type === 'overdue'
      ? t('pending.noteOverdue')
      : note.type === 'installment'
        ? t('pending.noteInstallment')
        : note.type === 'variable'
          ? t('pending.noteVariable')
          : note.type === 'expected'
            ? t('pending.noteExpected')
            : note.type === 'partial'
              ? t('pending.notePartial', { done: note.done, total: note.total })
              : note.type === 'average'
                ? t('pending.noteAverage', { amount: formatMoney(note.amount) })
                : note.days < 0
                  ? t('pending.noteDuePassed', { days: Math.abs(note.days) })
                  : note.days === 0
                    ? t('pending.noteDueToday')
                    : t('pending.noteDueIn', { days: note.days })

  return <span className="text-[12px] text-text-muted">{text}</span>
}

interface Props {
  result: PendingResult
  /** الالتزامات كما حُمّلت — يحتاجها سطر الصندوق ليعطي `DepositField` حسابه. */
  obligations: readonly ObligationWithCalc[]
  onDone: () => void | Promise<void>
  /** يفتح الشاشة التي يُنفَّذ فيها ما ليس إيداعاً. */
  onGo: (kind: PendingItem['kind']) => void
}

export function PendingPanel({ result, obligations, onDone, onGo }: Props) {
  const { t } = useTranslation()
  const [openId, setOpenId] = useState<string | null>(null)

  /*
   * الحالة الخالية تُقال ولا تُترك فراغاً.
   *
   * من سجّل كل ما عليه يستحقّ أن يعرف أنه فرغ — وإلا بدت اللوحة معطّلة، وعاد
   * يفتح الشاشات واحدةً واحدة ليتأكّد. وهو نفسه ما كان يصنع الإيداع المكرّر.
   */
  if (result.isClear) {
    return (
      <section className="rounded-3xl border border-brand/30 bg-brand-soft p-5 text-center">
        <p className="text-3xl" aria-hidden="true">
          ✅
        </p>
        <p className="mt-2 text-[15px] font-bold text-brand">{t('pending.clear')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <h2 className="text-sm font-bold text-text">
        {t('pending.title', { count: result.items.length })}
      </h2>

      <ul className="space-y-2">
        {result.items.map((item) => {
          const obligation =
            item.kind === 'deposit'
              ? obligations.find((o) => o.obligation.id === item.id)
              : undefined
          const open = openId === item.id

          return (
            <li key={`${item.kind}-${item.id}`} className="rounded-2xl bg-surface-muted p-3">
              <div className="flex items-center gap-3">
                <span className="text-lg leading-none" aria-hidden="true">
                  {KIND_ICON[item.kind]}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text">{item.name}</p>
                  <NoteLine note={item.note} />
                </div>

                {item.amount !== null && (
                  <span className="num text-sm font-bold text-text">
                    {formatMoney(item.amount)}
                  </span>
                )}

                {/*
                  * الصندوق يُنفَّذ في مكانه، وما عداه يفتح شاشته.
                  *
                  * الفاتورة تُصحَّح من الورقة التي بيد صاحبها (المتوسّط تخمين)،
                  * والدخل قد يصل من مصدرٍ غير مسجَّل — فكلاهما يحتاج شاشته.
                  * والصندوق وحده رقمُه يقينيّ، فيُنفَّذ بضغطة بلا انتقال.
                  */}
                <button
                  type="button"
                  onClick={() =>
                    obligation ? setOpenId(open ? null : item.id) : onGo(item.kind)
                  }
                  aria-label={t('pending.record', { name: item.name })}
                  className="shrink-0 rounded-xl bg-brand-soft px-3 py-2 text-xs font-bold text-brand"
                >
                  {obligation ? (open ? t('common.cancel') : t('pending.do')) : t('pending.open')}
                </button>
              </div>

              {open && obligation && (
                <div className="mt-3 border-t border-border pt-3">
                  <DepositField
                    item={obligation}
                    autoFocus
                    onDone={async () => {
                      setOpenId(null)
                      await onDone()
                    }}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* ما زاد على الحدّ يُقال عدده ولا يُخفى بصمت. */}
      {result.hiddenCount > 0 && (
        <p className="text-center text-[12px] text-text-muted">
          {t('pending.more', { count: result.hiddenCount })}
        </p>
      )}
    </section>
  )
}
