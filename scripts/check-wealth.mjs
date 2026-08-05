/**
 * فحص الثروة على قاعدة حقيقية:
 * أصول → صافي ثروة → صندوق طوارئ → لقطة شهرية → رقم الحرية → RLS → تنظيف.
 *
 * ما يحرسه هذا الفحص تحديداً: أن التعريفات التي بُني عليها صافي الثروة تنجو
 * من رحلة القاعدة كاملةً. المحرّك مُختبَرٌ وحده في networth.test.ts، وهذا
 * يفحص ما لا يستطيع الاختبار: أن الأعمدة موجودة، وأن `numeric` يعود نصّاً
 * فيُحوَّل، وأن الـ upsert لا يكرّر لقطة الشهر، وأن RLS تمنع التسرّب.
 *
 * التشغيل: npm run check:wealth
 */
import { createClient } from '@supabase/supabase-js'
import { computeNetWorth } from '../src/lib/wealth/networth.ts'
import { freedomNumber, projectFreedom } from '../src/lib/wealth/freedom.ts'
import { buildPayoffPlan, comparePayoff } from '../src/lib/commitments/payoff.ts'
import { allOf, createReporter, readEnv, requireTables, rowsOf, signInTestAccount } from './lib/checks.mjs'

const env = readEnv(import.meta.url)
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { step, finish } = createReporter()

await requireTables(
  supabase,
  ['assets', 'net_worth_snapshots'],
  'supabase/migrations/0014_wealth.sql',
)

const { creds, userId } = await signInTestAccount(supabase, import.meta.url, step)

const today = new Date()
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10)

/* ── 1) الأصول ─────────────────────────────────────────────── */

const { data: assets, error: assetErr } = await supabase
  .from('assets')
  .insert([
    {
      user_id: userId,
      name: 'كاش فحص',
      kind: 'cash',
      amount: 12000,
      is_liquid: true,
      is_emergency_fund: true,
      annual_return_percent: 0,
    },
    {
      user_id: userId,
      name: 'محفظة فحص',
      kind: 'investment',
      amount: 40000,
      is_liquid: true,
      is_emergency_fund: false,
      annual_return_percent: 7,
    },
    {
      user_id: userId,
      name: 'شقة فحص',
      kind: 'property',
      amount: 300000,
      is_liquid: false,
      is_emergency_fund: false,
      annual_return_percent: 3,
    },
  ])
  .select()
step('إدراج ثلاثة أصول', !assetErr && assets?.length === 3, assetErr?.message ?? '')
if (!assets) finish()

// القاعدة تحرس النوع: أيّ قيمةٍ خارج القائمة تعني عموداً حرّاً بلا معنى.
const { error: kindErr } = await supabase
  .from('assets')
  .insert({ user_id: userId, name: 'نوع غلط', kind: 'crypto', amount: 1 })
step('القاعدة ترفض نوعاً غير معروف', Boolean(kindErr), kindErr ? 'مرفوض' : 'قُبل!')

const { error: negErr } = await supabase
  .from('assets')
  .insert({ user_id: userId, name: 'سالب', kind: 'cash', amount: -5 })
step('القاعدة ترفض قيمة سالبة', Boolean(negErr), negErr ? 'مرفوض' : 'قُبل!')

/* ── 2) updated_at يتحرّك وحده ─────────────────────────────── */

const target = assets.find((a) => a.name === 'محفظة فحص')
const before = target.updated_at
const { error: touchErr } = await supabase
  .from('assets')
  .update({ amount: 41000 })
  .eq('id', target.id)
const { data: touched } = await supabase
  .from('assets')
  .select('updated_at, amount')
  .eq('id', target.id)
  .single()
step(
  'المُشغِّل يحدّث updated_at بلا تدخّل العميل',
  !touchErr && touched && new Date(touched.updated_at) > new Date(before),
  touchErr?.message ?? '',
)

/* ── 3) صافي الثروة من صفوفٍ حقيقية ────────────────────────── */

