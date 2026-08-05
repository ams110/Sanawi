/**
 * حساب رقم الشهر: كم يجب أن يخرج، وكم يبقى للصرف.
 * ملف نقي — لا React ولا Supabase.
 */

export type IncomeFrequency = 'weekly' | 'biweekly' | 'monthly'

/**
 * معاملات التحويل إلى شهري.
 *
 * أسبوعي × 4.333 لا × 4: السنة 52 أسبوعاً لا 48، والفرق أربعة رواتب أسبوعية
 * في السنة. استعمال 4 يجعل التطبيق يظنّ دخلك أقل مما هو فيخنق ميزانيتك بلا سبب.
 */
export const FREQUENCY_TO_MONTHLY: Record<IncomeFrequency, number> = {
  weekly: 52 / 12, // ‏4.3333…
  biweekly: 26 / 12, // ‏2.1666…
  monthly: 1,
}

export interface IncomeInput {
  amount: number
  frequency: IncomeFrequency
  isActive?: boolean
  /**
   * دخلٌ لا تقدير ثابت له — شغلٌ جانبي أو ساعاتٌ متغيّرة أو إكراميات.
   *
   * يُستثنى من **المتوقَّع** ولا يُحذف: مصدرٌ بلا رقمٍ موثوق خيرٌ من رقمٍ
   * مخترَع يضخّم الدخل، ويبقى داخلاً في **الواصل** عبر income_entries حين
   * يصل فعلاً. وهي نفس قسمة «التقدير في جدول والواقع في آخر».
   */
  isVariable?: boolean
}

export interface MonthlySummaryInput {
  incomes: IncomeInput[]
  /** الالتزامات الشهرية الثابتة: الأهل، بنزين، تلفون. */
  fixedCommitments: number[]
  /** أقساط الالتزامات السنوية لهذا الشهر. */
  obligationInstallments: number[]
  monthlySavingsTarget?: number
}

export interface MonthlySummary {
  monthlyIncome: number
  fixedTotal: number
  obligationsTotal: number
  savingsTarget: number
  /** كل ما يجب أن يخرج من الحساب هذا الشهر. */
  mustLeaveAccount: number
  /** الباقي فعلاً للصرف. سالب = عجز. */
  availableToSpend: number
  isOverBudget: boolean
}

const round2 = (v: number): number => Math.round(v * 100) / 100
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)

/**
 * بوّابة الأرقام.
 *
 * ‏`Math.max(0, NaN)` تُرجع NaN، فالتقصيص عند الصفر ليس بوّابة بل وهمُ بوّابة:
 * مُدخَلٌ واحد فاسد يمرّ منها ويخرج NaN في كل حقلٍ من حقول النتيجة. وNaN لا
 * يظهر على الشاشة خطأً بل يظهر فراغاً أو «—»، فيظنّ المستخدم أن التطبيق لا
 * يعرف بدل أن يعرف أن مُدخَله هو الخطأ. ‏Infinity كذلك يمرّ من هنا إلى بديله.
 */
