import { describe, expect, it } from 'vitest'
import {
  type PayoffDebt,
  buildPayoffPlan,
  comparePayoff,
  debtBalanceFrom,
  orderDebts,
} from './payoff'

const debt = (over: Partial<PayoffDebt> & { id: string }): PayoffDebt => ({
  name: over.id,
  balance: 0,
  minimumPayment: 0,
  annualInterestPercent: 0,
  ...over,
})

describe('debtBalanceFrom', () => {
  it('يضرب القسط في عدد الدفعات', () => {
    expect(debtBalanceFrom(500, 12)).toBe(6000)
  })

  it('يرجع صفراً لقسطٍ انتهت دفعاته', () => {
    expect(debtBalanceFrom(500, 0)).toBe(0)
  })

  it('لا يقبل رقماً سالباً فيقلب الدين أصلاً', () => {
    expect(debtBalanceFrom(-500, 12)).toBe(0)
    expect(debtBalanceFrom(500, -12)).toBe(0)
  })

  /*
   * بفائدة، الأصل أقلّ من مجموع الدفعات — والفرق هو الفائدة التي لم تُستحقّ.
   * خلطُ الاثنين كان يُدخل المحاكاةَ رقماً يحمل فائدةً، فتركّب عليه فائدةً ثانية.
   */
  it('يرجع الأصل لا مجموع الدفعات حين تكون ثمّة فائدة', () => {
    // ‏١٬٠٠٠ شهرياً لاثني عشر شهراً بـ ١٢٪: القيمة الحالية بمعدّل ١٪ شهرياً.
    const gross = 1000 * 12
    const principal = debtBalanceFrom(1000, 12, 12)
    expect(principal).toBeLessThan(gross)
    expect(principal).toBeCloseTo(11255.08, 1)
  })

  it('بفائدة صفر يبقى حاصل الضرب كما كان', () => {
    expect(debtBalanceFrom(500, 12, 0)).toBe(6000)
  })
})

/*
 * قرضٌ حقيقيّ منتهٍ يجب ألّا يُعلَن مستحيلاً.
 *
 * حين كان الأصل يُقرأ مجموعَ الدفعات، صار رصيدُ هذا القرض ١٨٬٠٠٠ وفائدتُه
 * الشهرية ٤٥٠ فوق قسطه البالغ ٣٠٠ — فيقول التطبيق «الحد الأدنى لا يغطّي
 * الفائدة» عن قرضٍ يُسدَّد فعلاً كل شهر وينتهي في موعده.
 */
describe('القرض الحقيقي لا يُعلَن مستحيلاً', () => {
  const debt = {
    id: 'قرض',
    name: 'قرض',
    balance: debtBalanceFrom(300, 60, 30),
    minimumPayment: 300,
    annualInterestPercent: 30,
  }

  it('أصله أصغر بكثير من مجموع دفعاته', () => {
    expect(debt.balance).toBeLessThan(300 * 60)
    expect(debt.balance).toBeCloseTo(9272.6, 0)
  })

  /*
   * ستون أو واحدٌ وستون، لا ستّمئة.
   *
   * الأصل مُعاد بناؤه من القسط وعدده ومقرَّبٌ إلى الأغورة، فقد يبقى بعد
   * الدفعة الستين كسرٌ يستدعي شهراً أخيراً بقروش. تثبيتُ الستين بالضبط
   * يجعل الاختبار يحرس دقّة التقريب لا المعنى؛ والمعنى هو أن قرضاً مدّته
   * خمس سنوات يُسدَّد في خمس سنوات ولا يُعلَن مستحيلاً.
   */
  it('وخطّته تنتهي في مدّته لا تُعلَن مستحيلة', () => {
    const plan = buildPayoffPlan({ debts: [debt] })
    expect(plan.isImpossible).toBe(false)
    expect(plan.months).not.toBeNull()
    expect(plan.months!).toBeGreaterThanOrEqual(60)
    expect(plan.months!).toBeLessThanOrEqual(61)
  })
})

