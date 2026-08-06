import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { Button } from '@/components/ui/Button'
import { summarizeDeposits, type DepositsSummary } from '@/lib/obligations/deposits'
import {
  addDeposit,
  getObligation,
  listDeposits,
  track,
  type ObligationWithCalc,
} from '@/features/obligations/api'
import { useAmount } from './amount'

/**
 * بابُ الإيداع الوحيد.
 *
 * كان للإيداع ثلاثة أبواب، كلٌّ كتب حارسه بنفسه: بطاقة القائمة، وصفحة
 * التفاصيل، والورقة السريعة. فوصل الحارس إلى بابين وتُرك الثالث — **وهو
 * الأقصر**: زرٌّ يكتب القسط صامتاً بلا سؤالٍ ولا رقمٍ ولا خبرٍ ولا رجعة.
 *
 * والعلّة بنيويّة لا سهو: ما دام الحارس خاصيّةً في الشاشة، فكل شاشةٍ جديدة
 * تولد بلا حارس. فيصير الحارس هنا خاصيّةً في **الفعل**: من أراد أن يودع
 * استعمل هذا المكوّن، ومن استعمله جاءه الحارس معه. وشرط القبول تقنيّ لا نيّة:
 * لا يُنادى `addDeposit` من أيّ ملفٍ في `src/features` غير هذا.
 *
 * وثلاثة أشياء يفعلها ولا يفعلها زرٌّ:
 * ١. يقول ما وقع هذا الشهر **قبل** أن يتحرّك الإصبع.
 * ٢. يقبل رقماً — فمن أودع 300 بدل 500 له مكانٌ يكتبه فيه.
 * ٣. يردّ بالرصيد والقسط الجديد **من صفٍّ أُعيدت قراءته**، لا من حسبةٍ متوقَّعة.
 *    والإنسان الذي لا يرى أثر فعله يعيده — وهذا أصل الإيداع المكرّر، لا نقص
 *    الحارس.
 */

export interface DepositDone {
  amount: number
  balance: number
  installment: number
  obligationName: string
}

interface Props {
  item: ObligationWithCalc
  /** يُنادى بعد نجاح الإيداع ومعه ما صار — لتحدّث الشاشة نفسها. */
  onDone: (done: DepositDone) => void | Promise<void>
  /** اسم الشريك المودِع، أو `null` = أنا. */
  partnerId?: string | null
  /** يُعرض تحت الحقل — رسالةٌ خاصّة بالشاشة إن أرادت. */
  hint?: string
  autoFocus?: boolean
}

export function DepositField({ item, onDone, partnerId = null, hint, autoFocus }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const amount = useAmount(item.calc.monthlyInstallment)

  const [movements, setMovements] = useState<DepositsSummary | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const obligationId = item.obligation.id

  /*
   * الحركات تُقرأ عند فتح الحقل لا عند الإرسال.
   *
   * حارسٌ يُسأل بعد الكتابة يصل متأخراً — المستخدم يكون قد ضغط. وقراءتها هنا
   * تجعل «حطّيت هالشهر كذا» مكتوباً فوق الحقل قبل أن يبدأ.
   */
  const loadMovements = useCallback(async () => {
    try {
      const rows = await listDeposits(obligationId)
      setMovements(
        summarizeDeposits(
          rows.map((d) => ({
            id: d.id,
            amount: Number(d.amount),
            depositDate: d.deposit_date,
            createdAt: d.created_at,
            partnerId: d.partner_id,
            note: d.note,
          })),
        ),
      )
    } catch {
      // فشل قراءة الحركات يُسقط التحذير ولا يمنع الإيداع: منعُه يجعل عطلاً
      // في القراءة عطلاً في الكتابة.
      setMovements(null)
    }
  }, [obligationId])

  useEffect(() => {
    void loadMovements()
    setConfirming(false)
  }, [loadMovements])

  const submit = async () => {
    if (!user || !amount.isValid) return
    setBusy(true)
    setError(null)
    const value = amount.value

    try {
      await addDeposit(obligationId, user.id, value, partnerId)
      void track(user.id, 'deposit_added', {
        obligation_id: obligationId,
        by_partner: partnerId !== null,
        was_second_this_month: movements?.alreadyDepositedThisMonth ?? false,
      })

      // إعادة قراءة لا تركيبٌ من المُدخَل: الرد يحمل ما صار فعلاً لا ما ظننّا
      // أنه سيصير — نفس قاعدة أدوات الكتابة في خادم MCP.
      const after = await getObligation(obligationId)
      setConfirming(false)
      amount.reset()
      await onDone({
        amount: value,
        balance: Number(after?.balance?.my_fund_balance ?? 0),
        installment: after?.calc.monthlyInstallment ?? 0,
        obligationName: item.obligation.name,
      })
    } catch (err) {
      setError(failureText(err, t, t('obligations.depositFailed')))
    } finally {
      setBusy(false)
    }
  }

  const repeated = movements?.alreadyDepositedThisMonth ?? false

  return (
    <div className="space-y-2">
      <input
        {...amount.props}
        onChange={(event) => {
          amount.set(event.target.value)
          setConfirming(false)
        }}
        autoFocus={autoFocus}
        placeholder={String(item.calc.monthlyInstallment)}
        aria-label={t('detail.depositTitle')}
        className="num w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-lg font-bold text-text"
      />

      {hint && !repeated && <p className="text-[12px] text-text-muted">{hint}</p>}

      {/*
        * الإيداع الثاني في الشهر يُسأل عنه ولا يُمنع: من يدفع قسطه على دفعتين
        * له حقٌّ في ذلك، ومن ضغط مرّتين لا يقصد — والفرق بينهما سؤالٌ واحد.
        */}
      {repeated && movements && (
        <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-semibold text-text">
          {t('detail.depositedThisMonth', {
            amount: formatMoney(movements.thisMonthTotal),
            count: movements.thisMonthCount,
          })}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      {repeated && confirming ? (
        <div className="flex gap-2">
          <Button onClick={() => void submit()} loading={busy} className="flex-1">
            {t('detail.confirmSecond')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          onClick={() => (repeated ? setConfirming(true) : void submit())}
          disabled={!amount.isValid || busy}
          loading={busy}
          className="w-full"
        >
          {t('detail.depositAmount', { amount: formatMoney(amount.value) })}
        </Button>
      )}
    </div>
  )
}

/**
 * سطر النتيجة بعد الإيداع.
 *
 * مفصولٌ عن الحقل لأن كل شاشةٍ تعرضه في مكانٍ مختلف — الورقة تعرضه بدلاً من
 * نفسها، والبطاقة تعرضه تحتها — والنصّ واحدٌ في الحالتين.
 */
export function DepositResult({ done }: { done: DepositDone }) {
  const { t } = useTranslation()

  return (
    <p className="rounded-xl bg-brand-soft px-3 py-2.5 text-[13px] font-semibold text-brand">
      {t('quickAdd.doneBody', {
        balance: formatMoney(done.balance),
        installment: formatMoney(done.installment),
      })}
    </p>
  )
}
