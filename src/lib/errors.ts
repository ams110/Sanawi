/**
 * لماذا فشل، بلغةٍ يفهمها صاحبه.
 *
 * كان في التطبيق أربعةٌ وثلاثون موضعاً بهذا الشكل:
 *
 *     setError(err instanceof Error ? err.message : t('expenses.saveFailed'))
 *
 * والفرع العربي فيها **ميتٌ كلّه**: `PostgrestError` يرث `Error`، فالشرط صحيحٌ
 * في كل فشلٍ من القاعدة ولا يُنفَّذ الفرع الثاني أبداً. فمن يودع والشبكة ضعيفة
 * في السيارة يقرأ «TypeError: Failed to fetch»، ومن تمنعه سياسة يقرأ
 * «new row violates row-level security policy for table "fund_deposits"».
 *
 * وأثر ذلك ليس في الفهم وحده: من لا يعرف هل حُفظ المبلغ أم لا **يعيده** —
 * وهذا ثاني أكبر مولّد للإيداع المكرّر بعد غياب التأكيد.
 *
 * والقاعدة هنا: نقول **ما فشل** و**لماذا** معاً. «ما قدرنا نسجّل المصروف» وحدها
 * لا تقول للمستخدم ماذا يفعل؛ ومعها «ما وصلنا للإنترنت» يعرف أن يعيد المحاولة،
 * أو أن المشكلة ليست عنده فلا يعيد.
 *
 * ملف نقي: لا React ولا Supabase ولا i18next. يُخرج **تصنيفاً** لا نصّاً،
 * وتحويلُه إلى جملةٍ عربية في `src/lib/i18n/failure.ts` — حيث تعيش المفاتيح
 * مكتوبةَ النوع كما يشترط `i18next.d.ts`.
 */

export type FailureKind =
  /** لم يصل النداء أصلاً — شبكةٌ منقطعة أو خادمٌ لا يردّ. */
  | 'offline'
  /** وصل ورفضته سياسات RLS: الصفّ ليس لهذا الحساب. */
  | 'denied'
  /** الجلسة انتهت — يحتاج دخولاً جديداً. */
  | 'expired'
  /** صفٌّ موجود مسبقاً بنفس المفتاح. */
  | 'duplicate'
  /** قيمةٌ ترفضها القاعدة: مبلغٌ سالب، نسبةٌ خارج المدى، حقلٌ مطلوب فارغ. */
  | 'invalid'
  /** لا صفّ بهذا المعرّف — أو أنه لا يخصّ هذا الحساب. */
  | 'missing'
  | 'unknown'

export interface Failure {
  kind: FailureKind
  /** الأصل الكامل — للطرفية والتشخيص، لا للعرض. */
  detail: string
}

interface ErrorLike {
  message?: unknown
  code?: unknown
  name?: unknown
  status?: unknown
}

/**
 * تصنيف الفشل.
 *
 * لا نشترط `instanceof Error` — وهو الخطأ الذي وُلد منه هذا الملف من الجهة
 * المقابلة: `supabase-js` لا يبني صنف الخطأ إلا مع `throwOnError`، فبعض ما
 * يصل كائنٌ عاديّ. نقرأ الحقول التي نعرفها ولا نسأل عن النسب.
 */
export function readFailure(error: unknown): Failure {
  const shaped: ErrorLike = typeof error === 'object' && error !== null ? error : {}
  const message = typeof shaped.message === 'string' ? shaped.message : String(error ?? '')
  const code = typeof shaped.code === 'string' ? shaped.code : ''
  const name = typeof shaped.name === 'string' ? shaped.name : ''
  const status = typeof shaped.status === 'number' ? shaped.status : 0
  const detail = code ? `${code}: ${message}` : message

  const of = (kind: FailureKind): Failure => ({ kind, detail })

  /*
   * الشبكة أولاً.
   *
   * `fetch` يرمي `TypeError` عند الانقطاع، و`supabase-js` يلفّه أحياناً في
   * `AuthRetryableFetchError`. وهي أكثر حالات الفشل وقوعاً على تلفونٍ يتنقّل،
   * وأهمّها تمييزاً: وحدها تعني «أعد المحاولة»، وما عداها يعني «لا تُعِد».
   */
  if (
    name === 'TypeError' ||
    name === 'AuthRetryableFetchError' ||
    /failed to fetch|networkerror|network request failed|load failed/i.test(message)
  ) {
    return of('offline')
  }

  switch (code) {
    case '42501':
      return of('denied')
    case 'PGRST301':
      return of('expired')
    case '23505':
      return of('duplicate')
    case '23514':
    case '23502':
    case '23503':
    case '22P02':
      return of('invalid')
    case 'PGRST116':
      return of('missing')
    default:
      break
  }

  if (status === 401 || /jwt expired|invalid claim/i.test(message)) return of('expired')
  if (status === 403 || /row-level security/i.test(message)) return of('denied')

  return of('unknown')
}
