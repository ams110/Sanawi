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
    // حصّتي 50٪ — النصف الآخر على الشريك المزروع تحت، وبه يُفحص مركز الشركاء.
    { id: 'o1', name: 'تأمين السيارة', total: 6000, due: `${year + 1}-01-15`, baseline: 500, share: 50 },
    { id: 'o2', name: 'טסט (فحص سنوي)', total: 1200, due: `${year + 1}-03-01`, baseline: 100 },
    /*
     * التزامٌ فات موعده بيومين — به تُفحص قائمة الفواتير الموحّدة: دفعته
     * تظهر مع فواتير الشهر وفوقها، في أي يومٍ من السنة جرى الفحص.
     */
    {
      id: 'o3',
      name: 'اشتراك الصالة',
      total: 1800,
      due: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2)),
      baseline: 150,
    },
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
      my_share_percent: o.share ?? 100,
      is_active: true,
      notes: null,
      created_at: new Date().toISOString(),
    })
  }

  /*
   * شريكٌ بحصّةٍ في التزامٍ وفاتورة، وإيداعٍ جزئي — به يُفحص مركز الشركاء:
   * الباقي عليه من التأمين، وما يحمله من الكهرباء شهرياً، في بطاقةٍ واحدة.
   */
  db.obligation_partners.push({
    id: 'p1',
    user_id: userId,
    name: 'سامر',
    created_at: new Date().toISOString(),
  })
  db.obligation_partner_shares.push({
    id: 'ps1',
    user_id: userId,
    obligation_id: 'o1',
    partner_id: 'p1',
    share_percent: 50,
    created_at: new Date().toISOString(),
  })
  db.commitment_partner_shares.push({
    id: 'cs1',
    user_id: userId,
    commitment_id: 'f1',
    partner_id: 'p1',
    share_percent: 50,
  })
  db.fund_deposits.push({
    id: 'pd1',
    user_id: userId,
    obligation_id: 'o1',
    partner_id: 'p1',
    account_id: null,
    amount: 1000,
    deposit_date: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
    note: null,
    created_at: new Date().toISOString(),
  })

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

  // قبضة الشهر الماضي: كانت تسقط من كل شاشةٍ واقفة على الحاضر، وبها
  // يُفحص سجلّ «قبضاتك حسب المصدر» — المال المسجَّل بأثرٍ رجعي لا يضيع.
  db.income_entries.push({
    id: 'in-past',
    user_id: userId,
    source_id: 'i1',
    name: null,
    amount: 11000,
    received_at: iso(new Date(today.getFullYear(), today.getMonth() - 1, 20)),
    note: null,
    created_at: new Date().toISOString(),
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
  const RAW_KEY = /\b(month|detail|quickAdd|expenses|bills|money|wealth|nav|common|payment|settings|backup|update|accounts|panel|hub|flow|reports|partners)\.[a-zA-Z]/

  // كل مقاطع المحاور الجديدة، لا الأبواب الخمسة وحدها.
  const TABS = [
    { path: '/month', name: 'month' },
    { path: '/flow/expenses', name: 'expenses' },
    { path: '/flow/income', name: 'money' },
    { path: '/flow/bills', name: 'bills' },
    { path: '/obligations', name: 'obligations' },
    { path: '/obligations/calendar', name: 'calendar' },
    { path: '/obligations/partners', name: 'partners' },
    { path: '/wealth', name: 'wealth' },
    { path: '/wealth/accounts', name: 'wealth-accounts' },
    { path: '/wealth/assets', name: 'wealth-assets' },
    { path: '/wealth/plans', name: 'wealth-plans' },
    { path: '/reports', name: 'insights' },
    { path: '/settings', name: 'settings' },
  ]

  for (const tab of TABS) {
    await page.goto(`${BASE}${tab.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/${tab.name}.png`, fullPage: true })

    const body = await page.locator('body').innerText()
    step(`${tab.name}: تُرسم بلا مفتاح ترجمة خام`, !RAW_KEY.test(body), (body.match(RAW_KEY) ?? [])[0] ?? '')
    step(`${tab.name}: ليست فارغة`, body.trim().length > 80)
  }

  /*
   * سجلّ «قبضاتك حسب المصدر»: القبضة المسجَّلة بأثرٍ رجعي في شهرٍ مضى
   * كانت غير مرئية من أي شاشة — موجودةً في القاعدة وضائعةً من العين.
   */
  await page.goto(`${BASE}/flow/income`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const historyCard = page.locator('section').filter({ hasText: 'قبضاتك حسب المصدر' }).first()
  step('سجلّ القبضات حسب المصدر ظاهر', await historyCard.isVisible())
  const historyText = (await historyCard.innerText().catch(() => '')).replace(/\n/g, ' · ')
  step('وقبضة الشهر الماضي فيه لا ضائعة', /11,000/.test(historyText), historyText.slice(0, 140))

  /*
   * قائمة الفواتير الموحّدة: دفعة الالتزام التي حلّ موعدها تظهر مع فواتير
   * الشهر، مرتّبةً بالاستعجال نفسه، ومعها جاهزية صندوقها وزرُّ دفعها.
   */
  await page.goto(`${BASE}/flow/bills`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const annualCard = page.locator('li').filter({ hasText: 'دفعة التزام' }).first()
  step('دفعة الالتزام المستحقّة تظهر في قائمة الفواتير', await annualCard.isVisible())

  const annualText = (await annualCard.innerText().catch(() => '')).replace(/\n/g, ' · ')
  step('وفيها اسم الالتزام وجاهزية صندوقه', /اشتراك الصالة/.test(annualText) && /صندوق/.test(annualText), annualText.slice(0, 120))
  step('والمتأخّرة تقول إنها متأخّرة', /متأخرة/.test(annualText), annualText.slice(0, 120))

  // المتأخّر فوق فاتورة الشهر التي لم يحن يومها — الترتيب استعجالٌ واحد للقائمتين.
  const billCard = page.locator('li').filter({ hasText: 'بالميزانية' }).first()
  const annualBox = await annualCard.boundingBox()
  const billBox = await billCard.boundingBox()
  step('وتسبق فاتورة الشهر في الترتيب', Boolean(annualBox && billBox && annualBox.y < billBox.y))

  /* زرّ الدفع يفتح نفس حوار صفحة التفاصيل — تأكيدٌ قبل أي أثر. */
  await annualCard.getByRole('button', { name: 'اندفع ✓' }).click()
  await page.waitForTimeout(600)
  const payDialog = page.getByRole('dialog')
  step('وزرّ الدفع يفتح حوار التأكيد', (await payDialog.innerText().catch(() => '')).includes('أكّد الدفع'))
  await page.screenshot({ path: `${OUT}/bills-pay.png` })
  await payDialog.getByRole('button', { name: 'إلغاء' }).click()
  await page.waitForTimeout(400)

  /*
   * مركز الشركاء: الباقي من التزام الشريك وحمله الشهري من الفاتورة —
   * في بطاقةٍ واحدة بدل صفحةٍ لكل شيء وآلةٍ حاسبة.
   */
  await page.goto(`${BASE}/obligations/partners`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const partnerCard = page.locator('li').filter({ hasText: 'سامر' }).first()
  step('بطاقة الشريك ظاهرة في المركز', await partnerCard.isVisible())
  // مقطعٌ في المحور لا صفحة تفاصيل: الهيدر يحمل اسم التطبيق لا «ارجع».
  const headerText = await page.locator('header').innerText()
  step('وبلا زرّ رجوعٍ في الهيدر — هو مقطعُ محورٍ لا تفاصيل', !headerText.includes('ارجع'), headerText.replace(/\n/g, ' · '))
  const partnerText = (await partnerCard.innerText().catch(() => '')).replace(/\n/g, ' · ')
  step('وفيها الباقي من التزامه', /2,000/.test(partnerText), partnerText.slice(0, 140))
  step('وحمله الشهري من الفاتورة', /بيحمل.*200/.test(partnerText), partnerText.slice(0, 140))

  /*
   * المسارات القديمة تعيش في متصفحات المستخدمين — إعادة التوجيه عهدٌ
   * يُفحص لا تعليقٌ يُصدَّق.
   */
  const REDIRECTS = [
    ['/bills', '/flow/bills'],
    ['/expenses', '/flow/expenses'],
    ['/money', '/flow/income'],
    ['/calendar', '/obligations/calendar'],
    ['/insights', '/reports'],
  ]
  for (const [from, to] of REDIRECTS) {
    await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    step(`الرابط القديم ${from} يوصل إلى ${to}`, page.url().includes(to), page.url())
  }

  /*
   * لوحة «ضلّ عليك» تُفحص في حالتيها لا في واحدة.
   *
   * فحصٌ يرى القائمة مملوءةً وحدها يمرّ على لوحةٍ لا تختفي أبداً — وهي أسوأ
   * من غيابها: تطلب ما تمّ فعلُه فيعيده صاحبها. والحالتان معاً هما الفحص.
   */
  await page.goto(`${BASE}/month`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const panel = page.locator('section', { hasText: 'ضلّ عليك' }).first()
  step('اللوحة تظهر وفيها ما لم يُسجَّل', await panel.isVisible())

  const rows = panel.locator('li')
  const rowCount = await rows.count()
  step('ولكل سطرٍ فيها زرّ فعل', rowCount > 0 && (await panel.getByRole('button').count()) >= rowCount)

  // الصندوق الذي أُودع فيه هذا الشهر (تأمين السيارة في البذرة) لا يظهر.
  const panelText = await panel.innerText()
  step('وما تمّ لا يظهر فيها', !panelText.includes('تأمين السيارة'), panelText.replace(/\n/g, ' · '))

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
  // الصندوق يُختار بالاسم لا بالافتراضي: الافتراضي أقربُ موعدٍ، وأيُّ بذرةٍ
  // جديدة تزحزحه — والحارس المفحوص يخصّ الصندوق الذي أُودع فيه هذا الشهر.
  await sheet.locator('select').selectOption({ label: 'تأمين السيارة' })
  await page.waitForTimeout(300)
  await sheet.getByRole('button', { name: /^حطّ ₪/ }).click()
  await page.waitForTimeout(600)
  step(
    'الإيداع الثاني يسأل قبل أن يقع',
    await sheet.getByRole('button', { name: 'أيوه، حطّ كمان مرة' }).isVisible(),
  )

  /*
   * الحسابات: تُنشأ وتُربط من التلفون.
   *
   * كان جدول `accounts` قابلاً للكتابة من كلود وحده، فالقسم يختفي لمن لا
   * حساب له، والتحذير «اربطها بحساب» يظهر بلا زرٍّ في التطبيق كلّه. وهذا
   * الفحص يمرّ على المسار كاملاً: أنشئ حساباً، اربط به صندوقاً، وتأكّد أن
   * «المحجوز» صار رصيد الصندوق فعلاً.
   */
  await page.goto(`${BASE}/wealth/accounts`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  /*
   * المحدِّد بالعنوان لا بالنصّ.
   *
   * `hasText` مطابقةٌ جزئية، و«بحساباتك» في ملخّص الثروة تحتوي «حساباتك» —
   * فكان `.first()` يلتقط بطاقة الملخّص التي لا زرَّ فيها. وهذا بالضبط صنف
   * الفحص الذي يفشل لسببٍ لا علاقة له بالمفحوص.
   */
  const accountsCard = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'حساباتك', exact: true }) })
    .first()
  step('قسم الحسابات ظاهرٌ ولو بلا حساب', await accountsCard.isVisible())

  await accountsCard.getByRole('button', { name: '+ ضيف حساب' }).click()
  await page.waitForTimeout(400)
  await accountsCard.getByLabel('اسم الحساب').fill('بنك الفحص')
  await accountsCard.getByLabel('الرصيد الفعلي').first().fill('2000')
  await accountsCard.getByRole('button', { name: 'احفظ' }).first().click()
  await page.waitForTimeout(2000)

  const afterAdd = await accountsCard.innerText()
  step('الحساب أُنشئ من التلفون', afterAdd.includes('بنك الفحص'), afterAdd.slice(0, 120))

  // الصندوق غير المربوط يظهر ومعه قائمة اختيار — لا تحذيراً بلا زرّ.
  const link = accountsCard.getByLabel(/^اربط تأمين السيارة/)
  step('والصندوق غير المربوط معه زرُّ ربطه', await link.isVisible())
  await link.selectOption({ label: 'بنك الفحص' })
  await page.waitForTimeout(2000)

  const afterLink = await accountsCard.innerText()
  await page.screenshot({ path: `${OUT}/accounts.png`, fullPage: true })
  step(
    'وبعد الربط صار «المحجوز» رصيد الصندوق',
    /محجوز لصناديقك[\s\S]*?500/.test(afterLink),
    afterLink.replace(/\n/g, ' · ').slice(0, 200),
  )

  /*
   * وحين لا يبقى شيء تختفي وتقول ذلك.
   *
   * نُسجّل إيداعاً لكل صندوقٍ باقٍ ودخلاً للراتب مباشرةً في القاعدة المزيّفة،
   * ثم نعيد التحميل: يجب أن تُستبدل القائمة بحالة «كل اللي عليك انسجّل».
   * فحصٌ لا يرى الحالتين معاً يمرّ على لوحةٍ لا تختفي أبداً.
   */
  const now = new Date()
  const todayKey = iso(now)
  for (const o of fake.db.obligations) {
    fake.db.fund_deposits.push({
      id: `seed-${o.id}`,
      user_id: fake.userId,
      obligation_id: o.id,
      partner_id: null,
      account_id: null,
      amount: 100,
      deposit_date: todayKey,
      note: null,
      created_at: new Date().toISOString(),
    })
  }
  for (const source of fake.db.income_sources) {
    fake.db.income_entries.push({
      id: `seed-in-${source.id}`,
      user_id: fake.userId,
      source_id: source.id,
      name: null,
      amount: Number(source.amount),
      received_at: todayKey,
      note: null,
      created_at: new Date().toISOString(),
    })
  }
  for (const c of fake.db.fixed_commitments) {
    fake.db.bill_payments.push({
      id: `seed-bill-${c.id}`,
      user_id: fake.userId,
      commitment_id: c.id,
      billing_month: `${todayKey.slice(0, 7)}-01`,
      amount: Number(c.amount),
      paid_at: todayKey,
      note: null,
      method_id: null,
      created_at: new Date().toISOString(),
    })
  }

  await page.goto(`${BASE}/month`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/month-clear.png`, fullPage: true })
  const clearText = await page.locator('body').innerText()
  step('وتختفي حين لا يبقى شيء', !clearText.includes('ضلّ عليك'))
  step('وتقول إنه فرغ', clearText.includes('انسجّل'))

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
