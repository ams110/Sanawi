import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import i18n from '@/lib/i18n'
import { formatMoney } from '@/lib/format'
import { buildReminders, type ReminderObligation } from '@/lib/obligations/reminders'
import type { ObligationWithCalc } from '@/features/obligations/api'

/**
 * جدولة التنبيهات على الجهاز.
 *
 * على الويب لا توجد إشعارات محلية، فتُتجاهل بصمت: لا رسالة خطأ ولا طلب إذن
 * لميزة غير موجودة أصلاً في تلك البيئة.
 */
export async function scheduleObligationReminders(items: ObligationWithCalc[]): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0

  const permission = await LocalNotifications.checkPermissions()
  if (permission.display !== 'granted') {
    const requested = await LocalNotifications.requestPermissions()
    // رفض الإذن قرار المستخدم — لا نلحّ ولا نعطّل شيئاً آخر بسببه.
    if (requested.display !== 'granted') return 0
  }

  const obligations: ReminderObligation[] = items.map((i) => ({
    id: i.obligation.id,
    name: i.obligation.name,
    nextDueDate: i.obligation.next_due_date,
    remainingAmount: i.calc.remainingAmount,
  }))

  const reminders = buildReminders(obligations, {
    messages: {
      title: (name) => i18n.t('reminders.title', { name }),
      bodyWithAmount: (name, days, amount) =>
        i18n.t('reminders.bodyWithAmount', { name, days, amount }),
      bodyReady: (name, days) => i18n.t('reminders.bodyReady', { name, days }),
    },
    formatMoney: (amount) => formatMoney(amount),
  })

  // إلغاء القديم أولاً: المواعيد تتغيّر بالتعديل والدفع، وتنبيهٌ عن موعد لم
  // يعد قائماً أسوأ من غياب التنبيه لأنه يهدم الثقة بالأرقام كلها.
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.notifications })
  }

  if (reminders.length === 0) return 0

  await LocalNotifications.schedule({
    notifications: reminders.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      schedule: { at: r.at, allowWhileIdle: true },
      extra: { obligationId: r.obligationId },
    })),
  })

  return reminders.length
}
