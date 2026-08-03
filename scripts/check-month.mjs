/**
 * فحص المرحلة 4 على قاعدة حقيقية:
 * دخل فعلي → لوحة موحّدة تجمع كل المصادر → الإسقاط → RLS → تنظيف.
 *
 * التشغيل: npm run check:month
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildMonthPanel, dailyAllowance } from '../src/lib/budget/month.ts'

const env = Object.fromEntries(
  readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

let failures = 0
const step = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const CRED_PATH = fileURLToPath(new URL('../.test-account.json', import.meta.url))
if (!existsSync(CRED_PATH)) {
  console.log('❌ لا حساب فحص محفوظ — شغّل npm run check:flow أولاً')
  process.exit(1)
}
const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'))
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword(creds)
if (authErr || !auth.session) {
  step('دخول بحساب الفحص', false, authErr?.message ?? 'بلا جلسة')
  process.exit(1)
}
step('دخول بحساب الفحص', true, creds.email)
const userId = auth.session.user.id

/*
 * وجود الجدول يُفحص أولاً وبـ select حقيقي لا head.
 *
 * بدونه يفشل نصف الفحوص برسالة "الجدول مفقود" وينجح نصفها كذباً: فحصُ
 * "هل ترفض القاعدة دخلاً بصفر" يمرّ لأن الإدراج فشل — لكنه فشل لغياب
 * الجدول لا لعمل القيد. خطأٌ واحدٌ واضح خيرٌ من عشرة أنصاف حقائق.
 */
const probe = await supabase.from('income_entries').select('id').limit(1)
if (probe.error) {
  console.log(`❌ جدول income_entries غير موجود — ${probe.error.message}`)
  console.log('   شغّل supabase/migrations/0012_income_entries.sql في SQL Editor أولاً.')
  process.exit(1)
}
step('جدول income_entries موجود', true)

const today = new Date()
const day = (n) => new Date(today.getFullYear(), today.getMonth(), n).toISOString().slice(0, 10)

// 1) مصدر دخل مقدَّر أسبوعي — الاختبار الحاسم: × 4.333 لا × 4.
const { data: source, error: srcErr } = await supabase
  .from('income_sources')
  .insert({ user_id: userId, name: 'شغل فحص', amount: 1000, frequency: 'weekly' })
  .select()
  .single()
step('مصدر دخل أسبوعي', !srcErr && Boolean(source?.id), srcErr?.message ?? '')

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

// 3) القاعدة ترفض دخلاً صفرياً أو سالباً.
const { error: zeroErr } = await supabase
  .from('income_entries')
  .insert({ user_id: userId, amount: 0, received_at: day(6) })
step('القاعدة ترفض دخلاً بصفر', Boolean(zeroErr), zeroErr ? 'مرفوض' : 'قُبل!')

// 4) القراءة بحدود الشهر.
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
const { data: fetched } = await supabase
  .from('income_entries')
  .select('*')
  .gte('received_at', monthStart)
  .lte('received_at', monthEnd)
const received = (fetched ?? []).reduce((s, r) => s + Number(r.amount), 0)
step('مجموع الدخل الواصل', received === 1500, `${received} ₪`)

// 5) اللوحة الموحّدة: الواصل يغلب المقدَّر.
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
step('اللوحة تعتمد الواصل لا المقدَّر', panel.incomeIsActual && panel.income === 1500)
step('الفجوة تكشف شهراً أضعف', panel.incomeGap < 0, `${panel.incomeGap} ₪`)
step('مجموع الملتزَم به', panel.committed === 1400, `${panel.committed} ₪`)
step('المتبقي = دخل − كل شي', panel.remaining === -500, `${panel.remaining} ₪`)
step('التجاوز مُعلَن لا مخفي', panel.isOverspent === true)

// 6) الإسقاط: 600 في 10 أيام → 1,800 في 30.
step('الإسقاط يمدّ الوتيرة', panel.projectedRemaining === -1700, `${panel.projectedRemaining} ₪`)
step('مصروف اليوم صفر لمن تجاوز', dailyAllowance(panel.remaining, 10, 30) === 0)

// 7) اللوحة بلا دخل مسجّل تقع على المقدَّر.
const noLog = buildMonthPanel({
  expectedIncome: 9000,
  receivedIncome: 0,
  obligationInstallments: 0,
  recurringBills: 0,
  installments: 0,
  dailyExpenses: 0,
  savingsTarget: 0,
  daysElapsed: 1,
  daysInMonth: 31,
})
step('بلا تسجيل: المقدَّر هو المرجع', !noLog.incomeIsActual && noLog.income === 9000)

// 8) عزل RLS.
await supabase.auth.signOut()
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data: leaked } = await anon.from('income_entries').select('id')
step('لا تسرّب للدخل بلا جلسة', (leaked ?? []).length === 0, `${(leaked ?? []).length} صف`)

// 9) تنظيف.
await supabase.auth.signInWithPassword(creds)
await supabase.from('income_entries').delete().eq('user_id', userId)
await supabase.from('income_sources').delete().eq('id', source.id)
step('تنظيف', true)

console.log(failures === 0 ? '\n✅ كل الفحوص نجحت' : `\n❌ ${failures} فحص فشل`)
process.exit(failures === 0 ? 0 : 1)
