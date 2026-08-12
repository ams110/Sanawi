import { describe, expect, it } from 'vitest'
import { summarizeBySource, totalOf } from './bySource'

const SOURCES = [
  { id: 's1', name: 'ادم', isActive: true },
  { id: 's2', name: 'شغل جانبي', isActive: false },
]

describe('القبضات حسب المصدر', () => {
  it('يجمع كل مصدرٍ على حدة ويرتّب بالمجموع نزولاً', () => {
    const rows = summarizeBySource(
      [
        { amount: 6000, sourceId: 's1', name: null },
        { amount: 5000, sourceId: 's1', name: null },
        { amount: 700, sourceId: 's2', name: null },
      ],
      SOURCES,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'ادم', total: 11000, count: 2, isArchived: false })
    expect(rows[1]).toMatchObject({ name: 'شغل جانبي', total: 700, count: 1, isArchived: true })
    expect(totalOf(rows)).toBe(11700)
  })

  it('المصدر المؤرشف يظهر موسوماً لا يختفي — هذا هو الثقب الذي وُلد الملف لسدّه', () => {
    const rows = summarizeBySource([{ amount: 700, sourceId: 's2', name: null }], SOURCES)
    expect(rows[0]!.isArchived).toBe(true)
    expect(rows[0]!.total).toBe(700)
  })

  it('القبضة الحرّة تتجمّع بتسميتها', () => {
    const rows = summarizeBySource(
      [
        { amount: 100, sourceId: null, name: 'هدية' },
        { amount: 200, sourceId: null, name: 'هدية' },
      ],
      SOURCES,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'name:هدية', name: 'هدية', total: 300, count: 2 })
  })

  it('بلا مصدرٍ ولا اسم تقع في سلّةٍ واحدة باسمٍ فارغ تسمّيه الواجهة', () => {
    const rows = summarizeBySource(
      [
        { amount: 50, sourceId: null, name: null },
        { amount: 50, sourceId: null, name: '  ' },
      ],
      SOURCES,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'unsourced', name: null, total: 100, count: 2 })
  })

  it('معرّفُ مصدرٍ لا وجود له لا يُسقط القبضة', () => {
    const rows = summarizeBySource([{ amount: 80, sourceId: 'gone', name: 'قديم' }], SOURCES)
    expect(rows[0]).toMatchObject({ name: 'قديم', total: 80 })
  })

  it('القبضات فرادى داخل المصدر، الأحدث أولاً وبلا تاريخ آخراً', () => {
    const rows = summarizeBySource(
      [
        { amount: 5000, sourceId: 's1', name: null, receivedAt: '2026-08-03' },
        { amount: 6000, sourceId: 's1', name: null, receivedAt: '2026-08-20' },
        { amount: 100, sourceId: 's1', name: null },
      ],
      SOURCES,
    )
    expect(rows[0]!.entries).toEqual([
      { amount: 6000, receivedAt: '2026-08-20' },
      { amount: 5000, receivedAt: '2026-08-03' },
      { amount: 100, receivedAt: null },
    ])
  })

  it('التعادل في المجموع يُرتَّب بالاسم — قائمةٌ لا تعيد ترتيب نفسها بين قراءتين', () => {
    const rows = summarizeBySource(
      [
        { amount: 100, sourceId: null, name: 'ب' },
        { amount: 100, sourceId: null, name: 'أ' },
      ],
      SOURCES,
    )
    expect(rows.map((r) => r.name)).toEqual(['أ', 'ب'])
  })
})