describe('ترتيب المهاجمة', () => {
  const debts = [
    debt({ id: 'بطاقة', balance: 4000, annualInterestPercent: 24 }),
    debt({ id: 'قرض', balance: 1500, annualInterestPercent: 5 }),
  ]

  it('الانهيار يبدأ بالأعلى فائدة', () => {
    expect(orderDebts(debts, 'avalanche').map((d) => d.id)).toEqual(['بطاقة', 'قرض'])
  })

  it('كرة الثلج تبدأ بالأصغر رصيداً', () => {
    expect(orderDebts(debts, 'snowball').map((d) => d.id)).toEqual(['قرض', 'بطاقة'])
  })

  it('عند تساوي الفائدة يقدّم الانهيار الأصغر رصيداً', () => {
    const tied = [
      debt({ id: 'كبير', balance: 800, annualInterestPercent: 10 }),
      debt({ id: 'صغير', balance: 300, annualInterestPercent: 10 }),
    ]
    expect(orderDebts(tied, 'avalanche').map((d) => d.id)).toEqual(['صغير', 'كبير'])
  })

  it('عند تساوي الرصيد تقدّم كرة الثلج الأعلى فائدة', () => {
    const tied = [
      debt({ id: 'رخيص', balance: 500, annualInterestPercent: 5 }),
      debt({ id: 'غالٍ', balance: 500, annualInterestPercent: 15 }),
    ]
    expect(orderDebts(tied, 'snowball').map((d) => d.id)).toEqual(['غالٍ', 'رخيص'])
  })

  it('لا يمسّ مصفوفة المستدعي', () => {
    const original = [...debts]
    orderDebts(debts, 'snowball')
    expect(debts).toEqual(original)
    expect(debts[0]!.id).toBe('بطاقة')
  })
})

describe('التدحرّج — سبب وجود هذا الملف', () => {
  // بلا فائدة ليكون الحساب مكشوفاً: 100 و300 وحدّان أدنيان 100، وبلا زيادة.
  // الشهر الأول يقتل الأول ويدفع 100 على الثاني، والشهر الثاني يرث الحدّ
  // المحرَّر فيدفع 200 دفعةً واحدة. بلا توريث الحدّ كانت الخطة ثلاثة شهور.
  const plan = buildPayoffPlan({
    debts: [
      debt({ id: 'أول', balance: 100, minimumPayment: 100 }),
      debt({ id: 'ثانٍ', balance: 300, minimumPayment: 100 }),
    ],
    extraMonthly: 0,
    strategy: 'snowball',
  })

  it('يورّث الحدّ الأدنى المحرَّر للدين التالي', () => {
    expect(plan.months).toBe(2)
  })

  it('يعمل بلا مبلغٍ زائد أصلاً', () => {
    expect(plan.lines[0]!.clearedAtMonth).toBe(1)
    expect(plan.lines[1]!.clearedAtMonth).toBe(2)
    expect(plan.totalPaid).toBe(400)
  })
})

describe('الفائض ينزل إلى الذي يليه في الشهر نفسه', () => {
  const plan = buildPayoffPlan({
    debts: [
      debt({ id: 'أول', balance: 100, minimumPayment: 10 }),
      debt({ id: 'ثانٍ', balance: 200, minimumPayment: 10 }),
    ],
    extraMonthly: 500,
    strategy: 'snowball',
  })

  it('يقتل الدينين في شهرٍ واحد بدل شهرين', () => {
    expect(plan.months).toBe(1)
    // الطول يُثبَّت قبل `every`: على مصفوفةٍ فارغة تُرجع `true` فيمرّ الفحص بلا فحص.
    expect(plan.lines).toHaveLength(2)
    expect(plan.lines.every((l) => l.clearedAtMonth === 1)).toBe(true)
  })

  it('لا تتجاوز الدفعة الرصيد فلا يُدفع إلا ما عليه', () => {
    expect(plan.totalPaid).toBe(300)
  })
})

