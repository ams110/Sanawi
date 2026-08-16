import { describe, expect, it } from 'vitest'
import { monthActuals } from './actuals'

// ساعةٌ نهارية لا منتصف ليل (قاعدة 7): منتصف الليل يخفي أخطاء حدود اليوم.
const TODAY = new Date(2026, 7, 16, 14, 30)
const day = (d: number): string => `2026-08-${String(d).padStart(2, '0')}`

const deposit = (over: Partial<{ id: string; amount: number; depositDate: string; partnerId: string | null }> = {}) => ({
  id: over.id ?? 'd1',
  amount: over.amount ?? 500,
  depositDate: over.depositDate ?? day(5),
  partnerId: over.partnerId ?? null,
})

const run = (over: Partial<Parameters<typeof monthActuals>[0]> = {}) =>
  monthActuals({ obligations: [], bills: [], today: TODAY, ...over })

describe('monthActuals — الإيداعات', () => {
  it('يجمع إيداعات هذا الشهر عبر كل الصناديق', () => {
    const r = run({
      obligations: [
        { deposits: [deposit({ amount: 500 }), deposit({ id: 'd2', amount: 300 })] },
        { deposits: [deposit({ id: 'd3', amount: 200 })] },
      ],
    })
    expect(r.depositsPaid).toBe(1000)
  })

  // قاعدة 3: إيداع الشريك حصّتُه هو، لا قسطي أنا. (ل1)
  it('إيداع الشريك ليس إيداعي', () => {
    const r = run({
      obligations: [
        { deposits: [deposit({ amount: 500 }), deposit({ id: 'd2', amount: 900, partnerId: 'p1' })] },
      ],
    })
    expect(r.depositsPaid).toBe(500)
  })

  it('إيداع شهرٍ ماضٍ لا يُحسب على هذا الشهر', () => {
    const r = run({
      obligations: [{ deposits: [deposit({ depositDate: '2026-07-28', amount: 700 })] }],
    })
    expect(r.depositsPaid).toBe(0)
  })

  it('السحب ليس إيداعاً — والصندوق المُفرَّغ يبدأ دورةً جديدة', () => {
    const r = run({
      obligations: [
        {
          deposits: [
            deposit({ id: 'in', amount: 500, depositDate: day(2) }),
            deposit({ id: 'out', amount: -500, depositDate: day(6) }),
            deposit({ id: 'again', amount: 400, depositDate: day(10) }),
          ],
        },
      ],
    })
    // ما قبل التفريغ خرج من الصندوق كلّه؛ الباقي هو إيداع الدورة الجديدة.
    expect(r.depositsPaid).toBe(400)
  })

  it('بلا صناديق: صفر لا NaN', () => {
    expect(run().depositsPaid).toBe(0)
  })
})

describe('monthActuals — الفواتير', () => {
  // قاعدة 3: `bill_payments.amount` المبلغ الكامل، ومن ينصّف الإنترنت لا يدفع كلّه.
  it('يحسب حصّتي لا المبلغ الكامل', () => {
    const r = run({ bills: [{ recordedAmount: 200, mySharePercent: 50 }] })
    expect(r.billsPaid).toBe(100)
  })

  it('فاتورةٌ لم تُسجَّل لا تدخل «ما خرج»', () => {
    const r = run({
      bills: [
        { recordedAmount: null, mySharePercent: 100 },
        { recordedAmount: 150, mySharePercent: 100 },
      ],
    })
    expect(r.billsPaid).toBe(150)
  })

  /*
   * حصّةٌ فاسدة ترجع إلى 100 لا إلى صفر — افتراض القاعدة نفسها. صفرٌ هنا
   * يُنقص «ما خرج» فيرفع «اللي بإيدك» فيرفع الكفاية: خطأٌ متفائل، وهو
   * الاتجاه الوحيد غير المقبول.
   */
  it('حصّةٌ فاسدة تُعامَل 100٪ لا صفراً', () => {
    expect(run({ bills: [{ recordedAmount: 300, mySharePercent: Number.NaN }] }).billsPaid).toBe(300)
  })

  it('حصّة فوق 100 تُقَصّ، وتحت الصفر تُرفَع', () => {
    expect(run({ bills: [{ recordedAmount: 100, mySharePercent: 250 }] }).billsPaid).toBe(100)
    expect(run({ bills: [{ recordedAmount: 100, mySharePercent: -40 }] }).billsPaid).toBe(0)
  })

  it('مبلغٌ سالب أو فاسد لا يُنقص ما خرج', () => {
    expect(run({ bills: [{ recordedAmount: -500, mySharePercent: 100 }] }).billsPaid).toBe(0)
    expect(run({ bills: [{ recordedAmount: Number.NaN, mySharePercent: 100 }] }).billsPaid).toBe(0)
  })
})
