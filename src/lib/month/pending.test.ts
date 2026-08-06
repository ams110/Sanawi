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
  it('الصندوق الذي أُودع فيه هذا الشهر يسقط', () => {
    const r = run({
      obligations: [
        obligation({ deposits: [{ id: 'd1', amount: 500, depositDate: '2026-08-03' }] }),
      ],
    })
    expect(r.items).toHaveLength(0)
    expect(r.isClear).toBe(true)
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

describe('الدخل', () => {
  it('المصدر الذي لم يصل يظهر بمبلغه', () => {
    const r = run({ incomes: [income({})] })
    expect(r.items[0]).toMatchObject({ kind: 'income', amount: 9000 })
  })

  // «قسطك الشهري» تخصّ الصندوق: الدخل يأتي إليك ولا تدفعه لنفسك.
  it('سطر الدخل لا يقول «قسطك»', () => {
    expect(run({ incomes: [income({})] }).items[0]!.note).toEqual({ type: 'expected' })
  })

  it('والذي وصل يسقط', () => {
    expect(run({ incomes: [income({ receivedCount: 1 })] }).items).toHaveLength(0)
  })

  // الأسبوعي أربع دفعات في الشهر: من سجّل واحدة ما زال عليه ثلاث، والسطر
  // يقول أين وصل بدل أن يظهر كأنه لم يبدأ.
  it('الأسبوعي يبقى حتى تكتمل دفعاته ويقول أين وصل', () => {
    const r = run({ incomes: [income({ frequency: 'weekly', receivedCount: 2 })] })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]!.note).toEqual({ type: 'partial', done: 2, total: 4 })
  })

  it('ويسقط حين تكتمل', () => {
    expect(
      run({ incomes: [income({ frequency: 'weekly', receivedCount: 4 })] }).items,
    ).toHaveLength(0)
  })

  /*
   * الدخل المتغيّر يُذكَّر به بلا رقم.
   *
   * اختراع رقمٍ له هو بالضبط ما جعل «الدخل المتوقَّع» يكذب قبل أن يُضاف
   * `is_variable` — فلا يُعاد هنا من باب القائمة.
   */
  it('المتغيّر بلا رقم', () => {
    const r = run({ incomes: [income({ isVariable: true, amount: 0 })] })
    expect(r.items[0]!.amount).toBe(null)
    expect(r.items[0]!.isCertain).toBe(false)
    expect(r.items[0]!.note).toEqual({ type: 'variable' })
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
  it('الترتيب: ما فات، ثم فاتورة اليوم، ثم الصناديق، ثم الدخل', () => {
    const r = run({
      obligations: [
        obligation({ id: 'late', name: 'متأخر', isOverdue: true }),
        obligation({ id: 'normal', name: 'عادي' }),
      ],
      bills: [bill({ id: 'today', dayOfMonth: 6 })],
      incomes: [income({})],
    })
    expect(r.items.map((i) => i.id)).toEqual(['late', 'today', 'normal', 'i1'])
  })

  it('يُقصّ عند الحدّ ويُقال كم بقي', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      obligation({ id: `o${i}`, name: `صندوق ${i}` }),
    )
    const r = run({ obligations: many, limit: 6 })
    expect(r.items).toHaveLength(6)
    expect(r.hiddenCount).toBe(3)
  })

  it('كل ما عليه تمّ — حالةٌ تُقال', () => {
    const r = run({})
    expect(r.isClear).toBe(true)
    expect(r.hiddenCount).toBe(0)
  })

  // القاعدة الثانية بنيةً لا انضباطاً: لا سطر بلا معرّفٍ يُنفَّذ عليه، فيستحيل
  // أن تحمل القائمة تحذيراً بلا زرّ.
  it('كل سطر يحمل معرّفاً يُنفَّذ عليه', () => {
    const r = run({
      obligations: [obligation({})],
      bills: [bill({})],
      incomes: [income({})],
    })
    expect(r.items.every((i) => i.id.length > 0)).toBe(true)
    expect(r.items).toHaveLength(3)
  })
})
