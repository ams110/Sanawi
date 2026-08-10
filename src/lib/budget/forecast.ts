/**
 * التوقّع النقدي: أين يقف مالك غير المخصَّص كلَّ يومٍ حتى آخر الشهر.
 * ملف نقي — لا React ولا Supabase.
 *
 * لوحة الشهر تجيب «كم يبقى لي؟» رقماً واحداً لآخر الشهر، ولا تقول **متى**
 * يمرّ الرصيد بأدنى نقطته: من معه 2,000 وفاتورةٌ يوم 10 وراتبٌ لا يصل قبل
 * آخر الشهر قد يعبر تحت الصفر في المنتصف ثم «يتعافى» على الورق. العبور
 * المؤقّت هذا هو ما يوقع الناس في السحب الزائد — والتوقّع يراه قبل وقوعه.
 *
 * قراران متعمّدان يجعلان الخطأ في الاتجاه الآمن:
 *
 * ١. **الدخل الذي لم يصل لا يدخل الحسبة.» مواعيد القبض ليست في البيانات،
 *    واختراعُ يومٍ للراتب يجعل التحذير يسكت على ثقةٍ مخترَعة. فالإسقاط
 *    يجيب: «لو ما وصل شيءٌ جديد، وين بتوقف؟» — والواجهة تقول ذلك صراحةً.
 *
 * ٢. **ما لا موعد له يقع اليوم.** فاتورةٌ بلا يومٍ وقسطُ صندوقٍ لم يُودَع:
 *    افتراضُ وقوعها آخرَ الشهر يؤجّل التحذير، وافتراضُها اليوم يقدّمه —
 *    و«جاهز أكثر من اللازم» هو الخطأ الوحيد المقبول في هذا التطبيق.
 */

import { differenceInCalendarDays } from 'date-fns'

export interface ForecastEvent {
  name: string
  /** موجب = يخرج من غير المخصَّص. */
  amount: number
  kind: 'bill' | 'annual' | 'installment'
}

/** فاتورة شهرية لم تُدفع بعد. */
export interface ForecastBillInput {
  name: string
  /** حصّتي — المقترح: المسجَّل، فالمتوسّط، فالميزانية. */
  amount: number
  /** يوم الاستحقاق في الشهر، أو null = بلا موعد. */
  dayOfMonth: number | null
}

/** دفعة التزامٍ يحلّ موعدها قبل آخر الشهر. */
export interface ForecastAnnualInput {
  name: string
  /** حصّتي من الدفعة. */
  myAmount: number
  /** رصيد صندوقي — محجوزٌ أصلاً خارج غير المخصَّص، فلا يخرج إلا النقص. */
  fundBalance: number
  dueDate: Date
}

/** قسط صندوقٍ لم يُودَع هذا الشهر — يخرج من غير المخصَّص إلى المحجوز. */
export interface ForecastInstallmentInput {
  name: string
  amount: number
}

export interface ForecastInput {
  /** غير المخصَّص الآن — `availableTotal` من محرّك الحسابات. */
  startBalance: number
  bills: readonly ForecastBillInput[]
  annualDues: readonly ForecastAnnualInput[]
  installments: readonly ForecastInstallmentInput[]
  /** متوسّط الصرف اليومي — يُوزَّع على كل يومٍ متبقٍّ. */
  dailySpend: number
  today?: Date
}

export interface ForecastDay {
  date: Date
  /** الرصيد آخر اليوم، بعد أحداثه وصرفه اليومي. */
  balance: number
  events: ForecastEvent[]
}

export interface ForecastResult {
  days: ForecastDay[]
  endBalance: number
  /** أدنى نقطة — هي الخبر، لا رقم آخر الشهر. */
  lowest: { date: Date; balance: number }
  /** أول يومٍ ينزل فيه الرصيد تحت الصفر، أو null إن لم يحدث. */
  crossesZeroOn: Date | null
  /** مجموع ما سيخرج حتى آخر الشهر. */
  totalOut: number
}

const round2 = (v: number): number => Math.round(v * 100) / 100

export function projectCashFlow(input: ForecastInput): ForecastResult {
  const today = input.today ?? new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const dayCount = differenceInCalendarDays(lastDay, startOfToday) + 1

  /* الأحداث تُسقَط على أيامها — والفائت أو المجهول يقع اليوم. */
  const eventsByOffset = new Map<number, ForecastEvent[]>()
  const push = (offset: number, event: ForecastEvent) => {
    const clamped = Math.min(Math.max(0, offset), dayCount - 1)
    const list = eventsByOffset.get(clamped) ?? []
    list.push(event)
    eventsByOffset.set(clamped, list)
  }

  for (const bill of input.bills) {
    if (bill.amount <= 0) continue
    const offset =
      bill.dayOfMonth === null
        ? 0
        : differenceInCalendarDays(
            new Date(
              today.getFullYear(),
              today.getMonth(),
              Math.min(bill.dayOfMonth, lastDay.getDate()),
            ),
            startOfToday,
          )
    push(offset, { name: bill.name, amount: round2(bill.amount), kind: 'bill' })
  }

  for (const due of input.annualDues) {
    // الصندوق محجوزٌ خارج غير المخصَّص أصلاً — لا يخرج منه إلا النقص.
    const shortfall = round2(Math.max(0, due.myAmount - Math.max(0, due.fundBalance)))
    if (shortfall <= 0) continue
    push(differenceInCalendarDays(due.dueDate, startOfToday), {
      name: due.name,
      amount: shortfall,
      kind: 'annual',
    })
  }

  for (const installment of input.installments) {
    if (installment.amount <= 0) continue
    push(0, { name: installment.name, amount: round2(installment.amount), kind: 'installment' })
  }

  const dailySpend = Math.max(0, input.dailySpend)

  const days: ForecastDay[] = []
  let balance = input.startBalance
  let lowest = { date: startOfToday, balance: input.startBalance }
  let crossesZeroOn: Date | null = null
  let totalOut = 0

  for (let offset = 0; offset < dayCount; offset++) {
    const date = new Date(
      startOfToday.getFullYear(),
      startOfToday.getMonth(),
      startOfToday.getDate() + offset,
    )
    const events = eventsByOffset.get(offset) ?? []
    const eventsTotal = events.reduce((sum, e) => sum + e.amount, 0)

    balance = round2(balance - eventsTotal - dailySpend)
    totalOut = round2(totalOut + eventsTotal + dailySpend)

    if (balance < lowest.balance) lowest = { date, balance }
    if (balance < 0 && crossesZeroOn === null) crossesZeroOn = date

    days.push({ date, balance, events })
  }

  return {
    days,
    endBalance: balance,
    lowest,
    crossesZeroOn,
    totalOut,
  }
}
