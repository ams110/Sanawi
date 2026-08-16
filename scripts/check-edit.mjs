/**
 * فحص التعديل على قاعدة حقيقية:
 * كل نوعٍ يُنشأ، يُعدَّل حقلٌ منه، ويُتحقَّق أن الباقي لم يتغيّر.
 *
 * التشغيل: npm run check:edit
 */
import { createClient } from '@supabase/supabase-js'
import { createReporter, readEnv, requireTables, rowsOf, signInTestAccount } from './lib/checks.mjs'

const env = readEnv(import.meta.url)
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { step, finish } = createReporter()

await requireTables(supabase, [
  'fixed_commitments',
  'expenses',
  'income_entries',
  'income_sources',
  'expense_categories',
])

const { userId } = await signInTestAccount(supabase, import.meta.url, step)
const today = new Date().toISOString().slice(0, 10)

/** يعدّل صفاً ويعيد قراءته. */
async function patchAndRead(table, id, patch) {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error) return { error }
  const rows = rowsOf(await supabase.from(table).select('*').eq('id', id), `قراءة ${table}`, step)
  return { row: rows?.[0] ?? null }
}

// ── البند الشهري ────────────────────────────────────────────────────────
const { data: bill } = await supabase
  .from('fixed_commitments')
  .insert({
    user_id: userId,
    name: 'بند قبل التعديل',
    amount: 300,
    day_of_month: 5,
    my_share_percent: 60,
  })
  .select()
  .single()
step('إنشاء بند', Boolean(bill?.id))

const billAfter = await patchAndRead('fixed_commitments', bill.id, {
  name: 'بند بعد التعديل',
  amount: 450,
  day_of_month: 20,
})
step('تعديل اسم البند ومبلغه وموعده', billAfter.row?.name === 'بند بعد التعديل' && Number(billAfter.row?.amount) === 450 && billAfter.row?.day_of_month === 20)
// أهمّ فحص: التعديل الجزئي لا يمسّ ما لم يُرسَل.
step('الحصة لم تتأثّر بتعديل جزئي', Number(billAfter.row?.my_share_percent) === 60, `${billAfter.row?.my_share_percent}%`)

// تحويل بندٍ عادي إلى قسط بتاريخ نهاية، ثم إرجاعه.
const end = new Date()
end.setMonth(end.getMonth() + 5)
const endsOn = end.toISOString().slice(0, 10)
const toLoan = await patchAndRead('fixed_commitments', bill.id, { ends_on: endsOn })
step('بند عادي يصير قسطاً', toLoan.row?.ends_on === endsOn, endsOn)
const backToPlain = await patchAndRead('fixed_commitments', bill.id, { ends_on: null })
step('والقسط يرجع بنداً بلا نهاية', backToPlain.row?.ends_on === null)

// تاريخ البدء: يُضبط، ثم يُمسح — و`null` قيمةٌ مقصودة لا غياب.
//
// كان هذا المسار غير قابل للاختبار أصلاً لأن أي شاشة لم تكن تكتب العمود،
// فبقيت فروع `startsOn` في طبقة البيانات كوداً ميتاً لا يمرّ به أحد.
const start = new Date()
start.setMonth(start.getMonth() + 2)
const startsOn = start.toISOString().slice(0, 10)
const toDeferred = await patchAndRead('fixed_commitments', bill.id, { starts_on: startsOn })
step('بندٌ يكتسب تاريخ بدء', toDeferred.row?.starts_on === startsOn, startsOn)

// والعرض يتبع الجدول: has_started تُشتقّ لا تُخزَّن.
const deferredView = rowsOf(
  await supabase.from('commitment_details').select('*').eq('commitment_id', bill.id),
  'قراءة العرض بعد تأجيل البدء',
  step,
)
step('العرض يعلن أنه لم يبدأ', deferredView?.[0]?.has_started === false, `${deferredView?.[0]?.has_started}`)

const startCleared = await patchAndRead('fixed_commitments', bill.id, { starts_on: null })
step('ومسحُ التاريخ يعيده مبتدئاً', startCleared.row?.starts_on === null)
const startedView = rowsOf(
  await supabase.from('commitment_details').select('*').eq('commitment_id', bill.id),
  'قراءة العرض بعد مسح البدء',
  step,
)
step('والعرض يوافق', startedView?.[0]?.has_started === true, `${startedView?.[0]?.has_started}`)

