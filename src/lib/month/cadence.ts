/**
 * عادة المصدر — مُتعلَّمة من سجلّه، لا مكتوبةً بيد.
 *
 * بعد أن صار الواصل هو الأساس، صارت قائمة «مصادر ما سجّلت منها» تنبّه على
 * كل مصدرٍ بلا قبضة هذا الشهر. وذلك يكذب مرّتين:
 *
 * ١. **مصدرٌ يجيء كل ثلاثة شهور** يظهر فيها شهرين من كل ثلاثة، وهو ليس
 *    متأخّراً في شيء.
 * ٢. **مصدرٌ لم يصل منه شيءٌ قطّ** يظهر إلى الأبد، والتطبيق لا يملك سبباً
 *    واحداً للاعتقاد بأن شيئاً منه مستحقّ.
 *
 * وقائمةٌ تنبّه بلا سبب تدرّب صاحبها على تجاهلها — وهي نفس العلّة التي
 * حكمت `pending.ts` من أوّلها: «تحذيرٌ بلا زرّ يدرّب صاحبه على تجاهل
 * التحذيرات».
 *
 * **فالتطبيق لا يدّعي إلا ما تعلّمه.** لا وتيرةَ مكتوبة بيد — تلك هي الغلطة
 * التي أُلغي الدخل المتوقَّع كلّه لأجلها (`docs/income-actual-plan.md`) —
 * بل الفجوة المعتادة بين قبضةٍ وأخرى، مقروءةً من `income_entries` نفسها.
 * فمن يقبض شهرياً يُذكَّر بعد شهر، ومن يقبض ربعياً يُذكَّر بعد ثلاثة، ومن لم
 * يقبض قطّ لا يُذكَّر بشيء.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

export interface CadenceInput {
  /**
   * مفاتيح الشهور `YYYY-MM` التي وصلت فيها قبضةٌ من هذا المصدر — بأي ترتيب.
   * تكرار الشهر لا يضرّ: قبضتان في شهرٍ واحد شهرٌ واحد.
   */
  entryMonths: readonly string[]
  /** الشهر الجاري `YYYY-MM`. */
  thisMonth: string
}

/** ترتيب الشهر على محورٍ واحد — يعبر حدّ السنة بلا حالةٍ خاصّة. (قاعدة 7) */
function monthIndex(key: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return Number(m[1]) * 12 + (month - 1)
}

/**
 * الوسيط الأعلى لا الأدنى.
 *
 * الميل إلى الصمت مقصود: التنبيه الكاذب هو العطل الذي وُلدت هذه الدالّة
 * لإصلاحه، والتأخّر في التذكير يكلّف دقّةَ رقمٍ ليومين — أمّا التنبيه بلا
 * سبب فيكلّف القائمةَ كلَّها مصداقيّتها.
 */
function upperMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * هل يُذكَّر بهذا المصدر هذا الشهر؟
 *
 * السقف `2 × العادة` يُسكت المصدر الميت: من ترك شغلاً ولم يؤرشف مصدره لا
 * يستحقّ سطراً أبدياً في شاشته الأولى — والأرشفة موجودة لمن أراد الحسم.
 */
export function shouldRemind(input: CadenceInput): boolean {
  const now = monthIndex(input.thisMonth)
  if (now === null) return false

  // فريدة ومرتّبة تنازلياً: الأحدث أولاً.
  const months = [...new Set(input.entryMonths)]
    .map(monthIndex)
    .filter((i): i is number => i !== null)
    .sort((a, b) => b - a)

  // سُجّل هذا الشهر: لا شيء يُنتظر. ولا سجلَّ أصلاً: لا شيء يُدَّعى.
  if (months.length === 0 || months[0]! >= now) return false

  const since = now - months[0]!

  // الفجوات بين القبضات المتتالية — وبقبضةٍ واحدة لا فجوة تُقاس، فالافتراض
  // شهرٌ: أقربُ العادات إلى الظنّ، وأقصرُها فلا يطول الصمت على خطأ.
  const gaps: number[] = []
  for (let i = 0; i < months.length - 1; i++) gaps.push(months[i]! - months[i + 1]!)
  const usual = gaps.length > 0 ? upperMedian(gaps) : 1

  return since >= usual && since <= usual * 2
}
