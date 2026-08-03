/**
 * فحص خادم MCP.
 * التشغيل: node scripts/check-mcp.mjs   (بعد `npm run build:mcp`)
 *
 * أربع مراحل:
 * 1. الأدوات المعلنة — لكلٍّ وصف وتوصيف، وأشكالها تتحوّل إلى JSON Schema.
 * 2. وضع القراءة فقط لا يسرّب أداة كتابة.
 * 3. تجربة كاملة على Supabase مزيّف في الذاكرة: السبع عشرة أداة كلها،
 *    بأرقام محسوبة يدوياً تُقارَن بما يردّه الخادم.
 * 4. نداء قراءة على الحساب الحقيقي إن وُجد SANAWI_EMAIL و SANAWI_PASSWORD
 *    في .env — ويُتخطّى بلا فشل إن لم يوجدا.
 *
 * المرحلة الثالثة هي جوهر الفحص: تعمل في أي مكان بلا حساب ولا شبكة، فلا يبقى
 * الخادم بلا شبكة أمان على جهاز مساهم جديد ولا في CI. ولا تمسّ بياناتك:
 * القاعدة المزيّفة تعيش في الذاكرة وتموت مع العملية.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startFakeSupabase } from './fake-supabase.mjs'

const root = new URL('../', import.meta.url)
const entry = fileURLToPath(new URL('mcp/dist/mcp/index.js', root))

if (!existsSync(entry)) {
  console.error('لم يُبنَ الخادم بعد. شغّل: npm run build:mcp')
  process.exit(1)
}

const envPath = fileURLToPath(new URL('.env', root))
const env = existsSync(envPath)
  ? Object.fromEntries(
      readFileSync(envPath, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
  : {}

const hasAccount = Boolean(env.SANAWI_EMAIL && env.SANAWI_PASSWORD)

/*
 * قيم بديلة حين لا يوجد .env: الدخول كسول لا يقع إلا عند أول نداء أداة،
 * فالخادم يقلع ويعلن أدواته بقيمٍ وهمية. هذا يجعل الفحص البنيوي ممكناً على
 * أي جهاز — وفي CI — بلا حساب حقيقي.
 */
const PLACEHOLDER = {
  SANAWI_SUPABASE_URL: 'https://example.supabase.co',
  SANAWI_SUPABASE_ANON_KEY: 'anon',
  SANAWI_EMAIL: 'check@example.com',
  SANAWI_PASSWORD: 'check',
}

let failed = false
const fail = (message) => {
  console.error(`✗ ${message}`)
  failed = true
}

async function connect(extraEnv) {
  const client = new Client({ name: 'sanawi-check', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: { ...PLACEHOLDER, ...process.env, ...env, ...extraEnv },
      stderr: 'pipe',
    }),
  )
  return client
}

/* ── 1. الأدوات المعلنة ───────────────────────────────────── */

const full = await connect({ SANAWI_READ_ONLY: '0' })
const { tools } = await full.listTools()

console.log(`الخادم يعلن ${tools.length} أداة:\n`)
for (const tool of tools) {
  console.log(`  ${tool.name}${tool.annotations?.readOnlyHint ? '' : '  ← كتابة'}`)
}

for (const tool of tools) {
  if (!tool.description) fail(`${tool.name} بلا وصف — النموذج لن يعرف متى يستعملها.`)
  if (!tool.annotations) fail(`${tool.name} بلا annotations.`)
}

/* ── 2. وضع القراءة فقط يخفي الكتابة فعلاً ────────────────── */

const readOnly = await connect({ SANAWI_READ_ONLY: '1' })
const leaked = (await readOnly.listTools()).tools.filter(
  (t) => t.annotations?.readOnlyHint !== true,
)

if (leaked.length > 0) {
  fail(`وضع القراءة فقط سرّب أدوات كتابة: ${leaked.map((t) => t.name).join('، ')}`)
} else {
  console.log('\n✓ وضع القراءة فقط: لا أداة كتابة مسجّلة.')
}

/* ── 3. المخرجات تطابق أشكالها ────────────────────────────── */

const { z } = await import('zod')
const { obligationOut, calendarMonthOut, billRowOut, toObligationOut, toCalendarMonthOut, toBillRowOut } =
  await import(new URL('mcp/dist/mcp/schemas.js', root).href)
