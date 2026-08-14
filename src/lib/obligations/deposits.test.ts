import { describe, expect, it } from 'vitest'
import { type DepositRow, summarizeDeposits } from './deposits'

const TODAY = new Date('2026-08-06T00:00:00')

const row = (over: Partial<DepositRow> & { id: string }): DepositRow => ({
  amount: 500,
  depositDate: '2026-08-03',
  ...over,
})

describe('حركات الصندوق', () => {
  it('يجمع إيداعات الشهر ويعدّها', () => {
    const s = summarizeDeposits(
      [
        row({ id: 'a', amount: 500, depositDate: '2026-08-03' }),
        row({ id: 'b', amount: 300, depositDate: '2026-08-05' }),
        row({ id: 'c', amount: 400, depositDate: '2026-07-30' }),
      ],
      { today: TODAY },
    )

    expect(s.thisMonthTotal).toBe(800)
    expect(s.thisMonthCount).toBe(2)
    expect(s.alreadyDepositedThisMonth).toBe(true)
  })

  it('شهرٌ بلا إيداع لا يُنذر', () => {
    const s = summarizeDeposits([row({ id: 'a', depositDate: '2026-07-03' })], { today: TODAY })
    expect(s.alreadyDepositedThisMonth).toBe(false)
    expect(s.thisMonthTotal).toBe(0)
  })

  /*
   * السحب عند الدفع قيدٌ سالب لا إيداع.
   *
   * لولا هذا التمييز لقال التطبيق «أودعتَ هذا الشهر» لمن دفع التزامه ولم
   * يودع شيئاً — فيمنعه سؤالٌ لا معنى له عن أول إيداعٍ في الدورة الجديدة.
   */
  it('السحب لا يُعدّ إيداعاً', () => {
    const s = summarizeDeposits(
      [row({ id: 'a', amount: -2000, depositDate: '2026-08-01', note: 'سحب عند الدفع' })],
      { today: TODAY },
    )

    expect(s.alreadyDepositedThisMonth).toBe(false)
    expect(s.thisMonthTotal).toBe(0)
    expect(s.entries[0]!.kind).toBe('withdrawal')
    // المبلغ يخرج موجباً والاتجاه في `kind`: «−₪ 2,000» في قائمةٍ عنوانها
    // «سحب» نفيٌ مزدوج يُقرأ إيداعاً.
    expect(s.entries[0]!.amount).toBe(2000)
  })

  it('الأحدث أولاً', () => {
    const s = summarizeDeposits(
      [
        row({ id: 'قديم', depositDate: '2026-08-01' }),
        row({ id: 'جديد', depositDate: '2026-08-05' }),
        row({ id: 'أوسط', depositDate: '2026-08-03' }),
      ],
      { today: TODAY },
    )
    expect(s.entries.map((e) => e.id)).toEqual(['جديد', 'أوسط', 'قديم'])
    expect(s.lastDeposit?.id).toBe('جديد')
  })

  it('آخر إيداع يتخطّى السحوبات', () => {
    const s = summarizeDeposits(
      [
        row({ id: 'سحب', amount: -1000, depositDate: '2026-08-05' }),
        row({ id: 'إيداع', amount: 500, depositDate: '2026-08-02' }),
      ],
      { today: TODAY },
    )
    expect(s.lastDeposit?.id).toBe('إيداع')
  })

  // اليوم المجرّد يُقرأ محلياً لا بـUTC: قفزةُ يومٍ عند أول الشهر تنقل الإيداع
  // إلى الشهر السابق فيسقط من الحارس كلّه.
  it('إيداع أول الشهر لا يقع في الشهر السابق', () => {
    const s = summarizeDeposits([row({ id: 'a', depositDate: '2026-08-01' })], { today: TODAY })
    expect(s.alreadyDepositedThisMonth).toBe(true)
  })

  it('تاريخٌ غير مقروء لا يُحسب على هذا الشهر', () => {
    const s = summarizeDeposits([row({ id: 'a', depositDate: 'لا تاريخ' })], { today: TODAY })
    expect(s.alreadyDepositedThisMonth).toBe(false)
    expect(s.entries[0]!.isThisMonth).toBe(false)
  })

  /*
   * الحدّ آخرُ تفريغٍ للصندوق لا أولُ الشهر.
   *
   * من دفع التزامه ثم أودع أول قسطٍ للدورة الجديدة في الشهر نفسه ليس مكرِّراً:
   * ما أودعه قبل الدفع خرج كلّه. وتحذيرٌ كاذب هنا يُفقِد التحذيرَ الصادق أثره.
   */
  it('ما قبل السحب لا يُنذر عمّا بعده', () => {
    const s = summarizeDeposits(
      [
        row({ id: 'قبل', amount: 500, depositDate: '2026-08-02', createdAt: '2026-08-02T09:00:00Z' }),
        row({
          id: 'سحب',
          amount: -500,
          depositDate: '2026-08-04',
          createdAt: '2026-08-04T09:00:00Z',
        }),
        row({ id: 'بعد', amount: 300, depositDate: '2026-08-05', createdAt: '2026-08-05T09:00:00Z' }),
      ],
      { today: TODAY },
    )

    expect(s.thisMonthTotal).toBe(300)
    expect(s.thisMonthCount).toBe(1)
  })

  // والسحب في اليوم نفسه يُرتَّب بلحظة الكتابة: `deposit_date` يومٌ بلا وقت،
  // وبدونها يبدو الإيداع الذي تلا الدفعَ وكأنه سبقه.
  it('السحب والإيداع في اليوم نفسه يُرتَّبان بلحظة الكتابة', () => {
    const s = summarizeDeposits(
      [
        row({ id: 'قبل', amount: 500, depositDate: '2026-08-06', createdAt: '2026-08-06T08:00:00Z' }),
        row({
          id: 'سحب',
          amount: -500,
          depositDate: '2026-08-06',
          createdAt: '2026-08-06T09:00:00Z',
        }),
        row({ id: 'بعد', amount: 200, depositDate: '2026-08-06', createdAt: '2026-08-06T10:00:00Z' }),
      ],
      { today: TODAY },
    )

    expect(s.entries.map((e) => e.id)).toEqual(['بعد', 'سحب', 'قبل'])
    expect(s.thisMonthTotal).toBe(200)
    expect(s.alreadyDepositedThisMonth).toBe(true)
  })

  it('أول إيداع بعد الدفع لا يُنذر', () => {
    const s = summarizeDeposits(
      [
        row({ id: 'قبل', amount: 500, depositDate: '2026-08-02', createdAt: '2026-08-02T09:00:00Z' }),
        row({
          id: 'سحب',
          amount: -500,
          depositDate: '2026-08-04',
          createdAt: '2026-08-04T09:00:00Z',
        }),
      ],
      { today: TODAY },
    )
    expect(s.alreadyDepositedThisMonth).toBe(false)
  })

  it('بلا حركات: أصفارٌ لا NaN', () => {
    const s = summarizeDeposits([], { today: TODAY })
    expect(s.entries).toEqual([])
    expect(s.thisMonthTotal).toBe(0)
    expect(s.thisMonthCount).toBe(0)
    expect(s.lastDeposit).toBe(null)
    expect(s.alreadyDepositedThisMonth).toBe(false)
  })

  it('يميّز إيداع الشريك عن إيداعي', () => {
    const s = summarizeDeposits(
      [
        row({ id: 'أنا', partnerId: null }),
        row({ id: 'شريك', partnerId: 'p1' }),
      ],
      { today: TODAY },
    )
    expect(s.entries.find((e) => e.id === 'شريك')?.partnerId).toBe('p1')
    expect(s.entries.find((e) => e.id === 'أنا')?.partnerId).toBe(null)
  })

  /*
   * إيداع الشريك حصّتُه هو لا قسطي أنا. (تدقيق آب 2026: ل1)
   *
   * كان يدخل «أودعتَ هذا الشهر» فيُسقط قسطي من «ضلّ عليك» ويحذّرني من
   * تكرارٍ لم أفعله — بينما `monthInstallments` تستثنيه. القاعدة واحدة الآن.
   */
  it('إيداع الشريك وحده لا يقول «أودعتَ هذا الشهر»', () => {
    const s = summarizeDeposits(
      [row({ id: 'شريك', amount: 250, depositDate: '2026-08-05', partnerId: 'p1' })],
      { today: TODAY },
    )
    expect(s.alreadyDepositedThisMonth).toBe(false)
    expect(s.thisMonthTotal).toBe(0)
    expect(s.thisMonthCount).toBe(0)
    // ويبقى في الحركات مرئياً — التصفية على العدّادات لا على التاريخ.
    expect(s.entries).toHaveLength(1)
  })

  it('وإيداعي بجانب إيداع الشريك يُعدّ وحدي', () => {
    const s = summarizeDeposits(
      [
        row({ id: 'أنا', amount: 250, depositDate: '2026-08-04', partnerId: null }),
        row({ id: 'شريك', amount: 250, depositDate: '2026-08-05', partnerId: 'p1' }),
      ],
      { today: TODAY },
    )
    expect(s.thisMonthTotal).toBe(250)
    expect(s.thisMonthCount).toBe(1)
    expect(s.alreadyDepositedThisMonth).toBe(true)
  })
})
