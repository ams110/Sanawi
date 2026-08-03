/**
 * لقطات شاشة للوضعين الفاتح والغامق مع فحوص سلوك.
 * التشغيل: npm run dev  ثم  node scripts/screenshot.mjs
 * المخرجات في .screenshots (متجاهَل من git).
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../.screenshots', import.meta.url))
mkdirSync(OUT, { recursive: true })

const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
let failures = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${label}: ${actual}${ok ? '' : ` (متوقّع: ${expected})`}`)
}

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    locale: 'ar',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto(URL_BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/start-${scheme}.png`, fullPage: true })

  check(`[${scheme}] اتجاه الصفحة`, await page.evaluate(() => document.documentElement.dir), 'rtl')
  check(`[${scheme}] عنوان سنوي ظاهر`, await page.getByText('سنوي').first().isVisible(), true)
  check(`[${scheme}] أخطاء وحدة التحكم`, errors.length, 0)
  if (errors.length) console.log(errors)

  await ctx.close()
}

await browser.close()
process.exit(failures ? 1 : 0)