const { calculateObligation } = await import(
  new URL('mcp/dist/src/lib/obligations/calc.js', root).href
)

const obligation = {
  id: '00000000-0000-4000-8000-000000000001',
  user_id: '00000000-0000-4000-8000-000000000002',
  group_id: null,
  name: 'تأمين السيارة',
  category: 'car',
  total_amount: 6000,
  next_due_date: '2027-01-01',
  recurrence_months: 12,
  cycle_start_date: '2026-01-01',
  baseline_installment: 500,
  my_share_percent: 100,
  is_active: true,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
}

const view = {
  obligation,
  balance: null,
  calc: calculateObligation({
    totalAmount: 6000,
    mySharePercent: 100,
    myFundBalance: 1500,
    nextDueDate: '2027-01-01',
    recurrenceMonths: 12,
    cycleStartDate: '2026-01-01',
    baselineInstallment: 500,
  }),
}

const cases = [
  ['obligation', z.object(obligationOut), toObligationOut(view)],
  [
    'calendar_month',
    z.object(calendarMonthOut),
    toCalendarMonthOut({ month: new Date(2026, 0, 1), dues: [], total: 0, myTotal: 0, isHeavy: false }),
  ],
  [
    'bill_row',
    z.object(billRowOut),
    toBillRowOut(
      { id: 'c1', user_id: 'u', name: 'كهرباء', amount: 300, day_of_month: null, is_active: true, created_at: '' },
      undefined,
      undefined,
    ),
  ],
]

for (const [name, schema, value] of cases) {
  const result = schema.safeParse(value)
  if (!result.success) fail(`مخرجات ${name} لا تطابق شكلها: ${result.error.issues[0]?.message}`)
}
if (!failed) console.log('✓ المخرجات تطابق أشكالها المعلنة.')

/* ── 4. تجربة كاملة على Supabase مزيّف ────────────────────── */

console.log('\n── تجربة كاملة على قاعدة مزيّفة في الذاكرة ──\n')

const fake = await startFakeSupabase()
const app = await connect({
  SANAWI_SUPABASE_URL: fake.url,
  SANAWI_SUPABASE_ANON_KEY: fake.anonKey,
  SANAWI_EMAIL: fake.email,
  SANAWI_PASSWORD: fake.password,
  SANAWI_READ_ONLY: '0',
})

/** ينادي أداة ويفشل الفحص إن ردّت خطأً. يعيد البيانات المنظّمة. */
async function call(name, args = {}) {
  const result = await app.callTool({ name, arguments: args })
  const text = result.content?.[0]?.text ?? ''
  if (result.isError) {
    fail(`${name}: ${text}`)
    return null
  }
  if (!result.structuredContent) fail(`${name}: ردّ بلا بيانات منظّمة`)
  return result.structuredContent ?? null
}

/** ينادي أداة ويتوقّع خطأً يذكر كذا — رسائل الأخطاء جزء من الواجهة. */
async function expectError(name, args, needle) {
  const result = await app.callTool({ name, arguments: args })
  const text = result.content?.[0]?.text ?? ''
  if (!result.isError) return fail(`${name}: كان يجب أن يفشل على ${JSON.stringify(args)}`)
  if (!text.includes(needle)) fail(`${name}: الرسالة لا تذكر «${needle}» — وصلت: ${text}`)
}

function expect(label, actual, wanted) {
  if (actual !== wanted) fail(`${label}: توقّعنا ${wanted} ووصل ${actual}`)
}

/* تواريخ نسبية: اليوم الخامس عشر من شهرٍ بعينه، فيبقى فرق الشهور التقويمية
   ثابتاً مهما كان تاريخ تشغيل الفحص. */
