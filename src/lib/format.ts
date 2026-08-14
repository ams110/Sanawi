/**
 * تنسيق الأرقام والتواريخ.
 *
 * العملة واللغة مُمرَّرتان دائماً كوسيطات ولا تُثبَّت في الكود،
 * لأنهما عمودان في قاعدة البيانات (profiles.currency / profiles.locale).
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  JOD: 'د.أ',
  EGP: 'ج.م',
}

export function currencySymbol(currency = 'ILS'): string {
  return CURRENCY_SYMBOLS[currency] ?? currency
}

/**
 * ‏₪ 1,234 — الرمز ثم المبلغ بأرقام لاتينية.
 * نستعمل en-US عمداً لا ar-EG: المستخدم يريد أرقاماً إنجليزية داخل واجهة عربية.
 */
export function formatMoney(amount: number, currency = 'ILS', decimals = 0): string {
  // التقريب قبل فحص الإشارة: ‏−0.4 بلا خانات كانت تخرج «₪ −0». (ل7)
  const factor = 10 ** decimals
  const rounded = Math.round(Math.abs(amount) * factor) / factor
  const value = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rounded)
  const sign = amount < 0 && rounded > 0 ? '−' : ''
  return `${currencySymbol(currency)} ${sign}${value}`
}

/** بلا رمز عملة — للاستعمال داخل جدول عموده معنون بالعملة. */
export function formatNumber(amount: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)
}

import i18n from './i18n'

/*
 * التواريخ بالأرقام لا بأسماء الشهور.
 *
 * أسماء الشهور العربية مذهبان لا واحد: «أغسطس» في مصر و«آب» في الشام،
 * وأيُّهما اخترتَ بدا غريباً لنصف القرّاء. والفواتير والبنوك هنا تكتب
 * 8/2026 فتصير القراءة مطابقةً لما يراه المستخدم في مصادره الأخرى.
 *
 * والأرقام لا تُترجَم، فتسقط معها مسألةُ لغةِ الشهر من الأساس.
 */

/** «11/2026» — كما تكتبه الفواتير والبنوك. */
export function formatMonthYear(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}/${d.getFullYear()}`
}

/** «15/8/2026» — يوم/شهر/سنة، الترتيب المستعمل هنا. */
export function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(`${date}T00:00:00`)
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

/** «بعد 3 شهور» / «هذا الشهر» / «فات موعده» — نص بشري لا رقم مجرّد. */
export function formatMonthsRemaining(months: number, isOverdue = false): string {
  if (isOverdue) return i18n.t('time.overdue')
  if (months <= 0) return i18n.t('time.thisMonth')
  if (months === 1) return i18n.t('time.inOneMonth')
  if (months === 2) return i18n.t('time.inTwoMonths')
  // العربية تفرّق بين جمع القلة (3–10) وجمع الكثرة، والفرق مسموع لا تجميلي.
  if (months <= 10) return i18n.t('time.inFewMonths', { count: months })
  return i18n.t('time.inManyMonths', { count: months })
}

/** «شهر» / «شهرين» / «شهور» — للتركيب داخل جملة. */
export function monthsWord(months: number): string {
  if (months === 1) return i18n.t('time.oneMonth')
  if (months === 2) return i18n.t('time.twoMonths')
  return i18n.t('time.fewMonths')
}
