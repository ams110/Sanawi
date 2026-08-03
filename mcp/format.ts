/**
 * تنسيق ردود الأدوات.
 *
 * كل أداة تردّ شيئين: نصاً عربياً يقرأه المستخدم في المحادثة، وبيانات منظّمة
 * (`structuredContent`) يبني عليها النموذج حساباته. النص وحده يجعل النموذج
 * يعيد تحليل أرقامٍ سبق أن حسبناها، والبيانات وحدها تجعل الرد غير مقروء.
 *
 * لا نستعمل `src/lib/format.ts` هنا لأنه يقرأ نصوصه من i18next وهو مبنيّ
 * للمتصفح. الحاجة هنا أصغر: عملة وتاريخ لا أكثر.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  JOD: 'د.أ',
  EGP: 'ج.م',
}

const MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const

/**
 * حدّ حجم الرد.
 *
 * ردٌّ ضخم يزحم سياق النموذج فيسوء جوابه عن سؤالٍ لاحق. الأرقام هنا عشرات
 * الصفوف لا آلافها، فالحدّ شبكة أمان لا سياسة تقسيم صفحات.
 */
export const CHARACTER_LIMIT = 25_000

export function money(amount: number, currency = 'ILS'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency
  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    Math.abs(amount),
  )
  return `${symbol} ${amount < 0 ? '−' : ''}${value}`
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(`${value}T00:00:00`)

/** «15 نوفمبر 2026» — أوضح من 2026-11-15 حين يُقرأ بسرعة. */
export function longDate(value: Date | string): string {
  const d = toDate(value)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function monthYear(value: Date | string): string {
  const d = toDate(value)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** تاريخ ISO بالتقويم المحلي — `toISOString` يحوّل إلى UTC فيقفز يوماً. */
export function isoDate(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const STATUS_LABEL: Record<string, string> = {
  on_track: 'ملحّق',
  slightly_behind: 'متأخر قليلاً',
  behind: 'متأخر',
}

/** «سنوي» / «كل 3 شهور» / «مرة واحدة» — أوضح من رقم مجرّد. */
export function recurrenceLabel(months: number): string {
  if (months <= 0) return 'مرة واحدة'
  if (months === 1) return 'شهري'
  if (months === 3) return 'ربع سنوي'
  if (months === 6) return 'نصف سنوي'
  if (months === 12) return 'سنوي'
  if (months === 24) return 'كل سنتين'
  return `كل ${months} شهر`
}

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  /** يشترطه نوع نتيجة الأداة في SDK — بدونه لا يقبل المعالِجَ أصلاً. */
  [key: string]: unknown
}

/**
 * ردّ ناجح.
 *
 * القصّ يقع على النص لا على البيانات المنظّمة: النص للقراءة ويحتمل الاختصار،
 * والبيانات يُبنى عليها الحساب فقصّها يصنع جواباً خاطئاً بثقة.
 */
export function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  const trimmed =
    text.length > CHARACTER_LIMIT
      ? `${text.slice(0, CHARACTER_LIMIT)}\n\n…قُصّ الرد. استعمل المرشّحات أو حدّد id للحصول على التفاصيل.`
      : text

  return {
    content: [{ type: 'text', text: trimmed }],
    ...(structured ? { structuredContent: structured } : {}),
  }
}

/** ردّ فاشل: `isError` يجعل النموذج يقرأ الرسالة ويصحّح بدل أن يبني عليها. */
export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: `تعذّر التنفيذ: ${message}` }], isError: true }
}

/**
 * غلاف كل معالِج أداة.
 *
 * الخطأ يُردّ كنتيجة فيها `isError` لا كاستثناء يقتل الاتصال: النموذج يقرأ
 * السبب ويصحّح نداءه، بينما الاستثناء يُسقط الخادم فيفقد المستخدم الأدوات كلها
 * بسبب معرّفٍ مكتوب خطأً.
 */
export function guard<A>(
  handler: (args: A) => Promise<ToolResult>,
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await handler(args)
    } catch (error) {
      return fail(describeError(error))
    }
  }
}

/**
 * تحويل أي خطأ إلى رسالة تقترح الخطوة التالية.
 *
 * أخطاء PostgREST تصل بأكواد لا معنى لها عند القراءة، وأشهرها هنا خرق قيد
 * أو صفٌّ لا تصل إليه RLS. نترجمها إلى سببها الحقيقي في هذا التطبيق.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code
    switch (code) {
      case '23514':
        return `القيمة مرفوضة من قاعدة البيانات: ${error.message}. راجع الحدود (المبالغ موجبة، النسبة بين 0 و100).`
      case '23503':
        return `مُعرّف مرتبط غير موجود: ${error.message}. تأكّد من id المجموعة أو الالتزام.`
      case '23505':
        return `الصف موجود مسبقاً: ${error.message}.`
      case 'PGRST116':
        return 'لا يوجد صف بهذا المعرّف — أو أنه لا يخصّ هذا الحساب.'
      default:
        return error.message
    }
  }
  return String(error)
}
