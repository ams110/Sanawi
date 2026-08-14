import { describe, expect, it } from 'vitest'
import { calculateObligation, monthsUntil } from './calc'

const TODAY = new Date('2026-08-02T00:00:00')

describe('monthsUntil', () => {
  it('يحسب الشهور التقويمية المتبقية', () => {
    expect(monthsUntil('2026-11-01', TODAY)).toBe(3)
  })

  it('يتحفّظ فلا يحتسب شهراً ناقصاً', () => {
    // 30/11 أبعد من 01/11 بيوم واحد فقط في نظرنا: كلاهما 3 شهور.
    expect(monthsUntil('2026-11-30', TODAY)).toBe(3)
  })

  it('يرجع سالباً لموعد فات', () => {
    expect(monthsUntil('2026-06-01', TODAY)).toBe(-2)
  })
})

describe('وضع الجسر — أخطر حالة في التطبيق', () => {
  const bridge = calculateObligation({
    totalAmount: 6000,
    myFundBalance: 0,
    nextDueDate: '2026-11-01',
    recurrenceMonths: 12,
    cycleStartDate: '2026-08-02',
    today: TODAY,
  })

  it('يرفع القسط لأن الموعد أقرب من دورة كاملة', () => {
    expect(bridge.monthsRemaining).toBe(3)
    expect(bridge.monthlyInstallment).toBe(2000)
  })

  it('يعلّم الالتزام كدفعة مضغوطة', () => {
    expect(bridge.isBridge).toBe(true)
  })

  it('يعرف القسط الطبيعي الذي سينزل إليه بعد الدورة', () => {
    expect(bridge.normalInstallment).toBe(500)
  })
})

describe('الدورة الكاملة', () => {
  const full = calculateObligation({
    totalAmount: 6000,
    myFundBalance: 0,
    nextDueDate: '2027-08-01',
    recurrenceMonths: 12,
    cycleStartDate: '2026-08-02',
    today: TODAY,
  })

  it('لا يعتبرها دفعة مضغوطة', () => {
    expect(full.isBridge).toBe(false)
  })

  it('يقسّم المبلغ على الدورة كاملة', () => {
    expect(full.monthsRemaining).toBe(12)
    expect(full.monthlyInstallment).toBe(500)
  })
})

describe('حالة الالتحاق بالجدول', () => {
  const base = {
    totalAmount: 6000,
    nextDueDate: '2027-08-01',
    recurrenceMonths: 12,
    cycleStartDate: '2026-02-02',
    baselineInstallment: 500,
    today: TODAY,
  }

  it('ملحّق حين يساوي الرصيد المتوقّع أو يزيد', () => {
    // مرّت 6 شهور × 500 = 3000 متوقّع
    const r = calculateObligation({ ...base, myFundBalance: 3000 })
    expect(r.monthsElapsed).toBe(6)
    expect(r.expectedBalance).toBe(3000)
    expect(r.gap).toBe(0)
    expect(r.status).toBe('on_track')
  })

  it('متأخر شوي حين تكون الفجوة قسطاً واحداً أو أقل', () => {
    const r = calculateObligation({ ...base, myFundBalance: 2600 })
    expect(r.gap).toBe(400)
    expect(r.status).toBe('slightly_behind')
  })

  it('متأخر حين تتجاوز الفجوة القسط', () => {
    const r = calculateObligation({ ...base, myFundBalance: 1000 })
    expect(r.gap).toBe(2000)
    expect(r.status).toBe('behind')
  })

  it('لا يخترع فجوة وهمية بعد اكتمال الصندوق', () => {
    // 20 شهراً مرّت × 500 = 10,000 وهو أكبر من المبلغ نفسه.
    const r = calculateObligation({
      ...base,
      cycleStartDate: '2024-12-02',
      myFundBalance: 6000,
    })
    expect(r.expectedBalance).toBe(6000)
    expect(r.status).toBe('on_track')
  })
})

describe('الالتزامات المشتركة', () => {
  it('يحسب القسط على حصتي أنا فقط', () => {
    const r = calculateObligation({
      totalAmount: 6000,
      mySharePercent: 50,
      myFundBalance: 0,
      nextDueDate: '2027-08-01',
      recurrenceMonths: 12,
      cycleStartDate: '2026-08-02',
      today: TODAY,
    })
    expect(r.myTotal).toBe(3000)
    expect(r.monthlyInstallment).toBe(250)
  })

  it('يحتفظ بالمبلغ الكامل للعرض ولا يخلطه بحصتي', () => {
    const r = calculateObligation({
      totalAmount: 6000,
      mySharePercent: 25,
      myFundBalance: 750,
      nextDueDate: '2027-08-01',
      recurrenceMonths: 12,
      cycleStartDate: '2026-08-02',
      today: TODAY,
    })
    expect(r.myTotal).toBe(1500)
    expect(r.progress).toBe(0.5)
  })
})

