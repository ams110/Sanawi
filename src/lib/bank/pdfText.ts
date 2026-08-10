/**
 * إعادة بناء جدولٍ من نصوص PDF المبعثرة.
 * ملف نقي — لا React ولا pdfjs: يأخذ قطع النص بإحداثياتها ويعيد سطوراً.
 *
 * ‏PDF لا يعرف «جدولاً»: كشف البنك فيه قطعُ نصٍّ حرّة لكلٍّ منها موضع
 * (x, y). القارئ البنكي يريد سطوراً بخلايا مفصولة — فنجمع القطع التي
 * تتشارك السطر (فرقُ y صغير)، ونرتّبها بموضعها الأفقي، ونفصل خليةً عن
 * خليةٍ حيث تتّسع الفجوة. الترتيب داخل السطر لا يهمّ القارئ: هو يجد
 * عمود التاريخ والمبلغ بمحتواهما لا بموقعهما.
 */

export interface PdfTextItem {
  str: string
  x: number
  y: number
  width: number
}

/** قطعتان على سطرٍ واحد إن تقارب ارتفاعاهما بهذا القدر. */
const LINE_TOLERANCE = 3

/** فجوةٌ أفقية أوسع من هذا تفصل خليةً عن خلية — لا مجرّد مسافةِ كلمتين. */
const CELL_GAP = 8

export function rowsFromPdfItems(items: readonly PdfTextItem[]): string {
  const meaningful = items.filter((item) => item.str.trim().length > 0)
  if (meaningful.length === 0) return ''

  /* السطور تُجمع بالارتفاع: y ينزل في PDF من أعلى الصفحة إلى أسفلها. */
  const lines: PdfTextItem[][] = []
  const sorted = [...meaningful].sort((a, b) => b.y - a.y || a.x - b.x)

  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l[0]!.y - item.y) <= LINE_TOLERANCE)
    if (line) line.push(item)
    else lines.push([item])
  }

  return lines
    .map((line) => {
      const cells: string[] = []
      let current = ''
      let lastEnd: number | null = null

      for (const item of [...line].sort((a, b) => a.x - b.x)) {
        const gap = lastEnd === null ? 0 : item.x - lastEnd
        if (lastEnd !== null && gap > CELL_GAP) {
          cells.push(current.trim())
          current = item.str
        } else {
          // القطع المتلاصقة كلمة واحدة مقطوعة — تُلصق بلا فاصل مصطنع.
          current += (current && gap > 1 ? ' ' : '') + item.str
        }
        lastEnd = item.x + item.width
      }
      cells.push(current.trim())

      return cells.filter((c) => c.length > 0).join('\t')
    })
    .filter((l) => l.length > 0)
    .join('\n')
}