const rows = rowsOf(
  await supabase.from('assets').select('*').eq('is_active', true),
  'قراءة الأصول',
  step,
)
if (!rows) finish()
step('الأصول المقروءة ثلاثة', rows.length === 3, `${rows.length} صف`)

// numeric يعود نصّاً من PostgREST؛ الفحص الحقيقي هنا أن التحويل يقع فعلاً.
step(
  'كل المبالغ تتحوّل إلى أرقام صحيحة',
  allOf(rows, (r) => Number.isFinite(Number(r.amount))),
)

const net = computeNetWorth({
  assets: rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    amount: Number(r.amount),
    isLiquid: r.is_liquid,
    isEmergencyFund: r.is_emergency_fund,
    annualReturnPercent: Number(r.annual_return_percent),
    updatedAt: r.updated_at,
  })),
  // صندوق التزامٍ فيه 3,000 — مالٌ حقيقيّ محجوز.
  restrictedFunds: [3000],
  // قسطٌ باقٍ عليه عشر دفعات بـ 500 = 5,000 ديناً.
  debts: [{ name: 'قرض فحص', monthlyAmount: 500, paymentsLeft: 10 }],
  monthlyEssentials: 4000,
  emergencyMonths: 3,
})

step('مجموع الأصول 353,000', net.assetsTotal === 353000, `${net.assetsTotal}`)
step('السائل يستثني العقار', net.liquidTotal === 53000, `${net.liquidTotal}`)
step('الصناديق تُحتسب ملكاً', net.restrictedTotal === 3000, `${net.restrictedTotal}`)
step('مجموع الملك 356,000', net.ownedTotal === 356000, `${net.ownedTotal}`)
step('الدَّين = القسط × الدفعات', net.debtsTotal === 5000, `${net.debtsTotal}`)
step('صافي الثروة 351,000', net.netWorth === 351000, `${net.netWorth}`)
step('ليس غارقاً', net.isUnderwater === false)

step(
  'التوزيع مرتّب تنازلياً',
  allOf(net.byKind, (_, i, arr) => i === 0 || arr[i - 1].total >= arr[i].total),
)
step(
  'حصص التوزيع كسورٌ مجموعها واحد',
  Math.abs(net.byKind.reduce((s, l) => s + l.share, 0) - 1) < 0.001,
)

/* ── 4) صندوق الطوارئ ──────────────────────────────────────── */

step('صندوق الطوارئ = السائل المُعلَّم وحده', net.emergencyFund.current === 12000)
step('الهدف = المصروف × الشهور', net.emergencyFund.target === 12000)
step('مكتمل', net.emergencyFund.isFunded === true)
step('يغطّي ثلاثة شهور', Math.abs(net.emergencyFund.monthsCovered - 3) < 0.001)

// العقار المُعلَّم صندوقَ طوارئ تناقض: المحرّك يستثنيه ولا يصدّق العلامة.
const illiquid = computeNetWorth({
  assets: [
    { name: 'شقة', kind: 'property', amount: 500000, isLiquid: false, isEmergencyFund: true },
  ],
  restrictedFunds: [],
  debts: [],
  monthlyEssentials: 4000,
  emergencyMonths: 3,
})
step('صندوق طوارئ غير سائل لا يُحتسب', illiquid.emergencyFund.current === 0)

/* ── 5) اللقطة الشهرية ─────────────────────────────────────── */

const snapshotOf = (month, netWorth) => ({
  user_id: userId,
  snapshot_month: month,
  assets_total: net.assetsTotal,
  restricted_total: net.restrictedTotal,
  debts_total: net.debtsTotal,
  net_worth: netWorth,
})

const { error: snapErr } = await supabase
  .from('net_worth_snapshots')
  .upsert([snapshotOf(prevMonth, 340000), snapshotOf(monthStart, net.netWorth)], {
    onConflict: 'user_id,snapshot_month',
  })
step('حفظ لقطتين', !snapErr, snapErr?.message ?? '')

