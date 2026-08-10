import { describe, expect, it } from 'vitest'
import { rowsFromPdfItems } from './pdfText'
import { parseBankText } from './parse'

/** قطعة نصٍّ بموضعها — كما يعيدها pdfjs مبسّطةً. */
const item = (str: string, x: number, y: number, width = str.length * 5) => ({
  str,
  x,
  y,
  width,
})

describe('إعادة بناء جدول PDF', () => {
  it('القطع المتشاركة الارتفاع سطرٌ واحد بخلايا تفصلها الفجوات', () => {
    const text = rowsFromPdfItems([
      item('03/08/2026', 400, 700),
      item('סופר פארם', 200, 700.5),
      item('-89.90', 50, 699),
    ])
    expect(text).toBe('-89.90\tסופר פארם\t03/08/2026')
  })

  it('فرق ارتفاعٍ حقيقي يقطع سطراً جديداً — والأعلى أولاً', () => {
    const text = rowsFromPdfItems([
      item('שורה תחתונה', 100, 650),
      item('שורה עליונה', 100, 700),
    ])
    expect(text).toBe('שורה עליונה\nשורה תחתונה')
  })

  it('الكلمة المقطوعة قطعتين متلاصقتين تُلصق لا تُفصل خليتين', () => {
    // «סופר» تنتهي عند 225 و«פארם» تبدأ عند 227 — فجوة كلمتين لا خليتين.
    const text = rowsFromPdfItems([
      item('סופר', 200, 700, 25),
      item('פארם', 227, 700, 25),
      item('-50', 50, 700),
    ])
    expect(text).toBe('-50\tסופר פארם')
  })

  it('القطع الفارغة تُهمل ولا تصنع خلايا', () => {
    const text = rowsFromPdfItems([item('  ', 300, 700), item('שכירות', 100, 700)])
    expect(text).toBe('שכירות')
  })

  it('المسار كاملاً: قطع PDF تصير كشفاً يقرؤه القارئ البنكي', () => {
    const y1 = 700
    const y2 = 680
    const text = rowsFromPdfItems([
      // الرأس
      item('תאריך', 400, 720),
      item('תיאור', 200, 720),
      item('סכום', 50, 720),
      // حركتان
      item('03/08/2026', 400, y1),
      item('חשמל', 200, y1),
      item('-400', 50, y1),
      item('05/08/2026', 400, y2),
      item('משכורת', 200, y2),
      item('9,000', 50, y2),
    ])
    const { rows, skipped } = parseBankText(text)
    expect(skipped).toBe(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ date: '2026-08-03', name: 'חשמל', amount: 400, direction: 'out' })
    expect(rows[1]).toMatchObject({ date: '2026-08-05', amount: 9000, direction: 'in' })
  })
})
