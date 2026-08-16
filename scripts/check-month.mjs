/**
 * فحص المرحلة 4 على قاعدة حقيقية:
 * دخل فعلي → لوحة موحّدة على الواصل → الإسقاط → RLS → تنظيف.
 *
 * التشغيل: npm run check:month
 */
import { createClient } from '@supabase/supabase-js'
import { buildMonthPanel, dailyAllowance } from '../src/lib/budget/month.ts'
import { monthActuals } from '../src/lib/month/actuals.ts'
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

// 1) مصدر دخل — اسمٌ للتصنيف لا رقمٌ يُحسب (خطة docs/income-actual-plan.md).
const { data: source, error: srcErr } = await supabase
  .from('income_sources')
  .insert({ user_id: userId, name: 'شغل فحص', amount: 1000, frequency: 'weekly' })
  .select()
  .single()
step('مصدر دخل أسبوعي', !srcErr && Boolean(source?.id), srcErr?.message ?? '')

// 1ب) مصدر ثانٍ — كان «المتغيّر» يوماً، وصار كأي مصدر: اسمٌ تُنسَب إليه
// القبضات. لم يعد ثمّة «متوقَّع» يُستثنى منه أحد.
const { data: gig, error: gigErr } = await supabase
  .from('income_sources')
  .insert({ user_id: userId, name: 'شغل حرّ فحص', amount: 0, is_variable: true })
  .select()
  .single()
step('مصدر متغيّر بلا مبلغ', !gigErr && gig?.is_variable === true, gigErr?.message ?? '')

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

// 5) اللوحة الموحّدة: الأساس هو الواصل، والطرفان من عالمٍ واحد.
//
// (خطة docs/income-actual-plan.md. وعطل ش3 لا يعود لأن الطرفين يُقلَبان
// معاً: مالٌ وصل ناقصَ مالٍ خرج فعلاً — لا دخلُ نصف شهرٍ ناقصَ خطةِ شهر.)
//
// وما خرج فعلاً من محرّك التجهيز نفسه الذي تستعمله الشاشة وMCP: إيداعُ
// الشريك ليس إيداعي، والفاتورة بحصّتي لا بمبلغها الكامل.
const actuals = monthActuals({
  obligations: [
    {
      deposits: [
        { id: 'd1', amount: 500, depositDate: day(3), partnerId: null },
        { id: 'd2', amount: 900, depositDate: day(4), partnerId: 'شريك' },
      ],
    },
  ],
  bills: [{ recordedAmount: 400, mySharePercent: 50 }],
})
step('إيداع الشريك خارج ما خرج مني', actuals.depositsPaid === 500, `${actuals.depositsPaid} ₪`)
step('الفاتورة بحصّتي لا كاملةً', actuals.billsPaid === 200, `${actuals.billsPaid} ₪`)

const panel = buildMonthPanel({
  receivedIncome: received,
  depositsPaid: actuals.depositsPaid,
  billsPaid: actuals.billsPaid,
  dailyExpenses: 600,
  pendingCommitments: 300,
  savingsTarget: 200,
  monthlyLoad: 1400,
  daysElapsed: 10,
  daysInMonth: 30,
})
// وصل 2,200، وخرج 500 + 200 + 600 = 1,300 → بإيدك 900.
step('ما خرج فعلاً', panel.paidOut === 1300, `${panel.paidOut} ₪`)
step('بإيدك من دخل الشهر', panel.inHand === 900, `${panel.inHand} ₪`)
// لسه عليه 300 قسطاً و200 ادخاراً → 500، والكفاية 900 − 500 = 400.
step('لسه لازم يطلع', panel.stillDue === 500, `${panel.stillDue} ₪`)
step('الكفاية بعد سداد ما عليه', panel.coverage === 400, `${panel.coverage} ₪`)
step('ولا نقص ما دام فائضاً', panel.isShort === false && panel.shortfallCause === null)

/*
 * 6) الإسقاط يمدّ الصرف وحده: 600 في عشرة أيام تعني 1,800 في ثلاثين،
 * فيصير 2,200 − 700 − 1,800 − 500 = −800. والدخل لا يُسقَط: مواعيد القبض
 * ليست في البيانات، واختراع دخلٍ قادم يُسكت التحذير على ثقةٍ مخترَعة.
 */
step('الإسقاط يمدّ الوتيرة', panel.projectedCoverage === -800, `${panel.projectedCoverage} ₪`)
step('وينذر بنقصٍ رغم أن الحالي موجب', panel.projectedIsShort === true)
// خاصيّة في الدالّة نفسها لا في أرقام هذه التجربة: المتجاوز لا يُمنَح مصروفاً.
step('مصروف اليوم صفر لمن تجاوز', dailyAllowance(-500, 10, 30) === 0)

/*
 * 7) أول الشهر بلا دخل: الأحمر يسمّي سببه ولا يتّهم الصرف.
 *
 * هذا هو جوهر التصليح: من فتح التطبيق في الثالث وراتبه آخر الشهر كان
 * يقرأ اتّهاماً لصرفه وهو لم يصرف شيئاً يُذكر.
 */
const startOfMonth = buildMonthPanel({
  receivedIncome: 0,
  depositsPaid: 0,
  billsPaid: 0,
  dailyExpenses: 155,
  pendingCommitments: 1400,
  savingsTarget: 200,
  monthlyLoad: 1400,
  daysElapsed: 3,
  daysInMonth: 31,
})
step(
  'أول الشهر: السبب أن الدخل لم يصل',
  startOfMonth.isShort === true && startOfMonth.shortfallCause === 'no_income_yet',
  `${startOfMonth.shortfallCause}`,
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
