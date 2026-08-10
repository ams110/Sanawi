import { describe, expect, it } from 'vitest'
import { bankRowKey, parseBankAmount, parseBankDate, parseBankText } from './parse'

describe('قراءة تاريخ الكشف', () => {
  it('اليوم قبل الشهر — 03/08 آبُ لا آذار', () => {
    expect(parseBankDate('03/08/2026')).toBe('2026-08-03')
    expect(parseBankDate('3.8.26')).toBe('2026-08-03')
    expect(parseBankDate('2026-08-03')).toBe('2026-08-03')
  })

  it('يرفض ما ليس تاريخاً', () => {
    expect(parseBankDate('סה"כ')).toBeNull()
    expect(parseBankDate('32/01/2026')).toBeNull()
    expect(parseBankDate('01/13/2026')).toBeNull()
  })
})

describe('قراءة مبلغ الكشف', () => {
  it('يقرأ الشيكل وفواصل الآلاف والأقواس السالبة', () => {
    expect(parseBankAmount('₪ 1,234.56')).toBe(1234.56)
    expect(parseBankAmount('-400')).toBe(-400)
    expect(parseBankAmount('(250)')).toBe(-250)
  })

  it('الصفر والنص ليسا مبلغاً', () => {
    expect(parseBankAmount('0')).toBeNull()
    expect(parseBankAmount('יתרה')).toBeNull()
    expect(parseBankAmount('')).toBeNull()
  })
})

describe('قراءة الكشف كاملاً', () => {
  it('كشفٌ عبري برأس סכום وإشارة سالبة', () => {
    const text = [
      'תאריך,תיאור,סכום',
      '03/08/2026,סופר פארם,-120.50',
      '05/08/2026,משכורת,9000',
    ].join('\n')
    const { rows, skipped } = parseBankText(text)
    expect(skipped).toBe(0)
    expect(rows).toEqual([
      { date: '2026-08-03', name: 'סופר פארם', amount: 120.5, direction: 'out' },
      { date: '2026-08-05', name: 'משכורת', amount: 9000, direction: 'in' },
    ])
  })

  it('عمودا חובה/זכות: الخارج والداخل كلاهما موجبٌ في عموده', () => {
    const text = [
      'תאריך,פרטים,חובה,זכות',
      '10/08/2026,חשמל,400,',
      '12/08/2026,העברה נכנסת,,700',
      '13/08/2026,שגוי,100,100',
    ].join('\n')
    const { rows, skipped } = parseBankText(text)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'חשמל', amount: 400, direction: 'out' })
    expect(rows[1]).toMatchObject({ name: 'העברה נכנסת', amount: 700, direction: 'in' })
    // صفٌّ فيه الاثنان معاً غلطُ كشفٍ يُعدّ لا يُخمَّن.
    expect(skipped).toBe(1)
  })

  it('اللصق من إكسل تبويبٌ — ويُقرأ بلا رأسٍ بالاستدلال', () => {
    const text = ['03/08/2026\tארוחה בחוץ\t-85', '04/08/2026\tהעברה\t1,000'].join('\n')
    const { rows } = parseBankText(text)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.direction).toBe('out')
    expect(rows[1]!.amount).toBe(1000)
  })

  it('سطور العناوين والأرصدة فوق الرأس تُتجاوز', () => {
    const text = [
      'עובר ושב - חשבון 123456',
      'יתרה: 5,000',
      'תאריך,תיאור,סכום',
      '01/08/2026,ארנונה,-300',
    ].join('\n')
    const { rows } = parseBankText(text)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('ארנונה')
  })

  it('نصٌّ لا كشف فيه يُرجع فراغاً بعدّ سطوره', () => {
    const { rows, skipped } = parseBankText('שלום\nעולם')
    expect(rows).toHaveLength(0)
    expect(skipped).toBe(2)
  })

  it('سطر סה"כ في الذيل يُعدّ متجاوَزاً لا حركة', () => {
    const text = ['תאריך,תיאור,סכום', '01/08/2026,קניות,-50', 'סה"כ,,−50'].join('\n')
    const { rows, skipped } = parseBankText(text)
    expect(rows).toHaveLength(1)
    expect(skipped).toBe(1)
  })

  it('مفتاح التكرار يميّز الاتجاه والمبلغ واليوم', () => {
    const a = { date: '2026-08-03', amount: 120.5, direction: 'out' as const }
    expect(bankRowKey(a)).toBe('2026-08-03|120.50|out')
    expect(bankRowKey({ ...a, direction: 'in' })).not.toBe(bankRowKey(a))
  })
})