// إعادة الحفظ تصحّح ولا تكرّر — وهذا كل معنى القيد الفريد.
const { error: reErr } = await supabase
  .from('net_worth_snapshots')
  .upsert([snapshotOf(monthStart, 999)], { onConflict: 'user_id,snapshot_month' })
const snaps = rowsOf(
  await supabase.from('net_worth_snapshots').select('*').order('snapshot_month'),
  'قراءة اللقطات',
  step,
)
if (!snaps) finish()
step('اللقطة الثانية حدّثت ولم تكرّر', !reErr && snaps.length === 2, `${snaps.length} لقطة`)
step(
  'قيمة الشهر الجاري هي الأخيرة المكتوبة',
  Number(snaps[snaps.length - 1].net_worth) === 999,
  `${snaps[snaps.length - 1].net_worth}`,
)

/* ── 6) رقم الحرية ─────────────────────────────────────────── */

step('رقم الحرية = المصروف × 25 عند 4%', freedomNumber(48000, 4) === 1200000)
step('معدّل سحبٍ أعلى يعني رقماً أصغر', freedomNumber(48000, 5) === 960000)

const freedom = projectFreedom({
  annualSpending: 48000,
  currentNetWorth: net.netWorth,
  monthlyContribution: 3000,
  annualReturnPercent: 7,
  inflationPercent: 3,
  withdrawalRatePercent: 4,
})
step('لم يبلغ الحرية بعد', freedom.isFree === false)
step('التاريخ موجود لا مفقود', freedom.freedomDate instanceof Date && freedom.monthsToFreedom > 0)
step('العائد الحقيقي أقل من الاسمي', freedom.realReturnPercent < 7, `${freedom.realReturnPercent}%`)
step(
  'لا رقم فاسد في أيّ حقل',
  Object.values(freedom).every(
    (v) => typeof v !== 'number' || (Number.isFinite(v) && !Number.isNaN(v)),
  ),
)

const stuck = projectFreedom({
  annualSpending: 48000,
  currentNetWorth: 1000,
  monthlyContribution: 0,
  annualReturnPercent: 0,
  inflationPercent: 3,
  withdrawalRatePercent: 4,
})
step('بلا ادخار ولا عائد: لا يُبلَغ أبداً', stuck.monthsToFreedom === null)

/* ── 7) ترتيب سداد الديون ──────────────────────────────────── */

const debts = [
  { id: 'a', name: 'بطاقة', balance: 6000, minimumPayment: 400, annualInterestPercent: 18 },
  { id: 'b', name: 'قرض', balance: 3000, minimumPayment: 500, annualInterestPercent: 4 },
]

const avalanche = buildPayoffPlan({ debts, extraMonthly: 300, strategy: 'avalanche' })
const snowball = buildPayoffPlan({ debts, extraMonthly: 300, strategy: 'snowball' })
step('الانهيار يبدأ بالأعلى فائدة', avalanche.lines[0].name === 'بطاقة')
step('كرة الثلج تبدأ بالأصغر', snowball.lines[0].name === 'قرض')
step('الخطتان تنتهيان', avalanche.months !== null && snowball.months !== null)
step('لا خطة مستحيلة هنا', avalanche.isImpossible === false)

const cmp = comparePayoff({ debts, extraMonthly: 300 })
step('الانهيار لا يخسر أمام كرة الثلج', cmp.interestSaved >= 0, `${cmp.interestSaved} ₪`)

/* ── 8) عزل RLS ────────────────────────────────────────────── */

await supabase.auth.signOut()
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data: leakedAssets } = await anon.from('assets').select('id')
const { data: leakedSnaps } = await anon.from('net_worth_snapshots').select('id')
step('لا تسرّب للأصول بلا جلسة', (leakedAssets ?? []).length === 0)
step('لا تسرّب للقطات بلا جلسة', (leakedSnaps ?? []).length === 0)

/* ── 9) تنظيف ──────────────────────────────────────────────── */

await supabase.auth.signInWithPassword(creds)
await supabase.from('net_worth_snapshots').delete().eq('user_id', userId)
await supabase.from('assets').delete().eq('user_id', userId)
step('تنظيف', true)

finish()
