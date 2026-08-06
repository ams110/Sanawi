import { describe, expect, it } from 'vitest'
import { planPayment, type PaymentPlanInput } from './payment'

const input = (over: Partial<PaymentPlanInput> = {}): PaymentPlanInput => ({
  totalAmount: 6000,
  mySharePercent: 100,
  myFundBalance: 6000,
  nextDueDate: '2027-01-15',
  recurrenceMonths: 12,
  paidDate: new Date('2026-08-06T00:00:00'),
  ...over,
})

describe('أثر الدفع كلّه', () => {
  it('ما خرج من البنك = ما في الصندوق + ما غُطّي من الجيب', () => {
    const plan = planPayment(input({ myFundBalance: 4000, fundAccountId: 'a' }))
    expect(plan.renewal.amountPaid).toBe(4000)
    expect(plan.renewal.shortfall).toBe(2000)
    expect(plan.withdrawn).toBe(6000)
  })

  /*
   * خصمُ `amountPaid` وحده — وهو الرقم الظاهر — يترك الرصيد أعلى من الحقيقة
   * بمقدار النقص: التطبيق يَعِد بمالٍ أُنفق فعلاً.
   */
  it('والنقص لا يسقط من الخصم', () => {
    const plan = planPayment(input({ myFundBalance: 0, fundAccountId: 'a' }))
    expect(plan.renewal.amountPaid).toBe(0)
    expect(plan.withdrawn).toBe(6000)
    expect(plan.chargeAccountId).toBe('a')
  })

  it('الفائض يُرحَّل ولا يخرج من البنك', () => {
    const plan = planPayment(input({ myFundBalance: 7000, fundAccountId: 'a' }))
    expect(plan.renewal.carriedBalance).toBe(1000)
    expect(plan.withdrawn).toBe(6000)
  })

  it('الافتراضي: يُدفع من حساب الصندوق', () => {
    expect(planPayment(input({ fundAccountId: 'a' })).chargeAccountId).toBe('a')
  })

  it('والدفع من حساب الصندوق نفسه لا يفتح تسوية', () => {
    const plan = planPayment(input({ fundAccountId: 'a', paidFromAccountId: 'a' }))
    expect(plan.settlement).toBe(null)
  })

  /*
   * الدفع من حسابٍ آخر: حساب الصندوق تحرّر ماله بلا أن ينقص رصيده، والحساب
   * الدافع نقص — فالأول مدينٌ للثاني.
   */
  it('الدفع من حسابٍ آخر يفتح تسوية بما تحرّر', () => {
    const plan = planPayment(input({ fundAccountId: 'a', paidFromAccountId: 'b' }))
    expect(plan.chargeAccountId).toBe('b')
    expect(plan.settlement).toEqual({
      debtorAccountId: 'a',
      creditorAccountId: 'b',
      amount: 6000,
    })
  })

  // التسوية بما كان في الصندوق لا بما خرج: النقص المغطّى من الجيب لم يكن في
  // حساب الصندوق أصلاً، فلا يُطالَب به.
  it('والتسوية بما كان في الصندوق لا بما خرج', () => {
    const plan = planPayment(
      input({ myFundBalance: 2000, fundAccountId: 'a', paidFromAccountId: 'b' }),
    )
    expect(plan.withdrawn).toBe(6000)
    expect(plan.settlement?.amount).toBe(2000)
  })

  it('وصندوقٌ فارغٌ لا يفتح تسوية — لا شيء تحرّر', () => {
    const plan = planPayment(
      input({ myFundBalance: 0, fundAccountId: 'a', paidFromAccountId: 'b' }),
    )
    expect(plan.settlement).toBe(null)
    expect(plan.chargeAccountId).toBe('b')
  })

  it('صندوقٌ غير مربوط: لا رصيد يُمسّ ولا تسوية', () => {
    const plan = planPayment(input({ fundAccountId: null }))
    expect(plan.chargeAccountId).toBe(null)
    expect(plan.settlement).toBe(null)
    // والتجديد يقع كما كان: عدمُ الربط لا يمنع الدفع.
    expect(plan.renewal.amountPaid).toBe(6000)
  })

  it('غير مربوطٍ ومعه حساب دفعٍ صريح: يُخصم منه بلا تسوية', () => {
    const plan = planPayment(input({ fundAccountId: null, paidFromAccountId: 'b' }))
    expect(plan.chargeAccountId).toBe('b')
    expect(plan.settlement).toBe(null)
  })

  it('التزامٌ بصفر لا يمسّ رصيداً', () => {
    const plan = planPayment(input({ totalAmount: 0, myFundBalance: 0, fundAccountId: 'a' }))
    expect(plan.withdrawn).toBe(0)
    expect(plan.chargeAccountId).toBe(null)
  })

  it('الحصّة المشتركة: ما يخرج حصّتي لا المبلغ الكامل', () => {
    const plan = planPayment(
      input({ mySharePercent: 50, myFundBalance: 3000, fundAccountId: 'a' }),
    )
    expect(plan.withdrawn).toBe(3000)
    expect(plan.renewal.shortfall).toBe(0)
  })
})
