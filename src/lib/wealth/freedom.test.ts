import { addMonths } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { freedomNumber, freedomSensitivity, projectFreedom } from './freedom'

const TODAY = new Date('2026-08-02T00:00:00')

/** مسارٌ واقعيّ متكرّر في الاختبارات: مصروف 120,000 ورقم حرية 3,000,000. */
const base = {
  annualSpending: 120000,
  currentNetWorth: 100000,
  monthlyContribution: 5000,
  annualReturnPercent: 7,
  inflationPercent: 3,
  withdrawalRatePercent: 4,
  today: TODAY,
}

describe('freedomNumber', () => {
  it('يحسب رقم الحرية من المصروف السنوي', () => {
    expect(freedomNumber(120000, 4)).toBe(3000000)
  })

  it('يرفع الرقم حين ينخفض معدّل السحب', () => {
    expect(freedomNumber(120000, 3)).toBe(4000000)
    expect(freedomNumber(120000, 5)).toBe(2400000)
  })

  it('لا يقسم على صفر حين يكون معدّل السحب صفراً', () => {
    const n = freedomNumber(120000, 0)
    expect(Number.isFinite(n)).toBe(true)
    // مقيَّد إلى ٠٫١٪ = المصروف السنوي × ألف.
    expect(n).toBe(120000000)
  })

  it('يعطي صفراً لمن لا مصروف له', () => {
    expect(freedomNumber(0, 4)).toBe(0)
    expect(freedomNumber(-500, 4)).toBe(0)
  })
})

describe('projectFreedom — المسار الطبيعي', () => {
  const r = projectFreedom(base)

  it('يبلغ الرقم بعد 317 شهراً بالعائد الحقيقي', () => {
    expect(r.target).toBe(3000000)
    expect(r.monthsToFreedom).toBe(317)
    expect(r.yearsToFreedom).toBe(26.42)
  })

  it('يعطي تاريخاً تقويمياً لا عدد أيام', () => {
    expect(r.freedomDate).toEqual(addMonths(TODAY, 317))
    expect(r.isFree).toBe(false)
  })

  it('يخصم التضخّم من العائد الاسمي', () => {
    // (1.07 ÷ 1.03) − 1 = 3.88٪ لا 4٪.
    expect(r.realReturnPercent).toBe(3.88)
  })

  it('يحسب النقص من رأس المال اليوم', () => {
    expect(r.shortfall).toBe(2900000)
  })
})

describe('الدخل السلبي والتغطية', () => {
  it('يحوّل الثروة إلى دخل شهري وإلى شهورٍ من كل اثني عشر', () => {
    const r = projectFreedom({ ...base, currentNetWorth: 1500000 })
    expect(r.passiveIncomeNow).toBe(5000)
    expect(r.coverage).toBe(0.5)
    // نصفُ الرقم يشتري نصف السنة: ستة شهور لا نصف شهر.
    expect(r.monthsCoveredNow).toBe(6)
  })

  it('من بلغ الرقم كاملاً يغطّي اثني عشر من اثني عشر', () => {
    const r = projectFreedom({ ...base, currentNetWorth: 3000000 })
    expect(r.monthsCoveredNow).toBe(12)
  })

  it('يقيّد التغطية بواحد ويترك الشهور المغطّاة بلا سقف', () => {
    const r = projectFreedom({ ...base, currentNetWorth: 6000000 })
    expect(r.coverage).toBe(1)
    expect(r.monthsCoveredNow).toBe(24)
  })

  it('لا يعطي دخلاً سلبياً سالباً لمن ثروته تحت الصفر', () => {
    const r = projectFreedom({ ...base, currentNetWorth: -50000 })
    expect(r.passiveIncomeNow).toBe(0)
    expect(r.monthsCoveredNow).toBe(0)
    expect(r.coverage).toBe(0)
  })
})

