import { describe, expect, it } from 'vitest'
import { toDateKey, toMonthKey } from './date'

/*
 * هذه الاختبارات تُشغَّل على UTC في التطوير و CI، وهي المنطقة الوحيدة التي
 * يكون فيها فرق `toISOString` صفراً. لذلك تُبنى التواريخ هنا بـ `new Date(y,m,d)`
 * — تقويماً محلياً — لا بنصٍّ ISO: هكذا تفشل الاختبارات فعلاً حين يعود أحدٌ
 * إلى `toISOString`، أياً كانت منطقة من يشغّلها.
 */
describe('مفتاح التاريخ', () => {
  it('يبني من التقويم المحلي لا من UTC', () => {
    expect(toDateKey(new Date(2026, 7, 1))).toBe('2026-08-01')
    expect(toDateKey(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('يصفّر الخانات', () => {
    expect(toDateKey(new Date(2026, 2, 5))).toBe('2026-03-05')
  })
})

describe('مفتاح الشهر', () => {
  it('يرجع أول يوم في الشهر', () => {
    expect(toMonthKey(new Date(2026, 7, 17))).toBe('2026-08-01')
    expect(toMonthKey(new Date(2026, 7, 1))).toBe('2026-08-01')
  })

  it('لا يقفز إلى الشهر السابق عند أول الشهر', () => {
    expect(toMonthKey(new Date(2027, 0, 1))).toBe('2027-01-01')
  })
})
