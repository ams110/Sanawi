import { supabase } from '@/lib/supabase'
import type { Asset, AssetKind, NetWorthSnapshot } from '@/lib/db/types'
import { listObligations } from '@/features/obligations/api'
import { listCommitmentDetails } from '@/features/bills/commitments'
import { listExpenses, monthKey, shiftMonth, toCalcRows } from '@/features/expenses/api'
import { summarizeExpenses } from '@/lib/expenses/calc'
import { summarizeMonthlyLoad, viewCommitment } from '@/lib/commitments/calc'
import { spendingBaseline } from '@/lib/wealth/baseline'
import type { AssetInput, DebtInput } from '@/lib/wealth/networth'
import { debtBalanceFrom, type PayoffDebt } from '@/lib/commitments/payoff'

/* ── الأصول ────────────────────────────────────────────────── */

export async function listAssets(): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('is_active', true)
    .order('amount', { ascending: false })
  if (error) throw error
  return (data ?? []) as Asset[]
}

export async function addAsset(
  userId: string,
  input: {
    name: string
    kind: AssetKind
    amount: number
    annualReturnPercent: number
    isLiquid: boolean
    isEmergencyFund: boolean
  },
): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .insert({
      user_id: userId,
      name: input.name,
      kind: input.kind,
      amount: input.amount,
      annual_return_percent: input.annualReturnPercent,
      is_liquid: input.isLiquid,
      is_emergency_fund: input.isEmergencyFund,
    })
    .select()
    .single()
  if (error) throw error
  return data as Asset
}

/**
 * التعديل الجزئي لا يمسّ ما لم يُرسَل.
 *
 * القاعدة نفسها المطبَّقة في كل تعديلات هذا التطبيق: بناء الصف من الحقول
 * المُرسَلة وحدها. إرسال الكائن كاملاً يكتب `undefined` فوق قيمٍ صحيحة
 * ويمحو ما لم يقصد المستخدم مسّه.
 */
export async function updateAsset(
  id: string,
  patch: {
    name?: string
    kind?: AssetKind
    amount?: number
    annualReturnPercent?: number
    isLiquid?: boolean
    isEmergencyFund?: boolean
  },
): Promise<void> {
  const row: Partial<Asset> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.kind !== undefined) row.kind = patch.kind
  if (patch.amount !== undefined) row.amount = patch.amount
  if (patch.annualReturnPercent !== undefined) {
    row.annual_return_percent = patch.annualReturnPercent
  }
  if (patch.isLiquid !== undefined) row.is_liquid = patch.isLiquid
  if (patch.isEmergencyFund !== undefined) row.is_emergency_fund = patch.isEmergencyFund

  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('assets').update(row).eq('id', id)
  if (error) throw error
}

/**
 * الحذف أرشفة لا محو.
 *
 * اللقطات الشهرية مبنيّة على أصولٍ كانت موجودة يوم أُخذت؛ محو الأصل يجعل
 * تاريخ الثروة يختلف عن نفسه كلما نُظّفت القائمة.
 */
