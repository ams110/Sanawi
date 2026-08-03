import { describe, expect, it } from 'vitest'
import { buildReminders, reminderId, REMINDER_DAYS } from './reminders'
import { toDateKey } from '../date'

const TODAY = new Date('2026-08-02T00:00:00')

const options = {
  today: TODAY,
  messages: {
    title: (name: string) => name,
    bodyWithAmount: (name: string, days: number, amount: string) =>
      `bodyWithAmount:${name}:${days}:${amount}`,
    bodyReady: (name: string, days: number) => `bodyReady:${name}:${days}`,
  },
  formatMoney: (n: number) => `₪ ${n}`,
}

describe('معرّف التنبيه', () => {
  it('ثابت لنفس الالتزام ونفس عدد الأيام', () => {
    expect(reminderId('abc-123', 30)).toBe(reminderId('abc-123', 30))
  })

  it('يختلف باختلاف عدد الأيام', () => {
    expect(reminderId('abc-123', 30)).not.toBe(reminderId('abc-123', 14))
  })

  it('يختلف باختلاف الالتزام', () => {
    expect(reminderId('abc-123', 30)).not.toBe(reminderId('xyz-789', 30))
  })

  it('عدد صحيح موجب — Capacitor لا يقبل غير ذلك', () => {
    const id = reminderId('some-uuid-value', 7)
    expect(Number.isInteger(id)).toBe(true)
    expect(id).toBeGreaterThan(0)
  })
})

describe('بناء التنبيهات', () => {
  const obligation = {
    id: 'ob-1',
    name: 'تأمين السيارة',
    nextDueDate: '2026-12-01',
    remainingAmount: 2000,
  }

  it('يجدول ثلاثة تنبيهات لموعد بعيد', () => {
    const r = buildReminders([obligation], options)
    expect(r).toHaveLength(3)
    expect(r.map((x) => x.daysBefore)).toEqual([30, 14, 7])
  })

  it('يرتّبها من الأقرب للأبعد', () => {
    const r = buildReminders([obligation], options)
    expect(r[0]!.at.getTime()).toBeLessThan(r[1]!.at.getTime())
  })

  it('يضبط التاريخ قبل الموعد بالعدد الصحيح من الأيام', () => {
    const r = buildReminders([obligation], options)
    // التنبيه لحظةٌ محلية (التاسعة صباحاً عند المستخدم)، فيُقاس بالتقويم المحلي.
    // ‏`toISOString` يحوّل إلى UTC فينزلق اليوم في المناطق البعيدة عن غرينتش.
    expect(toDateKey(r[0]!.at)).toBe('2026-11-01')
    expect(toDateKey(r[2]!.at)).toBe('2026-11-24')
  })

  it('يطلقها التاسعة صباحاً افتراضاً', () => {
    const r = buildReminders([obligation], options)
    expect(r[0]!.at.getHours()).toBe(9)
  })

  it('يتخطّى التنبيهات التي فات وقتها', () => {
    // موعد بعد 10 أيام: تنبيها 30 و14 يوماً وقعا في الماضي.
    const r = buildReminders(
      [{ ...obligation, nextDueDate: '2026-08-12' }],
      options,
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.daysBefore).toBe(7)
  })

  it('لا يجدول شيئاً لموعد فات', () => {
    expect(buildReminders([{ ...obligation, nextDueDate: '2026-06-01' }], options)).toHaveLength(0)
  })

  it('يذكر الباقي حين يكون الصندوق ناقصاً', () => {
    const r = buildReminders([obligation], options)
    expect(r[0]!.body).toContain('bodyWithAmount')
    expect(r[0]!.body).toContain('₪ 2000')
  })

  it('يغيّر النص حين يكتمل الصندوق', () => {
    const r = buildReminders([{ ...obligation, remainingAmount: 0 }], options)
    expect(r[0]!.body).toContain('bodyReady')
  })

  it('يجمع التزامات متعددة', () => {
    const r = buildReminders(
      [obligation, { ...obligation, id: 'ob-2', name: 'טסט', nextDueDate: '2027-01-15' }],
      options,
    )
    expect(r).toHaveLength(6)
    expect(new Set(r.map((x) => x.id)).size).toBe(6)
  })

  it('يحترم ساعة مخصّصة', () => {
    const r = buildReminders([obligation], { ...options, hour: 20 })
    expect(r[0]!.at.getHours()).toBe(20)
  })

  it('عدد التنبيهات لكل التزام يطابق REMINDER_DAYS', () => {
    expect(buildReminders([obligation], options)).toHaveLength(REMINDER_DAYS.length)
  })
})
