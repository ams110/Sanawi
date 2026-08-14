/**
 * فاتورة الشهر: قرار الكتابة وملخّص القراءة — القاعدة الواحدة للسطحين.
 *
 * كان لكلٍّ من الشاشة وخادم MCP نسخته: الشاشة تعيد كتابة تاريخ الدفع عند
 * تصحيح المبلغ (تدقيق آب 2026: س2)، وكلود يلخّص الفواتير بلا شرط الاستحقاق
 * فيذكّر ببندٍ لم تبدأ دفعاته (س9). القرار هنا، والكتابة عند كل عميل بأدواته.
 *
 * ملف نقي: لا React ولا Supabase.
 */

import { viewCommitment } from './calc.js'

/**
 * تاريخ دفع الفاتورة بعد إعادة تسجيلها.
 *
 * تاريخ دفعٍ قائم يبقى كما هو: إعادة التسجيل تصحيحُ مبلغٍ لا دفعٌ ثانٍ —
 * تصحيحُ فاتورةٍ مدفوعة من التلفون كان يعيد كتابة تاريخها إلى اليوم.
 */
export function resolveBillPaidAt(
  existingPaidAt: string | null | undefined,
  paid: boolean,
  today: string,
): string | null {
  if (!paid) return null
  return existingPaidAt ?? today
}

export interface BillSummaryRow {
  /** المقدَّر في الميزانية — المبلغ الكامل. */
  budgetedAmount: number
  mySharePercent: number
  startsOn: string | null
  endsOn: string | null
  /** الفاتورة المسجَّلة لهذا الشهر، أو null إن لم تُسجَّل. */
  recordedAmount: number | null
  paidAt: string | null
}

export interface BillsSummary {
  /** مجموع ما سُجّل لهذا الشهر. */
  recorded: number
  /** مجموع ما دُفع فعلاً. */
  paid: number
  /** ما زال مستحقاً هذا الشهر. */
  outstanding: number
  /** عدد البنود التي لم تُسجَّل بعد — كل بندٍ بلا صفّ، حيّاً أو لا. */
  missing: number
  /**
   * عدد البنود المستحقّة فعلاً هذا الشهر: بدأت دفعاتها، ولم تنتهِ، ولم تُسجَّل.
   *
   * غير `missing` عمداً: ذاك يقيس تقصيراً في الإدخال، وهذا مالاً يجب أن يخرج.
   */
  payable: number
}

const round2 = (v: number): number => Math.round(v * 100) / 100

export function summarizeBillRows(
  rows: readonly BillSummaryRow[],
  today: Date = new Date(),
): BillsSummary {
  let recorded = 0
  let paid = 0
  let missing = 0
  let payable = 0

  for (const row of rows) {
    if (row.recordedAmount === null) {
      missing++
      // الحكم من محرّك البنود نفسه لا من فحصٍ محلّي للتواريخ.
      const view = viewCommitment(
        {
          amount: row.budgetedAmount,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
          mySharePercent: row.mySharePercent,
        },
        today,
      )
      if (view.hasStarted && !view.isFinished) payable++
      continue
    }
    recorded += row.recordedAmount
    if (row.paidAt) paid += row.recordedAmount
  }

  return {
    recorded: round2(recorded),
    paid: round2(paid),
    outstanding: round2(recorded - paid),
    missing,
    payable,
  }
}
