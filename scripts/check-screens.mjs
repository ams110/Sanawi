/**
 * فحص الشاشات — التطبيق كاملاً بلا حساب ولا شبكة.
 * التشغيل: npm run check:screens
 *
 * لماذا: كل فحوص هذا المستودع تفحص الأرقام (`vitest`) أو الخادم (`check:mcp`)
 * أو القاعدة (`check:db`). ولا واحد منها يفتح شاشة. فما ينكسر في الواجهة —
 * زرٌّ يغطّي زرّاً، وحالةٌ فارغة لا تظهر، ونصٌّ مفقود يُطبع مفتاحه — لا يراه
 * إلا مستخدم. وقد وقع ذلك فعلاً: الزرّ العائم كان يغطّي زرَّ التراجع عن آخر
 * إيداع، ولم يكشفه إلا لقطة شاشة.
 *
 * وهو ممكنٌ لأن `scripts/fake-supabase.mjs` يخدم المتصفّح أيضاً: دخولٌ حقيقي
 * وبياناتٌ مزروعة في الذاكرة، فتعمل الشاشات كما تعمل على قاعدةٍ حقيقية —
 * وتموت القاعدة مع العملية ولا تمسّ بيانات أحد.
 *
 * المخرجات في `.screenshots/` (متجاهَل من git) — انظرها حين يفشل فحص.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startFakeSupabase } from './fake-supabase.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const OUT = `${root}.screenshots`
const ENV_FILE = `${root}.env`

let failures = 0
const step = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/*
 * ملف `.env` يُحفظ ويُعاد.
 *
 * ‏Vite يقرأ الإعداد من `.env` عند الإقلاع ولا يقبله من البيئة وحدها لمتغيّرات
 * `VITE_*` في كل الحالات. فنكتب ملفاً مؤقتاً ونعيد الأصلي مهما انتهى الفحص —
 * فحصٌ يترك ملفَّ إعدادٍ يشير إلى خادمٍ ميت يعطّل التطوير عند صاحبه.
 */
const savedEnv = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : null
const restoreEnv = () => {
  if (savedEnv === null) rmSync(ENV_FILE, { force: true })
  else writeFileSync(ENV_FILE, savedEnv)
}

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * حسابٌ يشبه حساب مستخدمٍ حقيقي.
 *
 * الفارغ يمرّ على كل شيء: شاشةٌ بلا صفوف لا تكشف تداخلاً ولا نصّاً مفقوداً.
 * فنزرع دخلاً وفواتير والتزامين — أحدهما ممولٌ جزئياً — ومصاريف وإيداعات.
 */
function seed(db, userId) {
  const today = new Date()
  const year = today.getFullYear()

  db.income_sources.push({
    id: 'i1',
    user_id: userId,
    name: 'راتب',
    amount: 9000,
    frequency: 'monthly',
    is_variable: false,
    is_active: true,
    created_at: new Date().toISOString(),
  })

  db.fixed_commitments.push({
    id: 'f1',
    user_id: userId,
    name: 'كهرباء',
    amount: 400,
    day_of_month: 10,
    default_method_id: null,
    icon: null,
    starts_on: null,
    ends_on: null,
    total_amount: null,
    annual_interest_percent: 0,
    my_share_percent: 100,
    account_id: null,
    is_active: true,
    created_at: new Date().toISOString(),
  })

  const obligations = [
    { id: 'o1', name: 'تأمين السيارة', total: 6000, due: `${year + 1}-01-15`, baseline: 500 },
    { id: 'o2', name: 'טסט (فحص سنوي)', total: 1200, due: `${year + 1}-03-01`, baseline: 100 },
  ]
  for (const o of obligations) {
    db.obligations.push({
      id: o.id,
      user_id: userId,
      group_id: null,
      account_id: null,
      name: o.name,
      category: 'car',
      total_amount: o.total,
      next_due_date: o.due,
      recurrence_months: 12,
      cycle_start_date: iso(today),
      baseline_installment: o.baseline,
      my_share_percent: 100,
      is_active: true,
      notes: null,
      created_at: new Date().toISOString(),
    })
  }

  // إيداعٌ سابق هذا الشهر: به وحده يظهر حارس «حطّيت هالشهر».
  db.fund_deposits.push({
    id: 'd1',
    user_id: userId,
    obligation_id: 'o1',
    partner_id: null,
    account_id: null,
    amount: 500,
    deposit_date: iso(new Date(today.getFullYear(), today.getMonth(), 2)),
    note: null,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
  })

  db.expenses.push({
    id: 'e1',
    user_id: userId,
    group_id: null,
    category: 'car',
    category_id: null,
    is_unexpected: false,
    amount: 120,
    spent_at: iso(today),
    note: 'بنزين',
    method_id: null,
    account_id: null,
    created_at: new Date().toISOString(),
  })
}

const fake = await startFakeSupabase()
seed(fake.db, fake.userId)
writeFileSync(ENV_FILE, `VITE_SUPABASE_URL=${fake.url}\nVITE_SUPABASE_ANON_KEY=${fake.anonKey}\n`)

