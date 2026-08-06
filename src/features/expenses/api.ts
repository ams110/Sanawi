import { supabase } from '@/lib/supabase'
import type { Expense, ExpenseCategory } from '@/lib/db/types'
import type { ExpenseRow } from '@/lib/expenses/calc'
import { toDateKey, toMonthKey } from '@/lib/date'

/** أول يوم في الشهر بصيغة ISO — مفتاح الشهر نفسه المستعمل في الفواتير. */
export function monthKey(date: Date = new Date()): string {
  return toMonthKey(date)
}

export function shiftMonth(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00`)
  d.setMonth(d.getMonth() + delta)
  return monthKey(d)
}

/** اليوم الأخير في شهر المفتاح — حدّ الاستعلام الأعلى. */
function monthEnd(key: string): string {
  const d = new Date(`${key}T00:00:00`)
  return toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/**
 * التصنيفات: الافتراضية والخاصة معاً في استعلام واحد.
 *
 * سياسة القراءة في القاعدة تضمّ الاثنين، فلا حاجة لاستعلامين ولا لدمجٍ
 * في الواجهة. الترتيب بـ sort_order ثم الاسم حتى لا يقفز الترتيب بين
 * تصنيفين لهما الرقم نفسه.
 */
export async function listCategories(): Promise<ExpenseCategory[]> {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name_ar', { ascending: true })
  if (error) throw error
  return (data ?? []) as ExpenseCategory[]
}

export async function addCategory(
  userId: string,
  input: { nameAr: string; icon: string },
): Promise<ExpenseCategory> {
  const { data, error } = await supabase
    .from('expense_categories')
    .insert({
      user_id: userId,
      name_ar: input.nameAr,
      icon: input.icon,
      // بعد الافتراضية كلها: تصنيفات المستخدم تظهر في ذيل القائمة لا وسطها.
      sort_order: 900,
    })
    .select()
    .single()
  if (error) throw error
  return data as ExpenseCategory
}

export async function listExpenses(month: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .gte('spent_at', month)
    .lte('spent_at', monthEnd(month))
    .order('spent_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Expense[]
}

export async function addExpense(
  userId: string,
  input: {
    amount: number
    categoryId: string | null
    /** اسم التصنيف كما يقرأه المستخدم — يُكتب مع المعرّف لا بدله. */
    categoryName?: string | null
    spentAt: string
    isUnexpected: boolean
    note?: string | null
  },
): Promise<void> {
  /*
   * العمودان معاً.
   *
   * كان التطبيق يكتب `category_id` وحده وكلود يكتب `category` وحده، فلا يرى
   * أحدهما ما كتبه الآخر: شاشة المصاريف تصنّف بالمعرّف فلا ترى ما سجّله
   * كلود، و`sanawi_group_cost` يرشّح بالنصّ فلا يرى ما سجّلته الشاشة —
   * فتخرج «التكلفة الحقيقية للسيارة» ناقصةً بمقدار ما سُجّل من الجهة الأخرى.
   */
  const { error } = await supabase.from('expenses').insert({
    user_id: userId,
    amount: input.amount,
    category_id: input.categoryId,
    category: input.categoryName ?? null,
    spent_at: input.spentAt,
    is_unexpected: input.isUnexpected,
    note: input.note ?? null,
  })
  if (error) throw error
}

export async function updateExpense(
  id: string,
  patch: {
    amount?: number
    categoryId?: string | null
    spentAt?: string
    isUnexpected?: boolean
    note?: string | null
  },
): Promise<void> {
  const row: Partial<Expense> = {}
  if (patch.amount !== undefined) row.amount = patch.amount
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId
  if (patch.spentAt !== undefined) row.spent_at = patch.spentAt
  if (patch.isUnexpected !== undefined) row.is_unexpected = patch.isUnexpected
  if (patch.note !== undefined) row.note = patch.note

  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('expenses').update(row).eq('id', id)
  if (error) throw error
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) throw error
}

/** تحويل صفوف القاعدة إلى مدخلات محرّك الحساب — الأرقام نصوص في PostgREST. */
export function toCalcRows(rows: readonly Expense[]): ExpenseRow[] {
  return rows.map((e) => ({
    amount: Number(e.amount),
    spentAt: e.spent_at,
    categoryId: e.category_id,
    isUnexpected: e.is_unexpected,
  }))
}
