/**
 * رقم الحرية وتاريخها.
 *
 * رقمُ الحرية هو رأس المال الذي يكفي السحبُ الآمن منه لتغطية مصروف سنةٍ كاملة،
 * وتاريخُها هو اليوم الذي يبلغه مسارك الحالي لو بقي على وتيرته. هذان الرقمان
 * وحدهما يحوّلان «ادّخر» إلى جملةٍ لها معنى.
 *
 * وكلاهما محسوبٌ هنا بقيمة اليوم — أي بالعائد الحقيقي بعد خصم التضخّم لا
 * بالعائد الاسمي. الإسقاط الأعمى عن التضخّم يَعِد بثروةٍ لا تشتري ما وعدت به:
 * مليونٌ بعد ثلاثين سنة رقمٌ فخم على الشاشة وهو في السوق نصف مليون. والسبب
 * الأدقّ أن المصروف السنوي يدخل بقيمة اليوم، فلو نمَت الأصول اسمياً وبقي
 * المصروف حقيقياً لقارنّا عملتين مختلفتين وسمّينا الفرق حرية.
 *
 * الثمن المقبول لهذا الاختيار: التاريخ الخارج من هنا متشائمٌ قليلاً مقارنةً
 * بالحاسبات التي تعرض أرقاماً اسمية — والتشاؤم في هذا الموضع أمانة لا عيب.
 */

import { addMonths } from 'date-fns'

const round2 = (n: number): number => Math.round(n * 100) / 100

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

/**
 * سقفُ حجمٍ للمُدخَل، لا سقفُ صدقٍ فقط.
 *
 * ردُّ NaN و∞ عند الباب لا يكفي: ∞ يُولَد بعد الباب أيضاً. مصروفٌ محدود
 * بحجم 1e307 يصير ∞ بمجرّد ضربه في مئة، فيخرج `target = ∞` من دالةٍ كلُّ
 * مُدخَلاتها محدودة — وهو ما تَعِد هذه الوحدة بألّا يقع. وثروةٌ فوق تريليون
 * ليست ثروةً بل خطأ إدخال، فقصُّها أصدق من إخراج ∞ باسمها.
 */
const MAX_MAGNITUDE = 1e12

/**
 * كل مُدخَلٍ يمرّ من هنا أولاً.
 *
 * الأرقام تصل من قاعدة البيانات ومن حقول الإدخال، وقسمةٌ واحدة على صفرٍ في
 * مصدرها تكفي لتسريب NaN إلى الشاشة. وNaN لا يظهر خطأً بل يظهر فراغاً أو
 * «—»، فيظنّ المستخدم أن التطبيق لا يعرف بدل أن يعرف أن المُدخَل خطأ.
 * التعقيم عند البوابة أرخص من حراسة كل عملية بعدها.
 */
