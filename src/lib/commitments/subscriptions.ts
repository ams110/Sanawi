/**
 * الاشتراكات: كل متكرّرٍ دائمٍ بكلفته السنوية الصادقة.
 * ملف نقي — لا React ولا Supabase.
 *
 * التطبيق كلّه مبنيٌّ على قلب العدسة: السنويُّ الكبير يُقسَم شهرياً ليُطاق.
 * وهذه الشاشة تقلبها عمداً في الاتجاه المعاكس: الشهريُّ الصغير يُضرب في
 * اثني عشر ليُرى. «520 بالشهر» رقمٌ يُبلَع، و«6,240 بالسنة» رقمٌ يوقف
 * عنده صاحبه ويسأل: هل ما زلت أستعمله أصلاً؟
 *
 * الاشتراك هنا بالمعنى المحاسبي: بندٌ متكرّر بلا تاريخ نهاية بدأت دفعاته
 * — الكهرباء والإنترنت واشتراك كلود سواء. القسط الذي ينتهي ليس منها:
 * له عدّاد «بقي X دفعة» وعبؤه مؤقّت، وخلطُهما يفسد السؤالين معاً.
 */

export interface SubscriptionInput {
  id: string
  name: string
  icon: string | null
  /** المبلغ الكامل — الحصّة تُحسب هنا. */
  amount: number
  mySharePercent?: number
  startsOn: string | null
  endsOn: string | null
}

export interface SubscriptionRow {
  id: string
  name: string
  icon: string | null
  /** حصّتي الشهرية. */
  monthly: number
  /** الرقم الذي يوقظ: حصّتي × 12. */
  yearly: number
  /** نصيبه من مجموع الاشتراكات 0..1 — لشريط العرض. */
  share: number
}

export interface SubscriptionsSummary {
  rows: SubscriptionRow[]
  monthlyTotal: number
  yearlyTotal: number
  count: number
}

const round2 = (v: number): number => Math.round(v * 100) / 100

const hasStarted = (startsOn: string | null, today: Date): boolean => {
  if (!startsOn) return true
  return new Date(`${startsOn}T00:00:00`) <= today
}

export function summarizeSubscriptions(
  commitments: readonly SubscriptionInput[],
  today: Date = new Date(),
): SubscriptionsSummary {
  const rows = commitments
    // الدائم وحده: نهايةٌ مكتوبة تعني قسطاً يعدّ دفعاته لا اشتراكاً يُراجَع.
    .filter((c) => c.endsOn === null && hasStarted(c.startsOn, today) && c.amount > 0)
    .map((c) => {
      const monthly = round2((c.amount * (c.mySharePercent ?? 100)) / 100)
      return {
        id: c.id,
        name: c.name,
        icon: c.icon,
        monthly,
        yearly: round2(monthly * 12),
        share: 0,
      }
    })
    .sort((a, b) => b.monthly - a.monthly || a.name.localeCompare(b.name, 'ar'))

  const monthlyTotal = round2(rows.reduce((sum, r) => sum + r.monthly, 0))
  for (const row of rows) {
    row.share = monthlyTotal > 0 ? row.monthly / monthlyTotal : 0
  }

  return {
    rows,
    monthlyTotal,
    yearlyTotal: round2(monthlyTotal * 12),
    count: rows.length,
  }
}
