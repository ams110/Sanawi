/**
 * فحص المصاريف اليومية على قاعدة بيانات حقيقية:
 * التصنيفات الافتراضية → تصنيف خاص → تسجيل مصاريف → التلخيص → عزل RLS → تنظيف.
 *
 * التشغيل: node scripts/check-expenses.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { summarizeExpenses } from '../src/lib/expenses/calc.ts'
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
  ['expense_categories', 'expenses'],
  'supabase/migrations/0009_expense_categories.sql',
)

const { creds, userId } = await signInTestAccount(supabase, import.meta.url, step)

// 1) التصنيفات الافتراضية موجودة ومقروءة.
const cats = rowsOf(
  await supabase.from('expense_categories').select('*').order('sort_order'),
  'قراءة التصنيفات',
  step,
)
if (!cats) finish()

const defaults = cats.filter((c) => c.user_id === null)
step('التصنيفات الافتراضية', defaults.length >= 12, `${defaults.length} تصنيف`)
step('لكل تصنيف أيقونة', allOf(defaults, (c) => c.icon?.length > 0))

// 2) تصنيف خاص بالمستخدم.
const { data: mine, error: mineErr } = await supabase
  .from('expense_categories')
  .insert({ user_id: userId, name_ar: 'فحص آلي', icon: '🧪', sort_order: 900 })
  .select()
  .single()
step('إضافة تصنيف خاص', !mineErr && Boolean(mine?.id), mineErr?.message ?? '')

// 3) الافتراضي محميّ من الحذف: سياسة الحذف مقيّدة بـ user_id.
const target = defaults[0]
const { error: delErr } = await supabase
  .from('expense_categories')
  .delete()
  .eq('id', target.id)
// select عادي لا head: الأخير يبتلع رسالة الخطأ فيبدو الصف المفقود موجوداً.
const { data: stillThere } = await supabase
  .from('expense_categories')
  .select('id')
  .eq('id', target.id)
step('التصنيف الافتراضي لا يُحذف', (stillThere ?? []).length === 1, delErr ? delErr.message : 'الصف باقٍ')

// 4) تسجيل مصاريف في الشهر الجاري.
const today = new Date()
const month = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
const day = (n) =>
  new Date(today.getFullYear(), today.getMonth(), n).toISOString().slice(0, 10)

const food = defaults.find((c) => c.name_ar.includes('أكل')) ?? defaults[0]
const fuel = defaults.find((c) => c.name_ar.includes('بنزين')) ?? defaults[1]

const rowsToInsert = [
  { amount: 45, category_id: food.id, spent_at: day(1), is_unexpected: false },
  { amount: 55, category_id: food.id, spent_at: day(2), is_unexpected: false },
  { amount: 300, category_id: fuel.id, spent_at: day(3), is_unexpected: false },
  { amount: 600, category_id: mine?.id ?? null, spent_at: day(3), is_unexpected: true },
].map((r) => ({ ...r, user_id: userId }))

const { data: inserted, error: insErr } = await supabase
  .from('expenses')
  .insert(rowsToInsert)
  .select()
step('تسجيل 4 مصاريف', !insErr && inserted?.length === 4, insErr?.message ?? '')

// 5) القراءة بحدود الشهر تُرجع ما سُجّل فقط.
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  .toISOString()
  .slice(0, 10)
const fetched = rowsOf(
  await supabase.from('expenses').select('*').gte('spent_at', month).lte('spent_at', monthEnd),
  'قراءة مصاريف الشهر',
  step,
)
if (!fetched) finish()
step('قراءة مصاريف الشهر', fetched.length >= 4, `${fetched.length} صف`)

// 6) التلخيص يطابق ما أُدخل — المحرّك نفسه الذي تستعمله الشاشة.
const summary = summarizeExpenses(
  fetched.map((e) => ({
    amount: Number(e.amount),
    spentAt: e.spent_at,
    categoryId: e.category_id,
    isUnexpected: e.is_unexpected,
  })),
  new Date(`${month}T00:00:00`),
  today,
)
step('المجموع صحيح', summary.total === 1000, `${summary.total} ₪`)
step('المفاجئ مفصول', summary.unexpectedTotal === 600, `${summary.unexpectedTotal} ₪`)
step(
  'الأثقل أولاً',
  summary.byCategory[0]?.total === 600 && summary.byCategory[1]?.total === 300,
  summary.byCategory.map((c) => c.total).join(' > '),
)
step('الأكل مجموع في سلّة واحدة', summary.byCategory.find((c) => c.categoryId === food.id)?.total === 100)
step('الإسقاط موجب ومعقول', summary.projectedTotal >= summary.total, `${summary.projectedTotal} ₪`)

// 7) عزل RLS: بلا جلسة لا يظهر شيء.
await supabase.auth.signOut()
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data: leaked } = await anon.from('expenses').select('id')
step('لا تسرّب بلا جلسة', (leaked ?? []).length === 0, `${(leaked ?? []).length} صف`)

// 8) تنظيف.
await supabase.auth.signInWithPassword(creds)
await supabase.from('expenses').delete().in('id', (inserted ?? []).map((r) => r.id))
if (mine?.id) await supabase.from('expense_categories').delete().eq('id', mine.id)
const { data: left } = await supabase.from('expenses').select('id').gte('spent_at', month)
step('تنظيف', true, `بقي ${(left ?? []).length} مصروف سابق`)

finish()
