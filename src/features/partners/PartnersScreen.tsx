import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { viewCommitment, shareAmount } from '@/lib/commitments/calc'
import {
  summarizePartners,
  totalOutstanding,
  type PartnerSummary,
} from '@/lib/partners/summary'
import { listAllSettlements, listObligationNames, listPartners } from './api'
import { listCommitmentShares } from '@/features/bills/commitments'
import { listFixedCommitments } from '@/features/money/api'

/**
 * مركز الشركاء — «قديش باقي عند سامر من كل شي؟» بنظرةٍ واحدة.
 *
 * الجواب كان مبعثراً: تسوية الالتزام في صفحة تفاصيله، وحصّة الفاتورة خلف
 * زرٍّ مطويّ في بطاقتها. من له شريكٌ في ثلاثة أشياء كان يفتح ثلاث صفحات
 * ويجمع بالآلة الحاسبة — وهذه الشاشة هي الآلة الحاسبة التي رُميت.
 */
export function PartnersScreen() {
  const { t } = useTranslation()
  const {
    data: summaries = [],
    isPending: loading,
    error: loadError,
  } = useQuery({
    queryKey: ['partners-center'],
    queryFn: async (): Promise<PartnerSummary[]> => {
      const [partners, settlements, obligationNames, commitments, shares] = await Promise.all([
        listPartners(),
        listAllSettlements(),
        listObligationNames(),
        listFixedCommitments(),
        listCommitmentShares(),
      ])

      const nameById = new Map(obligationNames.map((o) => [o.id, o.name]))
      const commitmentById = new Map(commitments.map((c) => [c.id, c]))
      const today = new Date()

      return summarizePartners(
        partners.map((p) => ({ id: p.id, name: p.name })),
        settlements.map((s) => ({
          partnerId: s.partner_id,
          obligationId: s.obligation_id,
          obligationName: nameById.get(s.obligation_id) ?? null,
          owed: Number(s.owed),
          deposited: Number(s.deposited),
        })),
        shares.flatMap((share) => {
          const commitment = commitmentById.get(share.commitment_id)
          if (!commitment) return []
          // البند الذي لم تبدأ دفعاته أو انتهت لا يحمل أحدٌ منه شيئاً هذا الشهر.
          const view = viewCommitment(
            {
              amount: Number(commitment.amount),
              startsOn: commitment.starts_on,
              endsOn: commitment.ends_on,
              mySharePercent: Number(commitment.my_share_percent ?? 100),
            },
            today,
          )
          if (!view.hasStarted || view.isFinished) return []
          return [
            {
              partnerId: share.partner_id,
              commitmentId: share.commitment_id,
              commitmentName: commitment.name,
              // من القاعدة الواحدة — لا صيغة قسمة مضمّنة. (س15)
              monthlyAmount: shareAmount(Number(commitment.amount), Number(share.share_percent)),
            },
          ]
        }),
      )
    },
  })
  const error = loadError ? failureText(loadError, t, t('partners.loadFailed')) : null

  const total = useMemo(() => totalOutstanding(summaries), [summaries])

  if (loading) {
    return (
      <div className="space-y-3 px-5 py-6">
        {[0, 1].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-3xl bg-surface-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      <div>
        <h1 className="text-xl font-bold text-text">{t('partners.screenTitle')}</h1>
        <p className="text-sm text-text-muted">{t('partners.screenSubtitle')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {summaries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
          <p className="text-4xl" aria-hidden="true">👥</p>
          <p className="mt-3 text-[15px] leading-relaxed text-text-muted">{t('partners.empty')}</p>
        </div>
      ) : (
        <>
          {/* رقم الرأس: سبب فتح الشاشة. والصفر الكامل يُقال لا يُترك فراغاً. */}
          <section className="flex items-baseline justify-between rounded-3xl border border-border bg-surface px-5 py-4">
            <span className="text-sm text-text-muted">
              {total > 0 ? t('partners.totalOutstanding') : t('partners.allSettled')}
            </span>
            {total > 0 && (
              <span className="num text-2xl font-bold text-accent">{formatMoney(total)}</span>
            )}
          </section>

          <ul className="space-y-3">
            {summaries.map((partner) => (
              <PartnerCard key={partner.id} partner={partner} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function PartnerCard({ partner }: { partner: PartnerSummary }) {
  const { t } = useTranslation()
  const progress =
    partner.owedTotal > 0 ? Math.min(1, partner.depositedTotal / partner.owedTotal) : 1

  return (
    <li className="space-y-3 rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-bold text-text">{partner.name}</span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            partner.outstanding > 0
              ? 'bg-accent-soft text-accent'
              : partner.isSettled
                ? 'bg-brand-soft text-brand'
                : 'bg-surface-muted text-text-muted'
          }`}
        >
          {partner.outstanding > 0
            ? t('partners.outstanding', { amount: formatMoney(partner.outstanding) })
            : partner.isSettled
              ? t('partners.settled')
              : t('partners.noShares')}
        </span>
      </div>

      {partner.owedTotal > 0 && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full ${partner.outstanding > 0 ? 'bg-accent' : 'bg-brand'}`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="text-xs text-text-muted">
            <span className="num">{formatMoney(partner.depositedTotal)}</span> {t('common.of')}{' '}
            <span className="num">{formatMoney(partner.owedTotal)}</span>
          </p>
        </>
      )}

      {partner.obligations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-text-muted">{t('partners.inObligations')}</p>
          <ul className="space-y-1">
            {partner.obligations.map((o) => (
              <li key={o.obligationId} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate text-text">
                  {o.name ?? t('partners.unknownObligation')}
                </span>
                <span className={`num shrink-0 font-semibold ${o.outstanding > 0 ? 'text-accent' : 'text-brand'}`}>
                  {o.outstanding > 0
                    ? t('partners.outstanding', { amount: formatMoney(o.outstanding) })
                    : t('partners.settled')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {partner.commitments.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-text-muted">{t('partners.inBills')}</p>
          <ul className="space-y-1">
            {partner.commitments.map((c) => (
              <li key={c.commitmentId} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate text-text">{c.name}</span>
                <span className="num shrink-0 font-semibold text-text-muted">
                  {t('partners.monthlyCarry', { amount: formatMoney(c.monthlyAmount) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}
