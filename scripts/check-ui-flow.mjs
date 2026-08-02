/**
 * فحص التطبيق كما يستعمله المستخدم: متصفح حقيقي وقاعدة بيانات حقيقية.
 * تسجيل → مقدمة → اختيار قالب → رؤية القسط → إيداع → عودة للقائمة.
 *
 * التشغيل: npm run dev  ثم  node scripts/check-ui-flow.mjs
 * يترك حساباً في Authentication — احذفه من اللوحة إن أردت.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../.screenshots', import.meta.url))
mkdirSync(OUT, { recursive: true })

const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
const stamp = String(process.hrtime.bigint())
const email = `sanawi.ui.${stamp}@gmail.com`
const password = `Test-${stamp.slice(-8)}!`

let failures = 0
const step = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/*
 * لا إعداد وكيل هنا عن قصد: حين يكون VITE_SUPABASE_URL نسبيّاً يمرّر خادم
 * التطوير نداءات Supabase نيابةً عن المتصفح (انظر vite.config.ts)، فيبقى
 * كل ما يخرج من المتصفح موجّهاً إلى localhost وحده.
 */
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({
  viewport: { width: 400, height: 900 },
  deviceScaleFactor: 2,
  locale: 'ar',
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

try {
  // 1) التسجيل
  await page.goto(URL_BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'حساب جديد' }).click()
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'افتح حساب' }).click()

  // 2) المقدمة تظهر لحساب جديد
  await page.getByText('المصروف السنوي بيجي مرة وحدة').waitFor({ timeout: 15000 })
  step('المقدمة تظهر بعد التسجيل', true)
  await page.screenshot({ path: `${OUT}/flow-1-onboarding.png`, fullPage: true })

  await page.getByRole('button', { name: 'كمّل' }).click()
  await page.getByText('الحل: قسّمها على شهور').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'يلا نبلش' }).click()

  // 3) القوالب تصل من قاعدة البيانات
  await page.getByText('تأمين السيارة', { exact: true }).waitFor({ timeout: 10000 })
  const templateCount = await page.locator('button:has(p)').count()
  step('القوالب وصلت من قاعدة البيانات', templateCount >= 15, `${templateCount} زر قالب`)
  await page.screenshot({ path: `${OUT}/flow-2-templates.png`, fullPage: true })

  // 4) اختيار قالب ينشئ الالتزام ويهبط على تفاصيله
  await page.getByText('تأمين السيارة', { exact: true }).click()
  await page.getByText('قسطك الشهري').waitFor({ timeout: 15000 })
  const installment = await page.locator('dd.num').first().innerText()
  step('الالتزام أُنشئ وظهر القسط', /₪/.test(installment), installment)
  await page.screenshot({ path: `${OUT}/flow-3-detail.png`, fullPage: true })

  // 5) الإيداع يرفع الرصيد
  const before = await page.locator('dd.num').nth(1).innerText()
  await page.getByRole('button', { name: /أودعت/ }).click()
  await page.waitForTimeout(2500)
  const after = await page.locator('dd.num').nth(1).innerText()
  step('الإيداع رفع الرصيد', before !== after, `${before} ← ${after}`)

  // 6) القائمة تعرض الالتزام ومجموع الشهر
  await page.locator('header a').first().click()
  await page.getByText('لازم يطلع من حسابك هالشهر').waitFor({ timeout: 10000 })
  const monthly = await page.locator('section p.num').first().innerText()
  const cards = await page.locator('article').count()
  step('القائمة تعرض المجموع والكارت', cards === 1 && /₪/.test(monthly), `${cards} كارت · ${monthly}`)
  await page.screenshot({ path: `${OUT}/flow-4-list.png`, fullPage: true })

  step('وحدة التحكم بلا أخطاء', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (err) {
  step('المسار اكتمل', false, String(err).split('\n')[0])
  await page.screenshot({ path: `${OUT}/flow-failure.png`, fullPage: true })
}

await browser.close()
console.log(`\n${failures === 0 ? 'المسار كامل نجح.' : `${failures} فحص فشل.`}`)
console.log(`حساب الفحص: ${email}`)
process.exit(failures ? 1 : 0)
