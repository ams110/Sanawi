import { describe, expect, it } from 'vitest'
import { isNewBuild, readBuildId } from './version'

describe('هل النسخة المحمَّلة قديمة', () => {
  it('رقمان مختلفان: نعم', () => {
    expect(isNewBuild('e358f41', '8bb0a93')).toBe(true)
  })

  it('الرقم نفسه: لا', () => {
    expect(isNewBuild('e358f41', 'e358f41')).toBe(false)
  })

  /*
   * الفراغ يقع كثيراً: ملفٌ لم يُنشر بعد، أو ردٌّ قطعه الوكيل. وقراءته
   * «تغيّرت النسخة» تعيد التحميل بلا سبب.
   */
  it('وفراغٌ في أيّ طرف: لا', () => {
    expect(isNewBuild('', 'e358f41')).toBe(false)
    expect(isNewBuild('e358f41', '')).toBe(false)
  })

  it('والتطوير لا يُقارَن: كل تحميلٍ محلّي رقمه dev', () => {
    expect(isNewBuild('dev', 'e358f41')).toBe(false)
    expect(isNewBuild('e358f41', 'dev')).toBe(false)
  })
})

describe('قراءة ملف النسخة', () => {
  it('الشكل المتوقَّع', () => {
    expect(readBuildId({ build: 'e358f41' })).toBe('e358f41')
  })

  it('والمسافات تُقصّ — سطرٌ في آخر الملف ليس جزءاً من الرقم', () => {
    expect(readBuildId({ build: ' e358f41\n' })).toBe('e358f41')
  })

  // صفحة HTML من موجّهٍ يردّ الفهرس لكل مسارٍ مفقود: `json()` قد تفشل، وإن
  // نجحت فما فيها ليس رقماً.
  it('وما ليس شكلاً متوقَّعاً يُقرأ فراغاً', () => {
    expect(readBuildId(null)).toBe('')
    expect(readBuildId('e358f41')).toBe('')
    expect(readBuildId({ build: 7 })).toBe('')
    expect(readBuildId({})).toBe('')
  })
})
