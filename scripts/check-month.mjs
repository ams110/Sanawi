/**
 * فحص المرحلة 4 على قاعدة حقيقية:
 * دخل فعلي → لوحة موحّدة تجمع كل المصادر → الإسقاط → RLS → تنظيف.
 *
 * التشغيل: npm run check:month
 */
import { createClient } from '@supabase/supabase-js'
import { buildMonthPanel, dailyAllowance } from '../src/lib/budget/month.ts'
import { monthlyIncomeFrom } from '../src/lib/budget/calc.ts'
import { createReporter, readEnv, requireTables, rowsOf, signInTestAccount } from './lib/checks.mjs'

const env = readEnv(import.meta.url)
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { step, finish } = createReporter()

await requireTables(
  supabase,
  ['income_entries', 'income_sources'],
  'supabase/migrations/0012_income_entries.sql',
)

const { creds, userId } = await signInTestAccount(supabase, import.meta.url, step)

const today = new Date()
const day = (n) => new Date(today.getFullYear(), today.getMonth(), n).toISOString().slice(0, 10)

// 1) مصدر دخل مقدَّر أسبوعي — الاختبار الحاسم: × 4.333 لا × 4.
const { data: source, error: srcErr } = await supabase
  .from('income_sources')
  .insert({ user_id: userId, name: 'شغل فحص', amount: 1000, frequency: 'weekly' })
  .select()
  .single()
step('مصدر دخل أسبوعي', !srcErr && Boolean(source?.id), srcErr?.message ?? '')

// 1ب) مصدر متغيّر — الشغل الجانبي الذي لا رقم ثابت له.
//
// هذا هو الفرق الذي يعيش من أجله العمود: مصدرٌ يظهر في القائمة ويستقبل
// دفعات، ولا يدخل «المتوقَّع» بشيء. وبلا العمود كان صاحبه مضطراً لاختراع
// رقم، فيتضخّم المتوقَّع ويصير «الباقي للصرف» وعداً لا يفي به الشهر.
const { data: gig, error: gigErr } = await supabase
  .from('income_sources')
  .insert({ user_id: userId, name: 'شغل حرّ فحص', amount: 0, is_variable: true })
  .select()
  .single()
step('مصدر متغيّر بلا مبلغ', !gigErr && gig?.is_variable === true, gigErr?.message ?? '')

// المحرّك نفسه الذي تستعمله الشاشة والخادم — لا حساب موازٍ هنا.
const sources = rowsOf(
  await supabase.from('income_sources').select('*').eq('is_active', true),
  'قراءة مصادر الدخل',
  step,
)
if (!sources) finish()
const expectedFromEngine = monthlyIncomeFrom(
  sources.map((r) => ({
    amount: Number(r.amount),
    frequency: r.frequency,
    isVariable: Boolean(r.is_variable),
  })),
)
// ‏1000 × 52 ÷ 12 = 4333.33، والمتغيّر يضيف صفراً لا أكثر.
step('المتغيّر خارج الدخل المتوقَّع', expectedFromEngine === 4333.33, `${expectedFromEngine} ₪`)

// 2) دفعتا دخل وصلتا فعلاً.
const { data: entries, error: entErr } = await supabase
  .from('income_entries')
  .insert([
    { user_id: userId, source_id: source.id, amount: 1000, received_at: day(3) },
    { user_id: userId, source_id: null, name: 'بيع غرض', amount: 500, received_at: day(5) },
  ])
  .select()
step('تسجيل دفعتَي دخل', !entErr && entries?.length === 2, entErr?.message ?? '')
step('دخل بلا مصدر مقبول', entries?.some((e) => e.source_id === null) === true)

// والمتغيّر يدخل «ما وصل» رغم أنه خارج «المتوقَّع» — وهذا كل المقصود منه.
const { data: gigEntry, error: gigEntErr } = await supabase
  .from('income_entries')
  .insert({ user_id: userId, source_id: gig.id, amount: 700, received_at: day(7) })
  .select()
  .single()
step('دفعة من مصدر متغيّر', !gigEntErr && gigEntry?.source_id === gig.id, gigEntErr?.message ?? '')

// 3) القاعدة ترفض دخلاً صفرياً أو سالباً.
const { error: zeroErr } = await supabase
  .from('income_entries')
  .insert({ user_id: userId, amount: 0, received_at: day(6) })
