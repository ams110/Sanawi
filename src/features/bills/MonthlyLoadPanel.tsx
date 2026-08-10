import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { summarizeMonthlyLoad } from '@/lib/commitments/calc'
import type { CommitmentDetail } from '@/lib/db/types'

/**
 * الحمل الشهري مفصولاً: ما يتكرّر بلا نهاية، وما ينتهي، وما تدفعه لنفسك.
 *
 * الفصل هو الرسالة. مديونٌ يرى 1,820 شيكلاً شهرياً يرى عبئاً دائماً؛ ويرى
 * "420 دائم و1,400 ينتهي، وأقربه بعد ثلاثة شهور" فيرى نفقاً له آخر.
 *
 * والرقم الكبير يشمل أقساط الصناديق: «قديش بتكلّف التزاماتي الشهرية؟» سؤالٌ
 * واحد، وكانت الفواتير وحدها تجيبه هنا وأقساط الصناديق تسكن لوحة الشهر —
 * فيقرأ المستخدم رقماً ناقصاً ثلث الحقيقة ويظن نفسه مرتاحاً.
 */
export function MonthlyLoadPanel({
  details,
  fundMonthly = 0,
}: {
  details: CommitmentDetail[]
  /** مجموع أقساط صناديق الالتزامات السنوية هذا الشهر. */
  fundMonthly?: number
}) {
  const { t } = useTranslation()

  const load = summarizeMonthlyLoad(
    details.map((d) => ({
      amount: Number(d.amount),
      startsOn: d.starts_on,
      endsOn: d.ends_on,
      mySharePercent: Number(d.my_share_percent),
    })),
  )

  if (load.total + fundMonthly === 0) return null

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-text">{t('bills.loadTitle')}</h2>
        <span className="num text-2xl font-black text-text">
          {formatMoney(load.total + fundMonthly)}
        </span>
      </div>

      <div className={`grid gap-2 ${fundMonthly > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Cell label={t('bills.recurring')} amount={load.recurring} />
        <Cell label={t('bills.installments')} amount={load.installments} accent />
        {fundMonthly > 0 && <Cell label={t('bills.fundInstallments')} amount={fundMonthly} />}
      </div>

      {load.nextRelief && (
        <p className="rounded-2xl bg-success-soft px-4 py-3 text-sm font-bold text-success">
          {load.nextRelief.monthsAway <= 1
            ? t('bills.nextReliefSoon', { amount: formatMoney(load.nextRelief.amount) })
            : t('bills.nextRelief', {
                count: load.nextRelief.monthsAway,
                amount: formatMoney(load.nextRelief.amount),
              })}
        </p>
      )}
    </section>
  )
}

function Cell({ label, amount, accent }: { label: string; amount: number; accent?: boolean }) {
  return (
    <div className="space-y-0.5 rounded-2xl bg-surface-muted px-3 py-2.5">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`num text-lg font-bold ${accent ? 'text-warning' : 'text-text'}`}>
        {formatMoney(amount)}
      </p>
    </div>
  )
}
