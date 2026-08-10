import { describe, expect, it } from 'vitest'
import { projectCashFlow } from './forecast'

const TODAY = new Date(2026, 7, 10) // 10 آب — الشهر 31 يوماً، بقي 22 يوماً

const base = {
  startBalance: 2000,
  bills: [],
  annualDues: [],
  installments: [],
  dailySpend: 0,
  today: TODAY,
}

describe('التوقّع النقدي', () => {
  it('بلا أحداثٍ ولا صرف يبقى الرصيد كما هو حتى آخر الشهر', () => {
    const r = projectCashFlow(base)
    expect(r.days).toHaveLength(22)
    expect(r.endBalance).toBe(2000)
    expect(r.crossesZeroOn).toBeNull()
    expect(r.lowest.balance).toBe(2000)
  })

  it('الفاتورة تقع في يومها وتُنزل الرصيد', () => {
    const r = projectCashFlow({
      ...base,
      bills: [{ name: 'كهرباء', amount: 400, dayOfMonth: 15 }],
    })
    const day15 = r.days.find((d) => d.date.getDate() === 15)!
    expect(day15.events[0]!.name).toBe('كهرباء')
    expect(day15.balance).toBe(1600)
    expect(r.endBalance).toBe(1600)
  })

  it('يلتقط العبور المؤقّت تحت الصفر — وهو الخبر الذي وُلد لأجله', () => {
    // فاتورة كبيرة يوم 12 ثم لا شيء: الرصيد يعبر وينتظر تحت الصفر.
    const r = projectCashFlow({
      ...base,
      startBalance: 500,
      bills: [{ name: 'إيجار', amount: 900, dayOfMonth: 12 }],
    })
    expect(r.crossesZeroOn?.getDate()).toBe(12)
    expect(r.lowest.balance).toBe(-400)
  })

  it('دفعة الالتزام يخرج نقصُها وحده — الصندوق محجوزٌ أصلاً', () => {
    const r = projectCashFlow({
      ...base,
      annualDues: [
        { name: 'تأمين', myAmount: 3000, fundBalance: 2500, dueDate: new Date(2026, 7, 20) },
      ],
    })
    const day20 = r.days.find((d) => d.date.getDate() === 20)!
    expect(day20.events[0]!.amount).toBe(500)
    expect(r.endBalance).toBe(1500)
  })

  it('الصندوق الجاهز لا يُخرج شيئاً', () => {
    const r = projectCashFlow({
      ...base,
      annualDues: [
        { name: 'تأمين', myAmount: 3000, fundBalance: 3000, dueDate: new Date(2026, 7, 20) },
      ],
    })
    expect(r.endBalance).toBe(2000)
    expect(r.days.every((d) => d.events.length === 0)).toBe(true)
  })

  it('ما لا موعد له يقع اليوم — الخطأ باتجاه الجاهزية', () => {
    const r = projectCashFlow({
      ...base,
      bills: [{ name: 'اشتراك', amount: 100, dayOfMonth: null }],
      installments: [{ name: 'صندوق التأمين', amount: 300 }],
    })
    expect(r.days[0]!.events).toHaveLength(2)
    expect(r.days[0]!.balance).toBe(1600)
  })

  it('الفاتورة الفائتة تُسحب إلى اليوم لا تسقط من النافذة', () => {
    const r = projectCashFlow({
      ...base,
      bills: [{ name: 'تلفون', amount: 200, dayOfMonth: 3 }],
    })
    expect(r.days[0]!.events[0]!.name).toBe('تلفون')
  })

  it('الصرف اليومي يوزَّع على كل يومٍ متبقٍّ', () => {
    const r = projectCashFlow({ ...base, dailySpend: 50 })
    expect(r.endBalance).toBe(2000 - 50 * 22)
    expect(r.days[0]!.balance).toBe(1950)
  })

  it('يوم 31 في فاتورةٍ وشهرُ العرض أقصر يُقصّ إلى آخر يومٍ فعلي', () => {
    const feb = new Date(2026, 1, 10) // شباط 2026 — 28 يوماً
    const r = projectCashFlow({
      ...base,
      today: feb,
      bills: [{ name: 'قسط', amount: 100, dayOfMonth: 31 }],
    })
    expect(r.days.at(-1)!.date.getDate()).toBe(28)
    expect(r.days.at(-1)!.events).toHaveLength(1)
  })

  it('أدنى نقطةٍ ليست رقم آخر الشهر حين يقع الثقل في المنتصف', () => {
    const r = projectCashFlow({
      ...base,
      startBalance: 1000,
      bills: [{ name: 'إيجار', amount: 1200, dayOfMonth: 12 }],
      annualDues: [],
    })
    // يعبر يوم 12 إلى −200 ويبقى هناك: الأدنى في 12 لا في 31.
    expect(r.lowest.date.getDate()).toBe(12)
    expect(r.lowest.balance).toBe(-200)
  })

  it('المجموع الخارج يجمع الأحداث والصرف معاً', () => {
    const r = projectCashFlow({
      ...base,
      bills: [{ name: 'كهرباء', amount: 400, dayOfMonth: 15 }],
      dailySpend: 10,
    })
    expect(r.totalOut).toBe(400 + 10 * 22)
  })
})