describe('الانهيار مقابل كرة الثلج', () => {
  const debts = [
    debt({ id: 'بطاقة', balance: 4000, minimumPayment: 100, annualInterestPercent: 24 }),
    debt({ id: 'قرض', balance: 1500, minimumPayment: 150, annualInterestPercent: 5 }),
  ]
  const cmp = comparePayoff({ debts, extraMonthly: 300 })

  it('يهاجم كلٌّ منهما ديناً مختلفاً', () => {
    expect(cmp.avalanche.lines[0]!.id).toBe('بطاقة')
    expect(cmp.snowball.lines[0]!.id).toBe('قرض')
  })

  // الأرقام مثبَّتة لا مشتقّة من الناتج نفسه: `interestSaved === snowball - avalanche`
  // جملةٌ صادقةٌ مهما انهار المحرّك، وهي أسوأ ما يُكتب في هذا الملف تحديداً —
  // ملفٌ كلّ قيمته في الرقم الذي يخرج منه.
  it('الانهيار يوفّر فائدةً حقيقية', () => {
    expect(cmp.avalanche.totalInterest).toBe(541.4)
    expect(cmp.snowball.totalInterest).toBe(634.18)
    expect(cmp.interestSaved).toBe(92.78)
  })

  it('وثمن الراحة: كرة الثلج تشتري فرحةً أبكر', () => {
    expect(cmp.snowball.firstClearedMonth).toBe(4)
    expect(cmp.avalanche.firstClearedMonth).toBe(11)
  })

  it('يقيس الاختصار بالشهور أيضاً', () => {
    expect(cmp.avalanche.months).toBe(11)
    expect(cmp.snowball.months).toBe(12)
    expect(cmp.monthsSaved).toBe(1)
  })
})

describe('حين يتطابق الترتيبان', () => {
  // الأصغر رصيداً هو الأعلى فائدةً، فلا خلاف بين المذهبين.
  const debts = [
    debt({ id: 'صغير غالٍ', balance: 500, minimumPayment: 50, annualInterestPercent: 20 }),
    debt({ id: 'كبير رخيص', balance: 1000, minimumPayment: 100, annualInterestPercent: 10 }),
  ]
  const cmp = comparePayoff({ debts, extraMonthly: 200 })

  it('لا فائدة تُوفَّر ولا شهر يُختصر', () => {
    expect(cmp.avalanche.months).toBe(5)
    expect(cmp.interestSaved).toBe(0)
    expect(cmp.monthsSaved).toBe(0)
  })

  it('الخطتان متطابقتان سطراً بسطر', () => {
    expect(cmp.snowball.lines).toEqual(cmp.avalanche.lines)
  })
})

describe('ديون بلا فائدة', () => {
  const plan = buildPayoffPlan({
    debts: [
      debt({ id: 'سلفة أخي', balance: 600, minimumPayment: 200 }),
      debt({ id: 'جهاز بالتقسيط', balance: 900, minimumPayment: 300 }),
    ],
    extraMonthly: 0,
  })

  it('لا فائدة ولا NaN', () => {
    expect(plan.totalInterest).toBe(0)
    expect(Number.isNaN(plan.totalPaid)).toBe(false)
    expect(plan.totalPaid).toBe(1500)
  })

  it('ينتهي بمجموع الأرصدة على المحفظة', () => {
    expect(plan.months).toBe(3)
    expect(plan.isImpossible).toBe(false)
  })
})

describe('الخطة المستحيلة', () => {
  const plan = buildPayoffPlan({
    debts: [
      debt({ id: 'بطاقة', balance: 10000, minimumPayment: 100, annualInterestPercent: 24 }),
    ],
    extraMonthly: 0,
    maxMonths: 24,
  })

  it('يعلنها مستحيلة بدل أن يعرض رقماً هائلاً', () => {
    expect(plan.isImpossible).toBe(true)
    expect(plan.months).toBeNull()
    expect(plan.lines[0]!.clearedAtMonth).toBeNull()
    expect(plan.firstClearedMonth).toBeNull()
  })

  it('ويسجّل مع ذلك الفائدة التي ضاعت خلال المدة', () => {
    expect(plan.totalInterest).toBeGreaterThan(2000)
    expect(plan.lines[0]!.totalPaid).toBe(2400)
  })

  // الفحص التحليلي "الحدّ الأدنى ≤ فائدة الشهر" كان سيُعلن هذا الدين مستحيلاً:
  // 90 أقلّ من فائدته الشهرية 100. لكنه يموت حين يتفرّغ له التدحرّج.
  it('لا يعلن ديناً مستحيلاً وهو ينتظر دوره فقط', () => {
    const rescued = buildPayoffPlan({
      debts: [
        debt({ id: 'بطاقة', balance: 5000, minimumPayment: 90, annualInterestPercent: 24 }),
        debt({ id: 'صغير', balance: 200, minimumPayment: 200 }),
      ],
      extraMonthly: 0,
    })
    expect(rescued.isImpossible).toBe(false)
    // الشهر مثبَّت لا مُختبَرٌ بـ`not.toBeNull`: الأخيرة تكرار لسطرٍ فوقها
    // لأن `isImpossible === false` تعني `months !== null` بحكم البناء.
    expect(rescued.months).toBe(23)
    expect(rescued.lines[1]!.clearedAtMonth).toBe(1)
  })
})

