/**
 * هل النسخة المحمَّلة قديمة؟
 *
 * قرارٌ صغير، وخطؤه في اتجاهٍ واحد مكلف: «قديمة» وهي ليست كذلك يعني إعادة
 * تحميلٍ لا تغيّر شيئاً — وإن تكرّرت صارت حلقةً تفتح التطبيق وتغلقه أمام
 * صاحبه. فالصمت هو الافتراضي كلما نقص اليقين: بلا رقمين واضحين مختلفين لا
 * يُقال شيء.
 */

/** رقم بناء التطوير: لا يُقارَن بشيء — كل تحميلٍ محلّي يولّده من جديد. */
const DEV = 'dev'

export function isNewBuild(current: string, latest: string): boolean {
  if (!current || !latest) return false
  if (current === DEV || latest === DEV) return false
  return current !== latest
}

/**
 * قراءة `version.json` بلا ثقة.
 *
 * الردّ قد يكون صفحة خطأ من الوكيل أو HTML من موجّهٍ يردّ الفهرس لكل مسار
 * غير موجود — وكلاهما ليس رقم بناء. فما ليس نصاً في `build` يُقرأ فراغاً،
 * والفراغ لا يُطلق شيئاً.
 */
export function readBuildId(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const value = (payload as { build?: unknown }).build
  return typeof value === 'string' ? value.trim() : ''
}
