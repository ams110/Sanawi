/**
 * فحص التناسق: الشاشة وكلود على نفس القاعدة — نفس الأرقام حرفياً.
 * التشغيل: npm run check:parity   (بعد `npm run build:mcp`)
 *
 * لماذا: تدقيق آب 2026 وجد أن أكبر عائلة أعطال ليست حساباً خاطئاً بل
 * سطحين يجيبان سؤالاً واحداً بجوابين — 490 اختباراً أخضر والشاشة تناقض
 * كلود. اختبار المحرّك وحده لا يلتقط هذا (قاعدة CLAUDE.md الثامنة)، فهذا
 * الفحص يفتح الشاشة فعلاً في متصفح، ويسأل الخادم فعلاً عبر MCP، على نفس
 * القاعدة المزيّفة، ويقارن ما يقرؤه المستخدم بما يسمعه من كلود.
 *
 * المقارنات — كل واحدة كانت عطلاً حقيقياً وقع:
 *   1. «لازم يطلع من حسابك» = monthly_load  (كانا من محرّكين: ش1، ش5)
 *   2. رقم اللوحة الكبير = coverage
 *   3. قائمة «ضلّ عليك»: نفس الأسماء والمبالغ والترتيب  (س1، ل1، ش13)
 *   4. «مصادر ما سجّلت منها»: نفس المصادر عند الطرفين
 *   5. «بإيدك من دخل الشهر» ≠ «غير المخصَّص»: رقمان بعالمين وتسميتين
 *      (خطة docs/income-actual-plan.md — `in_hand` ليس رصيدك)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startFakeSupabase } from './fake-supabase.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const entry = `${root}mcp/dist/mcp/index.js`
const ENV_FILE = `${root}.env`

if (!existsSync(entry)) {
  console.error('لم يُبنَ الخادم بعد. شغّل: npm run build:mcp')
  process.exit(1)
}

let failures = 0
const step = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** «₪ 1,234» أو «₪ −1,234» إلى عدد. */
const parseMoney = (text) => {
  const m = /₪\s*([−-]?)([\d,]+(?:\.\d+)?)/.exec(text)
  if (!m) return null
  return Number(m[2].replace(/,/g, '')) * (m[1] ? -1 : 1)
}

/**
 * بذرة تطأ مواضع الأعطال القديمة عمداً:
 * قبضة جزئية (كانت تقلب اللوحة)، إيداع شريك (كان يسدّ قسطي)، إيداعي
 * الجزئي (كان يُسقط السطر)، فاتورة منصَّفة بمتوسّط (كانت تقفز للكامل).
 */