const monthDay = (day) => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const inMonths = (n) => {
  const d = new Date()
  const m = new Date(d.getFullYear(), d.getMonth() + n, 15)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-15`
}

// ١. الدخل والبنود الثابتة
const income = await call('sanawi_add_income', { name: 'راتب', amount: 12000 })
expect('الدخل الشهري', income?.monthly_equivalent, 12000)

const weekly = await call('sanawi_add_income', { name: 'عمل إضافي', amount: 300, frequency: 'weekly' })
// ‏300 × 52 ÷ 12 = 1300 — لا 1200. المعامل الخطأ يضيع أربعة رواتب في السنة.
expect('تحويل الأسبوعي إلى شهري', weekly?.monthly_equivalent, 1300)

await call('sanawi_add_fixed_commitment', { name: 'كهرباء', amount: 300, day_of_month: 10 })

// ٢. التزامان: واحد بدورة كاملة وآخر بدورة مضغوطة
const car = await call('sanawi_create_obligation', {
  name: 'تأمين السيارة',
  total_amount: 6000,
  next_due_date: inMonths(12),
  category: 'car',
})
expect('قسط دورة كاملة', car?.obligation.monthly_installment, 500)
expect('وضع الجسر مطفأ', car?.obligation.is_bridge, false)

const dentist = await call('sanawi_create_obligation', {
  name: 'طبيب أسنان',
  total_amount: 1200,
  next_due_date: inMonths(2),
  category: 'health',
})
// شهران للموعد: 1200 ÷ 2 = 600، بينما القسط الطبيعي 1200 ÷ 12 = 100.
expect('قسط الدورة المضغوطة', dentist?.obligation.monthly_installment, 600)
expect('القسط الطبيعي', dentist?.obligation.normal_installment, 100)
expect('وضع الجسر مشتعل', dentist?.obligation.is_bridge, true)

// الاسم الغامض لا يُخمَّن: «ا» تقع في الاسمين معاً، فتُردّ قائمة المرشّحين.
// هذا أهم سلوك في البحث بالاسم: الإيداع في الصندوق الخطأ خطأ صامت.
await expectError('sanawi_add_deposit', { obligation: 'ا', amount: 10 }, 'يطابق أكثر من التزام')

// ٣. القوائم ومرشّحاتها
expect('عدد الالتزامات', (await call('sanawi_list_obligations'))?.count, 2)
expect(
  'مرشّح وضع الجسر',
  (await call('sanawi_list_obligations', { status: 'bridge' }))?.obligations[0]?.name,
  'طبيب أسنان',
)

// ٤. الإيداع — بالاسم لا بالمعرّف
const afterMine = await call('sanawi_add_deposit', { obligation: 'تأمين السيارة', amount: 1500 })
expect('الرصيد بعد إيداعي', afterMine?.obligation.my_fund_balance, 1500)
// ‏(6000 − 1500) ÷ 12 = 375
expect('القسط بعد الإيداع', afterMine?.obligation.monthly_installment, 375)

// شريك بلا حصة على الالتزام يُرفض: إيداعه كان يدخل الصندوق بلا أن يُنسب لأحد.
await expectError(
  'sanawi_add_deposit',
  { obligation: 'تأمين السيارة', amount: 500, partner_name: 'أبو أحمد' },
  'ليس شريكاً في هذا الالتزام',
)

// نضبط الحصص كما تفعل شاشة الالتزام في التطبيق، ثم يُقبل الإيداع باسمه.
const carId = afterMine.obligation.id
const partnerId = '00000000-0000-4000-8000-0000000000aa'
fake.db.obligation_partners.push({
  id: partnerId,
  user_id: fake.userId,
  name: 'أبو أحمد',
  color: null,
  created_at: '',
})
fake.db.obligation_partner_shares.push({
  id: '00000000-0000-4000-8000-0000000000bb',
  user_id: fake.userId,
  obligation_id: carId,
  partner_id: partnerId,
  share_percent: 40,
})

const afterPartner = await call('sanawi_add_deposit', {
  obligation: 'تأمين السيارة',
  amount: 500,
  partner_name: 'أبو أحمد',
})
expect('رصيد الصندوق كله', afterPartner?.obligation.fund_balance, 2000)
// إيداع الشريك لا يخصم من قسطي أنا: حصتي 100٪ وما أودعه هو لا يُحسب لي.
expect('رصيدي أنا وحدي', afterPartner?.obligation.my_fund_balance, 1500)
expect('قسطي لم يتغيّر', afterPartner?.obligation.monthly_installment, 375)

const detail = await call('sanawi_get_obligation', { obligation: 'تأمين السيارة' })
expect('عدد الحركات', detail?.deposits.length, 2)
// التسوية تظهر لأن للشريك حصة: عليه 40٪ من 6000 = 2400، دفع 500، باقٍ 1900.
expect('عدد التسويات', detail?.settlements.length, 1)
expect('على الشريك', detail?.settlements[0]?.owed, 2400)
expect('باقٍ على الشريك', detail?.settlements[0]?.outstanding, 1900)

// ٥. رقم الشهر — اللوحة الموحّدة، نفس محرّك الشاشة
const month = await call('sanawi_month_overview')
// لا دخل فعليّ مسجَّل بعد، فالرقم المعتمد هو المقدَّر: 12000 + 300×52÷12.
expect('الدخل المعتمد', month?.income, 13300)
expect('الدخل تقدير لا واقع', month?.income_is_actual, false)
expect('هدف الادخار', month?.savings_target, 500)
expect('مجموع الأقساط', month?.obligation_installments, 975) // ‏375 + 600
expect('فواتير متكرّرة', month?.recurring_bills, 300)
expect('أقساط تنتهي', month?.installments, 0)
expect('التقدير الثابت', month?.available_to_spend, 11525)
// ‏13300 − (975 + 300 + 0 + 500) = 11525، ولا مصاريف يومية بعد.
expect('الباقي فعلاً', month?.remaining, 11525)
expect('لا تجاوز', month?.is_overspent, false)

// دخلٌ فعليّ يقلب الرقم من تقدير إلى واقع.
fake.db.income_entries.push({
  id: '00000000-0000-4000-8000-0000000000cc',
  user_id: fake.userId,
  source_id: null,
  amount: 9000,
  received_at: monthDay(3),
  note: null,
  created_at: '',
})
const actual = await call('sanawi_month_overview')
expect('الدخل صار واقعاً', actual?.income_is_actual, true)
expect('الدخل الواصل', actual?.income, 9000)
expect('الفجوة عن المعتاد', actual?.income_gap, -4300)
expect('الباقي بعد الواقع', actual?.remaining, 7225)

// ٦. التقويم
const calendar = await call('sanawi_calendar', { months: 12 })
expect('طول النافذة', calendar?.months.length, 12)
if (!calendar?.months.some((m) => m.dues.some((d) => d.name === 'طبيب أسنان'))) {
  fail('التقويم لا يعرض استحقاق طبيب الأسنان داخل النافذة')
}

// ٧. المصروف وتكلفة البند الحقيقية
await call('sanawi_add_expense', { amount: 400, category: 'car', note: 'بنزين' })
const cost = await call('sanawi_group_cost', { category: 'car' })
expect('التزامات السنة', cost?.obligations_yearly, 6000)
expect('مصاريف السنة', cost?.expenses_yearly, 400)
expect('المجموع السنوي', cost?.total_yearly, 6400)
expect('المجموع الشهري', cost?.total_monthly, 533.33)

// ٨. الفواتير
const bill = await call('sanawi_save_bill', {
  commitment: 'كهرباء',
  amount: 320,
  note: 'شهر حار',
})
expect('المقدَّر', bill?.budgeted, 300)

// إعادة النداء تصحيحُ مبلغ لا فاتورةٌ ثانية، ولا تمحو الملاحظة ولا حالة الدفع.
const corrected = await call('sanawi_save_bill', { commitment: 'كهرباء', amount: 345 })
expect('المبلغ بعد التصحيح', corrected?.amount, 345)
expect('بقيت مدفوعة', corrected?.paid, true)
expect('عدد صفوف الفواتير', fake.db.bill_payments.length, 1)
expect('الملاحظة لم تُمحَ', fake.db.bill_payments[0]?.note, 'شهر حار')
const bills = await call('sanawi_list_bills')
expect('عدد البنود', bills?.bills.length, 1)
expect('المسجّل', bills?.summary.recorded, 345)
expect('المدفوع', bills?.summary.paid, 345)
expect('غير المسجّل', bills?.summary.missing, 0)

// ٩. القوائم المرجعية
expect('القوالب', (await call('sanawi_list_reference', { kind: 'templates' }))?.items.length, 2)
expect('الشركاء', (await call('sanawi_list_reference', { kind: 'partners' }))?.items.length, 1)
expect('المجموعات', (await call('sanawi_list_reference', { kind: 'groups' }))?.items.length, 0)
expect('مصادر الدخل', (await call('sanawi_list_reference', { kind: 'money' }))?.incomes.length, 2)

// ١٠. المحاكي
const projection = await call('sanawi_simulate_savings', { monthly_amount: 1000, years: 10 })
expect('ما أُودع فعلاً', projection?.total_deposited, 120000)
if (!(projection?.future_value > projection?.total_deposited)) {
  fail('المحاكي لا يُظهر نمواً بعائد 7٪')
}

// ١١. التعديل
const updated = await call('sanawi_update_obligation', {
  obligation: 'تأمين السيارة',
  total_amount: 7200,
})
// ‏(7200 − 1500) ÷ 12 = 475
expect('القسط بعد رفع المبلغ', updated?.obligation.monthly_installment, 475)

// ١٢. الدفع والتجديد
const paid = await call('sanawi_mark_paid', { obligation: 'طبيب أسنان' })
expect('ما خرج من الصندوق', paid?.amount_paid, 0)
expect('النقص المكشوف', paid?.shortfall, 1200)
expect('القسط بعد التجديد', paid?.new_installment, 100)
expect('لم ينتهِ', paid?.is_finished, false)

// ١٣. المصروف بحرف كبير: المطابقة تتجاهل حالة الأحرف في الجانبين معاً
await call('sanawi_add_expense', { amount: 100, category: 'CAR', note: 'غيار زيت' })
expect(
  'مصروف بحالة أحرف مختلفة يُحتسب',
  (await call('sanawi_group_cost', { category: 'car' }))?.expenses_yearly,
  500,
)

// ١٤. الأرشفة — ونداءٌ ثانٍ لا يفشل لأن الأداة معلَنة idempotent
await call('sanawi_archive_obligation', { obligation: 'تأمين السيارة' })
expect(
  'الأرشفة مرة ثانية لا تفشل',
  (await call('sanawi_archive_obligation', { obligation: 'تأمين السيارة' }))?.archived,
  true,
)
expect('بقي التزام واحد نشط', (await call('sanawi_list_obligations'))?.count, 1)
// الأرشفة لا تحذف: الإيداعات باقية.
expect('الإيداعات لم تُمسّ', fake.db.fund_deposits.length, 2)

// ١٥. الأخطاء تُرشد لا تُبهم
await expectError('sanawi_get_obligation', { obligation: 'التزام غير موجود' }, 'لا يوجد التزام')
await expectError('sanawi_add_deposit', { obligation: 'كهرباء', amount: 10 }, 'لا يوجد التزام')
await expectError('sanawi_group_cost', { category: 'car', group: 'x' }, 'واحداً منهما')
await expectError('sanawi_group_cost', {}, 'واحداً منهما')
await expectError('sanawi_create_obligation', {
  name: 'خطأ',
  total_amount: 100,
  next_due_date: '15/03/2027',
}, 'YYYY-MM-DD')
await expectError('sanawi_save_bill', { commitment: 'غاز', amount: 10 }, 'لا بند ثابت')
// حصة أقل من 100٪ تعني شركاء، وحصصهم لا تُكتب من هنا — فلا نترك المجموع ناقصاً.
await expectError(
  'sanawi_create_obligation',
  { name: 'مشترك', total_amount: 1000, next_due_date: inMonths(6), my_share_percent: 50 },
  'وجود شركاء',
)
await expectError('sanawi_update_obligation', { obligation: 'طبيب أسنان' }, 'لا حقل للتعديل')

// أخطاء القاعدة نفسها: يجب أن تصل مترجَمةً لا «[object Object]».
// supabase-js يعيد كائناً عادياً لا صنف Error، فاشتراط instanceof كان يبتلعها.
fake.failNext({ status: 403, code: '42501', message: 'new row violates row-level security policy' })
await expectError('sanawi_list_obligations', {}, 'RLS')

fake.failNext({
  status: 400,
  code: '23514',
  message: 'new row for relation "fund_deposits" violates check constraint',
})
await expectError('sanawi_add_deposit', { obligation: 'طبيب أسنان', amount: 5 }, 'مرفوضة من قاعدة البيانات')

fake.failNext({ status: 401, code: 'PGRST301', message: 'JWT expired' })
await expectError('sanawi_month_overview', {}, 'انتهت صلاحية الجلسة')

await app.close()
await fake.stop()

if (!failed) console.log('✓ السبع عشرة أداة كلها تعمل، والأرقام تطابق الحساب اليدوي.')

/* ── 5. النقل البعيد: HTTP بالمفتاح ───────────────────────── */

console.log('\n── النقل البعيد (HTTP) ──\n')
{
  const { createServer } = await import('node:http')
  const { createFetchHandler } = await import(new URL('mcp/dist/mcp/http.js', root).href)
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  )

  const remoteFake = await startFakeSupabase()
  const config = {
    url: remoteFake.url,
    anonKey: remoteFake.anonKey,
    email: remoteFake.email,
    password: remoteFake.password,
    readOnly: false,
  }
  const { createSession } = await import(new URL('mcp/dist/mcp/session.js', root).href)
  const TOKEN = 'token-for-the-check-only'
  const handler = createFetchHandler({ config, connect: createSession(config), token: TOKEN })

  // جسر من خادم Node إلى معالِج fetch — نفس المعالِج الذي يعمل على Deno.
  const bridge = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: body.length > 0 ? body : undefined,
    })
    const response = await handler(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  })
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${bridge.address().port}`

  // بلا مفتاح: يُرفض قبل أن يلمس القاعدة.
  const denied = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  expect('الرابط بلا مفتاح يُرفض', denied.status, 401)

  const wrong = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer not-the-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  expect('مفتاح خاطئ يُرفض', wrong.status, 401)

  // فحص الحياة مسموح بلا مفتاح ولا يكشف بيانات.
  const health = await fetch(`${base}/mcp`)
  expect('فحص الحياة', health.status, 200)

  // المفتاح في آخر المسار — الشكل الذي يعمل مع عميلٍ لا يقبل إلا رابطاً.
  const viaPath = await fetch(`${base}/mcp/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  expect('المفتاح في المسار يُقبل', viaPath.status, 200)

  // ثم عميل MCP حقيقي عبر النقل الرسمي.
  const remote = new Client({ name: 'sanawi-check-http', version: '1.0.0' })
  await remote.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    }),
  )

  const remoteTools = (await remote.listTools()).tools
  expect('عدد الأدوات عبر HTTP', remoteTools.length, tools.length)

  await remote.callTool({ name: 'sanawi_add_income', arguments: { name: 'راتب', amount: 9000 } })
  const overview = await remote.callTool({ name: 'sanawi_month_overview', arguments: {} })
  if (overview.isError) fail(`HTTP: ${overview.content?.[0]?.text}`)
  expect('الدخل عبر HTTP', overview.structuredContent?.income, 9000)

  // القراءة والكتابة تتعاقبان على نفس الحساب رغم أن كل رسالة خادمٌ جديد.
  await remote.callTool({
    name: 'sanawi_create_obligation',
    arguments: { name: 'تأمين', total_amount: 1200, next_due_date: inMonths(12) },
  })
  const listed = await remote.callTool({ name: 'sanawi_list_obligations', arguments: {} })
  expect('الحالة محفوظة بين النداءات', listed.structuredContent?.count, 1)

  await remote.close()
  await new Promise((r) => bridge.close(r))
  await remoteFake.stop()

  if (!failed) console.log('✓ النقل البعيد يعمل، والمفتاح يحرس الرابط فعلاً.')
}

/* ── 6. نداء حقيقي، إن وُجد حساب ──────────────────────────── */

if (hasAccount) {
  console.log('\nنداء sanawi_month_overview على الحساب الحقيقي…')
  const result = await readOnly.callTool({ name: 'sanawi_month_overview', arguments: {} })
  if (result.isError) {
    fail(result.content?.[0]?.text ?? 'نداء فاشل بلا رسالة')
  } else {
    console.log(result.content?.[0]?.text ?? '')
    console.log(
      `\n✓ الرد وصل ومعه ${Object.keys(result.structuredContent ?? {}).length} حقلاً منظّماً.`,
    )
  }
} else {
  console.log('\nبلا SANAWI_EMAIL و SANAWI_PASSWORD في .env — تُخطّى نداءات الحساب الحقيقي.')
}

await Promise.all([full.close(), readOnly.close()])
process.exit(failed ? 1 : 0)
