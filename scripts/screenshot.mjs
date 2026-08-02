/**
 * لقطات شاشة للوضعين الفاتح والغامق + فحص سلوك وضع الجسر.
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
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/bridge-${scheme}.png`, fullPage: true })

  const headline = () => page.locator('section').first().locator('p.num').first().innerText()
  const bridgeVisible = () => page.getByRole('status').count()

  const checks = [
    ['اتجاه الصفحة RTL', await page.evaluate(() => document.documentElement.dir), 'rtl'],
    ['قسط وضع الجسر', await headline(), '₪ 2,000'],
    ['تحذير الجسر ظاهر', await bridgeVisible(), 1],
  ]

  // ندفع الموعد إلى دورة كاملة: يجب أن ينزل القسط ويختفي التحذير.
  await page.locator('input[type=range]').first().fill('12')
  await page.waitForTimeout(400)
  checks.push(
    ['القسط بعد دورة كاملة', await headline(), '₪ 500'],
    ['اختفاء التحذير', await bridgeVisible(), 0],
    ['أخطاء وحدة التحكم', errors.length, 0],
  )
  await page.screenshot({ path: `${OUT}/normal-${scheme}.png`, fullPage: true })

  for (const [label, actual, expected] of checks) {
    const ok = actual === expected
    if (!ok) failures++
    console.log(`${ok ? '✅' : '❌'} [${scheme}] ${label}: ${actual}`)
  }
  if (errors.length) console.log(errors)

  await ctx.close()
}

await browser.close()
process.exit(failures ? 1 : 0)
