import { useState } from 'react'

/**
 * حقل مبلغ لا يُمسح تحت الإصبع.
 *
 * كان في التطبيق واحدٌ وعشرون حقل مبلغ بهذا الشكل:
 *
 *     value={amount || ''}
 *     onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
 *
 * وفيه عطلان يقعان كل يوم:
 *
 * ١) **النقطة العشرية تمسح ما كُتب.** `input[type=number]` يردّ قيمةً فارغة ما
 *    دام المكتوب ليس رقماً تامّاً، و«12.» ليست رقماً تامّاً. فمن يكتب 12.50
 *    يرى الحقل يُمسح عند النقطة، ثم يكتب 50 فيُسجَّل **50** بدل 12.50. وهذا
 *    يقع واقفاً عند الكاشير بيدٍ واحدة.
 *
 * ٢) **الصفر مستحيلٌ كتابةً.** من يكتب «0.9» تصير حالته `0`، فتصير قيمة الحقل
 *    `''` بينما `node.value` هو `"0"`، فيفرض React المسح.
 *
 * والعلاج معروفٌ في هذا المستودع وموثَّقٌ بنصّه — ومطبَّقٌ على حقلين من واحدٍ
 * وعشرين: **المبلغ نصٌّ في الحالة، ورقمٌ عند الإرسال وحده.** فما بين الضغطتين
 * يبقى كما كتبه صاحبه، ولا يمرّ على `Number` إلا حين يُحفظ.
 *
 * والفاصلة تُقبل: لوحة الأرقام العربية على أندرويد تعطي «٫» أو «,» لا «.»،
 * و`input[type=number]` يرفضها فيقف المستخدم أمام حقلٍ لا يقبل ما تكتبه لوحته.
 */

/** يقبل الفاصلة والنقطة والأرقام العربية-الهندية. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g

function normalize(raw: string): string {
  return raw
    .replace(ARABIC_DIGITS, (d) => String((d.codePointAt(0)! - 0x0660) % 10))
    .replace(/[٫,]/g, '.')
    .trim()
}

/**
 * قراءة نصّ الحقل رقماً.
 *
 * `NaN` تصير `null` لا صفراً: الصفر قيمةٌ مشروعة يكتبها المستخدم عمداً
 * (فاتورةٌ بصفر)، وخلطُه بالفراغ يجعل «لم يكتب شيئاً» و«كتب صفراً» حالةً واحدة.
 */
export function readAmount(raw: string): number | null {
  const text = normalize(raw)
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export interface AmountField {
  /** ما كُتب حرفياً — يُسنَد إلى `value` بلا تحويل. */
  text: string
  set: (raw: string) => void
  /** الرقم عند الإرسال، أو `fallback` إن كان الحقل فارغاً. */
  value: number
  /** الحقل فارغٌ فعلاً — لا صفرٌ مكتوب. */
  isEmpty: boolean
  /** صالحٌ للإرسال: مكتوبٌ أو له افتراضي، وموجب. */
  isValid: boolean
  reset: (raw?: string) => void
  /** خصائص تُنثر على `<input>` مباشرةً، فلا يُنسى `inputMode` في موضع. */
  props: {
    type: 'text'
    inputMode: 'decimal'
    value: string
    onChange: (event: { target: { value: string } }) => void
  }
}

/**
 * `fallback` هو معنى الحقل الفارغ.
 *
 * في الإيداع هو القسط الشهري: الحقل يبدأ فارغاً ويكتب المستخدم رقماً إن أراد
 * غيره، فيبقى الطريق السريع ضغطةً واحدة بلا كتابة. وحيث لا افتراضي يكون صفراً
 * فلا يمرّ `isValid`.
 */
export function useAmount(fallback = 0, initial = ''): AmountField {
  const [text, setText] = useState(initial)

  const parsed = readAmount(text)
  const isEmpty = parsed === null
  const value = isEmpty ? fallback : parsed

  return {
    text,
    set: setText,
    value,
    isEmpty,
    isValid: value > 0,
    reset: (raw = '') => setText(raw),
    props: {
      /*
       * `type="text"` لا `number` عمداً.
       *
       * الحقل الرقمي هو مصدر العطلين أعلاه: يبتلع الحالات الوسيطة ويرفض
       * الفاصلة. و`inputMode="decimal"` يعطي لوحة الأرقام نفسها على التلفون —
       * وهو ما يريده المستخدم فعلاً — بلا أن يفرض على النصّ شكلاً.
       */
      type: 'text',
      inputMode: 'decimal',
      value: text,
      onChange: (event) => setText(event.target.value),
    },
  }
}
