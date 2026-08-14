import { describe, expect, it } from 'vitest'
import { monthlyIncomeFrom, projectSavings, sumReceived, type SavingsProjection } from './calc'

describe('تحويل الدخل إلى شهري', () => {
  it('يحوّل الأسبوعي بـ 4.333 لا بـ 4', () => {
    // 2,000 أسبوعياً: الصحيح 8,667 لا 8,000 — الفرق أربعة رواتب في السنة.
    expect(monthlyIncomeFrom([{ amount: 2000, frequency: 'weekly' }])).toBeCloseTo(8666.67, 1)
  })

  it('يحوّل نصف الشهري بـ 2.167', () => {
    expect(monthlyIncomeFrom([{ amount: 4000, frequency: 'biweekly' }])).toBeCloseTo(8666.67, 1)
  })

  it('يترك الشهري كما هو', () => {
    expect(monthlyIncomeFrom([{ amount: 9000, frequency: 'monthly' }])).toBe(9000)
  })

  it('يجمع مصادر متعددة', () => {
    const total = monthlyIncomeFrom([
      { amount: 2000, frequency: 'weekly' },
      { amount: 1500, frequency: 'monthly' },
    ])
    expect(total).toBeCloseTo(10166.67, 1)
  })

  it('يتجاهل المصادر غير النشطة', () => {
    const total = monthlyIncomeFrom([
      { amount: 9000, frequency: 'monthly' },
      { amount: 5000, frequency: 'monthly', isActive: false },
    ])
    expect(total).toBe(9000)
  })

  /*
   * الدخل المتغيّر خارج المتوقَّع.
   *
   * صاحب المصادر المتعددة — راتبٌ ثابت وشغلٌ جانبي — كان مضطراً لإعطاء
   * الجانبي رقماً ثابتاً، فيتضخّم المتوقَّع ويصير «الباقي للصرف» وعداً لا
   * يفي به الشهر. والصادق ألّا يُخترع له رقم: يدخل في «ما وصل» حين يصل.
   */
  it('يستثني المصدر المتغيّر من المتوقَّع', () => {
    const total = monthlyIncomeFrom([
      { amount: 9000, frequency: 'monthly' },
      { amount: 2000, frequency: 'monthly', isVariable: true },
    ])
    expect(total).toBe(9000)
  })

  it('كل المصادر متغيّرة: صفر متوقَّع لا رقم مخترَع', () => {
    expect(monthlyIncomeFrom([{ amount: 3000, frequency: 'weekly', isVariable: true }])).toBe(0)
  })

  it('وغياب العلامة يعني ثابتاً — سلوك ما قبل الحقل', () => {
    expect(monthlyIncomeFrom([{ amount: 9000, frequency: 'monthly' }])).toBe(9000)
  })
})

describe('محاكي الادخار', () => {
  it('يحسب القيمة المستقبلية بعائد 7%', () => {
    // 1,000 شهرياً لعشر سنوات بعائد 7% فعليّ ≈ 171,052.
    // (كانت 173,085 حين كان المعدّل r/12 — أي 7.23٪ فعلياً. ث3)
    const r = projectSavings(1000, 10, 7)
    expect(r.futureValue).toBeGreaterThan(170000)
    expect(r.futureValue).toBeLessThan(172000)
    expect(r.totalDeposited).toBe(120000)
    expect(r.growth).toBeCloseTo(r.futureValue - 120000, 2)
  })

  it('يحسب الدخل السلبي بقاعدة 4%', () => {
    const r = projectSavings(1000, 10, 7)
    expect(r.monthlyPassiveIncome).toBeCloseTo((r.futureValue * 0.04) / 12, 2)
  })

  it('لا ينهار بعائد صفري', () => {
    const r = projectSavings(1000, 10, 0)
    expect(r.futureValue).toBe(120000)
    expect(r.growth).toBe(0)
  })

  it('يرجع صفراً لمدة صفرية', () => {
    expect(projectSavings(1000, 0, 7).futureValue).toBe(0)
  })
})

