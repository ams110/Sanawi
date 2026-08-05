import { describe, expect, it } from 'vitest'
import { spendingBaseline } from './baseline'

describe('خطّ الأساس للمصروف', () => {
  it('يأخذ متوسط الشهور المكتملة', () => {
    const base = spendingBaseline({
      completedMonths: [4000, 5000, 3000],
      currentMonthProjection: 99999,
    })
    expect(base.monthly).toBe(4000)
    expect(base.monthsUsed).toBe(3)
    expect(base.isProvisional).toBe(false)
  })

  /*
   * سببُ وجود هذا الملف كلّه: إسقاطُ اليوم الأول كان يقفز بالمصروف السنوي
   * ربعَ مليون ثم يعود بعد أسبوع.
   */
  it('لا يلتفت إلى إسقاط الشهر الجاري ما دام ثمّة شهر مكتمل', () => {
    const sane = spendingBaseline({ completedMonths: [4000], currentMonthProjection: 24800 })
    expect(sane.monthly).toBe(4000)
  })

  it('لا يتجاوز نافذته مهما طال التاريخ', () => {
    const base = spendingBaseline({
      completedMonths: [3000, 3000, 3000, 100000],
      currentMonthProjection: 0,
      window: 3,
    })
    expect(base.monthsUsed).toBe(3)
    expect(base.monthly).toBe(3000)
  })

  it('يقع على إسقاط الشهر الجاري حين لا شهر مكتمل، ويعلن أنه مبدئي', () => {
    const base = spendingBaseline({ completedMonths: [], currentMonthProjection: 4200 })
    expect(base.monthly).toBe(4200)
    expect(base.monthsUsed).toBe(0)
    expect(base.isProvisional).toBe(true)
  })

  /* شهرٌ بلا مصاريف شهرٌ رخيص لا شهرٌ مفقود: صفرُه يدخل المتوسط ويخفضه. */
  it('يحتسب الشهر الصفري ولا يتخطّاه', () => {
    const base = spendingBaseline({ completedMonths: [6000, 0], currentMonthProjection: 0 })
    expect(base.monthly).toBe(3000)
    expect(base.monthsUsed).toBe(2)
  })

  it('يطرح الأرقام الفاسدة ولا يسمّم المتوسط بها', () => {
    const base = spendingBaseline({
      completedMonths: [4000, Number.NaN, -50, 2000],
      currentMonthProjection: 0,
    })
    expect(base.monthly).toBe(3000)
    expect(base.monthsUsed).toBe(2)
  })

  it('لا يُخرج رقماً فاسداً ولو كان كل مُدخَل فاسداً', () => {
    const base = spendingBaseline({
      completedMonths: [Number.NaN],
      currentMonthProjection: Number.POSITIVE_INFINITY,
    })
    expect(Number.isFinite(base.monthly)).toBe(true)
    expect(base.monthly).toBe(0)
  })
})

/*
 * الفرق بين «ما صرفت» و«ما كنت هون».
 *
 * كشفه npm run check:mcp: القاعدة المزيّفة بلا شهورٍ ماضية، فقُرئ غيابها
 * أصفاراً وصار خطّ الأساس صفراً — ورقمُ الحرية صفراً — فقال التطبيق لمن
 * عنده 425 ألفاً وفواتيرُ شهرية إنه «حرٌّ ماليّاً».
 */
describe('الغياب ليس صفراً', () => {
  it('يتخطّى الشهور المجهولة ولا يحتسبها صفراً', () => {
    const base = spendingBaseline({
      completedMonths: [null, null, 4000],
      currentMonthProjection: 9000,
    })
    expect(base.monthly).toBe(4000)
    expect(base.monthsUsed).toBe(1)
  })

  it('كل الشهور مجهولة يعني رقماً مبدئياً من الشهر الجاري', () => {
    const base = spendingBaseline({
      completedMonths: [null, null, null],
      currentMonthProjection: 3300,
    })
    expect(base.monthly).toBe(3300)
    expect(base.isProvisional).toBe(true)
  })
})
