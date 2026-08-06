import { describe, expect, it } from 'vitest'
import { validateShares, type PartnerShareDraft } from './api'

const partner = (name: string, sharePercent: number): PartnerShareDraft => ({
  partnerId: null,
  name,
  sharePercent,
})

describe('التحقق من الحصص', () => {
  it('يقبل التزاماً كله عليّ', () => {
    expect(validateShares(100, [])).toBeNull()
  })

  it('يرفض حصة ناقصة بلا شركاء', () => {
    expect(validateShares(60, [])).toEqual({ code: 'mustBe100' })
  })

  it('يقبل مناصفة مع شريك واحد', () => {
    expect(validateShares(50, [partner('أخوي', 50)])).toBeNull()
  })

  it('يقبل ثلاثة شركاء مجموعهم 100', () => {
    expect(validateShares(40, [partner('أخوي', 35), partner('أبوي', 25)])).toBeNull()
  })

  it('يرفض مجموعاً أقل من 100', () => {
    expect(validateShares(50, [partner('أخوي', 30)])).toEqual({
      code: 'sumMismatch',
      percent: 80,
    })
  })

  it('يرفض مجموعاً أكثر من 100', () => {
    expect(validateShares(70, [partner('أخوي', 50)])).toEqual({
      code: 'sumMismatch',
      percent: 120,
    })
  })

  it('يرفض شريكاً بحصة بلا اسم', () => {
    expect(validateShares(50, [partner('   ', 50)])).toEqual({ code: 'needName' })
  })

  it('يتجاهل صفاً فارغاً تماماً فلا يعيق الحفظ', () => {
    // صف أضافه المستخدم ثم تركه فارغاً — ليس خطأً، فقط لا يُحفظ.
    expect(validateShares(50, [partner('أخوي', 50), partner('', 0)])).toBeNull()
  })

  it('يتسامح مع كسور التقريب', () => {
    expect(validateShares(33.34, [partner('أ', 33.33), partner('ب', 33.33)])).toBeNull()
  })
})
