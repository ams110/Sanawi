import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/format'
import { failureText } from '@/lib/i18n/failure'
import { buildMonthPanel } from '@/lib/budget/month'
import { listMonthDeposits, listObligations } from '@/features/obligations/api'
import { listBills } from '@/features/bills/api'
import { pendingThisMonth } from '@/lib/month/pending'
import { viewCommitment as viewBillCommitment } from '@/lib/commitments/calc'
import { PendingPanel } from './PendingPanel'
import { listIncomes } from '@/features/money/api'
import { listIncomeEntries, sumIncomeEntries } from '@/features/money/income'
import { listCommitmentDetails } from '@/features/bills/commitments'
import { listExpenses, monthKey, toCalcRows } from '@/features/expenses/api'
import { listAccounts } from '@/features/accounts/api'
import { envelopesByAccount, runwayDays, summarizeAccounts } from '@/lib/accounts/calc'
import { summarizeExpenses } from '@/lib/expenses/calc'
import { summarizeMonthlyLoad } from '@/lib/commitments/calc'
import { monthlyIncomeFrom } from '@/lib/budget/calc'
import type { MonthPanelInput } from '@/lib/budget/month'
import { MonthPanel } from './MonthPanel'
import { FundsPanel, type FundRowView, type FundsAccountView } from './FundsPanel'
import { useProfile } from '@/features/profile/ProfileProvider'
import { Button } from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'

/**
 * لوحة الشهر — الشاشة التي تجيب على سؤال واحد:
 * كم يجب أن يخرج من حسابي هذا الشهر، وكم يبقى لي.
 *
 * الاستعلام يجلب الخام وحده، والاشتقاق كلّه في `useMemo` تحته: هدف
 * الادخار من الملف الشخصي يدخل الحسبة بلا إعادة جلبٍ حين يتغيّر.
 */
