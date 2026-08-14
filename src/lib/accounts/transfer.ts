/**
 * التحويل بين الحسابات: قرار الرصيد وقرار إغلاق التسويات.
 *
 * الكتابة تختلف بين السطحين (عميل المتصفّح وعميل الخادم)، والقرار لا يختلف —
 * وكان منسوخاً حرفياً في `features/accounts/api.ts` و`mcp/tools/write.ts`
 * (تدقيق آب 2026: س12). النسختان متطابقتان يوم كُتبتا، وتنحرفان صامتتين يوم
 * يُعدَّل أحدهما وحده: تحويلٌ يُغلق تسويةً هنا ولا يُغلقها هناك.
 *
 * ملف نقي: لا React ولا Supabase.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * الرصيد بعد حركةٍ موجبةٍ أو سالبة.
 *
 * قراءةٌ ثم كتابة لا `balance = balance + x`: ‏PostgREST لا يكتب تعبيراً على
 * عمود. والتقريب هنا لا عند كل مستدعٍ — قرشٌ ضائع في مسارٍ واحد يجعل رصيد
 * الحساب يختلف باختلاف الباب الذي دخل منه المال.
 */
export function nextBalance(current: number | string, delta: number): number {
  const base = Number(current)
  return round2((Number.isFinite(base) ? base : 0) + (Number.isFinite(delta) ? delta : 0))
}

export interface SettlementRow {
  id: string
  amount: number | string
  debtorAccountId: string
  creditorAccountId: string
}

/**
 * أي التسويات المفتوحة يسدّدها هذا التحويل.
 *
 * التسوية تقول «A مدين لـ B بكذا»، والتحويل A→B بالمبلغ نفسه أو أكثر يسدّدها.
 * والإغلاق كاملٌ لا جزئي: تسويةٌ نصف مسدّدة رقمٌ لا يعرف صاحبه ماذا يفعل به،
 * وتحويلٌ أصغر منها يبقيها كما هي حتى يكتمل. والأقدم أولاً — تُمرَّر مرتّبةً
 * بتاريخ الإنشاء: من عليه تسويتان يسدّد أولاهما بأول تحويل.
 */
export function settlementsClosedBy<T extends SettlementRow>(
  open: readonly T[],
  transfer: { fromAccountId: string; toAccountId: string; amount: number },
): T[] {
  let budget = Number.isFinite(transfer.amount) ? transfer.amount : 0
  const closed: T[] = []

  for (const row of open) {
    if (
      row.debtorAccountId !== transfer.fromAccountId ||
      row.creditorAccountId !== transfer.toAccountId
    ) {
      continue
    }
    const amount = Number(row.amount)
    if (!Number.isFinite(amount) || amount > budget) continue
    budget = round2(budget - amount)
    closed.push(row)
  }

  return closed
}