// القاعدة تحرس الموعد حتى في التعديل لا الإنشاء وحده.
const badDay = await patchAndRead('fixed_commitments', bill.id, { day_of_month: 99 })
step('التعديل ليوم 99 مرفوض', Boolean(badDay.error), badDay.error ? 'مرفوض' : 'قُبل!')

// الأرشفة تخفيه ولا تمحو تاريخه.
await supabase.from('fixed_commitments').update({ is_active: false }).eq('id', bill.id)
const archived = rowsOf(
  await supabase.from('fixed_commitments').select('*').eq('id', bill.id),
  'قراءة بعد الأرشفة',
  step,
)
step('الأرشفة تُبقي الصف', (archived ?? []).length === 1 && archived[0].is_active === false)
const inViews = rowsOf(
  await supabase.from('commitment_details').select('*').eq('commitment_id', bill.id),
  'قراءة العرض',
  step,
)
step('المؤرشف يختفي من العرض', (inViews ?? []).length === 0)

// ── المصروف اليومي ──────────────────────────────────────────────────────
const cats = rowsOf(
  await supabase.from('expense_categories').select('*').is('user_id', null).limit(2),
  'قراءة التصنيفات',
  step,
)
const { data: exp } = await supabase
  .from('expenses')
  .insert({
    user_id: userId,
    amount: 50,
    category_id: cats?.[0]?.id ?? null,
    spent_at: today,
    is_unexpected: false,
  })
  .select()
  .single()
step('إنشاء مصروف', Boolean(exp?.id))

const expAfter = await patchAndRead('expenses', exp.id, {
  amount: 75,
  category_id: cats?.[1]?.id ?? null,
  is_unexpected: true,
})
step('تعديل مبلغ المصروف وتصنيفه', Number(expAfter.row?.amount) === 75 && expAfter.row?.category_id === cats?.[1]?.id)
step('خانة المفاجئ تتبدّل', expAfter.row?.is_unexpected === true)
step('التاريخ لم يتغيّر بتعديل لم يشمله', expAfter.row?.spent_at === today)

// ── دفعة الدخل ──────────────────────────────────────────────────────────
const { data: src } = await supabase
  .from('income_sources')
  .insert({ user_id: userId, name: 'مصدر قبل' })
  .select()
  .single()
const { data: entry } = await supabase
  .from('income_entries')
  .insert({ user_id: userId, source_id: src.id, amount: 900, received_at: today })
  .select()
  .single()
step('إنشاء دفعة دخل', Boolean(entry?.id))

const entryAfter = await patchAndRead('income_entries', entry.id, { amount: 1100, source_id: null })
step('تعديل مبلغ الدفعة ومصدرها', Number(entryAfter.row?.amount) === 1100 && entryAfter.row?.source_id === null)

const zeroed = await patchAndRead('income_entries', entry.id, { amount: 0 })
step('التعديل لصفر مرفوض', Boolean(zeroed.error), zeroed.error ? 'مرفوض' : 'قُبل!')

// ── مصدر الدخل ──────────────────────────────────────────────────────────
//
// الاسم وحده يُعدَّل. كانت هنا فحوصٌ لـ`amount` و`frequency` و`is_variable`،
// وقد صارت أعمدةً موروثة لا يكتبها التطبيق ولا يقرؤها محرّك (هجرة 0022) —
// وفحصُ عمودٍ ميت يوحي بأنه حيّ.
const srcAfter = await patchAndRead('income_sources', src.id, { name: 'مصدر بعد' })
step('إعادة تسمية المصدر', srcAfter.row?.name === 'مصدر بعد', `${srcAfter.row?.name}`)

// ── تنظيف ───────────────────────────────────────────────────────────────
await supabase.from('income_entries').delete().eq('id', entry.id)
await supabase.from('income_sources').delete().eq('id', src.id)
await supabase.from('expenses').delete().eq('id', exp.id)
await supabase.from('fixed_commitments').delete().eq('id', bill.id)
step('تنظيف', true)

finish()