const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})

const BASE = 'http://localhost:5199'
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 30_000)
  vite.stdout.on('data', (chunk) => {
    if (String(chunk).includes('ready in')) {
      clearTimeout(timer)
      resolve(true)
    }
  })
})

if (!ready) {
  console.error('✗ خادم التطوير لم يقلع')
  vite.kill()
  restoreEnv()
  await fake.stop()
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

try {
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 880 },
    deviceScaleFactor: 2,
    locale: 'ar',
  })
  const page = await ctx.newPage()

  /*
   * أخطاء الطرفية جزءٌ من الفحص.
   *
   * شاشةٌ تُرسم ومعها استثناءٌ في الطرفية شاشةٌ نصفُ عاملة: النصف الذي انكسر
   * لا يظهر أصلاً، فتبدو اللقطة سليمة. ونتجاهل ما يأتي من الشبكة وحدها لأن
   * القاعدة المزيّفة تردّ 404 على ما لا تعرفه عمداً.
   */
  const consoleErrors = []
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', fake.email)
  await page.fill('input[type="password"]', fake.password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(2500)

  step('الدخول يصل إلى لوحة الشهر', page.url().includes('/month'), page.url())

  /*
   * مفاتيح الترجمة المفقودة تُطبع كما هي.
   *
   * ‏i18next يعيد المفتاح حين لا يجد نصّاً، فيظهر «detail.undo» في الشاشة —
   * وهو عطلٌ لا يكسر شيئاً ولا يلتقطه بناءٌ ولا اختبار وحدة.
   */
  const RAW_KEY = /\b(month|detail|quickAdd|expenses|bills|money|wealth|nav|common|payment)\.[a-zA-Z]/

  const TABS = [
    { path: '/month', name: 'month' },
    { path: '/bills', name: 'bills' },
    { path: '/expenses', name: 'expenses' },
    { path: '/money', name: 'money' },
    { path: '/obligations', name: 'obligations' },
    { path: '/calendar', name: 'calendar' },
    { path: '/insights', name: 'insights' },
    { path: '/wealth', name: 'wealth' },
  ]

  for (const tab of TABS) {
    await page.goto(`${BASE}${tab.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/${tab.name}.png`, fullPage: true })

    const body = await page.locator('body').innerText()
    step(`${tab.name}: تُرسم بلا مفتاح ترجمة خام`, !RAW_KEY.test(body), (body.match(RAW_KEY) ?? [])[0] ?? '')
    step(`${tab.name}: ليست فارغة`, body.trim().length > 80)
  }

  /* الزرّ العائم: موجود على كل تبويب، ولا يغطّي محتوى الصفحة. */
  await page.goto(`${BASE}/obligations/o1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  const fab = page.getByRole('button', { name: 'ضيف إشي' })
  step('الزرّ العائم ظاهر', await fab.isVisible())

  /*
   * التغطية تُقاس لا تُقدَّر.
   *
   * ‏`pb` الصفحة يجب أن يترك آخر عنصرٍ فوق الزرّ العائم. وقياسه هنا يمنع
   * عودة العطل الذي كشفته لقطةٌ من قبل: الزرّ فوق زرِّ التراجع عن آخر إيداع.
   */
  const fabBox = await fab.boundingBox()
  const lastUndo = page.getByRole('button', { name: 'تراجع عن الإيداع' }).last()
  step('زرّ التراجع موجود', await lastUndo.isVisible())
  const undoBox = await lastUndo.boundingBox()
  const overlaps =
    fabBox &&
    undoBox &&
    fabBox.x < undoBox.x + undoBox.width &&
    fabBox.x + fabBox.width > undoBox.x &&
    fabBox.y < undoBox.y + undoBox.height &&
    fabBox.y + fabBox.height > undoBox.y
  step('الزرّ العائم لا يغطّي زرّ التراجع', !overlaps)

  /* حارس الإيداع المكرّر: ضغطةٌ واحدة لا تودع حين سبقها إيداعٌ هذا الشهر. */
  await fab.click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/quickadd.png` })

  // المحدِّد محصورٌ في الورقة: نفس النصّ موجودٌ خلفها في شاشة الالتزام،
  // و`.first()` كان يمسك المحجوب فيفشل النقر لسببٍ لا علاقة له بالمفحوص.
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: /^حطّ ₪/ }).click()
  await page.waitForTimeout(600)
  step(
    'الإيداع الثاني يسأل قبل أن يقع',
    await sheet.getByRole('button', { name: 'أيوه، حطّ كمان مرة' }).isVisible(),
  )

  step('لا استثناء في الطرفية', consoleErrors.length === 0, consoleErrors[0] ?? '')

  console.log(`\nاللقطات في .screenshots/ (${TABS.length + 1} صورة)`)
} finally {
  await browser.close()
  vite.kill()
  restoreEnv()
  await fake.stop()
}

console.log(failures === 0 ? '\n✅ كل فحوص الشاشات نجحت' : `\n❌ ${failures} فحص فشل`)
process.exit(failures === 0 ? 0 : 1)