describe('حالات البلوغ الفوري', () => {
  it('من ثروته تساوي الرقم بالضبط حرٌّ اليوم', () => {
    const r = projectFreedom({ ...base, currentNetWorth: 3000000 })
    expect(r.isFree).toBe(true)
    expect(r.monthsToFreedom).toBe(0)
    expect(r.yearsToFreedom).toBe(0)
    expect(r.freedomDate).toEqual(TODAY)
    expect(r.coverage).toBe(1)
    expect(r.shortfall).toBe(0)
  })

  /**
   * الفراغ لا يُقرأ نجاحاً.
   *
   * المصروف السنوي = المصاريف × ١٢، وصفرُه حالُ كل مستخدمٍ جديد قبل أن
   * يُدخِل شيئاً. لو قرأناه بلوغاً لهنّأناه بالحرية المالية في أول شاشة.
   */
  it('من لا مصروف معلوم له لا رقمَ له ولا بلوغ', () => {
    const r = projectFreedom({ ...base, annualSpending: 0, currentNetWorth: 0 })
    expect(r.target).toBe(0)
    expect(r.isFree).toBe(false)
    expect(r.coverage).toBe(0)
    expect(r.shortfall).toBe(0)
    expect(r.monthsToFreedom).toBeNull()
    expect(r.freedomDate).toBeNull()
    expect(r.monthsCoveredNow).toBe(0)
  })

  it('ولا يهنّئ الغارقَ بلا بيانات', () => {
    const r = projectFreedom({ ...base, annualSpending: 0, currentNetWorth: -50000 })
    expect(r.isFree).toBe(false)
    expect(r.coverage).toBe(0)
  })
})

describe('ما لا يُبلَغ', () => {
  it('يعلن الطريق المسدود بلا مسير حين لا إضافة ولا عائد', () => {
    const r = projectFreedom({
      ...base,
      monthlyContribution: 0,
      annualReturnPercent: 3,
      inflationPercent: 3,
      // سقفٌ خيالي: لو دارت الحلقة فعلاً لَما انتهى هذا الاختبار.
      maxYears: 100000,
    })
    expect(r.monthsToFreedom).toBeNull()
    expect(r.yearsToFreedom).toBeNull()
    expect(r.freedomDate).toBeNull()
    expect(r.isFree).toBe(false)
  })

  it('يعتبر العائد الاسمي الأقل من التضخّم عائداً غير موجب', () => {
    const r = projectFreedom({
      ...base,
      monthlyContribution: 0,
      annualReturnPercent: 1,
      inflationPercent: 5,
    })
    expect(r.realReturnPercent).toBeLessThan(0)
    expect(r.monthsToFreedom).toBeNull()
  })

  it('لا يختصر العائد السالب مع إيداعٍ موجب — يحسمه المسير', () => {
    const r = projectFreedom({
      ...base,
      annualSpending: 48,
      currentNetWorth: 0,
      monthlyContribution: 100,
      annualReturnPercent: 0,
      inflationPercent: 5,
    })
    expect(r.realReturnPercent).toBeLessThan(0)
    expect(r.target).toBe(1200)
    expect(r.monthsToFreedom).toBe(13)
  })

  it('يقف عند السقف ويقول لا يُبلَغ بدل أن يدور', () => {
    const r = projectFreedom({ ...base, maxYears: 1 })
    expect(r.monthsToFreedom).toBeNull()
    // والرقم نفسه يُبلَغ حين يتّسع السقف.
    expect(projectFreedom({ ...base, maxYears: 60 }).monthsToFreedom).toBe(317)
  })
})

describe('الجذر الهندسي — انحدارٌ سبق أن كلّف شهراً', () => {
  it('لا يركّب الفائدة اثنتي عشرة مرة في السنة', () => {
    // 1000 بعائد حقيقي 10٪: بعد اثني عشر شهراً 1,100.00 بالجذر الهندسي،
    // و1,104.71 بقسمة 10÷12. الهدف 1,104 يفرّق بينهما: الهندسيّ لا يبلغه
    // إلا في الشهر الثالث عشر، والقسمة تَعِد به في الثاني عشر.
    const r = projectFreedom({
      annualSpending: 44.16,
      currentNetWorth: 1000,
      monthlyContribution: 0,
      annualReturnPercent: 10,
      inflationPercent: 0,
      withdrawalRatePercent: 4,
      today: TODAY,
    })
    expect(r.target).toBe(1104)
    expect(r.monthsToFreedom).toBe(13)
  })
})