const finite = (n: number | undefined, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback

/** الدخل الشهري المتوقَّع: المصادر النشطة التي لها تقدير موثوق. */
export function monthlyIncomeFrom(incomes: IncomeInput[]): number {
  return round2(
    sum(
      incomes
        .filter((i) => i.isActive !== false && i.isVariable !== true)
        .map((i) => i.amount * FREQUENCY_TO_MONTHLY[i.frequency]),
    ),
  )
}

/** تحويل مبلغ الدورة الواحدة إلى ما يعادله شهرياً. */
export function monthlyEquivalent(amount: number, frequency: IncomeFrequency): number {
  return round2(amount * FREQUENCY_TO_MONTHLY[frequency])
}

export function summarizeMonth(input: MonthlySummaryInput): MonthlySummary {
  const monthlyIncome = monthlyIncomeFrom(input.incomes)
  const fixedTotal = round2(sum(input.fixedCommitments))
  const obligationsTotal = round2(sum(input.obligationInstallments))
  const savingsTarget = round2(input.monthlySavingsTarget ?? 0)

  const mustLeaveAccount = round2(fixedTotal + obligationsTotal + savingsTarget)
  const availableToSpend = round2(monthlyIncome - mustLeaveAccount)

  return {
    monthlyIncome,
    fixedTotal,
    obligationsTotal,
    savingsTarget,
    mustLeaveAccount,
    availableToSpend,
    isOverBudget: availableToSpend < 0,
  }
}

/**
 * محاكي الادخار: القيمة المستقبلية لدفعة شهرية ثابتة فوق رصيدٍ قائم.
 * FV = B × (1 + r/12)^n  +  P × [ ((1 + r/12)^n − 1) ÷ (r/12) ]
 */
export interface SavingsProjection {
  futureValue: number
  /** ما وضعتَه من جيبك: الرصيد الابتدائي + كل الدفعات. */
  totalDeposited: number
  growth: number
  /** دخل شهري سلبي بمعدّل السحب الآمن — 4٪ سنوياً ما لم يُطلب غيره. */
  monthlyPassiveIncome: number
  /** القيمة الاسمية بقوّة شراء اليوم. */
  realFutureValue: number
  /** والدخل السلبي منها بقيمة اليوم — وهو الرقم الصادق. */
  realMonthlyPassiveIncome: number
}

/** سقف المدّة: أطول من أيّ عمرٍ يُخطَّط له، وما فوقه يفيض الأسّ إلى ما لا نهاية. */
const MAX_PROJECTION_YEARS = 200

/**
 * ما دون هذا المعدّل الشهري يُعامَل عائداً صفرياً.
 *
 * الصيغة المغلقة تقسم على المعدّل، وعند معدّلٍ متناهي الصغر يبتلع خطأُ
 * الفاصلة العائمة الفرقَ ‏`(1+i)^n − 1` كلَّه فيصير البسط صفراً: ادخارُ عشر
 * سنين يخرج صفراً ونموّه سالباً بمقدار ما أودعتَ. المساواة بالصفر وحدها لا
 * تلتقط هذه الحافّة لأن المعدّل هنا موجبٌ فعلاً — صغيرٌ فقط.
 */
const NEGLIGIBLE_MONTHLY_RATE = 1e-9

export interface SavingsOptions {
  /** ما معك اليوم — نقطة البداية، لا صفر. */
  initialBalance?: number
  /** التضخّم المفترض؛ به تصير الأرقام بقوة شراء اليوم. */
  inflationPercent?: number
  /** معدّل السحب الآمن للدخل السلبي. */
  withdrawalRatePercent?: number
}

/**
 * كان هذا المحاكي يكذب كذبتين مهذّبتين.
 *
 * الأولى: يبدأ من صفر، وصاحب الحساب يملك رصيداً قبل أن يفتح الشاشة —
 * فيُريه رقماً أصغر من نصيبه ويُقنعه أن الطريق أطول مما هو.
 * والثانية أخطر: 7٪ لعشرين سنة بالشيكل الاسمي تصف ثروةً تفقد ثلث قوّتها
 * الشرائية أو أكثر قبل أن تصل. لذلك صار لكل رقمٍ هنا توأمٌ بقيمة اليوم،
 * وهو التوأم الذي يُتّخذ عليه القرار.
 *
 * التضخّم الافتراضي صفر لا 3: الشاشة والخادم يستدعيان هذه الدالة بثلاث
 * وسائط منذ زمن، وافتراضٌ غير صفريّ كان سيغيّر أرقامهما من تحتهما دون
 * أن يطلب أحد. الحقيقة تُطلَب صراحةً، ولا تُفرض على مَن لم يسأل عنها.
 *
 * وللسبب نفسه بقي المعدّل الشهري `r/12` هنا — أي أن 7٪ تعني اسمياً مركَّباً
 * شهرياً (7.23٪ فعلياً). ‏`wealth/freedom.ts` يأخذ الجذر الهندسي فيقرأ 7٪
 * على أنها 7٪ فعلية، فالمحرّكان يجيبان جوابين مختلفين عن الرقم نفسه.
 * التوحيد قرارٌ يُتّخذ صراحةً لأنه يزحزح كل رقمٍ معروضٍ اليوم، لا هنا خلسةً.
 */
export function projectSavings(
  monthlyAmount: number,
  years: number,
  annualRatePercent = 7,
  options: SavingsOptions = {},
): SavingsProjection {
  // هذا محرّك تراكم لا محرّك دَين: المدخل السالب خطأ إدخال، وتمريره كما هو
  // يُنتج "إسقاطاً" لثروةٍ سالبة لا تقرأه شاشة ولا يفهمه قارئ.
  const deposit = Math.max(0, finite(monthlyAmount, 0))
  const initialBalance = Math.max(0, finite(options.initialBalance, 0))
  // سنوات سالبة ترفع الأساس لأسٍّ سالب فيتقلّص المبلغ وكأن الادخار عقوبة،
  // ومدّةٌ بلا سقف تُفيض الأسّ إلى ما لا نهاية فتُخرج NaN بدل رقم.
  const safeYears = Math.min(MAX_PROJECTION_YEARS, Math.max(0, finite(years, 0)))

  const months = Math.round(safeYears * 12)
  const monthlyRate = finite(annualRatePercent, 7) / 100 / 12

  // بعائد صفري تنهار المعادلة على قسمة على صفر، والناتج الصحيح جمع بسيط.
  const compounded = Math.pow(1 + monthlyRate, months)
  const futureValue =
    Math.abs(monthlyRate) < NEGLIGIBLE_MONTHLY_RATE
      ? initialBalance + deposit * months
      : initialBalance * compounded + deposit * ((compounded - 1) / monthlyRate)

  const totalDeposited = initialBalance + deposit * months

  // تضخّم −100٪ يُصفّر المقام. عندها نُبقي الرقم الاسمي كما هو: قسمةٌ على
  // صفر تُخرج ما لا نهاية، وما لا نهاية أسوأ من تقديرٍ متفائل.
  const deflator = Math.pow(1 + finite(options.inflationPercent, 0) / 100, safeYears)
  const realFutureValue = deflator > 0 ? futureValue / deflator : futureValue

  const withdrawalRate = Math.max(0, finite(options.withdrawalRatePercent, 4)) / 100

  return {
    futureValue: round2(futureValue),
    totalDeposited: round2(totalDeposited),
    growth: round2(futureValue - totalDeposited),
    monthlyPassiveIncome: round2((futureValue * withdrawalRate) / 12),
    realFutureValue: round2(realFutureValue),
    realMonthlyPassiveIncome: round2((realFutureValue * withdrawalRate) / 12),
  }
}
