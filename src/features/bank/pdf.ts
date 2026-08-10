import { rowsFromPdfItems, type PdfTextItem } from '@/lib/bank/pdfText'

/**
 * استخراج نص كشف PDF — التوصيلة الوحيدة بـpdfjs.
 *
 * الاستيراد كسولٌ عمداً: pdfjs ثقيلة، ومن لا يرفع PDF لا يدفع ثمنها في
 * حزمة التطبيق. والمنطق الحقيقي (إعادة بناء الجدول) في ملفٍّ نقي مختبَر —
 * هذا الملف مجرّد جسر.
 *
 * الكشف الممسوح ضوئياً (صورة) لا نصَّ فيه: يُستخرج فراغٌ فيقولها القارئ
 * بـ«ما قدرنا نقرأ ولا حركة» — لا OCR هنا، والصدق أولى من الوعد.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const task = pdfjs.getDocument({ data })
  const pages: string[] = []

  try {
    const doc = await task.promise
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()

      const items: PdfTextItem[] = content.items.flatMap((raw) => {
        if (!('str' in raw) || typeof raw.str !== 'string') return []
        const transform = raw.transform as number[]
        return [
          {
            str: raw.str,
            x: Number(transform[4] ?? 0),
            y: Number(transform[5] ?? 0),
            width: Number(raw.width ?? 0),
          },
        ]
      })

      pages.push(rowsFromPdfItems(items))
    }
  } finally {
    // تُغلق المهمة لا المستند: هي من تملك العامل والطلبات.
    await task.destroy()
  }

  return pages.filter((p) => p.length > 0).join('\n')
}
