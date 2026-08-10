/**
 * التقرير الشهري: شهرٌ واحد، بكل حركته، في صفحةٍ تُقرأ في دقيقة.
 * ملف نقي — لا React ولا Supabase.
 *
 * كل شاشةٍ في التطبيق تجيب سؤالها الضيّق، ولا مكان يجيب «شو صار الشهر
 * الماضي؟» كاملاً: كم وصل ومن أين، كم خرج وعلى ماذا، ماذا دُفع وماذا
 * بقي، وكم دخل الصناديق. هذا هو الشهر مروياً — والتصدير يجعله ورقةً
 * تخرج من التطبيق.
 *
 * الصافي هنا **حركة الجيب**: الدخل الواصل ناقص ما خرج من اليد فعلاً —
 * المصاريف والفواتير المدفوعة والإيداعات في الصناديق. ودفعات الالتزامات
 * الكبيرة تُروى منفصلةً ولا تدخل الصافي: مالُها خرج من الجيب شهراً
 * بشهرٍ عبر الإيداعات، وعدُّها الآن يعدّه مرتين.
 */

export interface ReportIncomeInput {
  /** اسم المصدر أو التسمية الحرّة — `null` = بلا مصدر. */
  source: string | null
  amount: number
}

export interface ReportExpenseInput {
  /** اسم التصنيف — `null` = غير مصنَّف، تسمّيه الواجهة. */
  category: string | null
  amount: number
}

export interface ReportBillInput {
  name: string
  amount: number
  isPaid: boolean
}

export interface ReportDepositInput {
  /** موجب إيداعٌ في صندوق، سالب سحبٌ منه. */
  amount: number
}

export interface ReportObligationPaymentInput {
  name: string
  amount: number
}

export interface ReportInput {
  incomes: readonly ReportIncomeInput[]
  expenses: readonly ReportExpenseInput[]
  bills: readonly ReportBillInput[]
  deposits: readonly ReportDepositInput[]
  obligationPayments: readonly ReportObligationPaymentInput[]
}

export interface NamedTotal {
  name: string | null
  total: number
}

export interface MonthReport {
  incomeTotal: number
  incomeBySource: NamedTotal[]
  expenseTotal: number
  expenseByCategory: NamedTotal[]
  billsPaidTotal: number
  billsPaidCount: number
  billsOutstandingTotal: number
  billsOutstandingCount: number
  /** ما دخل الصناديق — الإيداعات الموجبة وحدها: السحب خروجُ دفعةٍ لا عكسُ ادّخار. */
  depositedTotal: number
  obligationPaidTotal: number
  obligationPaidCount: number
  /** الدخل − (مصاريف + فواتير مدفوعة + إيداعات) — حركة الجيب. */
  netFlow: number
  /** ما خرج من اليد فعلاً. */
  outTotal: number
}

const round2 = (v: number): number => Math.round(v * 100) / 100

function groupByName(rows: readonly { name: string | null; amount: number }[]): NamedTotal[] {
  const map = new Map<string | null, number>()
  for (const row of rows) {
    map.set(row.name, (map.get(row.name) ?? 0) + row.amount)
  }
  return [...map.entries()]
    .map(([name, total]) => ({ name, total: round2(total) }))
    .sort((a, b) => b.total - a.total || (a.name ?? '').localeCompare(b.name ?? '', 'ar'))
}

export function summarizeMonthReport(input: ReportInput): MonthReport {
  const incomeTotal = round2(input.incomes.reduce((s, i) => s + i.amount, 0))
  const expenseTotal = round2(input.expenses.reduce((s, e) => s + e.amount, 0))

  const paidBills = input.bills.filter((b) => b.isPaid)
  const unpaidBills = input.bills.filter((b) => !b.isPaid)
  const billsPaidTotal = round2(paidBills.reduce((s, b) => s + b.amount, 0))
  const billsOutstandingTotal = round2(unpaidBills.reduce((s, b) => s + b.amount, 0))

  const depositedTotal = round2(
    input.deposits.filter((d) => d.amount > 0).reduce((s, d) => s + d.amount, 0),
  )
  const obligationPaidTotal = round2(
    input.obligationPayments.reduce((s, p) => s + p.amount, 0),
  )

  const outTotal = round2(expenseTotal + billsPaidTotal + depositedTotal)

  return {
    incomeTotal,
    incomeBySource: groupByName(
      input.incomes.map((i) => ({ name: i.source, amount: i.amount })),
    ),
    expenseTotal,
    expenseByCategory: groupByName(
      input.expenses.map((e) => ({ name: e.category, amount: e.amount })),
    ),
    billsPaidTotal,
    billsPaidCount: paidBills.length,
    billsOutstandingTotal,
    billsOutstandingCount: unpaidBills.length,
    depositedTotal,
    obligationPaidTotal,
    obligationPaidCount: input.obligationPayments.length,
    netFlow: round2(incomeTotal - outTotal),
    outTotal,
  }
}

/**
 * التقرير ورقةً: CSV بصفوفٍ مسمّاة تُفتح في أي جدول.
 *
 * الأعمدة بالعربية عمداً — الورقة لصاحبها لا لبرنامج، وأرقامها خام بلا
 * تنسيق عملة: التنسيق يكسر الجمع في الجداول.
 */
export function reportToCsv(
  report: MonthReport,
  labels: {
    month: string
    unnamedIncome: string
    unnamedCategory: string
  },
): string {
  const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)
  const lines: string[] = ['البند,النوع,المبلغ']

  for (const row of report.incomeBySource) {
    lines.push(`${esc(row.name ?? labels.unnamedIncome)},دخل,${row.total}`)
  }
  for (const row of report.expenseByCategory) {
    lines.push(`${esc(row.name ?? labels.unnamedCategory)},مصاريف,${-row.total}`)
  }
  lines.push(`فواتير مدفوعة,فواتير,${-report.billsPaidTotal}`)
  lines.push(`إيداعات الصناديق,ادّخار,${-report.depositedTotal}`)
  if (report.obligationPaidTotal > 0) {
    lines.push(`دفعات التزامات (من صناديقها),التزامات,${-report.obligationPaidTotal}`)
  }
  lines.push(`صافي ${esc(labels.month)},صافي,${report.netFlow}`)

  // ‏BOM ليقرأ إكسل العربية صحيحةً لا رموزاً.
  return '﻿' + lines.join('\n')
}
