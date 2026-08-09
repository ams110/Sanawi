/**
 * قبضات الدخل موزّعةً على مصادرها — لأي مدى من الزمن.
 * ملف نقي — لا React ولا Supabase.
 *
 * «قديش قبضت من الوظيفة وقديش من الشغل الحرّ؟» سؤالٌ لم يكن له جواب في
 * التطبيق: التفصيل بالمصدر كان للشهر الحالي وحده، وعند كلود وحده. وكان فيه
 * ثقب: القبضة المربوطة بمصدرٍ مؤرشف تدخل المجموع وتغيب عن كل تفصيل — مالٌ
 * وصل فعلاً ولا يظهر تحت أي اسم، فيقرأ صاحبه «المجموع 700 وكل المصادر صفر».
 */

export interface BySourceSource {
  id: string
  name: string
  /** المؤرشف يُوسم ولا يُخفى — المال الذي وصل عليه وصل فعلاً. */
  isActive?: boolean
}

export interface BySourceEntry {
  amount: number
  sourceId: string | null
  /** تسمية القبضة الحرّة — «هدية»، «بيع غرض». */
  name: string | null
}

export interface SourceTotal {
  /** معرّف المصدر، أو التسمية الحرّة، أو 'unsourced' — مفتاح عرضٍ ثابت. */
  key: string
  /** `null` = قبضاتٌ بلا مصدرٍ ولا اسم — الواجهة تسمّيها لا المحرّك. */
  name: string | null
  total: number
  count: number
  isArchived: boolean
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/**
 * التجميع بالمصدر، والحرّ بتسميته، والمجهول في سلّةٍ واحدة مسمّاة في الواجهة.
 * الترتيب بالمجموع نزولاً: أول سطرٍ يجيب عن «من وين أكثر مصريّاتي؟».
 */
export function summarizeBySource(
  entries: readonly BySourceEntry[],
  sources: readonly BySourceSource[],
): SourceTotal[] {
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const buckets = new Map<string, SourceTotal>()

  for (const entry of entries) {
    const source = entry.sourceId ? sourceById.get(entry.sourceId) : undefined
    // مصدرٌ معروف، وإلا فالتسمية الحرّة، وإلا سلّة «بلا مصدر» — لا قبضة تسقط.
    const key = source ? source.id : (entry.name?.trim() ? `name:${entry.name.trim()}` : 'unsourced')
    const name = source ? source.name : (entry.name?.trim() || null)

    const bucket = buckets.get(key) ?? {
      key,
      name,
      total: 0,
      count: 0,
      isArchived: source ? source.isActive === false : false,
    }
    bucket.total = round2(bucket.total + entry.amount)
    bucket.count += 1
    buckets.set(key, bucket)
  }

  return [...buckets.values()].sort(
    (a, b) => b.total - a.total || (a.name ?? '').localeCompare(b.name ?? '', 'ar'),
  )
}

export function totalOf(rows: readonly SourceTotal[]): number {
  return round2(rows.reduce((sum, r) => sum + r.total, 0))
}
