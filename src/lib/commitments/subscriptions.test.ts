import { describe, expect, it } from 'vitest'
import { summarizeSubscriptions } from './subscriptions'

const TODAY = new Date(2026, 7, 10)

const sub = (over: Partial<Parameters<typeof summarizeSubscriptions>[0][number]> = {}) => ({
  id: 'c1',
  name: 'إنترنت',
  icon: null,
  amount: 159,
  startsOn: null,
  endsOn: null,
  ...over,
})

describe('الاشتراكات', () => {
  it('يجمع الدائم بحصّتي ويقلب العدسة سنوياً', () => {
    const s = summarizeSubscriptions(
      [sub(), sub({ id: 'c2', name: 'كلود', amount: 520 })],
      TODAY,
    )
    expect(s.count).toBe(2)
    expect(s.monthlyTotal).toBe(679)
    expect(s.yearlyTotal).toBe(8148)
    // الأغلى أولاً — هو المرشّح الأول للمراجعة.
    expect(s.rows[0]!.name).toBe('كلود')
    expect(s.rows[0]!.yearly).toBe(6240)
  })

  it('القسط الذي ينتهي ليس اشتراكاً — له عدّاده وعبؤه مؤقّت', () => {
    const s = summarizeSubscriptions([sub({ endsOn: '2026-11-15' })], TODAY)
    expect(s.count).toBe(0)
  })

  it('ما لم تبدأ دفعاته لا يُحمَّل بعد', () => {
    const s = summarizeSubscriptions([sub({ startsOn: '2026-09-01' })], TODAY)
    expect(s.count).toBe(0)
    expect(summarizeSubscriptions([sub({ startsOn: '2026-08-01' })], TODAY).count).toBe(1)
  })

  it('الحصّة المشتركة تدخل بحصّتي لا بالمبلغ الكامل', () => {
    const s = summarizeSubscriptions([sub({ amount: 400, mySharePercent: 50 })], TODAY)
    expect(s.rows[0]!.monthly).toBe(200)
    expect(s.rows[0]!.yearly).toBe(2400)
  })

  it('نصيب كل صفٍّ من المجموع يجمع إلى واحد', () => {
    const s = summarizeSubscriptions(
      [sub({ amount: 300 }), sub({ id: 'c2', name: 'ب', amount: 100 })],
      TODAY,
    )
    expect(s.rows[0]!.share).toBe(0.75)
    expect(s.rows[1]!.share).toBe(0.25)
  })

  it('التعادل يُرتَّب بالاسم — قائمة لا تعيد ترتيب نفسها', () => {
    const s = summarizeSubscriptions(
      [sub({ id: 'a', name: 'ب', amount: 100 }), sub({ id: 'b', name: 'أ', amount: 100 })],
      TODAY,
    )
    expect(s.rows.map((r) => r.name)).toEqual(['أ', 'ب'])
  })
})
