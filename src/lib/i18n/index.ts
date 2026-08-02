import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ar } from './ar'

/**
 * إعداد اللغات.
 *
 * العربية هي اللغة المرجعية والوحيدة المكتملة اليوم. البنية جاهزة لإضافة
 * العبرية والإنجليزية: انسخ ar.ts، ترجمه، وسجّله في LOCALES أدناه.
 * النوع `Translation` مشتق من ar، فأي مفتاح ناقص يصير خطأ بناء لا نصاً مفقوداً.
 */

export const LOCALES = {
  ar: { label: 'العربية', dir: 'rtl' as const, resource: ar },
  // he: { label: 'עברית',  dir: 'rtl' as const, resource: he },
  // en: { label: 'English', dir: 'ltr' as const, resource: en },
}

export type Locale = keyof typeof LOCALES

export const DEFAULT_LOCALE: Locale = 'ar'
const STORAGE_KEY = 'sanawi.locale'

function readStored(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && saved in LOCALES) return saved as Locale
  } catch {
    /* التخزين محجوب — نكمل بالافتراضي. */
  }
  return DEFAULT_LOCALE
}

/**
 * الاتجاه يتبع اللغة لا العكس.
 * تثبيت dir في index.html وحده لا يكفي: تبديل اللغة يجب أن يقلب الصفحة.
 */
export function applyDocumentLocale(locale: Locale): void {
  const { dir } = LOCALES[locale]
  document.documentElement.lang = locale
  document.documentElement.dir = dir
}

export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    /* الاختيار يبقى فعّالاً لهذه الجلسة. */
  }
  void i18n.changeLanguage(locale)
  applyDocumentLocale(locale)
}

const initial = readStored()

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(LOCALES).map(([code, { resource }]) => [code, { translation: resource }]),
  ),
  lng: initial,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: {
    // React يهرّب المخرجات أصلاً، والتهريب المزدوج يشوّه الاقتباسات العربية.
    escapeValue: false,
  },
  returnObjects: true,
})

applyDocumentLocale(initial)

export default i18n
