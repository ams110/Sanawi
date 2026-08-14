import { describe, expect, it } from 'vitest'
import {
  pendingThisMonth,
  type PendingBillInput,
  type PendingIncomeInput,
  type PendingObligationInput,
} from './pending'

const TODAY = new Date('2026-08-06T00:00:00')

const obligation = (over: Partial<PendingObligationInput>): PendingObligationInput => ({
  id: 'o1',
  name: 'تأمين السيارة',
  monthlyInstallment: 500,
  isOverdue: false,
  deposits: [],
  ...over,
})

const income = (over: Partial<PendingIncomeInput>): PendingIncomeInput => ({
  id: 'i1',
  name: 'راتب',
  amount: 9000,
  frequency: 'monthly',
  isVariable: false,
  receivedAmount: 0,
  receivedCount: 0,
  ...over,
})

const bill = (over: Partial<PendingBillInput>): PendingBillInput => ({
  id: 'b1',
  name: 'كهرباء',
  amount: 400,
  average: 0,
  isDueThisMonth: true,
  isRecorded: false,
  dayOfMonth: null,
  ...over,
})

const run = (over: Partial<Parameters<typeof pendingThisMonth>[0]> = {}) =>
  pendingThisMonth({ obligations: [], incomes: [], bills: [], today: TODAY, ...over })

describe('ما زال عليك هذا الشهر', () => {
  it('الصندوق الذي لم يستلم قسطه يظهر برقمه', () => {
    const r = run({ obligations: [obligation({})] })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({
      kind: 'deposit',
      name: 'تأمين السيارة',
      amount: 500,
      isCertain: true,
    })
  })

  /*
   * القاعدة الأولى: ما تمّ لا يظهر.
   *
   * الحارس يصير **تعريفاً للقائمة** لا سؤالاً يُطرح بعد أن يتحرّك الإصبع —
   * فمن أودع ثم فتح التطبيق بعد ساعة لا يجد ما يضغطه مرّةً ثانية أصلاً.
   */
  it('الصندوق الذي استلم قسطه كاملاً يسقط', () => {
    const r = run({
      obligations: [
        obligation({ deposits: [{ id: 'd1', amount: 500, depositDate: '2026-08-03' }] }),
      ],
    })
    expect(r.items).toHaveLength(0)
    expect(r.isClear).toBe(true)
  })

  // إيداعُ شيكلٍ واحد كان يُسقط القسط كلَّه من القائمة. (تدقيق آب 2026: ش13)
  it('الإيداع الجزئي يُبقي السطر بالباقي', () => {
    const r = run({
      obligations: [
        obligation({ deposits: [{ id: 'd1', amount: 100, depositDate: '2026-08-03' }] }),
      ],
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]!.amount).toBe(400)
    expect(r.items[0]!.note).toEqual({ type: 'partialDeposit', deposited: 100, total: 500 })
  })

  // إيداع الشريك حصّتُه هو لا قسطي أنا. (ل1 — العطل الحرج في التدقيق)
  it('إيداع الشريك لا يسدّ قسطي', () => {
    const r = run({
      obligations: [
        obligation({
          deposits: [{ id: 'd1', amount: 250, depositDate: '2026-08-05', partnerId: 'p1' }],
        }),
      ],
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]!.amount).toBe(500)
    expect(r.items[0]!.note).toEqual({ type: 'installment' })
  })

  it('وإيداعُ الشهر الماضي لا يُسقطه', () => {
    const r = run({
      obligations: [
        obligation({ deposits: [{ id: 'd1', amount: 500, depositDate: '2026-07-03' }] }),
      ],
    })
    expect(r.items).toHaveLength(1)
  })

  // السحب عند الدفع ليس إيداعاً: من دفع التزامه يبدأ دورةً جديدة، وأول قسطٍ
  // فيها ما زال عليه.
  it('السحب عند الدفع لا يُسقط السطر', () => {
    const r = run({
      obligations: [
        obligation({
          deposits: [{ id: 'w', amount: -2000, depositDate: '2026-08-01', note: 'سحب عند الدفع' }],
        }),
      ],
    })
    expect(r.items).toHaveLength(1)
  })

  it('الصندوق بلا قسط لا يُطلب له شيء', () => {
    expect(run({ obligations: [obligation({ monthlyInstallment: 0 })] }).items).toHaveLength(0)
  })

  it('ما فات موعده يسبق ما لم يفت', () => {
    const r = run({
      obligations: [
        obligation({ id: 'a', name: 'أ', isOverdue: false }),
        obligation({ id: 'b', name: 'ب', isOverdue: true }),
      ],
    })
    expect(r.items[0]!.id).toBe('b')
    expect(r.items[0]!.note).toEqual({ type: 'overdue' })
  })
})

