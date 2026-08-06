import { readFailure } from '@/lib/errors'
import type { Translate } from './translate'

/**
 * الفشل جملةً عربية: ما فشل، ثم لماذا.
 *
 * التصنيف يقع في `src/lib/errors.ts` — ملفٌّ نقيّ لا يعرف الترجمة — وهنا
 * وحده تُربط الأصناف بمفاتيحها، مكتوبةً حرفياً ليبقى حارس `i18next.d.ts`
 * قائماً: مفتاحٌ مكسور خطأُ بناءٍ لا نصٌّ مفقود يظهر بعد النشر.
 */
/**
 * `context` نصٌّ مترجَمٌ لا مفتاح.
 *
 * تمريرُ المفتاح كان يجرّ نوع مفاتيح i18next كلَّه إلى توقيع هذه الدالّة،
 * وهو اتحادٌ ضخم يُفشل المترجم بـ«type instantiation is excessively deep».
 * وتمريرُ النصّ يُبقي التدقيق حيث يجب أن يكون: عند `t('...')` في الشاشة.
 */
export function failureText(error: unknown, t: Translate, context?: string): string {
  const { kind, detail } = readFailure(error)

  // الأصل يبقى مقروءاً لمن يفتح الطرفية، ولا يصل الشاشة أبداً.
  console.error('[sanawi]', detail, error)

  const reason =
    kind === 'offline'
      ? t('errors.offline')
      : kind === 'denied'
        ? t('errors.denied')
        : kind === 'expired'
          ? t('errors.expired')
          : kind === 'duplicate'
            ? t('errors.duplicate')
            : kind === 'invalid'
              ? t('errors.invalid')
              : kind === 'missing'
                ? t('errors.missing')
                : t('errors.unknown')

  return context ? `${context} — ${reason}` : reason
}
