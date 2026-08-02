import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatDate, formatMoney, formatMonthsRemaining } from '@/lib/format'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { BridgeNotice } from '@/components/ui/BridgeNotice'
import { Button } from '@/components/ui/Button'
import { PartnerSettlements } from '@/features/partners/PartnerSettlements'
import { listSettlements } from '@/features/partners/api'
import type { PartnerSettlement } from '@/lib/db/types'
import { addDeposit, archiveObligation, getObligation, track, type ObligationWithCalc } from './api'

export function ObligationDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [item, setItem] = useState<ObligationWithCalc | null>(null)
  const [settlements, setSettlements] = useState<PartnerSettlement[]>([])
  const [payerId, setPayerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [found, shares] = await Promise.all([
        getObligation(id),
        // فشل التسوية لا يمنع عرض الالتزام نفسه.
        listSettlements(id).catch(() => [] as PartnerSettlement[]),
      ])
      setItem(found)
      setSettlements(shares)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ما قدرنا نجيب الالتزام')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const deposit = async () => {
    if (!user || !item) return
    setBusy(true)
    try {
      await addDeposit(item.obligation.id, user.id, item.calc.monthlyInstallment, payerId)
      void track(user.id, 'deposit_added', {
        obligation_id: item.obligation.id,
        by_partner: payerId !== null,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ما قدرنا نسجّل الإيداع')
    } finally {
      setBusy(false)
    }
  }

  const archive = async () => {
    if (!item) return
    setBusy(true)
    try {
      await archiveObligation(item.obligation.id)
      navigate('/obligations', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ما قدرنا نأرشفه')
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="px-5 py-6"><div className="h-40 animate-pulse rounded-3xl bg-surface-muted" /></div>
  }

  if (!item) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-text-muted">ما لقينا هالالتزام.</p>
        <Link to="/obligations" className="mt-3 inline-block font-bold text-brand">
          ارجع للالتزامات
        </Link>
      </div>
    )
  }

  const { obligation, calc } = item
  const myBalance = Number(item.balance?.my_fund_balance ?? 0)
  const fundBalance = Number(item.balance?.fund_balance ?? 0)

  return (
    <div className="space-y-5 px-5 py-6">
      <section className="rounded-3xl border border-border bg-surface p-6">
        <div className="flex items-center gap-4">
          <ProgressRing progress={calc.progress} status={calc.status} size={72} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-text">{obligation.name}</h1>
            <p className="text-sm text-text-muted">
              {formatMonthsRemaining(calc.monthsRemaining, calc.isOverdue)} ·{' '}
              {formatDate(obligation.next_due_date)}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3">
          <Stat label="قسطك الشهري" value={formatMoney(calc.monthlyInstallment)} accent />
          <Stat label="جمعت لهلأ" value={formatMoney(myBalance)} />
          <Stat label="حصتك من المبلغ" value={formatMoney(calc.myTotal)} />
          <Stat label="باقي عليك" value={formatMoney(calc.remainingAmount)} />
        </dl>

        {Number(obligation.my_share_percent) < 100 && (
          <p className="mt-3 rounded-xl bg-surface-muted px-3 py-2.5 text-[13px] text-text-muted">
            مشترك: حصتك <span className="num">{obligation.my_share_percent}%</span> من{' '}
            <span className="num">{formatMoney(Number(obligation.total_amount))}</span>. مجموع
            الصندوق من الكل <span className="num">{formatMoney(fundBalance)}</span>.
          </p>
        )}
      </section>

      {calc.isBridge && (
        <BridgeNotice
          bridgeInstallment={calc.monthlyInstallment}
          normalInstallment={calc.normalInstallment}
          monthsRemaining={calc.monthsRemaining}
          recurrenceMonths={obligation.recurrence_months}
        />
      )}

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {settlements.length > 0 && (
        <PartnerSettlements
          settlements={settlements}
          mine={{ owed: calc.myTotal, deposited: myBalance }}
        />
      )}

      <div className="space-y-3">
        {settlements.length > 0 && calc.monthlyInstallment > 0 && (
          <div className="space-y-1.5">
            <span className="text-sm font-semibold text-text">مين بيودع؟</span>
            <div className="flex flex-wrap gap-2">
              <PayerChip label="أنا" active={payerId === null} onClick={() => setPayerId(null)} />
              {settlements.map((s) => (
                <PayerChip
                  key={s.partner_id}
                  label={s.partner_name}
                  active={payerId === s.partner_id}
                  onClick={() => setPayerId(s.partner_id)}
                />
              ))}
            </div>
          </div>
        )}

        {calc.monthlyInstallment > 0 && (
          <Button onClick={deposit} loading={busy} className="w-full">
            أودعت {formatMoney(calc.monthlyInstallment)} ✓
          </Button>
        )}
        <div className="flex gap-3">
          <Link to={`/obligations/${obligation.id}/edit`} className="flex-1">
            <Button variant="secondary" className="w-full">
              عدّل
            </Button>
          </Link>
          <Button variant="danger" onClick={archive} disabled={busy}>
            أرشفه
          </Button>
        </div>
      </div>
    </div>
  )
}

function PayerChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
        active ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-surface text-text-muted'
      }`}
    >
      {label}
    </button>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface-muted px-3 py-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`num text-lg font-bold ${accent ? 'text-brand' : 'text-text'}`}>{value}</dd>
    </div>
  )
}