describe('الدخل — قائمةٌ ثانية لا سطرٌ في «عليك»', () => {
  // «ضلّ عليك» تعني ما يخرج منك، والدخل يدخل إليك. (ش6)
  it('الدخل في incomeItems لا في items', () => {
    const r = run({ incomes: [income({})] })
    expect(r.items).toHaveLength(0)
    expect(r.incomeItems).toHaveLength(1)
    expect(r.incomeItems[0]).toMatchObject({ kind: 'income', amount: 9000 })
    expect(r.isClear).toBe(false)
  })

  // «قسطك الشهري» تخصّ الصندوق: الدخل يأتي إليك ولا تدفعه لنفسك.
  it('سطر الدخل لا يقول «قسطك»', () => {
    expect(run({ incomes: [income({})] }).incomeItems[0]!.note).toEqual({ type: 'expected' })
  })

  it('والذي وصل مبلغُه كاملاً يسقط', () => {
    expect(
      run({ incomes: [income({ receivedAmount: 9000, receivedCount: 1 })] }).incomeItems,
    ).toHaveLength(0)
  })

  /*
   * الاكتمال بالمبلغ لا بعدد القيود (ش12): قيدٌ واحد بنصف الراتب كان
   * يُسقط السطر «اكتمل» واللوحة تعرض فجوة النصف — تناقضٌ على شاشة واحدة.
   */
  it('قيدٌ واحد بنصف الراتب نصفُ اكتمال لا اكتمال', () => {
    const r = run({ incomes: [income({ receivedAmount: 4500, receivedCount: 1 })] })
    expect(r.incomeItems).toHaveLength(1)
    expect(r.incomeItems[0]!.amount).toBe(4500)
    expect(r.incomeItems[0]!.note).toEqual({ type: 'partial', received: 4500, expected: 9000 })
  })

  /*
   * الأسبوعي بمكافئه الحقيقي 52/12 لا بأربعة (ش8): أربع دفعات من 1,000
   * كانت «تُكمل» المصدر هنا بينما اللوحة تعرض «أقل من المعتاد بـ333» —
   * تناقضٌ دائمٌ كلَّ شهر.
   */
  it('الأسبوعي يُقاس على 4.333 فلا يناقض اللوحة', () => {
    const r = run({
      incomes: [income({ frequency: 'weekly', amount: 1000, receivedAmount: 4000, receivedCount: 4 })],
    })
    expect(r.incomeItems).toHaveLength(1)
    expect(r.incomeItems[0]!.amount).toBe(333.33) // ‏4333.33 − 4000
  })

  it('ويسقط حين يصل مكافئه الشهري', () => {
    expect(
      run({
        incomes: [
          income({ frequency: 'weekly', amount: 1000, receivedAmount: 4333.33, receivedCount: 5 }),
        ],
      }).incomeItems,
    ).toHaveLength(0)
  })

  /*
   * الدخل المتغيّر يُذكَّر به بلا رقم.
   *
   * اختراع رقمٍ له هو بالضبط ما جعل «الدخل المتوقَّع» يكذب قبل أن يُضاف
   * `is_variable` — فلا يُعاد هنا من باب القائمة. ويبقى على العدّ إذ لا
   * مبلغ يُقاس عليه.
   */
  it('المتغيّر بلا رقم ويسقط بالعدّ', () => {
    const r = run({ incomes: [income({ isVariable: true, amount: 0 })] })
    expect(r.incomeItems[0]!.amount).toBe(null)
    expect(r.incomeItems[0]!.isCertain).toBe(false)
    expect(r.incomeItems[0]!.note).toEqual({ type: 'variable' })
    expect(
      run({ incomes: [income({ isVariable: true, amount: 0, receivedCount: 1 })] }).incomeItems,
    ).toHaveLength(0)
  })
})