describe('الحالات الحدّية', () => {
  it('لا ديون: خطةٌ فارغة لا خطةٌ منهارة', () => {
    const plan = buildPayoffPlan({ debts: [] })
    expect(plan.lines).toEqual([])
    expect(plan.months).toBe(0)
    expect(plan.totalInterest).toBe(0)
    expect(plan.totalPaid).toBe(0)
    expect(plan.firstClearedMonth).toBeNull()
    expect(plan.isImpossible).toBe(false)
  })

  it('دينٌ رصيده صفر ميتٌ قبل أن تبدأ الخطة', () => {
    const plan = buildPayoffPlan({
      debts: [
        debt({ id: 'مسدَّد', balance: 0, minimumPayment: 100 }),
        debt({ id: 'حيّ', balance: 300, minimumPayment: 100 }),
      ],
      strategy: 'snowball',
    })
    expect(plan.lines[0]!.clearedAtMonth).toBe(0)
    // حدّه الأدنى يبقى في المحفظة، فيُقتل الحيّ في شهرين لا ثلاثة.
    expect(plan.months).toBe(2)
    // وموتُه قبل البدء ليس «أول فرحة»: الشهر الثاني هو أول ما يُبشَّر به.
    expect(plan.firstClearedMonth).toBe(2)
  })

  it('لا يجمع خطأ التقريب عبر عشرات الشهور', () => {
    // 33.33 × 30 = 999.9 والباقي 0.1 في الشهر 31؛ التقريب الشهري كان
    // سيُخرج 1000.02 أو 999.98 بدل الرقم الذي عليه فعلاً.
    const plan = buildPayoffPlan({
      debts: [debt({ id: 'قرض', balance: 1000, minimumPayment: 33.33 })],
    })
    expect(plan.months).toBe(31)
    expect(plan.totalPaid).toBe(1000)
    expect(plan.totalInterest).toBe(0)
  })

  it('السقف يحدّ الدوران ولا يترك الحساب بلا نهاية', () => {
    const plan = buildPayoffPlan({
      debts: [debt({ id: 'قرض', balance: 100000, minimumPayment: 1 })],
      maxMonths: 3,
    })
    expect(plan.isImpossible).toBe(true)
    expect(plan.lines[0]!.totalPaid).toBe(3)
  })

  it('سقفٌ مبالغٌ فيه يُقصّ إلى ٦٠٠ ولا يدور مليون دورة', () => {
    const plan = buildPayoffPlan({
      debts: [debt({ id: 'قرض', balance: 1e9, minimumPayment: 1 })],
      maxMonths: 5_000_000,
    })
    expect(plan.lines[0]!.totalPaid).toBe(600)
  })

  it('مُدخَلٌ فاسد لا يقلب الترتيب رأساً على عقب', () => {
    // NaN في الفائدة كان يجعل المقارِن يرجع NaN، وترتيب المصفوفة عندها غير
    // معرَّف؛ والرصيد السالب كان يتصدّر كرة الثلج وهو دينٌ تعدّه المحاكاة ميتاً.
    const dirty = [
      debt({ id: 'سالب', balance: -500, minimumPayment: 10 }),
      debt({ id: 'مجهول', balance: 300, annualInterestPercent: Number.NaN }),
      debt({ id: 'سليم', balance: 200, minimumPayment: 10, annualInterestPercent: 9 }),
    ]
    expect(orderDebts(dirty, 'avalanche').map((d) => d.id)).toEqual(['سليم', 'سالب', 'مجهول'])
    expect(orderDebts(dirty, 'snowball').map((d) => d.id)).toEqual(['سالب', 'سليم', 'مجهول'])
  })
})
