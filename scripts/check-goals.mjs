/**
 * فحص أهداف الشراء على قاعدة حقيقية:
 * قوالب الأهداف → هدف بلا تجديد → الإيداع والتقدّم → الاكتمال → تنظيف.
 *
 * التشغيل: npm run check:goals
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { calculateObligation } from '../src/lib/obligations/calc.ts'

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

// 1) قوالب الأهداف.
const { data: goals, error: gErr } = await supabase
  .from('obligation_templates')
  .select('*')
  .eq('category', 'goal')
  .order('sort_order')
if (gErr) {
  step('قراءة قوالب الأهداف', false, gErr.message)
  process.exit(1)
}
step('قوالب الأهداف', goals.length >= 10, `${goals.length} قالب`)

// every على مصفوفة فارغة تُرجع true، فيمرّ الفحص كذباً حين لا صفوف أصلاً.
// اشتراط عدم الفراغ يجعل غياب القوالب فشلاً واحداً واضحاً لا ثلاثة متناقضة.
const nonEmpty = goals.length > 0
step(
  'كلها بلا تجديد',
  nonEmpty && goals.every((g) => g.default_recurrence_months === 0),
  nonEmpty ? goals.map((g) => g.default_recurrence_months).join(',') : 'لا قوالب',
)
step('لكل قالب أيقونة', nonEmpty && goals.every((g) => g.icon?.length > 0))
step(
  'القوالب السنوية ما تأثّرت',
  (await supabase.from('obligation_templates').select('id').neq('category', 'goal')).data.length >= 15,
)

const pc = goals.find((g) => g.name_ar.includes('كمبيوتر'))
step('قالب الكمبيوتر موجود', Boolean(pc), pc?.icon ?? '')

// 2) هدف: 6000 ₪ بعد سنة.
const due = new Date()
due.setMonth(due.getMonth() + 12)
due.setDate(0) // آخر يوم في الشهر السابق — داخل نافذة الاثني عشر شهراً
const dueDate = due.toISOString().slice(0, 10)

const { data: goal, error: goalErr } = await supabase
  .from('obligations')
  .insert({
    user_id: userId,
    name: 'كمبيوتر فحص',
    category: 'goal',
    total_amount: 6000,
    next_due_date: dueDate,
    recurrence_months: 0,
    baseline_installment: 500,
    my_share_percent: 100,
  })
  .select()
  .single()
step('إنشاء هدف بلا تجديد', !goalErr && goal?.recurrence_months === 0, goalErr?.message ?? dueDate)

// 3) المحرّك: هدف بعيد لا يُصنَّف دفعةً مضغوطة.
const fresh = calculateObligation({
  totalAmount: 6000,
  myFundBalance: 0,
  nextDueDate: dueDate,
  recurrenceMonths: 0,
  cycleStartDate: new Date().toISOString().slice(0, 10),
  baselineInstallment: 500,
})
step('الهدف ليس دفعة مضغوطة', fresh.isBridge === false)
step('القسط معقول', fresh.monthlyInstallment > 0 && fresh.monthlyInstallment <= 600, `${fresh.monthlyInstallment} ₪`)

// 4) إيداعان يرفعان الرصيد والتقدّم.
const { error: depErr } = await supabase.from('fund_deposits').insert([
  { user_id: userId, obligation_id: goal.id, amount: 2000 },
  { user_id: userId, obligation_id: goal.id, amount: 1000 },
])
const { data: bal } = await supabase
  .from('obligation_balances')
  .select('*')
  .eq('obligation_id', goal.id)
  .single()
step('الإيداعات تُجمع', !depErr && Number(bal?.my_fund_balance) === 3000, `${bal?.my_fund_balance} ₪`)

const half = calculateObligation({
  totalAmount: 6000,
  myFundBalance: 3000,
  nextDueDate: dueDate,
  recurrenceMonths: 0,
  cycleStartDate: new Date().toISOString().slice(0, 10),
  baselineInstallment: 500,
})
step('التقدّم نصف الطريق', Math.abs(half.progress - 0.5) < 0.01, `${Math.round(half.progress * 100)}%`)

// 5) الاكتمال: لا قسط باقٍ.
const done = calculateObligation({
  totalAmount: 6000,
  myFundBalance: 6000,
  nextDueDate: dueDate,
  recurrenceMonths: 0,
  cycleStartDate: new Date().toISOString().slice(0, 10),
  baselineInstallment: 500,
})
step('هدف مكتمل: لا قسط', done.monthlyInstallment === 0 && done.remainingAmount === 0)
step('تجاوز المبلغ لا يعطي سالباً', calculateObligation({
  totalAmount: 6000,
  myFundBalance: 7000,
  nextDueDate: dueDate,
  recurrenceMonths: 0,
  cycleStartDate: new Date().toISOString().slice(0, 10),
  baselineInstallment: 500,
}).remainingAmount === 0)

// 6) تنظيف.
await supabase.from('fund_deposits').delete().eq('obligation_id', goal.id)
await supabase.from('obligations').delete().eq('id', goal.id)
step('تنظيف', true)

console.log(failures === 0 ? '\n✅ كل الفحوص نجحت' : `\n❌ ${failures} فحص فشل`)
process.exit(failures === 0 ? 0 : 1)