export function MonthScreen() {
  const { t } = useTranslation()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const client = useQueryClient()

  const {
    data: raw,
    isPending: loading,
    error: loadError,
  } = useQuery({
    queryKey: ['month', monthKey()],
    queryFn: async () => {
      const month = monthKey()
      const [obligations, incomes, details, expenses, entries, deposits, bills, accounts] =
        await Promise.all([
          listObligations(),
          listIncomes(),
          listCommitmentDetails(),
          listExpenses(month),
          listIncomeEntries(month),
          listMonthDeposits(month),
          listBills(month),
          // المؤرشفة أيضاً: صندوقٌ مربوط بحسابٍ أُرشف يبقى اسمُ حسابه
          // مقروءاً، وإخفاؤه يجعله يبدو «بلا حساب» وهو مربوط — نفس القاعدة
          // الموثَّقة في mcp/data.ts.
          listAccounts(true),
        ])
      return { month, obligations, incomes, details, expenses, entries, deposits, bills, accounts }
    },
  })
  const error = loadError ? failureText(loadError, t, t('money.loadFailed')) : null

  // كل فعلٍ من «ضلّ عليك» يغيّر شاشاتٍ أخرى معه — الإبطال عامٌّ.
  const reload = async () => {
    await client.invalidateQueries()
  }

  const savingsTarget = Number(profile?.monthly_savings_target ?? 0)
  const derived = useMemo(() => {
    if (!raw) return null
    const { month, obligations, incomes, details, expenses, entries, deposits, bills, accounts } = raw

    /*
     * «ضلّ عليك» — الشاشة تبدأ الكلام.
     *
     * المحرّك في src/lib/month/pending.ts، والشاشة تعطيه ما جلبته ولا تحسب
     * سطراً واحداً بنفسها: هو نفسه الذي سيقوله كلود، فيتّفق الاثنان بنيةً
     * لا انضباطاً.
     */
    const depositsByObligation = new Map<string, typeof deposits>()
    for (const d of deposits) {
      const list = depositsByObligation.get(d.obligation_id) ?? []
      list.push(d)
      depositsByObligation.set(d.obligation_id, list)
    }

    // بالمبلغ وبالعدد معاً: الاكتمال يُقاس بالمبلغ (قيدٌ بنصف الراتب نصفُ
    // اكتمال)، والمتغيّر الذي لا مبلغ له يبقى على العدّ.
    const receivedAmountBySource = new Map<string, number>()
    const receivedCountBySource = new Map<string, number>()
    for (const entry of entries) {
      if (!entry.source_id) continue
      receivedAmountBySource.set(
        entry.source_id,
        (receivedAmountBySource.get(entry.source_id) ?? 0) + Number(entry.amount),
      )
      receivedCountBySource.set(
        entry.source_id,
        (receivedCountBySource.get(entry.source_id) ?? 0) + 1,
      )
    }

    const pending = pendingThisMonth({
      obligations: obligations.map((o) => ({
        id: o.obligation.id,
        name: o.obligation.name,
        monthlyInstallment: o.calc.monthlyInstallment,
        isOverdue: o.calc.isOverdue,
        deposits: (depositsByObligation.get(o.obligation.id) ?? []).map((d) => ({
          id: d.id,
          amount: Number(d.amount),
          depositDate: d.deposit_date,
          createdAt: d.created_at,
          partnerId: d.partner_id,
          note: d.note,
        })),
      })),
      incomes: incomes.map((i) => ({
        id: i.id,
        name: i.name,
        amount: Number(i.amount),
        frequency: i.frequency,
        isVariable: Boolean(i.is_variable),
        receivedAmount: receivedAmountBySource.get(i.id) ?? 0,
        receivedCount: receivedCountBySource.get(i.id) ?? 0,
      })),
      bills: bills.map((row) => {
        const view = viewBillCommitment({
          amount: Number(row.commitment.amount),
          startsOn: row.commitment.starts_on,
          endsOn: row.commitment.ends_on,
          mySharePercent: Number(row.commitment.my_share_percent ?? 100),
        })
        return {
          id: row.commitment.id,
          name: row.commitment.name,
          // حصّتي لا المبلغ الكامل: من ينصّف الإنترنت لا يدفع كلّه.
          amount: view.myAmount,
          average: Number(row.average?.average_amount ?? 0),
          isDueThisMonth: view.hasStarted && !view.isFinished,
          isRecorded: row.payment !== null,
          dayOfMonth: row.commitment.day_of_month,
        }
      }),
    })

    const obligationsTotal = obligations.reduce((s, o) => s + o.calc.monthlyInstallment, 0)

    /*
     * الحمل الشهري يأتي من commitment_details لا من fixed_commitments:
     * الأول يحمل حصّتي بالشيكل ويعرف أيّ بندٍ انتهى قسطه، والثاني يعطي
     * المبلغ الكامل لكل بندٍ حيّاً كان أو ميتاً.
     */
    const monthlyLoad = summarizeMonthlyLoad(
      details.map((d) => ({
        amount: Number(d.amount),
        startsOn: d.starts_on,
        endsOn: d.ends_on,
        mySharePercent: Number(d.my_share_percent),
      })),
    )
    const spending = summarizeExpenses(toCalcRows(expenses), new Date(`${month}T00:00:00`))

    const panelInput: MonthPanelInput = {
      expectedIncome: monthlyIncomeFrom(
        incomes.map((i) => ({
          amount: Number(i.amount),
          frequency: i.frequency,
          isVariable: Boolean(i.is_variable),
        })),
      ),
      receivedIncome: sumIncomeEntries(entries),
      obligationInstallments: Math.round(obligationsTotal * 100) / 100,
      recurringBills: monthlyLoad.recurring,
      installments: monthlyLoad.installments,
      dailyExpenses: spending.total,
      savingsTarget,
      daysElapsed: spending.daysElapsed,
      daysInMonth: spending.daysInMonth,
    }
    /*
     * نداءٌ واحد للمحرّك، وكلُّ رقمٍ على الشاشة منه (قاعدة CLAUDE.md
     * الثامنة): بطاقة «لازم يطلع» واللوحة و«يومية الصرف» كلها من `panel`
     * هذا — فيستحيل أن تتناقض بطاقتان كما كان. (تدقيق آب 2026: ش1، ش5)
     */
    const panel = buildMonthPanel(panelInput)

    /*
     * الصناديق بعلامة بنكها — التجميع من `envelopesByAccount` النقي، على ما
     * جلبته هذه الشاشة أصلاً: الالتزامات محمَّلة فلا تُجلب ثانيةً لأجل
     * المظاريف. والصندوق غير المربوط يبقى بعلامة خطر لا يُخفى.
     */
    const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
    const fundRows = obligations
      .map((item) => ({
        obligationId: item.obligation.id,
        name: item.obligation.name,
        balance: Number(item.balance?.my_fund_balance ?? 0),
        accountId: item.obligation.account_id,
      }))
      .filter((row) => row.balance !== 0)

    // الأكبر أولاً — كما ترتّب المظاريف نفسها في محرّك الحسابات.
    const funds: FundRowView[] = fundRows
      .map((row) => ({
        obligationId: row.obligationId,
        name: row.name,
        balance: row.balance,
        accountName: row.accountId ? (accountNames.get(row.accountId) ?? null) : null,
      }))
      .sort((a, b) => b.balance - a.balance)

    const byAccount = envelopesByAccount(fundRows)

    // «غير المخصّص» للحسابات الحيّة وحدها — المؤرشف خارج اللوحات كلها.
    const accountsSummary = summarizeAccounts(
      accounts
        .filter((account) => !account.archived_at)
        .map((account) => ({
          id: account.id,
          name: account.name,
          kind: account.kind,
          balance: Number(account.balance),
          balanceUpdatedAt: account.balance_updated_at,
          envelopes: byAccount.get(account.id) ?? [],
        })),
    )
    const fundsAccounts: FundsAccountView[] = accountsSummary.accounts.map((account) => ({
      name: account.name,
      available: account.available,
      shortfall: account.shortfall,
    }))

    // العدّ التنازلي: المتاح كله ÷ وتيرة الصرف اليومية حتى الآن.
    const runway = runwayDays(
      accountsSummary.availableTotal,
      spending.total / Math.max(1, spending.daysElapsed),
    )

    return {
      pending,
      panelInput,
      panel,
      // قيودٌ حرّة بلا مصادر دخلٌ أيضاً: من وصله مال لا تُخفى عنه اللوحة. (ش18)
      hasIncome: incomes.length > 0 || entries.length > 0,
      funds,
      fundsAccounts,
      runway,
    }
  }, [raw, savingsTarget])

  const panelInput = derived?.panelInput ?? null
  const panel = derived?.panel ?? null
  const pending = derived?.pending ?? null
  const obligationRows = raw?.obligations ?? []
  const hasIncome = derived?.hasIncome ?? true

  if (loading) {
    return (
      <div className="space-y-4 px-5 py-6">
        <div className="h-44 animate-pulse rounded-3xl bg-surface-muted" />
        <div className="h-52 animate-pulse rounded-3xl bg-surface-muted" />
      </div>
    )
  }

  if (error || !panel) {
    return (
      <p role="alert" className="m-5 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {error}
      </p>
    )
  }

  return (
    <div className="space-y-5 px-5 py-6">
      {/* الترويسة الموحّدة: عنوانٌ وسطرُ شرح، كما في كل تبويب. */}
      <div>
        <h1 className="text-xl font-bold text-text">{t('month.screenTitle')}</h1>
        <p className="text-sm text-text-muted">{t('month.screenSubtitle')}</p>
      </div>

      {/*
       * الرقم الذي يُقرأ في نصف ثانية — من نفس المحرّك الذي يغذّي اللوحة،
       * وبحصّتي من الفواتير لا بمبلغها الكامل. كانت هذه البطاقة من محرّكٍ
       * ثانٍ (`summarizeMonth`) يحسب الفواتير كاملةً، فتقول 3,179 واللوحة
       * تحتها 2,850 لنفس البنود. (ش5)
       */}
      <section className="rounded-3xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-text-muted">{t('month.title')}</p>
        <p className="num mt-2 text-6xl font-bold leading-none text-brand">
          {formatMoney(panel.committed)}
        </p>
      </section>

      {/*
       * «ضلّ عليك» تسبق الأرقام كلها.
       *
       * من يفتح التطبيق يسأل «شو لازم أعمل»، لا «كم مجموع التزاماتي». والرقم
       * الكبير فوقها يبقى لأنه جواب السؤال الثاني — لكنه لم يعد وحده في
       * الصدارة.
       */}
      {pending && (
        <PendingPanel
          result={pending}
          obligations={obligationRows}
          onDone={reload}
          onGo={(kind) => navigate(kind === 'bill' ? '/bills' : '/money')}
        />
      )}

      {/*
       * اللوحة الموحّدة — الجواب الوحيد على «كم بيدي».
       *
       * بطاقة «بيضل معك للصرف» التي كانت هنا تحتها حُذفت: كانت من محرّكٍ
       * ثانٍ بفرضياتٍ أخرى (دخل متوقَّع × فواتير كاملة) فتقول «5,562+»
       * واللوحة «−4,397» على الشاشة نفسها. صار الرقمان واحداً في اللوحة،
       * والعالمان مصرَّحَين: الخطة أساساً والواصل تقدّماً. (ش1، ش2)
       */}
      {hasIncome && panelInput ? (
        <MonthPanel input={panelInput} panel={panel} />
      ) : (
        <section className="rounded-3xl border border-dashed border-border bg-surface p-6 text-center">
          <p className="text-[15px] text-text-muted">{t('month.noIncome')}</p>
          <Link to="/money" className="mt-3 block">
            <Button className="w-full">{t('month.addIncome')}</Button>
          </Link>
        </section>
      )}

      {/*
       * الصناديق قبل مدخل الحسابات: من قرأ «بيضل معك» يسأل بعدها مباشرةً
       * «وين المصاري الملتزَم فيها؟» — وكل صندوقٍ هنا برصيده وعلامة بنكه،
       * وتحتها «غير المخصّص» لكل حساب لأن سالبه لا يُرى من صندوقٍ واحد.
       */}
      {derived && (
        <FundsPanel
          funds={derived.funds}
          accounts={derived.fundsAccounts}
          runway={derived.runway}
        />
      )}

      {/*
       * التفصيل حُذف من هنا.
       *
       * كانت الشاشة تعرض «وين بتروح» مرّتين: واحدةً داخل اللوحة الموحّدة
       * وأخرى تحتها — بعنوانٍ واحدٍ وأرقامٍ مختلفة، لأن الأولى تطرح المصاريف
       * اليومية والثانية لا تطرحها. فيقرأ صاحبها رقمين لسؤالٍ واحد بفرق آلاف
       * على بُعد سنتيمترين، ولا شيء يقول له لماذا اختلفا. وهذا هو «مخربط»
       * بعينه. الباقي هو تفصيل اللوحة وحدها.
       */}

      {/*
       * مدخل الثروة في آخر لوحة الشهر لا في أوّلها.
       *
       * الترتيب هو الرسالة: من يفتح التطبيق يسأل عن شهره، ومن يصل إلى آخر
       * الشاشة يكون قد فرغ من السؤال القريب — وعندها وحدها يعني السؤالُ
       * البعيد شيئاً.
       */}
      {/* بطاقة السيولة قبل بطاقة الثروة: «كم معي الآن؟» أقرب من «كم تراكم؟». */}
      <Link
        to="/wealth/accounts"
        className="flex items-center gap-3 rounded-3xl border border-border bg-surface p-5"
      >
        <span className="text-2xl" aria-hidden="true">
          🏦
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-text">{t('accounts.entryTitle')}</span>
          <span className="block text-[12px] text-text-muted">{t('accounts.entryHint')}</span>
        </span>
        <span className="text-text-muted" aria-hidden="true">
          ←
        </span>
      </Link>

      <Link
        to="/wealth"
        className="flex items-center gap-3 rounded-3xl border border-brand/30 bg-brand-soft p-5"
      >
        <span className="text-2xl" aria-hidden="true">
          🌱
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-brand">{t('wealth.entryTitle')}</span>
          <span className="block text-[12px] text-text-muted">{t('wealth.entryHint')}</span>
        </span>
        <span className="text-brand" aria-hidden="true">
          ←
        </span>
      </Link>
    </div>
  )
}
