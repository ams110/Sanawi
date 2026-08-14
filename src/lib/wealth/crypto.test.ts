import { describe, expect, it } from 'vitest'
import { valueCryptoHoldings, type CryptoValuationInput } from './crypto'

const input = (over: Partial<CryptoValuationInput>): CryptoValuationInput => ({
  balances: [],
  usdPrices: {},
  ...over,
})

describe('تقييم المحفظة', () => {
  it('يضرب الكمية بالسعر ثم بسعر الصرف', () => {
    const r = valueCryptoHoldings(
      input({
        balances: [{ coin: 'BTC', amount: 0.5 }],
        usdPrices: { BTC: 60000 },
        usdToCurrencyRate: 3.7,
      }),
    )
    expect(r.total).toBe(111000) // ‏0.5 × 60,000 × 3.7
    expect(r.holdings[0]).toMatchObject({ coin: 'BTC', value: 111000, share: 1 })
  })

  it('بلا سعر صرف يبقى الرقم بالدولار لا يُمحى', () => {
    const r = valueCryptoHoldings(
      input({ balances: [{ coin: 'USDT', amount: 100 }], usdPrices: { USDT: 1 } }),
    )
    expect(r.total).toBe(100)
  })

  it('يجمع عملاتٍ متعددة ويرتّبها الأكبر أولاً', () => {
    // القيم مختلفة عمداً: متساويان لا يفحصان ترتيباً.
    const r = valueCryptoHoldings(
      input({
        balances: [
          { coin: 'ETH', amount: 2 }, // ‏6,000
          { coin: 'BTC', amount: 0.2 }, // ‏12,000
        ],
        usdPrices: { ETH: 3000, BTC: 60000 },
      }),
    )
    expect(r.total).toBe(18000)
    expect(r.holdings.map((h) => h.coin)).toEqual(['BTC', 'ETH'])
    expect(r.holdings[0]!.share).toBeCloseTo(2 / 3, 5)
  })

  /*
   * العملة المجهولة سعرُها ليست صفراً — وإلا كذب المجموع بالنقصان صامتاً،
   * وهو أسوأ اتجاهٍ للخطأ في شاشةٍ كل غرضها أن تقول «كم معك».
   */
  it('العملة بلا سعر تُقال ولا تُصفَّر', () => {
    const r = valueCryptoHoldings(
      input({
        balances: [
          { coin: 'BTC', amount: 1 },
          { coin: 'SHIB', amount: 1_000_000 },
        ],
        usdPrices: { BTC: 60000 },
      }),
    )
    expect(r.total).toBe(60000)
    expect(r.unpriced).toEqual(['SHIB'])
    expect(r.holdings).toHaveLength(1)
  })

  it('ولا تتكرّر في القائمة ولو تكرّر رصيدها', () => {
    const r = valueCryptoHoldings(
      input({
        balances: [
          { coin: 'SHIB', amount: 5 },
          { coin: 'shib', amount: 5 },
        ],
      }),
    )
    expect(r.unpriced).toEqual(['SHIB'])
  })

  // الغبار يُطوى من العرض والمجموع يبقى كاملاً: المجموع رقم مال، والقائمة عرض.
  it('الغبار يُقصّ من القائمة لا من المجموع', () => {
    const r = valueCryptoHoldings(
      input({
        balances: [
          { coin: 'BTC', amount: 1 },
          { coin: 'DOGE', amount: 10 },
        ],
        usdPrices: { BTC: 60000, DOGE: 0.1 },
        dustThreshold: 5,
      }),
    )
    expect(r.holdings.map((h) => h.coin)).toEqual(['BTC'])
    expect(r.dustCount).toBe(1)
    expect(r.dustValue).toBe(1)
    expect(r.total).toBe(60001)
  })

  it('الرمز يُوحَّد كبيراً ومقصوصاً', () => {
    const r = valueCryptoHoldings(
      input({ balances: [{ coin: ' btc ', amount: 1 }], usdPrices: { BTC: 100 } }),
    )
    expect(r.holdings[0]!.coin).toBe('BTC')
  })

  it('الرصيد الصفري لا يُعرض ولا يُعدّ بلا سعر', () => {
    const r = valueCryptoHoldings(input({ balances: [{ coin: 'ETH', amount: 0 }] }))
    expect(r.holdings).toHaveLength(0)
    expect(r.unpriced).toHaveLength(0)
    expect(r.total).toBe(0)
  })

  it('محفظة فارغة: أصفار لا NaN', () => {
    const r = valueCryptoHoldings(input({}))
    expect(r.total).toBe(0)
    expect(r.holdings).toEqual([])
    expect(r.dustValue).toBe(0)
  })

  // بوّابة المدخل الفاسد (قاعدة CLAUDE.md السادسة): المنصّات تعيد نصوصاً،
  // وسعرُ صرفٍ فاسد كان سيمحو المحفظة كلها بضربها في NaN.
  it('لا يسرّب NaN من سعرٍ أو كميةٍ أو صرفٍ فاسد', () => {
    const r = valueCryptoHoldings(
      input({
        balances: [
          { coin: 'BTC', amount: Number.NaN },
          { coin: 'ETH', amount: 2 },
        ],
        usdPrices: { BTC: 60000, ETH: 3000 },
        usdToCurrencyRate: Number.NaN,
      }),
    )
    expect(r.total).toBe(6000)
    expect(Number.isFinite(r.total)).toBe(true)
  })

  it('وسعر صرفٍ سالب أو صفر لا يمحو المحفظة', () => {
    expect(
      valueCryptoHoldings(
        input({
          balances: [{ coin: 'BTC', amount: 1 }],
          usdPrices: { BTC: 100 },
          usdToCurrencyRate: 0,
        }),
      ).total,
    ).toBe(100)
  })
})