function seed(db, userId) {
  const today = new Date()
  const monthKey = `${iso(today).slice(0, 7)}-01`
  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15)

  db.income_sources.push({
    id: 'i1', user_id: userId, name: 'راتب', amount: 9000, frequency: 'monthly',
    is_variable: false, is_active: true, created_at: new Date().toISOString(),
  })
  // قبضة جزئية: 700 وصلت من الراتب — والأساس هو ما وصل في السطحين.
  db.income_entries.push({
    id: 'in1', user_id: userId, source_id: 'i1', name: null, amount: 700,
    received_at: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
    note: null, created_at: new Date().toISOString(),
  })
  /*
   * مصدرٌ عادتُه شهرية وتأخّر — يُشغّل قائمة «مصادر ما سجّلت منها» فعلاً.
   *
   * قبضتاه في الشهرين الماضيين ولا شيء هذا الشهر: هذا ما يُذكَّر به.
   * ومصدرٌ بلا سجلٍّ أصلاً لا يُذكَّر به بعد `cadence.ts` — فلو بُذر فارغاً
   * لبقيت القائمة خاويةً في الطرفين ومرّ فحصُها وهو لا يفحص شيئاً، وهو
   * بالضبط نوع «الأخضر الكاذب» الذي وُلد هذا الملف ليمنعه.
   */
  db.income_sources.push({
    id: 'i2', user_id: userId, name: 'شغل جانبي', amount: 0, frequency: 'monthly',
    is_variable: true, is_active: true, created_at: new Date().toISOString(),
  })
  const backThen = (monthsAgo, day) =>
    iso(new Date(today.getFullYear(), today.getMonth() - monthsAgo, day))
  db.income_entries.push(
    {
      id: 'in-gig-1', user_id: userId, source_id: 'i2', name: null, amount: 900,
      received_at: backThen(1, 12), note: null, created_at: new Date().toISOString(),
    },
    {
      id: 'in-gig-2', user_id: userId, source_id: 'i2', name: null, amount: 850,
      received_at: backThen(2, 14), note: null, created_at: new Date().toISOString(),
    },
  )

  // فاتورة منصَّفة 400 بمتوسّطٍ 360 من فاتورة الشهر الماضي.
  db.fixed_commitments.push({
    id: 'f1', user_id: userId, name: 'كهرباء', amount: 400,
    day_of_month: null, default_method_id: null, icon: null, starts_on: null,
    ends_on: null, total_amount: null, annual_interest_percent: 0,
    my_share_percent: 50, account_id: null, is_active: true,
    created_at: new Date().toISOString(),
  })
  db.bill_payments.push({
    id: 'bp-prev', user_id: userId, commitment_id: 'f1',
    billing_month: `${iso(prevMonth).slice(0, 7)}-01`, amount: 360,
    paid_at: iso(prevMonth), note: null, method_id: null,
    created_at: new Date().toISOString(),
  })

  // التزام منصَّف: إيداع شريكٍ (لا يسدّ قسطي) وإيداعي الجزئي (يُبقي الباقي).
  db.obligations.push(
    {
      id: 'o1', user_id: userId, group_id: null, account_id: null,
      name: 'تأمين السيارة', category: 'car', total_amount: 6000,
      next_due_date: iso(new Date(today.getFullYear() + 1, 0, 15)),
      recurrence_months: 12, cycle_start_date: iso(today),
      baseline_installment: 250, my_share_percent: 50, is_active: true,
      notes: null, created_at: new Date().toISOString(),
    },
    {
      id: 'o2', user_id: userId, group_id: null, account_id: null,
      name: 'טסט', category: 'car', total_amount: 1200,
      next_due_date: iso(new Date(today.getFullYear() + 1, 2, 1)),
      recurrence_months: 12, cycle_start_date: iso(today),
      baseline_installment: 100, my_share_percent: 100, is_active: true,
      notes: null, created_at: new Date().toISOString(),
    },
  )
  db.obligation_partners.push({ id: 'p1', user_id: userId, name: 'سامر', created_at: new Date().toISOString() })
  db.obligation_partner_shares.push({
    id: 'ps1', user_id: userId, obligation_id: 'o1', partner_id: 'p1',
    share_percent: 50, created_at: new Date().toISOString(),
  })
  db.fund_deposits.push(
    {
      id: 'dp-partner', user_id: userId, obligation_id: 'o1', partner_id: 'p1',
      account_id: null, amount: 250,
      deposit_date: iso(new Date(today.getFullYear(), today.getMonth(), 2)),
      note: null, created_at: new Date().toISOString(),
    },
    {
      id: 'dp-mine', user_id: userId, obligation_id: 'o1', partner_id: null,
      account_id: null, amount: 100,
      deposit_date: iso(new Date(today.getFullYear(), today.getMonth(), 3)),
      note: null, created_at: new Date().toISOString(),
    },
  )

  db.expenses.push({
    id: 'e1', user_id: userId, group_id: null, category: 'car', category_id: null,
    is_unexpected: false, amount: 155, spent_at: iso(today), note: 'بنزين',
    method_id: null, account_id: null, created_at: new Date().toISOString(),
  })
  /*
   * الحساب المربوط بالبنك — الرقم الذي وُلد مع ربط الحسابات.
   *
   * لقطة الرصيد قبل خمسة أيام بساعةٍ نهارية (قاعدة 7)، وثلاث حركات تطأ
   * المواضع الثلاثة التي يخطئ الحدس فيها:
   *   · صرفة 620 بعد اللقطة، معلّقة  ← تدخل
   *   · قبضة 200 بعد اللقطة، متجاهَلة ← تدخل أيضاً: «تجاهلتها» قرارُ دفترٍ
   *     لا إلغاءٌ لسحبٍ وقع في البنك
   *   · صرفة 900 قبل اللقطة          ← لا تدخل، فهي داخلةٌ في الرصيد أصلاً
   * فالصافي ‎−420 والمقترَح 4,580.
   */
  const snapshot = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5, 13, 40)
  db.accounts.push({
    id: 'a1', user_id: userId, name: 'لئومي', kind: 'checking',
    balance: 5000, balance_updated_at: snapshot.toISOString(),
    bank_provider_id: 'leumi', bank_external_id: 'IL-9911',
    archived_at: null, created_at: new Date().toISOString(),
  })
  const inboxRow = (id, amount, direction, dayOffset, status) => ({
    id, user_id: userId, tx_sk: `sk-${id}`,
    provider_id: 'leumi', account_external_id: 'IL-9911',
    name: `حركة ${id}`, amount, direction,
    tx_date: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOffset)),
    category_main: null, category_sub: null,
    installment_number: null, installment_total: null,
    status, recorded_kind: null, created_at: new Date().toISOString(),
  })
  db.bank_inbox.push(
    inboxRow('bx1', 620, 'out', 2, 'pending'),
    inboxRow('bx2', 200, 'in', 1, 'dismissed'),
    inboxRow('bx3', 900, 'out', 9, 'recorded'),
  )

  void monthKey
}