const finite = (n: number | undefined, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? clamp(n, -MAX_MAGNITUDE, MAX_MAGNITUDE) : fallback

/**
 * أدنى معدّل سحبٍ مسموح به.
 *
 * السحب صفراً يعني رأس مالٍ لا نهائي، والنتيجة ∞ لا تُعرَض ولا تُقرأ. نقيّده
 * إلى ٠٫١٪ (= المصروف السنوي × ألف) بدل أن نرمي خطأً: رقمٌ هائل ظاهرٌ يقول
 * للمستخدم إن مُدخَله لا معنى له، وشاشةٌ فارغة لا تقول شيئاً.
 */
const MIN_WITHDRAWAL_RATE = 0.1

/** سقفٌ للسقف: maxYears يأتي من الخارج، وعمرٌ بشريّ لا يحتاج أكثر من قرنين. */
const MAX_SEARCH_YEARS = 200

export interface FreedomInput {
  /** المصروف السنوي بقيمة اليوم. */
  annualSpending: number
  /** صافي الثروة الآن. */
  currentNetWorth: number
  /** ما يُضاف شهرياً إلى الأصول. */
  monthlyContribution: number
  /** العائد السنوي الاسمي المتوقّع. */
  annualReturnPercent: number
  /** التضخّم المفترض. */
  inflationPercent?: number
  /** معدّل السحب الآمن. */
  withdrawalRatePercent?: number
  /** سقف البحث بالسنوات — بعده نقول "لا يُبلَغ" بدل أن ندور بلا نهاية. */
  maxYears?: number
  today?: Date
}

export interface FreedomResult {
  /** رقم الحرية: المصروف السنوي ÷ معدّل السحب. */
  target: number
  /** ما بلغتَه منه، 0..1 (مقيَّد بـ 1). */
  coverage: number
  /** الدخل السلبي الشهري من ثروتك اليوم. */
  passiveIncomeNow: number
  /** كم شهراً من كل اثني عشر يشتريه دخلك السلبي — بكسوره، وبلا سقف. */
  monthsCoveredNow: number
  /** الشهور حتى بلوغ الرقم. فارغ = لا يُبلَغ ضمن السقف. */
  monthsToFreedom: number | null
  yearsToFreedom: number | null
  freedomDate: Date | null
  isFree: boolean
  /** العائد الحقيقي المستعمَل: ((1+اسمي)/(1+تضخّم))-1، بالمئة. */
  realReturnPercent: number
  /** ما ينقصك من رأس المال اليوم. */
  shortfall: number
}

export function freedomNumber(annualSpending: number, withdrawalRatePercent = 4): number {
  const spending = Math.max(0, finite(annualSpending, 0))
  if (spending <= 0) return 0
  const rate = Math.max(MIN_WITHDRAWAL_RATE, finite(withdrawalRatePercent, 4))
  return round2((spending * 100) / rate)
}

export function projectFreedom(input: FreedomInput): FreedomResult {
  // تاريخٌ فاسد يمرّ من `??` بلا اعتراض ثم يخرج «Invalid Date» في حقلٍ يُعرَض؛
  // تعقيم الأرقام وحده لا يحرس التاريخ.
  const today =
    input.today instanceof Date && !Number.isNaN(input.today.getTime()) ? input.today : new Date()

  const annualSpending = Math.max(0, finite(input.annualSpending, 0))
  const netWorth = finite(input.currentNetWorth, 0)
  const contribution = finite(input.monthlyContribution, 0)
  const nominal = finite(input.annualReturnPercent, 0)
  const withdrawalRate = Math.max(MIN_WITHDRAWAL_RATE, finite(input.withdrawalRatePercent, 4))
  // تضخّم −١٠٠٪ يقسم على صفر؛ نقيّده قبل القسمة لا بعدها.
  const inflation = Math.max(-99, finite(input.inflationPercent, 3))

  const real = (1 + nominal / 100) / (1 + inflation / 100) - 1

  /**
   * المعدّل الشهري جذرٌ هندسيّ للسنوي، لا قسمةً على اثني عشر.
   *
   * القسمة تُركّب الفائدة اثنتي عشرة مرة فتُخرج أكثر ممّا وُعد به: ٧٪ سنوياً
   * تصير ٧٫٢٣٪ فعلياً. الفرق تافه في سنة، وعبر ثلاثين سنة يقصّر التاريخَ
   * بشهورٍ كاملة — أي يَعِد المستخدم بحرّيةٍ قبل أوانها. الجذر يعيد بالضبط
   * ما أدخله المستخدم، ولا شيء غيره.
   *
   * وقاعدة القوّة مقيَّدة بالصفر: عائدٌ حقيقيّ أسوأ من −١٠٠٪ يجعل الأساس
   * سالباً وجذرَه NaN، والقيد يترجمه إلى ما يعنيه فعلاً — محوُ الرصيد.
   */
  const monthlyReal = Math.max(0, 1 + real) ** (1 / 12) - 1

  const target = freedomNumber(annualSpending, withdrawalRate)

  // ثروةٌ سالبة لا تُدرّ دخلاً سلبياً سالباً، تُدرّ لا شيء.
  const investable = Math.max(0, netWorth)
  const passiveIncomeNow = round2((investable * withdrawalRate) / 100 / 12)

  /**
   * دخلُ سنةٍ كاملة مقسوماً على مصروف شهر — لا دخلُ شهرٍ على مصروف شهر.
   *
   * الحقل يُقرأ في الواجهة وفي MCP بصيغة «يغطّي كذا من كل ١٢ شهر»، وتلك
   * الجملة تفرض المقياس: من بلغ الرقم كاملاً يقرأ ١٢ من ١٢، ومن بلغ نصفه
   * يقرأ ٦. وقسمةُ الشهر على الشهر تعطي ١ لمن صار حرّاً — أي «دخلك يغطّي
   * شهراً واحداً من سنتك» لمن يغطّي دخلُه سنته كلها.
   *
   * وهي بلا سقفٍ عمداً: coverage مقيَّدة بـ ١، ومن تجاوز الرقم يستحقّ أن
   * يرى بكم تجاوزه. ومن لا مصروف له لا شيء يُغطّى؛ الصفر هنا أصدق من ∞.
   */
  const monthsCoveredNow =
    annualSpending <= 0 ? 0 : round2((investable * withdrawalRate * 12) / (annualSpending * 100))

  const realReturnPercent = round2(real * 100)

  /**
   * لا رقمَ حريةٍ بلا مصروفٍ معلوم.
   *
   * المصروف السنوي يُبنى من مصاريف المستخدم، وصفرُه في التطبيق يعني «لم
   * يُدخِل بعد» لا «لا ينفق». فمن جعل الصفرَ بلوغاً يهنّئ كلَّ مستخدمٍ جديد
   * بالحرية المالية في أول شاشةٍ يفتحها — وهو أسوأ ما يمكن أن يقوله رقم.
   * الفراغ يُقال فراغاً: لا تغطية، ولا تاريخ، ولا بلوغ.
   */
  const hasTarget = target > 0
  const coverage = hasTarget ? clamp(netWorth / target, 0, 1) : 0
  const shortfall = hasTarget ? round2(Math.max(0, target - netWorth)) : 0

  const settle = (months: number | null): FreedomResult => ({
    target,
    coverage,
    passiveIncomeNow,
    monthsCoveredNow,
    monthsToFreedom: months,
    yearsToFreedom: months === null ? null : round2(months / 12),
    // شهورٌ تقويمية لا ٣٠ يوماً: التاريخ يُقرأ «آذار ٢٠٣٩» لا «بعد 4,745 يوماً».
    freedomDate: months === null ? null : addMonths(today, months),
    isFree: months === 0,
    realReturnPercent,
    shortfall,
  })

  if (!hasTarget) return settle(null)
  if (netWorth >= target) return settle(0)

  /**
   * الطريق المسدود يُعلَن بلا مسير.
   *
   * بلا إضافةٍ شهرية وبعائدٍ حقيقيّ غير موجب، الرصيد لا يكبر أبداً — فسبع
   * مئة دورةٍ لن تكتشف إلا ما تقوله الحسبة من أول سطر. والاختصار هنا ليس
   * توفيراً للوقت بل صدقٌ في المعنى: «لا يُبلَغ» هنا حقيقةٌ دائمة، لا نتيجةَ
   * سقفِ بحثٍ اخترناه نحن.
   *
   * ولا يشمل الاختصارُ العائدَ السالب مع إضافةٍ موجبة: ذلك سباقٌ حقيقيّ بين
   * التآكل والإيداع، وقد يُكسَب — تحسمه الحلقة لا الحدس.
   */
  if (contribution <= 0 && real <= 0) return settle(null)

  const capMonths = clamp(Math.floor(finite(input.maxYears, 60)), 0, MAX_SEARCH_YEARS) * 12

  let balance = netWorth
  for (let month = 1; month <= capMonths; month += 1) {
    balance = balance * (1 + monthlyReal) + contribution
    if (balance >= target) return settle(month)
  }

  return settle(null)
}

/** أثر دفعة إضافية: كم شهراً تقصُر الرحلة لو زدتَ ادخارك الشهري. */
export function freedomSensitivity(
  input: FreedomInput,
  extraMonthly: number,
): { monthsSaved: number | null; newMonthsToFreedom: number | null } {
  const base = projectFreedom(input)
  const boosted = projectFreedom({
    ...input,
    monthlyContribution: finite(input.monthlyContribution, 0) + finite(extraMonthly, 0),
  })

  /**
   * إن كان أحد المسارين لا يُبلَغ فلا فرقَ بينهما يُقاس بالشهور.
   * «وفّرت ∞ شهراً» ليست بشرى، و«وفّرت 0» كذبٌ صريح؛ الفراغ وحده صادق.
   *
   * وانتبه: الفراغ هنا لا يعني «الزيادة لا تنفع». حين يكون الأساس لا يُبلَغ
   * والمُعزَّز يُبلَغ، فالزيادة هي التي فتحت الطريق كلَّه — والخبر يُقرأ من
   * `newMonthsToFreedom` لا من `monthsSaved`. من قرأ الفراغ وحده وقال
   * للمستخدم «هذه الزيادة لا تكفي» قلبَ أحسنَ خبرٍ يمكن أن يُقال له.
   */
  const monthsSaved =
    base.monthsToFreedom === null || boosted.monthsToFreedom === null
      ? null
      : base.monthsToFreedom - boosted.monthsToFreedom

  return { monthsSaved, newMonthsToFreedom: boosted.monthsToFreedom }
}
