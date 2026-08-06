import { describe, expect, it } from 'vitest'
import { readFailure } from './errors'

/**
 * الأشكال هنا منسوخةٌ عن الواقع لا مخترعة.
 *
 * `PostgrestError` يرث `Error` — وهذا بالضبط ما قتل الفرع العربي في أربعةٍ
 * وثلاثين موضعاً — فنبنيه هنا وارثاً كذلك، وإلا فحصنا شكلاً لا يقع.
 */
class PostgrestErrorLike extends Error {
  code: string
  details: string | null
  hint: string | null

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PostgrestError'
    this.code = code
    this.details = null
    this.hint = null
  }
}

describe('تصنيف الفشل', () => {
  it('انقطاع الشبكة يُعرف من TypeError', () => {
    const failure = readFailure(new TypeError('Failed to fetch'))
    expect(failure.kind).toBe('offline')
  })

  it('ولو جاء ملفوفاً باسم supabase', () => {
    const wrapped = new Error('Network request failed')
    wrapped.name = 'AuthRetryableFetchError'
    expect(readFailure(wrapped).kind).toBe('offline')
  })

  it('رفض RLS يُعرف من الرمز', () => {
    const failure = readFailure(
      new PostgrestErrorLike('42501', 'new row violates row-level security policy'),
    )
    expect(failure.kind).toBe('denied')
  })

  it('الجلسة المنتهية تُميَّز عن الرفض', () => {
    expect(readFailure(new PostgrestErrorLike('PGRST301', 'JWT expired')).kind).toBe('expired')
  })

  it('القيمة المرفوضة من قيد', () => {
    expect(
      readFailure(new PostgrestErrorLike('23514', 'violates check constraint')).kind,
    ).toBe('invalid')
  })

  it('الصفّ المكرّر', () => {
    expect(readFailure(new PostgrestErrorLike('23505', 'duplicate key')).kind).toBe('duplicate')
  })

  /*
   * `supabase-js` لا يبني صنف الخطأ إلا مع `throwOnError`، فبعض ما يصل كائنٌ
   * عاديّ. واشتراط `instanceof Error` هو ما ابتلع أخطاء القاعدة في خادم MCP
   * مرّةً وحوّلها إلى «[object Object]».
   */
  it('كائنٌ عاديّ بلا نسب يُصنَّف كما يُصنَّف الخطأ', () => {
    expect(readFailure({ code: '42501', message: 'denied' }).kind).toBe('denied')
  })

  it('ما لا نعرفه يبقى مجهولاً ولا يُخترع له تشخيص', () => {
    expect(readFailure(new Error('something odd')).kind).toBe('unknown')
    expect(readFailure(null).kind).toBe('unknown')
    expect(readFailure('نصّ حرّ').kind).toBe('unknown')
  })

  it('الأصل الكامل يبقى في detail للطرفية', () => {
    const failure = readFailure(new PostgrestErrorLike('42501', 'row-level security'))
    expect(failure.detail).toContain('42501')
    expect(failure.detail).toContain('row-level security')
  })
})
