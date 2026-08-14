/**
 * حركات الصندوق: ماذا دخل، ومتى، وهل تكرّر.
 *
 * الإيداع أكثر فعلٍ يقع في هذا التطبيق، وكان أقلّها حراسةً: زرٌّ يكتب صفّاً
 * فوراً، بلا رقمٍ يُكتب، وبلا قائمةٍ تُرى، وبلا رجعة. فمن ضغطه مرّتين — أو
 * ضغطه وهو لا يذكر أنه أودع أول الشهر — يصير صندوقه أكبر من الحقيقة، وقسطه
 * أصغر منها، والتطبيق يقول له «ملحّق ✅» وهو ليس كذلك.
 *
 * وثلاثة أرقامٍ تكفي لسدّ ذلك: كم أودعتُ هذا الشهر، وكم مرّة، وآخر إيداع متى.
 *
 * والسحب ليس إيداعاً. الصندوق يُفرَّغ عند الدفع بقيدٍ سالب لا بحذف الإيداعات
 * (قرارٌ قديم: تاريخ من دفع ماذا لا يُمحى)، فلو عُدّت القيود السالبة إيداعاتٍ
 * لقال التطبيق «أودعتَ هذا الشهر» لمن دفع التزامه ولم يودع شيئاً.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

export interface DepositRow {
  id: string
  amount: number
  /** يوم الحركة — `YYYY-MM-DD` أو تاريخ. */
  depositDate: Date | string
  /**
   * لحظة الكتابة — للترتيب داخل اليوم الواحد.
   *
   * عمود `deposit_date` يومٌ بلا وقت، وإيداعٌ وسحبٌ في اليوم نفسه لا يُرتَّبان
   * به. والفرق بينهما هو الفرق بين «أودعتَ هذا الشهر» و«صندوقك فُرِّغ للتوّ».
   */
  createdAt?: Date | string | null
  partnerId?: string | null
  note?: string | null
}

export interface DepositView {
  id: string
  /** موجبٌ دائماً — الاتجاه في `kind` لا في الإشارة. */
  amount: number
  kind: 'deposit' | 'withdrawal'
  depositDate: string
  partnerId: string | null
  note: string | null
  /** حركةٌ وقعت في الشهر الجاري. */
  isThisMonth: boolean
}

export interface DepositsSummary {
  /** الأحدث أولاً — العين تقرأ آخر ما فعلت لا أوّله. */
  entries: DepositView[]
  /**
   * مجموع ما أودعتُه **أنا** هذا الشهر، بلا السحوبات وبلا إيداعات الشركاء.
   *
   * إيداع الشريك حصّتُه هو لا قسطي أنا (تدقيق آب 2026: ل1) — عدُّه هنا
   * كان يُسقط قسطي من «ضلّ عليك» ويقول لي «أودعتَ هذا الشهر» عمّا أودعه
   * غيري. وهي نفس قاعدة `monthInstallments.ts` نصّاً لا ادّعاءً.
   */
  thisMonthTotal: number
  thisMonthCount: number
  lastDeposit: DepositView | null
  /**
   * أودع في هذا الشهر مرّةً على الأقل **منذ آخر تفريغٍ للصندوق**.
   *
   * ليست منعاً — من يدفع قسطه على دفعتين له حقٌّ في ذلك — إنما سؤالٌ يُطرح
   * قبل الإيداع الثاني بدل أن يقع صامتاً.
   */
  alreadyDepositedThisMonth: boolean
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * قراءة يومٍ قد يأتي مجرّداً أو بطابعٍ زمني.
 *
 * `deposit_date` عمود `date` فيصل «2026-08-06»، وهذه يقرأها المتصفّح بتوقيت
 * UTC لا بالمحلي فيقفز اليوم إلى ما قبله شرقَ غرينتش — وقفزةُ يومٍ عند أول
 * الشهر تنقل الإيداع إلى الشهر السابق فيسقط من الحارس كلّه.
 */
function toDate(value: Date | string): Date {
  if (value instanceof Date) return value
  return new Date(value.includes('T') ? value : `${value}T00:00:00`)
}

const isoDay = (date: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const sameMonth = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

export function summarizeDeposits(
  rows: readonly DepositRow[],
  options: { today?: Date } = {},
): DepositsSummary {
  const today = options.today ?? new Date()

  const ranked = rows.map((row) => {
    const raw = Number(row.amount)
    const amount = Number.isFinite(raw) ? raw : 0
    const date = toDate(row.depositDate)
    const valid = !Number.isNaN(date.getTime())
    const created = row.createdAt ? toDate(row.createdAt) : null

    return {
      view: {
        id: row.id,
        amount: round2(Math.abs(amount)),
        kind: (amount < 0 ? 'withdrawal' : 'deposit') as 'deposit' | 'withdrawal',
        depositDate: valid ? isoDay(date) : '',
        partnerId: row.partnerId ?? null,
        note: row.note ?? null,
        // تاريخٌ غير مقروء ليس «هذا الشهر»: الحارس يسأل عمّا يعرفه لا عمّا يظنّه.
        isThisMonth: valid && sameMonth(date, today),
      },
      // اليوم أولاً ثم لحظة الكتابة: الأول ما يراه المستخدم، والثانية تفصل
      // ما وقع في اليوم نفسه.
      order: `${valid ? isoDay(date) : ''}#${
        created && !Number.isNaN(created.getTime()) ? created.toISOString() : ''
      }`,
    }
  })

  ranked.sort((a, b) => (a.order < b.order ? 1 : a.order > b.order ? -1 : 0))
  const entries = ranked.map((r) => r.view)

  /*
   * الحدّ هو آخر تفريغٍ للصندوق، لا أول الشهر.
   *
   * من دفع التزامه ثم أودع أول قسطٍ للدورة الجديدة في الشهر نفسه ليس مكرِّراً:
   * ما أودعه قبل الدفع خرج من الصندوق كلّه. وتحذيرٌ كاذب هنا أسوأ من لا
   * تحذير — من يراه مرّةً بلا سبب يتجاهله في المرّة التي تهمّ.
   */
  const lastWithdrawal = entries.findIndex((e) => e.kind === 'withdrawal')
  const currentCycle = lastWithdrawal === -1 ? entries : entries.slice(0, lastWithdrawal)

  const thisMonthDeposits = currentCycle.filter(
    (e) => e.kind === 'deposit' && e.isThisMonth && e.partnerId === null,
  )
  const deposits = entries.filter((e) => e.kind === 'deposit')

  return {
    entries,
    thisMonthTotal: round2(thisMonthDeposits.reduce((sum, e) => sum + e.amount, 0)),
    thisMonthCount: thisMonthDeposits.length,
    lastDeposit: deposits[0] ?? null,
    alreadyDepositedThisMonth: thisMonthDeposits.length > 0,
  }
}
