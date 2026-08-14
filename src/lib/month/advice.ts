/**
 * نصيحة لحظة القبضة.
 *
 * تسجيل الدخل هو اللحظة الوحيدة التي يكون فيها المال والانتباه في نفس المكان:
 * وصل مبلغ، والمستخدم ممسكٌ بالتطبيق. ما يُقال هنا يُنفَّذ، وما يُؤجَّل إلى
 * «لما أفتح الشاشة» يُنسى. فهذا المحرّك يجيب على سؤالٍ واحد: **وصلتك قبضة —
 * شو أول شي تعمله فيها؟**
 *
 * والترتيب هو الرسالة، لا زينة:
 *
 * ١. **سدّ العجز قبل كل شيء.** حسابٌ «غير مخصّصه» سالب يَعِد بمالٍ ليس فيه،
 *    وكل نصيحةٍ تُبنى فوق عجزٍ قائم تكذب معه.
 * ٢. **ثم أقساط الشهر.** الصناديق التي لم تستلم قسطها هي سبب وجود التطبيق —
 *    والقبضة الواصلة هي مصدر تمويلها الطبيعي.
 * ٣. **ثم صحّة الأرقام نفسها**: رصيدٌ قديم يجعل كل ما فوقه تخميناً.
 * ٤. **ثم التحذير المبكر**: إسقاط آخر الشهر، وما لم يصل من الدخل المتوقَّع.
 *
 * والبنية بلا نصّ عمداً — كالقاعدة في `pending.ts`: المحرّك يُخرج أنواعاً
 * وأرقاماً، وكلُّ واجهةٍ (خادم كلود اليوم، شاشةٌ غداً) تصوغ جملتها بلغتها.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

export interface AdviceAccountInput {
  name: string
  /** غير المخصّص — سالبُه عجز. */
  available: number
  balanceIsStale: boolean
  daysSinceBalanceUpdate: number | null
}

export interface IncomeAdviceInput {
  /** القبضة المسجَّلة الآن. */
  amount: number
  /** أقساط صناديق لم تُودَع هذا الشهر — من `pendingThisMonth`. */
  pendingInstallments: readonly { name: string; amount: number }[]
  accounts: readonly AdviceAccountInput[]
  /** المتوقَّع شهرياً من المصادر الثابتة. */
  expectedIncome: number
  /** ما وصل هذا الشهر شاملاً هذه القبضة. */
  receivedIncome: number
  /** إسقاط آخر الشهر من اللوحة الموحّدة. */
  projectedRemaining: number
  projectedIsOverspent: boolean
}

export type IncomeAdviceItem =
  /** حسابٌ غير مخصّصه سالب — يُسدّ بتحويلٍ إليه قبل أي تخصيص. */
  | { kind: 'cover_shortfall'; accountName: string; amount: number }
  /** أقساط الشهر التي ما زالت بلا إيداع، وهل تغطّيها هذه القبضة. */
  | {
      kind: 'fund_installments'
      total: number
      covered: boolean
      items: { name: string; amount: number }[]
    }
  /** رصيدٌ عمره أكثر من أسبوعين — كل ما فوقه تخمين. `days` مجهولة حين لا تاريخ. */
  | { kind: 'stale_balance'; accountName: string; days: number | null }
  /** بوتيرة الصرف الحالية ينتهي الشهر بعجزٍ بهذا المقدار. */
  | { kind: 'projection_negative'; amount: number }
  /** المتبقّي من الدخل المتوقَّع الذي لم يصل بعد. */
  | { kind: 'income_gap'; amount: number }
  /** لا عجز ولا أقساط معلّقة — حالةٌ تستحقّ أن تُقال لا أن تُترك فراغاً. */
  | { kind: 'all_clear' }

const round2 = (n: number): number => Math.round(n * 100) / 100

export function adviseOnIncome(input: IncomeAdviceInput): IncomeAdviceItem[] {
  const items: IncomeAdviceItem[] = []

  // الأعمق عجزاً أولاً: من عنده نقصان يبدأ بالذي يكذب أكثر.
  const shortfalls = input.accounts
    .filter((account) => account.available < 0)
    .sort((a, b) => a.available - b.available)
  for (const account of shortfalls) {
    items.push({
      kind: 'cover_shortfall',
      accountName: account.name,
      amount: round2(Math.abs(account.available)),
    })
  }

  if (input.pendingInstallments.length > 0) {
    const list = input.pendingInstallments.map((row) => ({
      name: row.name,
      amount: round2(row.amount),
    }))
    const total = round2(list.reduce((sum, row) => sum + row.amount, 0))
    /*
     * الترتيب هو الرسالة، والتغطية تحترمه: سطرُ «سدّ العجز» فوق هذا السطر
     * يستهلك من القبضة أولاً، فما يُقاس عليه «هل تكفي؟» هو الباقي بعده —
     * قبضةُ 1,000 مع عجزِ 800 لا تغطّي أقساطاً بـ900، وكان `covered`
     * يتجاهل العجز فتناقض القائمةُ ترتيبَها المعلن. (تدقيق آب 2026: ش9)
     */
    const shortfallTotal = round2(
      shortfalls.reduce((sum, account) => sum + Math.abs(account.available), 0),
    )
    items.push({
      kind: 'fund_installments',
      total,
      covered: round2(input.amount - shortfallTotal) >= total,
      items: list,
    })
  }

  for (const account of input.accounts) {
    if (!account.balanceIsStale) continue
    items.push({
      kind: 'stale_balance',
      accountName: account.name,
      // عمرٌ مجهول يُقال مجهولاً: «0 يوم» عن رصيدٍ معلَّمٍ قديماً كذبة. (ش15)
      days: account.daysSinceBalanceUpdate,
    })
  }

  if (input.projectedIsOverspent) {
    items.push({ kind: 'projection_negative', amount: round2(Math.abs(input.projectedRemaining)) })
  }

  /*
   * الفجوة إخبارٌ لا عتاب: تُذكر فقط ما دام المتوقَّع لم يكتمل، لأن قارئها
   * الطبيعي هو من يقبض على دفعات — «وصل الراتب وبقي الشغل الجانبي» — ولا
   * تُذكر حين وصل أكثر من المتوقَّع: الزيادة بشرى لا نقصاً يُنبَّه عليه.
   */
  const gap = round2(input.expectedIncome - input.receivedIncome)
  if (gap > 0) items.push({ kind: 'income_gap', amount: gap })

  if (items.length === 0) items.push({ kind: 'all_clear' })

  return items
}