export async function archiveAsset(id: string): Promise<void> {
  const { error } = await supabase.from('assets').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

/* ── اللقطات ───────────────────────────────────────────────── */

export async function listSnapshots(limit = 24): Promise<NetWorthSnapshot[]> {
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select('*')
    .order('snapshot_month', { ascending: false })
    .limit(limit)
  if (error) throw error
  // تصاعدياً للرسم: الخط يُقرأ من القديم إلى الجديد.
  return ((data ?? []) as NetWorthSnapshot[]).slice().reverse()
}

/**
 * لقطة الشهر تُحدَّث ولا تتكرّر.
 *
 * `upsert` على (user_id, snapshot_month): فتح الشاشة مرتين في الشهر نفسه
 * يصحّح اللقطة ولا يضيف نقطةً ثانية تقفز داخل الشهر بلا معنى.
 */
export async function saveSnapshot(
  userId: string,
  totals: {
    assetsTotal: number
    restrictedTotal: number
    debtsTotal: number
    netWorth: number
  },
  month = monthKey(),
): Promise<void> {
  const { error } = await supabase.from('net_worth_snapshots').upsert(
    {
      user_id: userId,
      snapshot_month: month,
      assets_total: totals.assetsTotal,
      restricted_total: totals.restrictedTotal,
      debts_total: totals.debtsTotal,
      net_worth: totals.netWorth,
    },
    { onConflict: 'user_id,snapshot_month' },
  )
  if (error) throw error
}

/* ── تجميع مدخلات المحرّكات ────────────────────────────────── */

export interface WealthSources {
  assets: Asset[]
  /** أرصدة صناديق الالتزامات — ما أودعتُه أنا وحدي في كل صندوق. */
  restrictedFunds: number[]
  debts: DebtInput[]
  payoffDebts: PayoffDebt[]
  snapshots: NetWorthSnapshot[]
  /**
   * المصروف الشهري الذي يستمرّ مدى العمر.
   *
   * ثلاثة بنود لا أربعة: الفواتير الدائمة، وأقساط الالتزامات السنوية
   * (التأمين لا يتوقّف حين تتقاعد)، والمصروف اليومي من الشهور المكتملة.
   * أما أقساط الديون فمستثناة عمداً — لها تاريخ نهاية، وحسابُ حريةٍ يفترض
   * أنك ستسدّد قرض السيارة إلى الأبد يطلب منك رأس مالٍ لا تحتاجه.
   * والادخار مستثنى كذلك: هو الطريق لا الوجهة.
   */
  monthlyEssentials: number
  /** خطّ الأساس مبنيّ على شهرٍ لم ينتهِ — الرقم مبدئيّ ويجب أن يُقال. */
  spendingIsProvisional: boolean
  annualSpending: number
}

export function toAssetInputs(assets: readonly Asset[]): AssetInput[] {
  return assets.map((a) => ({
    name: a.name,
    kind: a.kind,
    amount: Number(a.amount),
    isLiquid: a.is_liquid,
    isEmergencyFund: a.is_emergency_fund,
    annualReturnPercent: Number(a.annual_return_percent),
    updatedAt: a.updated_at,
  }))
}

export async function loadWealthSources(): Promise<WealthSources> {
  const month = monthKey()
  // ثلاثة شهورٍ مكتملة خلف الجاري: عليها يُبنى خطّ الأساس، لا على شهرٍ
  // لم ينتهِ بعد.
  const completedKeys = [shiftMonth(month, -1), shiftMonth(month, -2), shiftMonth(month, -3)]

  const [assets, obligations, details, expenses, snapshots, ...completed] = await Promise.all([
    listAssets(),
    listObligations(),
    listCommitmentDetails(),
    listExpenses(month),
    listSnapshots(),
    ...completedKeys.map((key) => listExpenses(key)),
  ])

  const restrictedFunds = obligations.map((o) => Number(o.balance?.my_fund_balance ?? 0))

  const load = summarizeMonthlyLoad(
    details.map((d) => ({
      amount: Number(d.amount),
      startsOn: d.starts_on,
      endsOn: d.ends_on,
      mySharePercent: Number(d.my_share_percent),
    })),
  )

  /*
   * الدَّين هو ما له نهاية. الفاتورة الدائمة مصروفٌ لا دين، وإدراجها يجعل
   * كل مستخدمٍ يبدو غارقاً إلى الأبد.
   *
   * والحصّة والدفعات تُشتقّان من `viewCommitment` لا من عمودَي العرض: العرض
   * يحملهما، لكن خادم MCP يشتقّهما من المحرّك، ورقمان لتعريفٍ واحد يفترقان
   * يوم يتغيّر التعريف في أحد الطرفين.
   *
   * والقسط الذي لم تبدأ دفعاته دَينٌ رغم ذلك: هو خارج حمل هذا الشهر وداخلٌ
   * في «ما عليّ». فالفلترة على الانتهاء وحده.
   */
  const live = details
    .map((row) => ({
      row,
      view: viewCommitment({
        amount: Number(row.amount),
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        mySharePercent: Number(row.my_share_percent),
      }),
    }))
    .filter(({ view }) => view.isInstallment && !view.isFinished)

  const debts: DebtInput[] = live.map(({ row, view }) => ({
    name: row.name,
    monthlyAmount: view.myAmount,
    paymentsLeft: view.paymentsLeft ?? 0,
  }))

  const payoffDebts: PayoffDebt[] = live.map(({ row, view }) => {
    const rate = Number(row.annual_interest_percent ?? 0)
    return {
      id: row.commitment_id,
      name: row.name,
      // الأصل لا مجموع الدفعات: الثاني يحمل فائدةً لم تُستحقّ بعد، وإدخالُه
      // المحاكاةَ يجعلها تركّب الفائدة مرّتين وتعلن قرضاً حقيقياً مستحيلاً.
      balance: debtBalanceFrom(view.myAmount, view.paymentsLeft ?? 0, rate),
      minimumPayment: view.myAmount,
      annualInterestPercent: rate,
    }
  })

  const spending = summarizeExpenses(toCalcRows(expenses), new Date(`${month}T00:00:00`))
  const obligationInstallments = obligations.reduce((s, o) => s + o.calc.monthlyInstallment, 0)

  /*
   * المصروف اليومي من الشهور المكتملة لا من إسقاط الجاري.
   *
   * الإسقاط صادقٌ في لوحة الشهر وكارثةٌ هنا: طلعةُ تسوّقٍ في أول الشهر
   * تُضرب في ثلاثين فيقفز رقم الحرية بالملايين ثم يعود بعد أسبوع.
   * التفصيل في src/lib/wealth/baseline.ts.
   */
  const baseline = spendingBaseline({
    // شهرٌ بلا صفوف شهرٌ مجهول لا شهرٌ صفريّ.
    completedMonths: completed.map((rows) =>
      rows.length === 0 ? null : rows.reduce((total, row) => total + Number(row.amount), 0),
    ),
    currentMonthProjection: spending.projectedTotal,
  })

  const monthlyEssentials =
    Math.round((load.recurring + obligationInstallments + baseline.monthly) * 100) / 100

  return {
    assets,
    restrictedFunds,
    debts,
    payoffDebts,
    snapshots,
    monthlyEssentials,
    spendingIsProvisional: baseline.isProvisional,
    annualSpending: Math.round(monthlyEssentials * 12 * 100) / 100,
  }
}
