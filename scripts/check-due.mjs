/**
 * فحص موعد الدفع وطريقته على قاعدة حقيقية:
 * طرق الدفع → بند بموعد وطريقة → فاتورة بطريقة → الترتيب → RLS → تنظيف.
 *
 * التشغيل: npm run check:due
 */
import { createClient } from '@supabase/supabase-js'
import { dueInfo, sortBills } from '../src/lib/commitments/due.ts'
import {
  allOf,
  createReporter,
  readEnv,
  requireTables,
  rowsOf,
  signInTestAccount,
} from './lib/checks.mjs'

const env = readEnv(import.meta.url)
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { step, finish } = createReporter()

await requireTables(
  supabase,
  ['payment_methods', 'fixed_commitments', 'bill_payments'],
  'supabase/migrations/0013_payment_methods.sql',
)

const { creds, userId } = await signInTestAccount(supabase, import.meta.url, step)

// 1) طرق الدفع الافتراضية.
const methods = rowsOf(
  await supabase.from('payment_methods').select('*').order('sort_order'),
  'قراءة طرق الدفع',
  step,
)
if (!methods) finish()

const defaults = methods.filter((m) => m.user_id === null)
step('طرق الدفع الافتراضية', defaults.length >= 6, `${defaults.length} طريقة`)
step('لكل طريقة أيقونة', allOf(defaults, (m) => m.icon?.length > 0))

const auto = defaults.filter((m) => m.is_automatic)
step('الاقتطاع التلقائي معلَّم', auto.length === 1, auto.map((m) => m.name_ar).join('، '))

const cash = defaults.find((m) => m.name_ar === 'كاش')
const standing = auto[0]
step('كاش موجود', Boolean(cash), cash?.icon ?? '')

// 2) طريقة خاصة بالمستخدم — "فيزا" وحدها لا تكفي لمن يحمل بطاقتين.
const { data: myCard, error: cardErr } = await supabase
  .from('payment_methods')
  .insert({ user_id: userId, name_ar: 'ماكس فحص', icon: '💳', is_automatic: false, sort_order: 900 })
  .select()
  .single()
step('إضافة بطاقة خاصة', !cardErr && Boolean(myCard?.id), cardErr?.message ?? '')

// 3) الافتراضية محميّة من الحذف.
await supabase.from('payment_methods').delete().eq('id', cash.id)
const stillThere = rowsOf(
  await supabase.from('payment_methods').select('id').eq('id', cash.id),
  'قراءة بعد محاولة الحذف',
  step,
)
step('الطريقة الافتراضية لا تُحذف', (stillThere ?? []).length === 1)

// 4) بند بموعد وطريقة معتادة.
const { data: bill, error: billErr } = await supabase
  .from('fixed_commitments')
  .insert({
    user_id: userId,
    name: 'كهرباء موعد',
    amount: 400,
    day_of_month: 10,
    default_method_id: standing.id,
    my_share_percent: 100,
  })
  .select()
  .single()
step('بند بموعد وطريقة', !billErr && bill?.day_of_month === 10, billErr?.message ?? `يوم ${bill?.day_of_month}`)
step('الطريقة المعتادة محفوظة', bill?.default_method_id === standing.id)

// 5) القاعدة ترفض يوماً خارج المدى — القيد موجود منذ 0003.
const { error: badDay } = await supabase.from('fixed_commitments').insert({
  user_id: userId,
  name: 'يوم غلط',
  amount: 100,
  day_of_month: 45,
})
step('القاعدة ترفض يوم 45', Boolean(badDay), badDay ? 'مرفوض' : 'قُبل!')

// 6) فاتورة مسجّلة بطريقة فعلية تختلف عن المعتادة.
const today = new Date()
const month = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
const { error: payErr } = await supabase.from('bill_payments').upsert(
  {
    user_id: userId,
    commitment_id: bill.id,
    billing_month: month,
    amount: 430,
    paid_at: today.toISOString().slice(0, 10),
    method_id: myCard.id,
  },
  { onConflict: 'commitment_id,billing_month' },
)
const saved = rowsOf(
  await supabase.from('bill_payments').select('*').eq('commitment_id', bill.id),
  'قراءة الفاتورة',
  step,
)
step('طريقة الفاتورة تسبق المعتادة', !payErr && saved?.[0]?.method_id === myCard.id, payErr?.message ?? '')

// 7) المحرّك: الموعد والترتيب.
const monthStart = new Date(`${month}T00:00:00`)
const d = dueInfo(10, monthStart, new Date(today.getFullYear(), today.getMonth(), 10))
step('موعد اليوم يُعطي today', d.urgency === 'today' && d.daysAway === 0)

const order = sortBills(
  [
    { id: 'مدفوعة', dayOfMonth: 2, isPaid: true, isAutomatic: false },
    { id: 'آلية', dayOfMonth: 3, isPaid: false, isAutomatic: true },
    { id: 'متأخرة', dayOfMonth: 4, isPaid: false, isAutomatic: false },
    { id: 'بعيدة', dayOfMonth: 28, isPaid: false, isAutomatic: false },
  ],
  (b) => b,
  monthStart,
  new Date(today.getFullYear(), today.getMonth(), 10),
)
step(
  'الترتيب قائمة عمل لا سجلّ',
  order.map((o) => o.id).join('<') === 'متأخرة<بعيدة<آلية<مدفوعة',
  order.map((o) => o.id).join(' < '),
)

// 8) عزل RLS.
await supabase.auth.signOut()
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data: leakedMine } = await anon.from('payment_methods').select('id').not('user_id', 'is', null)
step('لا تسرّب للطرق الخاصة بلا جلسة', (leakedMine ?? []).length === 0, `${(leakedMine ?? []).length} صف`)

// 9) تنظيف.
await supabase.auth.signInWithPassword(creds)
await supabase.from('bill_payments').delete().eq('commitment_id', bill.id)
await supabase.from('fixed_commitments').delete().eq('id', bill.id)
await supabase.from('payment_methods').delete().eq('id', myCard.id)
step('تنظيف', true)

finish()
