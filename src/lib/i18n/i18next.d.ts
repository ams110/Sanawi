import type { Translation } from './ar'

/**
 * يجعل `t()` مكتوبة النوع: مفتاح غير موجود يصير خطأ بناء لا نصاً فارغاً
 * يظهر في الشاشة بعد النشر.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: Translation }
  }
}
