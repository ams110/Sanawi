/**
 * فحص المصاريف اليومية على قاعدة بيانات حقيقية:
 * التصنيفات الافتراضية → تصنيف خاص → تسجيل مصاريف → التلخيص → عزل RLS → تنظيف.
 *
 * التشغيل: node scripts/check-expenses.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { summarizeExpenses } from '../src/lib/expenses/calc.ts'

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
  console.log('❌ لا حساب فحص محفوظ — شغّل scripts/check-flow.mjs أولاً')
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

// 1) التصنيفات الافتراضية موجودة ومقروءة.
const { data: cats, error: catsErr } = await supabase
  .from('expense_categories')
  .select('*')
  .order('sort_order')
if (catsErr) {
  step('قراءة التصنيفات', false, catsErr.message)
  process.exit(1)
}
const defaults = cats.filter((c) => c.user_id === null)
step('التصنيفات الافتراضية', defaults.length >= 12, `${defaults.length} تصنيف`)
step('لكل تصنيف أيقونة', defaults.every((c) => c.icon?.length > 0))

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
const { count: stillThere } = await supabase
  .from('expense_categories')
  .select('id', { count: 'exact', head: true })
  .eq('id', target.id)
step('التصنيف الافتراضي لا يُحذف', stillThere === 1, delErr ? delErr.message : 'الصف باقٍ')

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
const { data: fetched, error: fetchErr } = await supabase
  .from('expenses')
  .select('*')
  .gte('spent_at', month)
  .lte('spent_at', monthEnd)
step('قراءة مصاريف الشهر', !fetchErr && fetched.length >= 4, fetchErr?.message ?? `${fetched?.length} صف`)

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
const { count: left } = await supabase
  .from('expenses')
  .select('id', { count: 'exact', head: true })
  .gte('spent_at', month)
step('تنظيف', true, `بقي ${left ?? 0} مصروف سابق`)

console.log(failures === 0 ? '\n✅ كل الفحوص نجحت' : `\n❌ ${failures} فحص فشل`)
process.exit(failures === 0 ? 0 : 1)