describe('الفواتير', () => {
  it('الفاتورة غير المسجّلة تظهر بمتوسّطها لا بمقدَّرها', () => {
    const r = run({ bills: [bill({ amount: 400, average: 340 })] })
    expect(r.items[0]).toMatchObject({ kind: 'bill', amount: 340 })
  })

  it('وبمقدَّرها حين لا متوسّط بعد', () => {
    expect(run({ bills: [bill({ average: 0 })] }).items[0]!.amount).toBe(400)
  })

  /*
   * المتوسّط تخمينٌ لا يُؤكَّد بضغطة.
   *
   * `bill_averages` يُحسب على كل صفّ فاتورة بلا شرط الدفع، فتأكيده بضغطة
   * يكتبه في الجدول الذي وُلد منه — حلقةٌ تثبّت رقماً لم يدفعه أحد.
   */
  it('الفاتورة غير يقينية — تُصحَّح من الورقة', () => {
    expect(run({ bills: [bill({ average: 340 })] }).items[0]!.isCertain).toBe(false)
  })

  it('المسجّلة تسقط', () => {
    expect(run({ bills: [bill({ isRecorded: true })] }).items).toHaveLength(0)
  })

  it('وما لم يبدأ أو انتهى لا يُحمَّل على الشهر', () => {
    expect(run({ bills: [bill({ isDueThisMonth: false })] }).items).toHaveLength(0)
  })

  it('التي حان يومها تسبق الصناديق', () => {
    const r = run({
      obligations: [obligation({})],
      bills: [bill({ dayOfMonth: 6 })],
    })
    expect(r.items[0]!.kind).toBe('bill')
    expect(r.items[0]!.note).toEqual({ type: 'due', days: 0 })
  })

  it('والبعيدة تليها', () => {
    const r = run({
      obligations: [obligation({})],
      bills: [bill({ dayOfMonth: 28 })],
    })
    expect(r.items[0]!.kind).toBe('deposit')
  })
})

describe('القائمة نفسها', () => {
  it('الترتيب: ما فات، ثم فاتورة اليوم، ثم الصناديق — والدخل في قائمته', () => {
    const r = run({
      obligations: [
        obligation({ id: 'late', name: 'متأخر', isOverdue: true }),
        obligation({ id: 'normal', name: 'عادي' }),
      ],
      bills: [bill({ id: 'today', dayOfMonth: 6 })],
      incomes: [income({})],
    })
    expect(r.items.map((i) => i.id)).toEqual(['late', 'today', 'normal'])
    expect(r.incomeItems.map((i) => i.id)).toEqual(['i1'])
  })

  // العنوان كان يعدّ المعروض لا الكلّ: «ضلّ عليك 6» والحقيقة 7. (ش7)
  it('يُقصّ عند الحدّ ويُقال العدد الحقيقي', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      obligation({ id: `o${i}`, name: `صندوق ${i}` }),
    )
    const r = run({ obligations: many, limit: 6 })
    expect(r.items).toHaveLength(6)
    expect(r.hiddenCount).toBe(3)
    expect(r.totalCount).toBe(9)
  })

  it('كل ما عليه تمّ — حالةٌ تُقال', () => {
    const r = run({})
    expect(r.isClear).toBe(true)
    expect(r.hiddenCount).toBe(0)
    expect(r.totalCount).toBe(0)
  })

  it('دخلٌ منتظرٌ وحده يمنع «كله تمام»', () => {
    expect(run({ incomes: [income({})] }).isClear).toBe(false)
  })

  // القاعدة الثانية بنيةً لا انضباطاً: لا سطر بلا معرّفٍ يُنفَّذ عليه، فيستحيل
  // أن تحمل القائمة تحذيراً بلا زرّ.
  it('كل سطر يحمل معرّفاً يُنفَّذ عليه', () => {
    const r = run({
      obligations: [obligation({})],
      bills: [bill({})],
      incomes: [income({})],
    })
    expect([...r.items, ...r.incomeItems].every((i) => i.id.length > 0)).toBe(true)
    expect(r.items).toHaveLength(2)
    expect(r.incomeItems).toHaveLength(1)
  })
})

// فاتورة يومها أكبر من أيام الشهر تُستحقّ آخرَه، لا «بعد أيام» ليومٍ لا يأتي. (ش16)
describe('يوم استحقاقٍ خارج الشهر', () => {
  it('يوم 31 في شباط يُقصّ إلى آخره', () => {
    const r = pendingThisMonth({
      obligations: [],
      incomes: [],
      bills: [bill({ dayOfMonth: 31 })],
      today: new Date('2026-02-27T00:00:00'),
    })
    // شباط 2026 ينتهي في 28: ‏28 − 27 = بعد يوم واحد، لا «بعد 4 أيام».
    expect(r.items[0]!.note).toEqual({ type: 'due', days: 1 })
  })
})