step('القاعدة ترفض دخلاً بصفر', Boolean(zeroErr), zeroErr ? 'مرفوض' : 'قُبل!')

// 4) القراءة بحدود الشهر.
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
const fetched = rowsOf(
  await supabase
    .from('income_entries')
    .select('*')
    .gte('received_at', monthStart)
    .lte('received_at', monthEnd),
  'قراءة دخل الشهر',
  step,
)
if (!fetched) finish()
const received = fetched.reduce((s, r) => s + Number(r.amount), 0)
step('مجموع الدخل الواصل', received === 2200, `${received} ₪`)

// 5) اللوحة الموحّدة: الأساس الخطة، والواصل تقدّمٌ لا انقلاب.
//
// (تصليح تدقيق آب 2026 ش3: قبضةٌ واصلة كانت تقلب الأساس إلى «الواصل»
// فتُقارن بدخل نصف شهرٍ التزاماتُ شهرٍ كامل.)
const expected = 1000 * (52 / 12) // 4333.33
const panel = buildMonthPanel({
  expectedIncome: Math.round(expected * 100) / 100,
  receivedIncome: received,
  obligationInstallments: 500,
  recurringBills: 400,
  installments: 300,
  dailyExpenses: 600,
  savingsTarget: 200,
  daysElapsed: 10,
  daysInMonth: 30,
})
step(
  'الأساس الخطة رغم وصول قبضات',
  panel.incomeBasis === 'expected' && panel.income === 4333.33,
  `${panel.income} ₪`,
)
step('والواصل يُعرض تقدّماً', panel.receivedIncome === 2200, `${panel.receivedIncome} ₪`)
step('الفجوة تكشف ما لم يصل بعد', panel.incomeGap === -2133.33, `${panel.incomeGap} ₪`)
step('مجموع الملتزَم به', panel.committed === 1400, `${panel.committed} ₪`)
// ميزانية الخطة: 4,333.33 − 1,400 = 2,933.33، والباقي بعد المصروف 600.
step('ميزانية الصرف من الخطة', panel.spendingBudget === 2933.33, `${panel.spendingBudget} ₪`)
step('المتبقي = الميزانية − المصروف', panel.remaining === 2333.33, `${panel.remaining} ₪`)
step('ولا تجاوز ما دام فائضاً', panel.isOverspent === false)

/*
 * 6) الإسقاط يمدّ الصرف وحده: 600 في عشرة أيام تعني 1,800 في ثلاثين،
 * فيصير 2,933.33 − 1,800 = 1,133.33 — ولا يدخل فيه دخلٌ لم يصل، فتحذير
 * «بوتيرة صرفك» يتّهم الصرفَ وحده. (ش4)
 */
step('الإسقاط يمدّ الوتيرة', panel.projectedRemaining === 1133.33, `${panel.projectedRemaining} ₪`)
step('ولا إنذار كاذب من فجوة الدخل', panel.projectedIsOverspent === false)
// خاصيّة في الدالّة نفسها لا في أرقام هذه التجربة: المتجاوز لا يُمنَح مصروفاً.
step('مصروف اليوم صفر لمن تجاوز', dailyAllowance(-500, 10, 30) === 0)

// 7) من لا مصادر ثابتة له يُحسب بالواصل — بتصريح، لا خلسة.
const looseOnly = buildMonthPanel({
  expectedIncome: 0,
  receivedIncome: 2500,
  obligationInstallments: 0,
  recurringBills: 0,
  installments: 0,
  dailyExpenses: 0,
  savingsTarget: 0,
  daysElapsed: 1,
  daysInMonth: 31,
})
step(
  'بلا مصادر ثابتة: الواصل هو الأساس',
  looseOnly.incomeBasis === 'received' && looseOnly.income === 2500,
)

// 8) عزل RLS.
await supabase.auth.signOut()
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data: leaked } = await anon.from('income_entries').select('id')
step('لا تسرّب للدخل بلا جلسة', (leaked ?? []).length === 0, `${(leaked ?? []).length} صف`)

// 9) تنظيف.
await supabase.auth.signInWithPassword(creds)
await supabase.from('income_entries').delete().eq('user_id', userId)
await supabase.from('income_sources').delete().in('id', [source.id, gig.id])
step('تنظيف', true)

finish()