const fake = await startFakeSupabase()
seed(fake.db, fake.userId)

/* ── كلود: عبر الخادم المبني فعلاً على نفس القاعدة ─────────── */
const client = new Client({ name: 'sanawi-parity', version: '1.0.0' })
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      ...process.env,
      SANAWI_SUPABASE_URL: fake.url,
      SANAWI_SUPABASE_ANON_KEY: fake.anonKey,
      SANAWI_EMAIL: fake.email,
      SANAWI_PASSWORD: fake.password,
    },
    stderr: 'pipe',
  }),
)
const call = async (name, args = {}) =>
  (await client.callTool({ name, arguments: args })).structuredContent

const overview = await call('sanawi_month_overview')

/* ── الشاشة: متصفح حقيقي على نفس القاعدة ───────────────────── */
const savedEnv = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : null
writeFileSync(ENV_FILE, `VITE_SUPABASE_URL=${fake.url}\nVITE_SUPABASE_ANON_KEY=${fake.anonKey}\n`)
const restoreEnv = () => {
  if (savedEnv === null) rmSync(ENV_FILE, { force: true })
  else writeFileSync(ENV_FILE, savedEnv)
}

const vite = spawn('npx', ['vite', '--port', '5198', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})
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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 880 }, locale: 'ar' })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5198', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', fake.email)
  await page.fill('input[type="password"]', fake.password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(2500)

  /* 1. «لازم يطلع من حسابك» = committed */
  const mustLeaveCard = page
    .locator('section')
    .filter({ hasText: 'لازم يطلع من حسابك' })
    .first()
  const mustLeave = parseMoney(await mustLeaveCard.innerText())
  step(
    'بطاقة «لازم يطلع» = monthly_load عند كلود',
    mustLeave !== null && mustLeave === overview.monthly_load,
    `الشاشة ${mustLeave} · كلود ${overview.monthly_load}`,
  )

  /* 2. رقم اللوحة الكبير = coverage */
  const panelCard = page
    .locator('section')
    .filter({ hasText: 'بعد ما تسدّ اللي عليك هالشهر' })
    .first()
  const coverage = parseMoney(await panelCard.innerText())
  step(
    'رقم اللوحة الكبير = coverage عند كلود',
    coverage !== null && coverage === overview.coverage,
    `الشاشة ${coverage} · كلود ${overview.coverage}`,
  )

  /*
   * 3. «ضلّ عليك»: الأسماء والمبالغ والترتيب.
   *
   * العنوان ثابتٌ في متغيّر لا مكرَّرٌ نصّاً: القسمة عليه هي التي تفصل
   * القائمتين، وتغييرُ نصٍّ في `i18n` بلا تغييره هنا كان يجعل قسم الدخل
   * فارغاً فيمرّ الفحص وهو لا يفحص شيئاً.
   */
  const INCOME_HEADING = 'مصادر ما سجّلت منها'

  const pendingCard = page.locator('section').filter({ hasText: 'ضلّ عليك' }).first()
  const cardText = await pendingCard.innerText()
  /*
   * المبلغ من عنصره (`span.num`) لا من نصّ السطر كلّه: الملاحظة تحته تحمل
   * أرقاماً أيضاً («حطّيت 100 من 580»، «وصل 700 من 9,000») وقراءتها مبلغاً
   * تُفشل المقارنة لسببٍ لا علاقة له بالمفحوص.
   */
  const amountsOf = async (list) => {
    const out = []
    for (const li of await list.locator('li').all()) {
      const span = li.locator('span.num').first()
      const value = parseMoney(await span.innerText().catch(() => ''))
      if (value !== null) out.push(value)
    }
    return out
  }
  // القائمتان <ul> متتاليتان في البطاقة: «عليك» أولاً ثم «ما سجّلت منها».
  const screenRows = await amountsOf(pendingCard.locator('ul').nth(0))
  const claudeRows = overview.pending.map((p) => p.amount).filter((a) => a !== null)
  step(
    'قائمة «ضلّ عليك»: نفس المبالغ بنفس الترتيب',
    JSON.stringify(screenRows) === JSON.stringify(claudeRows),
    `الشاشة [${screenRows}] · كلود [${claudeRows}]`,
  )
  const dueSection = cardText.split(INCOME_HEADING)[0]
  for (const item of overview.pending) {
    step(`و«${item.name}» ظاهر في الشاشة كما عند كلود`, dueSection.includes(item.name))
  }

  /*
   * 4. «مصادر ما سجّلت منها»: نفس المصادر عند الطرفين.
   *
   * بلا مبالغ بعد إلغاء الدخل المتوقَّع — التطبيق لا يعرف كم سيصل، يعرف
   * فقط أنه لم يُسجَّل. فالمقارنة على الأسماء لا على الأرقام.
   */
  const incomeSection = cardText.split(INCOME_HEADING)[1] ?? ''
  for (const item of overview.pending_income) {
    step(`و«${item.name}» في قائمة الدخل عند الطرفين`, incomeSection.includes(item.name))
  }
  step(
    'ولا مبلغ مخترَع لدخلٍ لم يصل',
    overview.pending_income.every((p) => p.amount === null),
    `${JSON.stringify(overview.pending_income.map((p) => p.amount))}`,
  )

  /* والمواضع القديمة بعينها: إيداع الشريك والقسط الجزئي والمتوسّط المنصَّف */
  // حصّتي 3,000 ناقص إيداعي 100 = ‏2,900 على 5 شهور ← قسط 580، والباقي بعد
  // إيداعي 480. إيداع الشريك (250) خارج الحسبة كلها — كان يسدّ قسطي. (ل1)
  const insurance = overview.pending.find((p) => p.name === 'تأمين السيارة')
  step('قسط التأمين باقيه 480 (لا يسدّه الشريك ولا يسقط بالجزئي)', insurance?.amount === 480, `كلود ${insurance?.amount}`)
  const bill = overview.pending.find((p) => p.name === 'كهرباء')
  step('فاتورة الكهرباء بمتوسّطها المنصَّف 180', bill?.amount === 180, `كلود ${bill?.amount}`)
  /*
   * 5. حدّ الصدق: «بإيدك من دخل الشهر» ليس الرصيد.
   *
   * الرقمان على شاشةٍ واحدة، ومن يخلطهما يظنّ أن ماله ضعف ما هو أو نصفه.
   * فالفحص يؤكّد أنهما مختلفان **وأن كلّاً منهما مسمّىً بعالمه** — لا أن
   * يتطابقا، بل ألّا يُعرضا كأنهما رقمٌ واحد اختلف.
   */
  const panelText = await panelCard.innerText()
  step(
    'اللوحة تصرّح أن «بإيدك» من دخل الشهر لا رصيدك',
    panelText.includes('من دخل هالشهر'),
    panelText.slice(0, 120),
  )
  const liquidity = await call('sanawi_list_accounts')
  step(
    'و«غير المخصَّص» رقمٌ آخر من عالمٍ آخر',
    typeof liquidity.available_total === 'number' &&
      liquidity.available_total !== overview.in_hand,
    `بإيدك ${overview.in_hand} · غير المخصَّص ${liquidity.available_total}`,
  )

  /*
   * 5. الرصيد المقترَح بعد حركات البنك — الشاشة وكلود على نفس النداء.
   *
   * هذا الرقم يُعرض في مكانين ويُشتقّ من نفس البيانات (قاعدة 8): زرّ «خلّي
   * الرصيد …» في شاشة الحسابات، وحقل bank_since.suggested_balance عند كلود.
   * ولولا هذا التأكيد لانحرف أحدهما صامتاً أوّل ما يتغيّر تعريف «بعد اللقطة».
   */
  const accountsOut = await call('sanawi_list_accounts')
  const claudeAccount = accountsOut.accounts.find((a) => a.name === 'لئومي')
  const claudeSuggested = claudeAccount?.bank_since?.suggested_balance ?? null

  await page.goto('http://localhost:5198/wealth/accounts', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const applyButton = page.getByRole('button', { name: /خلّي الرصيد/ }).first()
  const screenSuggested = parseMoney(await applyButton.innerText().catch(() => ''))

  step(
    'الرصيد المقترَح بعد حركات البنك = suggested_balance عند كلود',
    screenSuggested !== null && screenSuggested === claudeSuggested,
    `الشاشة ${screenSuggested} · كلود ${claudeSuggested}`,
  )
  step(
    'والصافي ‎−420: المتجاهَلة محسوبة وما قبل اللقطة مستثناة',
    claudeAccount?.bank_since?.net === -420 && claudeAccount?.bank_since?.count === 2,
    `كلود صافي ${claudeAccount?.bank_since?.net} من ${claudeAccount?.bank_since?.count} حركة`,
  )
} finally {
  await browser.close()
  vite.kill()
  restoreEnv()
  await client.close()
  await fake.stop()
}

console.log(failures === 0 ? '\n✅ الشاشة وكلود يقولان نفس الأرقام' : `\n❌ ${failures} تناقض بين السطحين`)
process.exit(failures === 0 ? 0 : 1)
