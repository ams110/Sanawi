import { describe, expect, it } from 'vitest'
import { shouldRemind } from './cadence'

const remind = (entryMonths: string[], thisMonth = '2026-08') =>
  shouldRemind({ entryMonths, thisMonth })

describe('عادة المصدر تُتعلَّم من سجلّه', () => {
  it('الشهري يُذكَّر بعد شهرٍ واحد', () => {
    expect(remind(['2026-07', '2026-06', '2026-05'])).toBe(true)
  })

  /*
   * العطل الذي وُلدت هذه الدالّة لأجله: مصدرٌ ربعيّ كان يظهر في القائمة
   * شهرين من كل ثلاثة، وهو ليس متأخّراً في شيء.
   */
  it('الربعيّ يسكت في شهرَي الانتظار', () => {
    const quarterly = ['2026-07', '2026-04', '2026-01']
    expect(shouldRemind({ entryMonths: quarterly, thisMonth: '2026-08' })).toBe(false)
    expect(shouldRemind({ entryMonths: quarterly, thisMonth: '2026-09' })).toBe(false)
  })

  it('ويُذكَّر حين تحلّ عادته', () => {
    expect(shouldRemind({ entryMonths: ['2026-07', '2026-04', '2026-01'], thisMonth: '2026-10' })).toBe(
      true,
    )
  })

  // لا سجلَّ = لا ادّعاء. مصدرٌ أُضيف ولم يصل منه شيءٌ قطّ لا يُنبَّه عليه:
  // التطبيق لا يملك سبباً واحداً للاعتقاد بأن شيئاً منه مستحقّ.
  it('مصدرٌ بلا سجلٍّ لا يُذكَّر به', () => {
    expect(remind([])).toBe(false)
  })

  it('وسُجّل هذا الشهر: لا شيء يُنتظر', () => {
    expect(remind(['2026-08', '2026-07'])).toBe(false)
  })

  // السقف يُسكت الميت: من ترك شغلاً ولم يؤرشف مصدره لا يستحقّ سطراً أبدياً.
  it('يسكت بعد ضعف العادة', () => {
    expect(shouldRemind({ entryMonths: ['2026-06', '2026-05'], thisMonth: '2026-08' })).toBe(true)
    expect(shouldRemind({ entryMonths: ['2026-05', '2026-04'], thisMonth: '2026-08' })).toBe(false)
  })

  it('قبضةٌ واحدة تُعامَل عادةً شهرية ثم تسكت', () => {
    expect(shouldRemind({ entryMonths: ['2026-07'], thisMonth: '2026-08' })).toBe(true)
    expect(shouldRemind({ entryMonths: ['2026-06'], thisMonth: '2026-08' })).toBe(true)
    expect(shouldRemind({ entryMonths: ['2026-05'], thisMonth: '2026-08' })).toBe(false)
  })

  /*
   * انتقال كانون أول ← ثاني (قاعدة 7): الشهر محسوبٌ على محورٍ واحد
   * `سنة × 12 + شهر`، فلا يحتاج حدُّ السنة حالةً خاصّة — ولو حُسب بطرح
   * رقمَي الشهر لصار ‏1 − 12 = ‏−11 وسكت المصدر إلى الأبد.
   */
  it('يعبر حدّ السنة', () => {
    expect(shouldRemind({ entryMonths: ['2025-12', '2025-11'], thisMonth: '2026-01' })).toBe(true)
    expect(shouldRemind({ entryMonths: ['2025-10', '2025-07'], thisMonth: '2026-01' })).toBe(true)
    expect(shouldRemind({ entryMonths: ['2025-11', '2025-10'], thisMonth: '2026-01' })).toBe(true)
    expect(shouldRemind({ entryMonths: ['2025-08', '2025-07'], thisMonth: '2026-01' })).toBe(false)
  })

  it('الشهر المكرّر شهرٌ واحد', () => {
    // قبضتان في تموز لا تصنعان فجوةً صفرية تُفسد الوسيط.
    expect(shouldRemind({ entryMonths: ['2026-07', '2026-07', '2026-06'], thisMonth: '2026-08' })).toBe(
      true,
    )
  })

  // بوّابة المدخل الفاسد (قاعدة 6): مفتاحٌ مشوّه يُهمَل ولا يُسقط الحسبة.
  it('مفاتيح فاسدة تُهمَل', () => {
    expect(shouldRemind({ entryMonths: ['حزيران', '2026-13', ''], thisMonth: '2026-08' })).toBe(false)
    expect(shouldRemind({ entryMonths: ['2026-07', 'خربوش'], thisMonth: '2026-08' })).toBe(true)
    expect(shouldRemind({ entryMonths: ['2026-07'], thisMonth: 'لا شهر' })).toBe(false)
  })

  // قبضةٌ بتاريخٍ مستقبلي لا تجعل «منذ» سالباً فيُذكَّر بما لم يحن.
  it('قبضةٌ في شهرٍ قادم لا تُنتج تذكيراً', () => {
    expect(shouldRemind({ entryMonths: ['2026-09'], thisMonth: '2026-08' })).toBe(false)
  })
})
