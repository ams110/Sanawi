import { describe, expect, it } from 'vitest'
import { renewAfterPayment } from './renewal'

const PAID = new Date('2026-11-01T00:00:00')

describe('التجديد بعد الدفع', () => {
  it('يقدّم الموعد بمقدار الدورة', () => {
    const r = renewAfterPayment({
      totalAmount: 6000,
      myFundBalance: 6000,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 12,
      paidDate: PAID,
    })
    // حقول التقويم المحلي لا toISOString: الأخيرة تنزلق يوماً في أي منطقة موجبة.
    expect(r.nextDueDate?.getFullYear()).toBe(2027)
    expect(r.nextDueDate?.getMonth()).toBe(10)
    expect(r.nextDueDate?.getDate()).toBe(1)
  })

  it('ينزل بالقسط بعد اكتمال الدورة — أهم أثر للتجديد', () => {
    // كان القسط 2,000 في دورة الجسر المضغوطة، ويصير 500 على دورة كاملة.
    const r = renewAfterPayment({
      totalAmount: 6000,
      myFundBalance: 6000,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 12,
      paidDate: PAID,
    })
    expect(r.newInstallment).toBe(500)
  })

  it('يرحّل الفائض ويخفض القسط أكثر', () => {
    const r = renewAfterPayment({
      totalAmount: 6000,
      myFundBalance: 6600,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 12,
      paidDate: PAID,
    })
    expect(r.amountPaid).toBe(6000)
    expect(r.carriedBalance).toBe(600)
    // ‏(6000 − 600) ÷ 12 = 450
    expect(r.newInstallment).toBe(450)
  })

  it('يصرّح بالنقص بدل أن يخفيه', () => {
    const r = renewAfterPayment({
      totalAmount: 6000,
      myFundBalance: 4500,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 12,
      paidDate: PAID,
    })
    expect(r.amountPaid).toBe(4500)
    expect(r.shortfall).toBe(1500)
    expect(r.carriedBalance).toBe(0)
  })

  it('لا يسحب من الصندوق أكثر مما فيه', () => {
    const r = renewAfterPayment({
      totalAmount: 6000,
      myFundBalance: 0,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 12,
      paidDate: PAID,
    })
    expect(r.amountPaid).toBe(0)
    expect(r.shortfall).toBe(6000)
  })

  it('يحسب على حصتي في الالتزام المشترك', () => {
    const r = renewAfterPayment({
      totalAmount: 6000,
      mySharePercent: 50,
      myFundBalance: 3000,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 12,
      paidDate: PAID,
    })
    expect(r.amountPaid).toBe(3000)
    expect(r.shortfall).toBe(0)
    expect(r.newInstallment).toBe(250)
  })

  it('ينهي الالتزام لمرة واحدة بلا موعد قادم', () => {
    const r = renewAfterPayment({
      totalAmount: 3000,
      myFundBalance: 3000,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 0,
      paidDate: PAID,
    })
    expect(r.nextDueDate).toBeNull()
    expect(r.isFinished).toBe(true)
    expect(r.newInstallment).toBe(0)
  })

  it('يبدأ الدورة من تاريخ الدفع لا من الموعد القديم', () => {
    const r = renewAfterPayment({
      totalAmount: 6000,
      myFundBalance: 6000,
      nextDueDate: '2026-11-01',
      recurrenceMonths: 6,
      paidDate: PAID,
    })
    expect(r.cycleStartDate).toEqual(PAID)
    expect(r.newInstallment).toBe(1000)
  })
})
