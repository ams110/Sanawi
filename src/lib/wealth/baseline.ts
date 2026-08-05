/**
 * خطّ الأساس للمصروف — الرقم الذي يُبنى عليه العمر لا الشهر.
 *
 * لوحة الشهر تُسقط الوتيرة عمداً: «صرفتَ 800 في يومين، وهذه وتيرةٌ تنتهي بك
 * إلى 12 ألفاً» تحذيرٌ صادقٌ ونافع. لكن رقم الحرية وصندوق الطوارئ يقيسان
 * عمراً لا شهراً، وإسقاطُ يومٍ واحدٍ عليهما كارثة: طلعةُ تسوّقٍ بـ800 في أول
 * الشهر تُضرب في ثلاثين فيقفز المصروف السنوي بربع مليون، ورقمُ الحرية
 * بستّة ملايين — ثم يعود كلُّه بعد أسبوع. رقمٌ يتأرجح بهذا القدر لأنّ اليوم
 * هو الأول لا يُبنى عليه قرار.
 *
 * فالأساس هنا من الشهور المكتملة وحدها: انقضت فلا تُسقَط، ومتوسّطها يبتلع
 * شهر العيد وشهر السفر معاً. ولا يُلجأ إلى الشهر الجاري إلا حين لا يوجد
 * شهرٌ مكتملٌ واحد — وعندها يُقال للمستخدم إن الرقم مبدئيّ.
 *
 * ملف نقي — لا React ولا Supabase.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100

export interface SpendingBaselineInput {
  /**
   * مجاميع الشهور المكتملة، الأحدث أولاً. الشهر الجاري ليس منها.
   *
   * ‏`null` تعني «لا سجلّ لهذا الشهر» لا «صُرف فيه صفر»، والفرق بينهما هو
   * الفرق بين خطّ أساسٍ صحيح وآخر يساوي صفراً. من فتح التطبيق اليوم ليس
   * له شهرٌ ماضٍ، وقراءةُ غيابه صفراً تجعل مصروفه السنوي صفراً ورقمَ حريته
   * صفراً — فيقول له التطبيق «وصلت» وهو لم يبدأ.
   *
   * أما الصفر الصريح فقيمةٌ صحيحة تدخل المتوسط: شهرٌ لم يُصرَف فيه شيء
   * شهرٌ رخيص لا شهرٌ مفقود.
   */
  completedMonths: readonly (number | null)[]
  /** إسقاط الشهر الجاري — لا يُستعمل إلا حين لا شهر مكتمل. */
  currentMonthProjection: number
  /** كم شهراً مكتملاً ندخل في المتوسط على الأكثر. */
  window?: number
}

export interface SpendingBaseline {
  /** المصروف اليومي الشهري المعتمد. */
  monthly: number
  /** عدد الشهور المكتملة التي دخلت المتوسط. */
  monthsUsed: number
  /**
   * الرقم مبنيٌّ على شهرٍ لم ينتهِ بعد، فهو تقديرٌ مبدئي.
   * تُقال للمستخدم صراحةً: رقمٌ يتحرّك غداً يجب أن يُعلَن أنه يتحرّك.
   */
  isProvisional: boolean
}

const DEFAULT_WINDOW = 3

export function spendingBaseline(input: SpendingBaselineInput): SpendingBaseline {
  const window = Math.max(1, Math.floor(input.window ?? DEFAULT_WINDOW))
  const months = input.completedMonths
    .filter((total): total is number => total !== null && Number.isFinite(total) && total >= 0)
    .slice(0, window)

  if (months.length === 0) {
    return {
      monthly: round2(Math.max(0, finite(input.currentMonthProjection))),
      monthsUsed: 0,
      isProvisional: true,
    }
  }

  const sum = months.reduce((total, month) => total + month, 0)
  return {
    monthly: round2(sum / months.length),
    monthsUsed: months.length,
    isProvisional: false,
  }
}

const finite = (n: number): number => (Number.isFinite(n) ? n : 0)
