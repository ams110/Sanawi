import { describe, expect, it } from 'vitest'
import { formatMoney } from './format'

describe('formatMoney', () => {
  it('الرمز ثم المبلغ بأرقام لاتينية', () => {
    expect(formatMoney(1234)).toBe('₪ 1,234')
  })

  it('السالب بعلامة سالب حقيقية', () => {
    expect(formatMoney(-1234)).toBe('₪ −1,234')
  })

  // التقريب قبل فحص الإشارة: ‏−0.4 كانت تخرج «₪ −0». (تدقيق آب 2026: ل7)
  it('سالبٌ صغير يُقرَّب صفراً بلا إشارة', () => {
    expect(formatMoney(-0.4)).toBe('₪ 0')
    expect(formatMoney(-0.5, 'ILS', 1)).toBe('₪ −0.5')
  })

  it('عملة غير معروفة تُعرض برمزها كما ورد', () => {
    expect(formatMoney(10, 'XYZ')).toBe('XYZ 10')
  })
})
