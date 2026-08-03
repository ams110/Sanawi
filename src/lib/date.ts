/**
 * مفاتيح التاريخ.
 *
 * ملف نقي: لا React ولا Supabase ولا i18n. هذا شرطٌ لا تفصيل — `format.ts`
 * يلمس `document` عند التحميل، فاستيرادُ مفتاح تاريخ منه يُسقط كل ملف اختبار
 * يمسّ طبقة البيانات ولو كان ما يختبره دوالَّ نقية.
 */

/**
 * مفتاح تاريخ `YYYY-MM-DD` من التقويم المحلي.
 *
 * لا تستعمل `toISOString().slice(0, 10)` لهذا: هي تحوّل إلى UTC أولاً، فمنتصفُ
 * ليلِ أولِ آب في القدس (UTC+3) يصير `2026-07-31`. النتيجة أعمدةُ تاريخ تنزلق
 * يوماً إلى الوراء: موعد استحقاق يتراجع مع كل تجديد، وفاتورةٌ تُحفظ تحت الشهر
 * السابق وترويسةٌ تقول «يوليو» والمستخدم يسجّل أغسطس. لم يظهر العطل في التطوير
 * لأن الخوادم والاختبارات تعمل على UTC حيث الفرق صفر — وحده المستخدم يراه.
 */
export function toDateKey(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** أول يوم في شهر التاريخ المعطى — مفتاح الشهر في `bill_payments`. */
export function toMonthKey(date: Date = new Date()): string {
  return `${toDateKey(date).slice(0, 7)}-01`
}
