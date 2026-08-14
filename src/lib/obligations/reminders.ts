/**
 * جدولة التنبيهات قبل مواعيد الاستحقاق.
 *
 * الغرض ليس التذكير بالدفع — التطبيق يجمع المال سلفاً — بل التذكير بأن الموعد
 * يقترب حتى يتأكد المستخدم أن صندوقه مكتمل قبل أن يفاجئه النقص.
 * ملف نقي — لا React ولا Capacitor.
 */

import { subDays } from 'date-fns'

/** ثلاثة تنبيهات: واحد للتخطيط، وواحد للتحقق، وواحد أخير. */
export const REMINDER_DAYS = [30, 14, 7] as const

export interface ReminderObligation {
  id: string
  name: string
  nextDueDate: Date | string
  /** الباقي على المستخدم جمعه — يُذكر في نص التنبيه إن كان أكبر من صفر. */
  remainingAmount: number
}

export interface ScheduledReminder {
  /** معرّف رقمي ثابت: إعادة الجدولة تستبدل التنبيه القديم بدل أن تكرّره. */
  id: number
  obligationId: string
  title: string
  body: string
  at: Date
  daysBefore: number
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(`${v}T00:00:00`))

/**
 * معرّف مستقرّ من معرّف الالتزام وعدد الأيام.
 *
 * Capacitor يقبل أعداداً صحيحة فقط، ويستبدل التنبيه ذا المعرّف نفسه.
 * لو وُلّد المعرّف عشوائياً لتراكمت التنبيهات مع كل فتح للتطبيق حتى يصير
 * المستخدم يتلقّى عشرات الإشعارات عن موعد واحد.
 */
export function reminderId(obligationId: string, daysBefore: number): number {
  let hash = 0
  for (let i = 0; i < obligationId.length; i++) {
    hash = (hash * 31 + obligationId.charCodeAt(i)) | 0
  }
  return Math.abs(hash % 1_000_000) * 100 + daysBefore
}

/**
 * الرسائل تُمرَّر كدوال جاهزة لا كمفاتيح نصية.
 *
 * المفتاح النصي يمرّ عبر دالة عامة فيضيع نوعه، ويصير مفتاح ترجمة غير موجود
 * خطأً لا يظهر إلا في الإشعار نفسه بعد النشر. الدالة تُستدعى في موضع الاستدعاء
 * حيث المفتاح حرفيّ ويتحقّق منه المترجم.
 */
export interface ReminderMessages {
  title: (name: string) => string
  bodyWithAmount: (name: string, days: number, amount: string) => string
  bodyReady: (name: string, days: number) => string
}

export interface BuildRemindersOptions {
  today?: Date
  /** ساعة إطلاق التنبيه محلياً — 9 صباحاً افتراضاً. */
  hour?: number
  messages: ReminderMessages
  formatMoney: (amount: number) => string
}

export function buildReminders(
  obligations: ReminderObligation[],
  options: BuildRemindersOptions,
): ScheduledReminder[] {
  const today = options.today ?? new Date()
  const hour = options.hour ?? 9
  const reminders: ScheduledReminder[] = []

  for (const obligation of obligations) {
    const due = toDate(obligation.nextDueDate)

    for (const daysBefore of REMINDER_DAYS) {
      const at = subDays(due, daysBefore)
      at.setHours(hour, 0, 0, 0)

      /*
       * الماضي لا يُجدوَل: تنبيه في وقت فائت إما يُطلق فوراً أو يُتجاهل،
       * وكلاهما إزعاج بلا فائدة. والمقارنة بالطابع الكامل لا بالأيام
       * التقويمية: فرقُ الأيام كان يمرّر تنبيهَ اليومِ نفسه بعد ساعته
       * (جدولة الساعة 15:00 لتنبيه التاسعة صباحاً) فيطلقه Capacitor فوراً.
       * (تدقيق آب 2026: ل3)
       */
      if (at.getTime() <= today.getTime()) continue

      const body =
        obligation.remainingAmount > 0
          ? options.messages.bodyWithAmount(
              obligation.name,
              daysBefore,
              options.formatMoney(obligation.remainingAmount),
            )
          : options.messages.bodyReady(obligation.name, daysBefore)

      reminders.push({
        id: reminderId(obligation.id, daysBefore),
        obligationId: obligation.id,
        title: options.messages.title(obligation.name),
        body,
        at,
        daysBefore,
      })
    }
  }

  return reminders.sort((a, b) => a.at.getTime() - b.at.getTime())
}