describe('محاكي الادخار — الرصيد الابتدائي', () => {
  it('يبدأ مما معك اليوم لا من صفر', () => {
    const fromZero = projectSavings(1000, 10, 7)
    const withBalance = projectSavings(1000, 10, 7, { initialBalance: 50000 })
    // 50,000 وحدها تصير 98,357.57 بعد عشر سنوات بعائد 7٪ فعليّ.
    expect(withBalance.futureValue - fromZero.futureValue).toBeCloseTo(98357.57, 1)
  })

  it('يعدّ الرصيد الابتدائي من جيبك فلا يحسبه نمواً', () => {
    const r = projectSavings(1000, 10, 7, { initialBalance: 50000 })
    expect(r.totalDeposited).toBe(170000)
    expect(r.growth).toBeCloseTo(r.futureValue - 170000, 2)
  })

  it('ينمّي رصيداً قائماً بلا أي دفعة شهرية', () => {
    const r = projectSavings(0, 10, 7, { initialBalance: 100000 })
    expect(r.futureValue).toBeCloseTo(196715.14, 1)
    expect(r.totalDeposited).toBe(100000)
  })

  it('يجمع الرصيد والدفعات جمعاً بسيطاً بعائد صفري', () => {
    const r = projectSavings(1000, 10, 0, { initialBalance: 50000 })
    expect(r.futureValue).toBe(170000)
    expect(r.totalDeposited).toBe(170000)
    expect(r.growth).toBe(0)
  })
})

describe('محاكي الادخار — القيمة بقوة شراء اليوم', () => {
  it('يخصم التضخّم عن الرقم الاسمي', () => {
    const r = projectSavings(2000, 20, 7, { inflationPercent: 3 })
    expect(r.futureValue).toBeCloseTo(1015072.75, 1)
    // ‏1.03^20 = 1.806 — أي أن المليون الاسمي يساوي 562 ألفاً بقيمة اليوم.
    expect(r.realFutureValue).toBeCloseTo(562021.17, 1)
    expect(r.realMonthlyPassiveIncome).toBeCloseTo(1873.4, 1)
  })

  it('يترك القيمة الحقيقية مساوية للاسمية حين لا يُطلب تضخّم', () => {
    const r = projectSavings(1000, 10, 7)
    expect(r.realFutureValue).toBe(r.futureValue)
    expect(r.realMonthlyPassiveIncome).toBe(r.monthlyPassiveIncome)
  })

  it('لا يخرج ما لا نهاية عند تضخّم يُصفّر المقام', () => {
    const r = projectSavings(1000, 10, 7, { inflationPercent: -100 })
    expect(Number.isFinite(r.realFutureValue)).toBe(true)
    expect(r.realFutureValue).toBe(r.futureValue)
  })

  it('يغيّر معدّل السحب الدخلَ السلبي وحده', () => {
    const r = projectSavings(1000, 10, 7, { withdrawalRatePercent: 3.5 })
    expect(r.futureValue).toBeCloseTo(171051.73, 1)
    expect(r.monthlyPassiveIncome).toBeCloseTo((r.futureValue * 0.035) / 12, 2)
  })
})

describe('محاكي الادخار — العائد الفعليّ مثبَّتاً', () => {
  /**
   * الأرقام مثبَّتة بالحرف كي لا تنزاح ثانيةً بلا طلب.
   *
   * انزاحت مرّةً واحدة بقرارٍ صريح من صاحب التطبيق (تدقيق آب 2026: ث3):
   * صار المعدّل الشهري جذراً هندسياً لا `r/12`، فـ7٪ تعني 7٪ فعلية لا
   * 7.23٪ — وهو نفس ما يفهمه `wealth/freedom.ts`، فالشاشتان تتفقان.
   * وما دون ذلك، أي تغيّر هنا يغيّر ما يراه المستخدم بلا أن يطلبه.
   */
  it('يرجع أرقام العائد الفعليّ حرفياً', () => {
    expect(projectSavings(2000, 20, 7)).toEqual({
      futureValue: 1015072.75,
      totalDeposited: 480000,
      growth: 535072.75,
      monthlyPassiveIncome: 3383.58,
      realFutureValue: 1015072.75,
      realMonthlyPassiveIncome: 3383.58,
    })
  })

  it('يبقي السحب الافتراضي 4٪ على حاله بالضبط', () => {
    const r = projectSavings(1000, 10, 7)
    expect(r.futureValue).toBe(171051.73)
    expect(r.monthlyPassiveIncome).toBe(570.17)
  })

  /*
   * الاتفاق نفسه يُفحص صراحةً لا يُستنتج (قاعدة CLAUDE.md الثامنة):
   * محرّكان يقرآن «7٪» ويجب أن يعنيا الشيء نفسه.
   */
  it('يفهم 7٪ كما يفهمها محرّك الحرية بالضبط', () => {
    // نموّ سنةٍ واحدة على رصيدٍ قائم بلا إيداعات = العائد المعلَن نفسه.
    const r = projectSavings(0, 1, 7, { initialBalance: 100000 })
    expect(r.futureValue).toBeCloseTo(107000, 0)
  })
})