describe('freedomSensitivity', () => {
  it('يقصّر الرحلة بزيادة الادخار الشهري', () => {
    const s = freedomSensitivity(base, 2000)
    expect(s.newMonthsToFreedom).toBe(257)
    expect(s.monthsSaved).toBe(60)
  })

  it('لا يوفّر شيئاً حين لا تُغيّر الزيادة شيئاً', () => {
    expect(freedomSensitivity(base, 0).monthsSaved).toBe(0)
  })

  it('يعطي فراغاً لا صفراً حين يبقى أحد المسارين بعيداً', () => {
    const stuck = { ...base, maxYears: 1 }
    const s = freedomSensitivity(stuck, 2000)
    expect(s.monthsSaved).toBeNull()
    expect(s.newMonthsToFreedom).toBeNull()
  })

  /**
   * الفراغ حالتان لا حالة، والفرق بينهما في `newMonthsToFreedom` وحده.
   * هنا الأساس لا يُبلَغ أبداً والزيادة تفتح الطريق كلَّه — فمن قرأ
   * `monthsSaved === null` وحده وقال «الزيادة لا تكفي» قلبَ الخبر.
   */
  it('يفرّق بين مسارٍ مسدود ومسارٍ فتحته الزيادة', () => {
    const dead = { ...base, monthlyContribution: 0, annualReturnPercent: 3, inflationPercent: 3 }
    expect(projectFreedom(dead).monthsToFreedom).toBeNull()

    const s = freedomSensitivity(dead, 5000)
    expect(s.monthsSaved).toBeNull()
    expect(s.newMonthsToFreedom).not.toBeNull()
    expect(s.newMonthsToFreedom).toBeGreaterThan(0)
  })

  it('يقبل زيادةً سالبة فتطول الرحلة', () => {
    const s = freedomSensitivity(base, -2000)
    expect(s.newMonthsToFreedom).toBeGreaterThan(317)
    expect(s.monthsSaved).toBeLessThan(0)
  })
})

describe('لا NaN ولا ∞ يخرج من أي حقل', () => {
  const numericFields = [
    'target',
    'coverage',
    'passiveIncomeNow',
    'monthsCoveredNow',
    'realReturnPercent',
    'shortfall',
  ] as const

  const expectClean = (r: ReturnType<typeof projectFreedom>): void => {
    for (const key of numericFields) {
      expect(Number.isFinite(r[key]), key).toBe(true)
    }
    if (r.monthsToFreedom !== null) expect(Number.isFinite(r.monthsToFreedom)).toBe(true)
    if (r.yearsToFreedom !== null) expect(Number.isFinite(r.yearsToFreedom)).toBe(true)
    if (r.freedomDate !== null) expect(Number.isNaN(r.freedomDate.getTime())).toBe(false)
  }

  it('يعقّم المدخلات الفاسدة عند البوابة', () => {
    expectClean(
      projectFreedom({
        annualSpending: Number.NaN,
        currentNetWorth: Number.POSITIVE_INFINITY,
        monthlyContribution: Number.NaN,
        annualReturnPercent: Number.NEGATIVE_INFINITY,
        inflationPercent: Number.NaN,
        withdrawalRatePercent: Number.NaN,
        maxYears: Number.NaN,
        today: TODAY,
      }),
    )
  })

  it('ينجو من معدّل سحبٍ صفر وتضخّمٍ يمحو المقام', () => {
    expectClean(projectFreedom({ ...base, withdrawalRatePercent: 0, inflationPercent: -100 }))
  })

  it('ينجو من عائدٍ حقيقيّ أسوأ من محوٍ كامل', () => {
    // الأساس (1 + عائد) سالب، وجذره النون يخرج NaN لو لم يُقيَّد بالصفر.
    expectClean(projectFreedom({ ...base, annualReturnPercent: -150, inflationPercent: 0 }))
  })

  it('ينجو من سقفٍ سالب ومن مصروفٍ سالب', () => {
    expectClean(projectFreedom({ ...base, maxYears: -5 }))
    expectClean(projectFreedom({ ...base, annualSpending: -1000, currentNetWorth: -1000 }))
  })

  /**
   * ∞ لا يدخل من الباب فقط، بل يُولَد بعده.
   * 1e307 رقمٌ محدود يمرّ من كل فحوص Number.isFinite، ثم يضربه الحساب في
   * مئة فيفيض — فتخرج ∞ من دالةٍ كلُّ مُدخَلاتها محدودة.
   */
  it('ينجو من أرقامٍ محدودةٍ يفيض حاصلُ ضربها', () => {
    expectClean(projectFreedom({ ...base, annualSpending: 1e307 }))
    expectClean(projectFreedom({ ...base, currentNetWorth: 1e308 }))
    expectClean(projectFreedom({ ...base, annualReturnPercent: 1e308, inflationPercent: -100 }))
    expectClean(projectFreedom({ ...base, monthlyContribution: 1e307 }))
  })

  it('لا يُخرج تاريخاً فاسداً من تاريخٍ فاسد', () => {
    const r = projectFreedom({ ...base, currentNetWorth: 3000000, today: new Date('لا تاريخ') })
    expect(r.freedomDate).not.toBeNull()
    expect(Number.isNaN(r.freedomDate?.getTime() ?? Number.NaN)).toBe(false)
  })
})