describe('الحالات الحدّية', () => {
  it('يعامل الموعد الفائت كشهر واحد ولا يقسم على صفر', () => {
    const r = calculateObligation({
      totalAmount: 1200,
      myFundBalance: 0,
      nextDueDate: '2026-06-01',
      recurrenceMonths: 12,
      cycleStartDate: '2025-06-01',
      today: TODAY,
    })
    expect(r.isOverdue).toBe(true)
    expect(r.monthsRemaining).toBe(1)
    expect(r.monthlyInstallment).toBe(1200)
  })

  it('يصفّر القسط حين يكتمل الصندوق', () => {
    const r = calculateObligation({
      totalAmount: 6000,
      myFundBalance: 6000,
      nextDueDate: '2027-08-01',
      recurrenceMonths: 12,
      cycleStartDate: '2026-08-02',
      today: TODAY,
    })
    expect(r.remainingAmount).toBe(0)
    expect(r.monthlyInstallment).toBe(0)
    expect(r.isBridge).toBe(false)
    expect(r.progress).toBe(1)
  })

  it('لا يصنّف الالتزام لمرة واحدة كدفعة مضغوطة', () => {
    const r = calculateObligation({
      totalAmount: 3000,
      myFundBalance: 0,
      nextDueDate: '2026-10-01',
      recurrenceMonths: 0,
      cycleStartDate: '2026-08-02',
      today: TODAY,
    })
    expect(r.isBridge).toBe(false)
    expect(r.monthlyInstallment).toBe(1500)
    expect(r.normalInstallment).toBe(1500)
  })

  // هدف الشراء التزامٌ لمرة واحدة، فما يصحّ عليه يصحّ على الهدف.
  it('هدف اكتمل: لا قسط باقٍ ولا مبلغ متبقٍّ', () => {
    const r = calculateObligation({
      totalAmount: 4000,
      myFundBalance: 4000,
      nextDueDate: '2027-01-01',
      recurrenceMonths: 0,
      cycleStartDate: '2026-08-02',
      today: TODAY,
    })
    expect(r.remainingAmount).toBe(0)
    expect(r.monthlyInstallment).toBe(0)
    expect(r.progress).toBe(1)
  })

  it('هدف تجاوز مبلغه: لا يعطي متبقّياً سالباً', () => {
    const r = calculateObligation({
      totalAmount: 4000,
      myFundBalance: 4500,
      nextDueDate: '2027-01-01',
      recurrenceMonths: 0,
      cycleStartDate: '2026-08-02',
      today: TODAY,
    })
    expect(r.remainingAmount).toBe(0)
    expect(r.monthlyInstallment).toBe(0)
  })

  it('هدف بعيد: القسط ينقسم على الشهور المتبقية كلها', () => {
    const r = calculateObligation({
      totalAmount: 6000,
      myFundBalance: 0,
      nextDueDate: '2027-08-01',
      recurrenceMonths: 0,
      cycleStartDate: '2026-08-02',
      today: TODAY,
    })
    expect(r.monthsRemaining).toBe(12)
    expect(r.monthlyInstallment).toBe(500)
    expect(r.isBridge).toBe(false)
  })

  it('يقرّب القسط لأعلى فلا ينقص الصندوق شيكلاً', () => {
    const r = calculateObligation({
      totalAmount: 1000,
      myFundBalance: 0,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 12,
      cycleStartDate: '2026-08-02',
      today: TODAY,
    })
    // 1000 ÷ 3 = 333.33 ← 334
    expect(r.monthlyInstallment).toBe(334)
  })
})

/*
 * حواف الساعة (تدقيق آب 2026: ل2): الموعد منتصفُ ليلٍ و`today` يحمل الساعة،
 * فكانت المقارنة الخام تُعلن «فات موعده» صباحَ يوم الاستحقاق نفسه — بينما
 * `commitments/due.ts` يصنّف اليوم نفسه «اليوم». كل اختبارات الملف كانت
 * بمنتصف الليل فلم يظهر الفرق.
 */
describe('يوم الاستحقاق نفسه', () => {
  const input = {
    totalAmount: 1200,
    myFundBalance: 0,
    nextDueDate: '2026-08-14',
    recurrenceMonths: 12,
    cycleStartDate: '2026-08-01',
  }

  it('صباحُه ليس «فات موعده»', () => {
    const r = calculateObligation({ ...input, today: new Date('2026-08-14T10:00:00') })
    expect(r.isOverdue).toBe(false)
  })

  it('واليوم التالي فات فعلاً — بأي ساعة', () => {
    const r = calculateObligation({ ...input, today: new Date('2026-08-15T08:00:00') })
    expect(r.isOverdue).toBe(true)
  })
})