describe('محاكي الادخار — المدخلات الفاسدة', () => {
  it('لا يعطي NaN لمستخدم بلا مال ولا مدّة', () => {
    const r = projectSavings(0, 0, 7)
    expect(r.futureValue).toBe(0)
    expect(r.realFutureValue).toBe(0)
    expect(r.monthlyPassiveIncome).toBe(0)
    expect(r.realMonthlyPassiveIncome).toBe(0)
  })

  /**
   * كل مُدخَلٍ على حدة: حقلٌ فاسدٌ واحد كافٍ ليُخرج NaN في كل الحقول، لأن
   * ‏`Math.max(0, NaN)` تُرجع NaN. الفحص المجمّع كان سيمرّ على بوّابةٍ واحدة
   * صالحة ويترك البقيّة بلا حراسة.
   */
  const allFinite = (r: SavingsProjection): boolean =>
    Object.values(r).every((v) => Number.isFinite(v))

  it('لا يسرّب NaN من أي مُدخَل فاسد', () => {
    expect(allFinite(projectSavings(Number.NaN, 10, 7))).toBe(true)
    expect(allFinite(projectSavings(1000, Number.NaN, 7))).toBe(true)
    expect(allFinite(projectSavings(1000, 10, Number.NaN))).toBe(true)
    expect(allFinite(projectSavings(1000, 10, 7, { initialBalance: Number.NaN }))).toBe(true)
    expect(allFinite(projectSavings(1000, 10, 7, { inflationPercent: Number.NaN }))).toBe(true)
    expect(allFinite(projectSavings(1000, 10, 7, { withdrawalRatePercent: Number.NaN }))).toBe(true)
  })

  it('لا يسرّب ما لا نهاية من مدّةٍ أو مبلغٍ بلا حدّ', () => {
    expect(allFinite(projectSavings(1000, Number.POSITIVE_INFINITY, 7))).toBe(true)
    expect(allFinite(projectSavings(Number.POSITIVE_INFINITY, 10, 7))).toBe(true)
    // مليون سنة لا تُقرأ رقماً بل تُقرأ فيضاناً؛ السقف يُبقيها رقماً.
    expect(allFinite(projectSavings(1000, 1_000_000, 7))).toBe(true)
  })

  it('لا يبتلع الدفعات عند عائدٍ متناهي الصغر', () => {
    // بلا حدٍّ أدنى للمعدّل يخرج هذا صفراً ونموّه ‎−120,000: ادخارُ عشر سنين يختفي.
    const r = projectSavings(1000, 10, 1e-13)
    expect(r.futureValue).toBe(120000)
    expect(r.growth).toBe(0)
  })

  it('يقصّ المدّة السالبة عند الصفر', () => {
    const r = projectSavings(1000, -3, 7)
    expect(r.futureValue).toBe(0)
    expect(r.totalDeposited).toBe(0)
  })

  it('يقصّ الدفعة السالبة ولا يسقط ثروةً سالبة', () => {
    // بمدّةٍ موجبة: المدّة الصفرية كانت تضرب الدفعة في صفرٍ فتُخفي التقصيص.
    const r = projectSavings(-500, 10, 7)
    expect(r.futureValue).toBe(0)
    expect(r.totalDeposited).toBe(0)
    expect(r.growth).toBe(0)
  })

  it('يقصّ الرصيد الابتدائي السالب فلا يخصمه من النتيجة', () => {
    const r = projectSavings(1000, 10, 7, { initialBalance: -50000 })
    expect(r.futureValue).toBe(171051.73)
    expect(r.totalDeposited).toBe(120000)
  })

  it('يقبل سنواتٍ كسرية', () => {
    const r = projectSavings(1000, 0.5, 7)
    expect(r.totalDeposited).toBe(6000)
    expect(r.futureValue).toBeCloseTo(6085.45, 1)
  })
})

// القاعدة الواحدة لمجموع الواصل — كانت ثلاث نسخ. (س13)
describe('sumReceived', () => {
  it('يجمع ويقرّب ويقبل نصوص PostgREST', () => {
    expect(sumReceived([{ amount: '1000.005' }, { amount: 500 }])).toBe(1500.01)
    expect(sumReceived([])).toBe(0)
  })
})
