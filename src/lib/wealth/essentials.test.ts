import { describe, expect, it } from 'vitest'
import { essentialSpending } from './essentials'

// الصيغة كانت منسوخةً في شاشة الثروة وخادم MCP وتغذّي رقم الحرية. (س11)
describe('essentialSpending', () => {
  it('الدائم والأقساط السنوية وخطّ الأساس — شهرياً وسنوياً', () => {
    const e = essentialSpending({
      recurringBills: 2850,
      obligationInstallments: 2092,
      baselineMonthly: 1500.5,
    })
    expect(e.monthly).toBe(6442.5)
    expect(e.annual).toBe(77310)
  })
})
