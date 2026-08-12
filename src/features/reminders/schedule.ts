import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import i18n from '@/lib/i18n'
import { formatMoney } from '@/lib/format'
import { buildReminders, type ReminderObligation } from '@/lib/obligations/reminders'
import { envelopesByAccount, summarizeAccounts } from '@/lib/accounts/calc'
import type { Account } from '@/lib/db/types'
import type { ObligationWithCalc } from '@/features/obligations/api'

/**
 * معرّف ثابت لإشعار العجز — خارج مدى معرّفات التذكيرات (أقصاها 99,999,930)،
 * وثباتُه يجعل إعادة الجدولة تستبدل الإشعار لا تكرّره.
 */
const SHORTFALL_ALERT_ID = 999_999_901

/**
 * جدولة التنبيهات على الجهاز.
 *
 * على الويب لا توجد إشعارات محلية، فتُتجاهل بصمت: لا رسالة خطأ ولا طلب إذن
 * لميزة غير موجودة أصلاً في تلك البيئة.
 */
export async function scheduleObligationReminders(
  items: ObligationWithCalc[],
  accounts: Account[] = [],
): Promise<number> {
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

  /*
   * حارس السيولة: «غير مخصّص» سالبٌ يصير إشعاراً لا رقماً ينتظر من يفتح
   * الشاشة — سالبُه يعني وعداً بمالٍ ليس في البنك، وهو لا يُرى من صندوقٍ
   * واحد. يُجدول للتاسعة القادمة — نفس ساعة التذكيرات — ويُبنى مع كل جدولة:
   * إن سُدّ العجز لا يُعاد بناؤه فيسقط مع الإلغاء العام تحته.
   */
  const shortfalls = summarizeAccounts(
    accounts.map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      balance: Number(account.balance),
      balanceUpdatedAt: account.balance_updated_at,
      envelopes:
        envelopesByAccount(
          items.map((i) => ({
            obligationId: i.obligation.id,
            name: i.obligation.name,
            balance: Number(i.balance?.my_fund_balance ?? 0),
            accountId: i.obligation.account_id,
          })),
        ).get(account.id) ?? [],
    })),
  ).accounts.filter((account) => account.shortfall)

  const alerts: { id: number; title: string; body: string; at: Date }[] = []
  if (shortfalls.length > 0) {
    const at = new Date()
    at.setHours(9, 0, 0, 0)
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
    alerts.push({
      id: SHORTFALL_ALERT_ID,
      title: i18n.t('reminders.shortfallTitle'),
      body: i18n.t('reminders.shortfallBody', {
        accounts: shortfalls
          .map((account) => `${account.name} (${formatMoney(account.available)})`)
          .join('، '),
      }),
      at,
    })
  }

  // إلغاء القديم أولاً: المواعيد تتغيّر بالتعديل والدفع، وتنبيهٌ عن موعد لم
  // يعد قائماً أسوأ من غياب التنبيه لأنه يهدم الثقة بالأرقام كلها.
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.notifications })
  }

  const total = reminders.length + alerts.length
  if (total === 0) return 0

  await LocalNotifications.schedule({
    notifications: [
      ...reminders.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        schedule: { at: r.at, allowWhileIdle: true },
        extra: { obligationId: r.obligationId },
      })),
      ...alerts.map((alert) => ({
        id: alert.id,
        title: alert.title,
        body: alert.body,
        schedule: { at: alert.at, allowWhileIdle: true },
        extra: {},
      })),
    ],
  })

  return total
}
