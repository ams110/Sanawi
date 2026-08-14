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
 * ‏PDF صالحٌ من سطور [تاريخ، وصف، مبلغ] — لفحص مسار الاستيراد كاملاً.
 *
 * الإزاحات في جدول xref تُحسب لا تُخمَّن: pdfjs قد يرمّم جدولاً مكسوراً
 * وقد لا يفعل، وفحصٌ يعتمد على الترميم يفشل لسببٍ لا علاقة له بالمفحوص.
 */
function buildPdfStatement(rows) {
  const content = rows
    .map(([date, name, amount], i) => {
      const y = 700 - i * 20
      return [
        `BT /F1 12 Tf 300 ${y} Td (${date}) Tj ET`,
        `BT /F1 12 Tf 150 ${y} Td (${name}) Tj ET`,
        `BT /F1 12 Tf 50 ${y} Td (${amount}) Tj ET`,
      ].join('\n')
    })
    .join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

  return Buffer.from(pdf, 'latin1')
}

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
    /*
     * يومها دائماً بعد يوم الفحص — لا يومٌ ثابت.
     *
     * كان 10، ففحص «المتأخّر يسبق فاتورةً لم يحن يومها» يمرّ من أول الشهر
     * حتى الحادي عشر ثم يفشل بقية الشهر: الكهرباء نفسها تصير متأخرةً أكثر
     * من الصالة فتسبقها بحق. و31 في الشهور القصيرة يقصّه المحرّك إلى آخر
     * يومٍ فعلي، فأسوأ الحالات «اليوم» — وهي بعد المتأخّر دائماً.
     */
    day_of_month: Math.min(31, today.getDate() + 5),
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

  // قسطٌ له نهاية: به يُفحص أن شاشة الاشتراكات لا تعدّه اشتراكاً دائماً.
  // بلا موعدٍ عمداً: موعدٌ ثابت يقلب ترتيب قائمة الفواتير حسب يوم إجراء الفحص.
  db.fixed_commitments.push({
    id: 'f2',
    user_id: userId,
    name: 'قسط الثلاجة',
    amount: 250,
    day_of_month: null,
    default_method_id: null,
    icon: null,
    starts_on: null,
    ends_on: iso(new Date(year + 1, 5, 5)),
    total_amount: 3000,
    annual_interest_percent: 0,
    my_share_percent: 100,
    account_id: null,
    is_active: true,
    created_at: new Date().toISOString(),
  })

  /*
   * مجموعة وملاحظات — الحقلان اليتيمان: يكتبهما كلود، وبهما يُفحص أن
   * التطبيق صار يعرضهما لا يبتلعهما.
   */
  db.obligation_groups.push({
    id: 'g1',
    user_id: userId,
    name: 'العيلة',
    icon: '👨‍👩‍👦',
    color: null,
    created_at: new Date().toISOString(),
  })

  /*
   * الربط الحي: مفاتيح محفوظة وحركتان في الوارد — خارجةٌ تُسجَّل مصروفاً
   * بضغطة، وداخلةٌ لها منتقى وجهةٍ بالصناديق. بهما تُفحص شاشة الوارد كاملة.
   */
  db.financy_credentials.push({
    user_id: userId,
    client_id: 'check-client',
    client_secret: 'check-secret',
    financy_user_id: 'check-user',
    updated_at: new Date().toISOString(),
  })
  db.bank_inbox.push(
    {
      id: 'bi1',
      user_id: userId,
      tx_sk: 'TX#seed-out',
      provider_id: 'max',
      account_external_id: null,
      name: 'סופר יוחננוף',
      amount: 45.5,
      direction: 'out',
      tx_date: iso(new Date(today.getFullYear(), today.getMonth(), 4)),
      category_main: 'FOOD_&_DRINKS',
      category_sub: 'GROCERIES',
      installment_number: null,
      installment_total: null,
      status: 'pending',
      recorded_kind: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'bi2',
      user_id: userId,
      tx_sk: 'TX#seed-in',
      provider_id: 'leumi',
      account_external_id: null,
      name: 'העברה נכנסת',
      amount: 800,
      direction: 'in',
      tx_date: iso(new Date(today.getFullYear(), today.getMonth(), 5)),
      category_main: null,
      category_sub: null,
      installment_number: null,
      installment_total: null,
      status: 'pending',
      recorded_kind: null,
      created_at: new Date().toISOString(),
    },
  )

  // فاتورة الثلاجة مدفوعة يوم 3 — بها يُفحص أن «إمتى دفعتها» يُعرض لا يُحفظ وحسب.
  db.bill_payments.push({
    id: 'bp1',
    user_id: userId,
    commitment_id: 'f2',
    billing_month: `${iso(today).slice(0, 7)}-01`,
    amount: 250,
    paid_at: iso(new Date(today.getFullYear(), today.getMonth(), 3)),
    note: null,
    method_id: null,
    created_at: new Date().toISOString(),
  })

  const obligations = [
    // حصّتي 50٪ — النصف الآخر على الشريك المزروع تحت، وبه يُفحص مركز الشركاء.
    { id: 'o1', name: 'تأمين السيارة', total: 6000, due: `${year + 1}-01-15`, baseline: 500, share: 50, group: 'g1', notes: 'رقم البوليصة 12345' },
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
      group_id: o.group ?? null,
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
      notes: o.notes ?? null,
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
    note: 'دفعة أولى',
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
    note: 'شيك آخر الشهر',
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
  const RAW_KEY = /\b(month|detail|quickAdd|expenses|bills|money|wealth|nav|common|payment|settings|backup|update|accounts|panel|hub|flow|reports|partners|forecast|subs|report|bank)\.[a-zA-Z]/

  // كل مقاطع المحاور الجديدة، لا الأبواب الخمسة وحدها.
  const TABS = [
    { path: '/month', name: 'month' },
    { path: '/flow/expenses', name: 'expenses' },
    { path: '/flow/income', name: 'money' },
    { path: '/flow/bills', name: 'bills' },
    { path: '/flow/import', name: 'bank-import' },
    { path: '/obligations', name: 'obligations' },
    { path: '/obligations/calendar', name: 'calendar' },
    { path: '/obligations/partners', name: 'partners' },
    { path: '/wealth', name: 'wealth' },
    { path: '/wealth/accounts', name: 'wealth-accounts' },
    { path: '/wealth/assets', name: 'wealth-assets' },
    { path: '/wealth/plans', name: 'wealth-plans' },
    { path: '/reports', name: 'insights' },
    { path: '/reports/forecast', name: 'forecast' },
    { path: '/reports/subscriptions', name: 'subscriptions' },
    { path: '/reports/monthly', name: 'monthly-report' },
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

  // ملاحظة القبضة — كانت تُحفظ ولا تُعرض. تظهر عند تصفّح شهرها.
  await page.getByRole('button', { name: '◀' }).first().click()
  await page.waitForTimeout(800)
  const lastMonthList = await page.locator('body').innerText()
  step('وملاحظة القبضة ظاهرة في شهرها', lastMonthList.includes('شيك آخر الشهر'))

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

  /*
   * «كل التزاماتك الشهرية بمحل واحد»: أقساط الصناديق صفوفٌ في القائمة نفسها —
   * المودَع بحاله وتاريخ آخر إيداع، والفارغ بحاله، ومن حلّ موعده هذا الشهر
   * (الصالة) دفعتُه وحدها لا قسطٌ معها — نفس المال لا يُعرض مرتين.
   */
  const instCards = page.locator('li').filter({ hasText: 'قسط صندوق' })
  const instCount = await instCards.count()
  step('أقساط الصناديق صفوفٌ في قائمة الفواتير', instCount === 2, `عددها ${instCount}`)

  const insuranceInst = instCards.filter({ hasText: 'تأمين السيارة' }).first()
  const insuranceInstText = (await insuranceInst.innerText().catch(() => '')).replace(/\n/g, ' · ')
  step(
    'المودَع فيه يقول حطّيت ومعه تاريخ آخر إيداع',
    /حطّيت/.test(insuranceInstText) && /آخر إيداع/.test(insuranceInstText),
    insuranceInstText.slice(0, 160),
  )

  const testInst = instCards.filter({ hasText: 'טסט' }).first()
  const testInstText = (await testInst.innerText().catch(() => '')).replace(/\n/g, ' · ')
  step('والفارغ يقول بعدك ومعه زرّ القسط', /بعدك ما حطّيته/.test(testInstText) && /حطّ القسط/.test(testInstText), testInstText.slice(0, 160))

  const gymInstCount = await instCards.filter({ hasText: 'اشتراك الصالة' }).count()
  step('ومن حلّ موعده دفعتُه وحدها لا قسطٌ معها', gymInstCount === 0, `ظهر ${gymInstCount} قسطاً`)

  const billsBody = await page.locator('body').innerText()
  step('والحمل الشهري يجمع أقساط الصناديق', billsBody.includes('أقساط صناديقك'))

  // الفاتورة المدفوعة تقول إمتى — بشارة «✓ دفعتها» لا بحالٍ بلا تاريخ.
  const fridgeCard = page.locator('li').filter({ hasText: 'قسط الثلاجة' }).first()
  const fridgeText = (await fridgeCard.innerText().catch(() => '')).replace(/\n/g, ' · ')
  step('والفاتورة المدفوعة تقول إمتى اندفعت', /✓ دفعتها 3\//.test(fridgeText), fridgeText.slice(0, 160))
  await page.screenshot({ path: `${OUT}/bills-installments.png`, fullPage: true })

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
   * التوقّع النقدي: بلا حساباتٍ في البذرة غيرُ المخصَّص صفر، والفواتير
   * والأقساط تنزل به تحت الصفر فوراً — فالتحذير يجب أن يظهر بتاريخٍ ورقم.
   */
  await page.goto(`${BASE}/reports/forecast`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const forecastBody = await page.locator('body').innerText()
  step('التوقّع يحذّر من النزول تحت الصفر', forecastBody.includes('تحت الصفر'))
  step('وقائمة «شو طالع» فيها فاتورة الشهر', /شو طالع[\s\S]*كهرباء/.test(forecastBody))
  step('وصراحة «بلا الدخل» معروضة لا مخفيّة', forecastBody.includes('بلا الدخل'))
  // التزامٌ موعدُه هذا الشهر: دفعتُه لا تُعدّ دفعةً وقسطاً معاً — نفس المال مرتين.
  const gymCount = (forecastBody.match(/اشتراك الصالة/g) ?? []).length
  step('ودفعة الشهر لا تُحسب مرتين (دفعة + قسط)', gymCount === 1, `ظهرت ${gymCount} مرة`)

  /*
   * الاشتراكات: المتكرّر الدائم بعدسته السنوية — كهرباء 400 شهرياً تُقرأ
   * 4,800 سنوياً، والقسط ذو النهاية لا يتسلّل إلى القائمة.
   */
  await page.goto(`${BASE}/reports/subscriptions`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const subsBody = await page.locator('body').innerText()
  step('الاشتراك يُقرأ بكلفته السنوية', /كهرباء[\s\S]*4,800/.test(subsBody))
  step('والقسط ذو النهاية ليس اشتراكاً', !subsBody.includes('قسط الثلاجة'))

  /*
   * التقرير الشهري: الشهر الحالي فيه مصروف البنزين، والشهر الماضي —
   * بسهمٍ واحد — فيه قبضة الـ11,000. والصافي وزرّ CSV حاضران.
   */
  await page.goto(`${BASE}/reports/monthly`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const reportBody = await page.locator('body').innerText()
  step('التقرير يعرض صافي الشهر', reportBody.includes('صافي حركة الشهر'))
  step('ومصاريف الشهر فيه', /مصاريف[\s\S]*120/.test(reportBody))
  // التصنيف القديم («car») يُترجم لا يُطبع خاماً.
  step('والتصنيف القديم مترجمٌ لا خام', reportBody.includes('السيارة') && !/\bcar\b/.test(reportBody))
  step('وزرّ التصدير حاضر', await page.getByRole('button', { name: /CSV/ }).isVisible())

  await page.getByRole('button', { name: 'الشهر السابق' }).click()
  await page.waitForTimeout(1000)
  const prevReport = await page.locator('body').innerText()
  step('والشهر الماضي يروي قبضته', /11,000/.test(prevReport))

  /*
   * «سجّل من البنك» — المسار كاملاً: لصقُ كشفٍ عبري، قراءةٌ ومراجعة،
   * تسجيلٌ، ثم لصقُ الكشف نفسه ثانيةً ليُعلَّم مكرَّراً لا ليُكتب مرتين.
   */
  await page.goto(`${BASE}/flow/import`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  /*
   * الوارد الحي: الحركات المزروعة ظاهرة، الخارجة تُسجَّل مصروفاً بضغطةٍ
   * فتغادر الوارد، والداخلة معها منتقى وجهةٍ بالصناديق وأرصدتها.
   */
  const financyCard = page.locator('section').filter({ hasText: 'وارد البنك' }).first()
  step('وارد البنك الحي ظاهر وفيه الحركتان', await financyCard.isVisible() && (await financyCard.locator('li').count()) === 2)

  const inRow = financyCard.locator('li').filter({ hasText: 'העברה נכנסת' }).first()
  const inRowText = (await inRow.innerText().catch(() => '')).replace(/\n/g, ' · ')
  step('والداخلة معها منتقى وجهةٍ بالصناديق', (await inRow.locator('select option').count()) > 1, inRowText.slice(0, 140))

  const outRow = financyCard.locator('li').filter({ hasText: 'סופר יוחננוף' }).first()
  const outRowText = (await outRow.innerText().catch(() => '')).replace(/\n/g, ' · ')
  step('والخارجة بتصنيف Financy مترجماً', /أكل وشرب/.test(outRowText), outRowText.slice(0, 140))

  await page.screenshot({ path: `${OUT}/financy-inbox.png` })
  await outRow.getByRole('button', { name: 'سجّلها مصروف' }).click()
  await page.waitForTimeout(2000)
  step('وتسجيلها مصروفاً يخرجها من الوارد', (await financyCard.locator('li').count()) === 1)

  const impDate = new Date()
  const impMonth = String(impDate.getMonth() + 1).padStart(2, '0')
  const statement = [
    'תאריך,תיאור,סכום',
    `03/${impMonth}/${impDate.getFullYear()},סופר פארם,-89.90`,
    `04/${impMonth}/${impDate.getFullYear()},העברה נכנסת,1200`,
  ].join('\n')

  await page.locator('textarea').fill(statement)
  await page.getByRole('button', { name: 'اقرأ الكشف' }).click()
  await page.waitForTimeout(1500)

  const reviewBody = await page.locator('body').innerText()
  // ‏89.90 تُعرض ₪ 90: التنسيق بالشيكل الكامل كبقية التطبيق — والمخزون بدقّته.
  step(
    'الكشف الملصوق يُقرأ للمراجعة',
    reviewBody.includes('סופר פארם') && /[−-]₪ 90/.test(reviewBody),
    reviewBody.replace(/\n/g, ' · ').slice(0, 200),
  )
  step('والاتجاهان مميّزان داخلاً وخارجاً', reviewBody.includes('1,200'))

  await page.getByRole('button', { name: /سجّل 2 حركة/ }).click()
  await page.waitForTimeout(2000)
  const afterCommit = await page.locator('body').innerText()
  step('التسجيل يقول ما سجّل', afterCommit.includes('انسجّلت'), afterCommit.slice(0, 120))

  // الكشف نفسه ثانيةً: الحارس يعلّم الحركتين «موجودة» ويطفئهما.
  await page.locator('textarea').fill(statement)
  await page.getByRole('button', { name: 'اقرأ الكشف' }).click()
  await page.waitForTimeout(1500)
  const secondPass = await page.locator('body').innerText()
  step('ولصقُه ثانيةً لا يكتب مرتين', (secondPass.match(/موجودة/g) ?? []).length === 2, secondPass.slice(0, 160))
  step('والمختار صفر من تلقائه', secondPass.includes('مختار 0 من 2'))

  /*
   * القبضة الداخلة توجَّه لصندوق: تصير إيداعاً لا دخلاً — تحويلة التوفير
   * تظهر في كشفها قبضةً وليست دخلاً — بيوم الحركة نفسه. ومع كل صندوقٍ
   * رصيدُه في المنتقى، ولصق الكشف ثانيةً يجدها «موجودة»: حارس التكرار
   * يعرف إيداعات الصناديق أيضاً.
   */
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await page.waitForTimeout(300)
  const fundStatement = `תאריך,תיאור,סכום\n05/${impMonth}/${impDate.getFullYear()},הפקדה לחסכון,350`
  await page.locator('textarea').fill(fundStatement)
  await page.getByRole('button', { name: 'اقرأ الكشف' }).click()
  await page.waitForTimeout(1500)

  // صفوف اللصق وحدها فيها checkbox — الوارد الحي فوقها له select آخر.
  const destSelect = page
    .locator('li')
    .filter({ has: page.locator('input[type="checkbox"]') })
    .locator('select')
    .first()
  const destVisible = await destSelect.isVisible().catch(() => false)
  const destText = destVisible ? await destSelect.innerText() : ''
  step('وللقبضة منتقى وجهةٍ ومع كل صندوقٍ رصيدُه', destVisible && /טסט/.test(destText) && /فيه/.test(destText), destText.replace(/\n/g, ' · ').slice(0, 160))

  const testOptionValue = await destSelect
    .locator('option', { hasText: 'טסט' })
    .getAttribute('value')
  await destSelect.selectOption(testOptionValue)
  await page.screenshot({ path: `${OUT}/bank-import-fund.png` })
  await page.getByRole('button', { name: /سجّل 1 حركة/ }).click()
  await page.waitForTimeout(2000)
  const fundDone = await page.locator('body').innerText()
  step('والقبضة الموجَّهة تُسجَّل إيداعاً بصندوقها', /راح لصندوقه/.test(fundDone), fundDone.slice(0, 160))

  await page.locator('textarea').fill(fundStatement)
  await page.getByRole('button', { name: 'اقرأ الكشف' }).click()
  await page.waitForTimeout(1500)
  const fundSecond = await page.locator('body').innerText()
  step(
    'ولصقُها ثانيةً يجدها موجودة — الحارس يعرف الصناديق',
    fundSecond.includes('موجودة') && fundSecond.includes('مختار 0 من 1'),
    fundSecond.slice(0, 160),
  )

  /*
   * كشف PDF حقيقي: يُولَّد ملفٌّ صالح هنا ويُرفع، فيمرّ بالأنبوب كاملاً —
   * pdfjs يستخرج القطع، والمنطق النقي يعيد بناء الجدول، والقارئ يقرؤه.
   */
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await page.waitForTimeout(400)

  const pdfLines = [
    ['03/' + impMonth + '/' + impDate.getFullYear(), 'Market', '-77.70'],
    ['04/' + impMonth + '/' + impDate.getFullYear(), 'Transfer In', '850'],
  ]
  const pdfPath = `${OUT}/bank-statement.pdf`
  writeFileSync(pdfPath, buildPdfStatement(pdfLines))
  await page.locator('input[type="file"]').setInputFiles(pdfPath)
  await page.waitForTimeout(3000)

  const pdfReview = await page.locator('body').innerText()
  step('كشف الـPDF يُقرأ للمراجعة', pdfReview.includes('Market') && pdfReview.includes('مختار 2 من 2'), pdfReview.replace(/\n/g, ' · ').slice(0, 200))
  step('واتجاها الـPDF مقروءان', /[−-]₪ 78/.test(pdfReview) && pdfReview.includes('850'))
  await page.getByRole('button', { name: 'إلغاء' }).click()
  await page.waitForTimeout(300)

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

  /*
   * الحقول اليتيمة صارت مرئية: الملاحظات والمجموعة وملاحظة الحركة —
   * يكتبها كلود وكان التطبيق يبتلعها.
   */
  const detailBody = await page.locator('body').innerText()
  step('ملاحظات الالتزام ظاهرة في التفاصيل', detailBody.includes('رقم البوليصة 12345'))
  step('ومجموعته ظاهرة', detailBody.includes('العيلة'))
  step('وملاحظة الإيداع ظاهرة في الحركات', detailBody.includes('دفعة أولى'))

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
      /*
       * مبلغٌ يغطّي أيّ قسط — لا 100.
       *
       * الإيداع الجزئي صار يُبقي السطر بالباقي («حطّيت 100 من 500») بدل أن
       * يُسقط القسط كلَّه (تدقيق آب 2026: ش13)، فمئةٌ على قسطٍ بخمسمئة لا
       * تُفرغ القائمة — وهذا الفحص يريد الحالة الخالية لا الجزئية.
       */
      amount: 100_000,
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
    // المدفوعة منذ البذرة لا تُدفع ثانيةً — صفّان لفاتورةٍ واحدة يكذبان.
    if (fake.db.bill_payments.some((b) => b.commitment_id === c.id)) continue
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
