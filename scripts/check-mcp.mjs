/**
 * فحص خادم MCP.
 * التشغيل: node scripts/check-mcp.mjs   (بعد `npm run build:mcp`)
 *
 * أربع مراحل:
 * 1. الأدوات المعلنة — لكلٍّ وصف وتوصيف، وأشكالها تتحوّل إلى JSON Schema.
 * 2. وضع القراءة فقط لا يسرّب أداة كتابة.
 * 3. تجربة كاملة على Supabase مزيّف في الذاكرة: كل أداة معلَنة تُستدعى فعلاً،
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

const monthsAgo = (n) => {
  const d = new Date()
  const m = new Date(d.getFullYear(), d.getMonth() - n, 1)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`
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

// دخلٌ فعليّ يقلب الرقم من تقدير إلى واقع — بالأداة لا بصفٍّ مدسوس.
const received = await call('sanawi_record_income', {
  amount: 9000,
  source: 'راتب',
  received_at: monthDay(3),
})
expect('المبلغ كما سُجّل', received?.amount, 9000)
expect('ورُبط بالمصدر المعرَّف', received?.source_name, 'راتب')
expect('ومجموع الشهر', received?.month_total, 9000)

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

// ١٠ب. الثروة: أصول، صافي ثروة، رقم حرية، ترتيب سداد.
//
// الأصول صفر قبل هذا القسم، وهذا هو الفحص الأول: تطبيقٌ بلا أصولٍ مسجّلة
// يجب أن يقول «صافي ثروتك سالب بمقدار ديونك» لا أن ينهار ولا أن يخترع رقماً.
const emptyNet = await call('sanawi_net_worth')
expect('بلا أصول: الأصول صفر', emptyNet?.assets_total, 0)
if (!(emptyNet?.restricted_total > 0)) {
  fail('صناديق الالتزامات لم تُحتسب ملكاً')
}

const cash = await call('sanawi_save_asset', {
  name: 'كاش بالبنك',
  amount: 20000,
  kind: 'cash',
  is_emergency_fund: true,
})
expect('الأصل أُنشئ', cash?.created, true)
expect('ومعلَّم صندوقَ طوارئ', cash?.asset.is_emergency_fund, true)

// الاسم نفسه يحدّث ولا يكرّر — وإلا صار كل «الكاش صار كذا» أصلاً جديداً.
const cashAgain = await call('sanawi_save_asset', { name: 'كاش بالبنك', amount: 25000 })
expect('الاسم نفسه يحدّث لا ينشئ', cashAgain?.created, false)
expect('والقيمة الجديدة محفوظة', cashAgain?.asset.amount, 25000)
expect('ولم يتكرّر الصف', fake.db.assets.length, 1)
// تحديث المبلغ وحده لا يمحو ما لم يُرسَل — وإلا سقطت علامة صندوق الطوارئ صامتةً.
expect('والعلامة نجت من التحديث', cashAgain?.asset.is_emergency_fund, true)

// صندوق طوارئ غير سائل تناقض: العلامة تُهمَل ولا تُحفظ.
const flat = await call('sanawi_save_asset', {
  name: 'شقة',
  amount: 400000,
  kind: 'property',
  is_liquid: false,
  is_emergency_fund: true,
})
expect('صندوق طوارئ غير سائل لا يُقبل', flat?.asset.is_emergency_fund, false)

const net = await call('sanawi_net_worth')
expect('مجموع الأصول', net?.assets_total, 425000)
expect('السائل يستثني العقار', net?.liquid_total, 25000)
expect('صندوق الطوارئ هو السائل المُعلَّم', net?.emergency_fund.current, 25000)
if (!(net?.net_worth > 425000)) {
  fail('صافي الثروة لا يضمّ صناديق الالتزامات')
}
if (net?.is_underwater !== false) fail('حُسب غارقاً وهو ليس كذلك')

const freedom = await call('sanawi_freedom_number')
if (!(freedom?.target > 0)) fail('رقم الحرية صفر مع وجود مصروف')
if (freedom?.is_free !== false) fail('قال إنه حرّ ماليّاً بـ 425 ألفاً')
if (!(freedom?.real_return_percent < 7)) {
  fail('العائد الحقيقي لم يُخصَم منه التضخّم')
}
// كل حقلٍ عددي يجب أن يكون رقماً حقيقياً: NaN يعبر JSON كـ null ويبدو غياباً.
for (const [key, value] of Object.entries(freedom ?? {})) {
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`حقل فاسد في رقم الحرية: ${key}`)
}

// ترتيب السداد يحتاج ديوناً بفائدتين مختلفتين، وإضافتها ترفع الحمل الشهري
// فتُزحزح أرقاماً تتحقّق منها فحوصٌ لاحقة — لذلك مكانها آخر التجربة لا هنا.

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

// مصدرٌ غير معرَّف يبقى تسميةً حرّة: دخلٌ عابر لا يستحقّ مصدراً دائماً.
const oneOff = await call('sanawi_record_income', { amount: 400, source: 'عيدية' })
expect('التسمية الحرّة تُحفظ', oneOff?.source_name, 'عيدية')
expect('والمجموع يضمّها', oneOff?.month_total, 9400)
expect('ولم يُنشأ مصدر دائم', (await call('sanawi_list_reference', { kind: 'money' }))?.incomes.length, 2)

/* ─── الشركاء ─── */

const shared = await call('sanawi_create_obligation', {
  name: 'تأمين مشترك',
  total_amount: 6000,
  next_due_date: inMonths(12),
})

// حصّة ناقصة بلا شركاء تُرفض: مجموعٌ مختلّ يحبس الالتزام عن التعديل من الشاشة.
await expectError(
  'sanawi_update_obligation',
  { obligation: 'تأمين مشترك', my_share_percent: 50 },
  'sanawi_set_partners',
)

const partners = await call('sanawi_set_partners', {
  obligation: 'تأمين مشترك',
  partners: [
    { name: 'أخوي', share_percent: 40 },
    { name: 'أبوي', share_percent: 10 },
  ],
})
expect('حصّتي تُشتقّ من الباقي', partners?.my_share_percent, 50)
expect('وحصّتي بالشيكل', partners?.my_total, 3000)
expect('وما على الأول', partners?.partners?.[0]?.owed, 2400)
expect('وما على الثاني', partners?.partners?.[1]?.owed, 600)

// القسط يتبع حصّتي لا المبلغ الكامل — وإلا ادّخر المستخدم ضعف ما عليه.
const sharedRow = (await call('sanawi_list_obligations'))?.obligations?.find(
  (o) => o.name === 'تأمين مشترك',
)
expect('القسط على حصّتي وحدها', sharedRow?.my_total, 3000)

// مجموع يتجاوز 100 يُرفض قبل أن يلمس القاعدة.
await expectError(
  'sanawi_set_partners',
  { obligation: 'تأمين مشترك', partners: [{ name: 'س', share_percent: 70 }, { name: 'ص', share_percent: 40 }] },
  '110',
)
await expectError(
  'sanawi_set_partners',
  { obligation: 'تأمين مشترك', partners: [{ name: 'أخوي', share_percent: 20 }, { name: 'أخوي', share_percent: 30 }] },
  'مرتين',
)

/*
 * الاستبدال كامل: من غاب عن القائمة رُفع.
 *
 * القراءة من القاعدة لا من ردّ الأداة: الردّ مبنيٌّ على المدخلات، فيقول ما
 * طُلب منه لا ما حُفظ. جُرِّب بتعطيل الحذف فمرّ الفحص وهو لا يفحص شيئاً —
 * حصص قديمة باقية والمجموع يتجاوز 100٪ بلا أن ينبس أحد.
 */
const rewritten = await call('sanawi_set_partners', {
  obligation: 'تأمين مشترك',
  partners: [{ name: 'أخوي', share_percent: 25 }],
})
expect('وحصّتي أُعيد اشتقاقها', rewritten?.my_share_percent, 75)

const stored = await call('sanawi_get_obligation', { obligation: 'تأمين مشترك' })
expect('المحفوظ فعلاً: شريك واحد', stored?.settlements?.length, 1)
expect('وحصّته المحفوظة', stored?.settlements?.[0]?.share_percent, 25)
expect('وما عليه', stored?.settlements?.[0]?.owed, 1500)

// الشريك يُعاد استعماله بالاسم لا يتضاعف مع كل ضبط.
const reference = await call('sanawi_list_reference', { kind: 'partners' })
expect('«أخوي» واحد لا اثنان', reference?.items?.filter((p) => p.name === 'أخوي').length, 1)

// وقائمة فارغة تعيد الالتزام كلّه إليّ.
const solo = await call('sanawi_set_partners', { obligation: 'تأمين مشترك', partners: [] })
expect('بلا شركاء: الكل عليّ', solo?.my_share_percent, 100)
expect('وحصّتي كامل المبلغ', solo?.my_total, 6000)
expect(
  'ولا صفّ حصّة باقٍ',
  (await call('sanawi_get_obligation', { obligation: 'تأمين مشترك' }))?.settlements?.length,
  0,
)

await call('sanawi_archive_obligation', { obligation: 'تأمين مشترك' })

/* ─── الأقساط: بندٌ ينتهي ─── */

// قسط ٦ دفعات بـ400: يُحمَّل على الشهر الآن، ويُرفع عنه حين ينتهي.
const loan = await call('sanawi_add_fixed_commitment', {
  name: 'قسط تلفون',
  amount: 400,
  installments: 6,
  total_amount: 2400,
})
expect('الدفعات المتبقية', loan?.payments_left, 6)
expect('ومجموع ما بقي', loan?.remaining_total, 2400)
expect('وسعر الشراء محفوظ للسياق', loan?.total_amount, 2400)

// آخر دفعة بعد خمسة شهور لا ستة: العدّ يشمل دفعة هذا الشهر.
const fifthMonth = new Date()
fifthMonth.setMonth(fifthMonth.getMonth() + 5)
expect(
  'آخر دفعة تشمل شهر البدء',
  loan?.ends_on?.slice(0, 7),
  `${fifthMonth.getFullYear()}-${String(fifthMonth.getMonth() + 1).padStart(2, '0')}`,
)

/*
 * الفصل بين «متكرّر» و«ينتهي» هو ما تقوم عليه بشرى المديون.
 * القسط لا يدخل recurring_bills، ولوحة الشهر تقول متى ينخفض الحمل وبكم.
 */
const withLoan = await call('sanawi_month_overview')
expect('القسط في خانته لا في الفواتير', withLoan?.installments, 400)
expect('والفواتير الدائمة لم تتأثّر', withLoan?.recurring_bills, 300)
expect('وموعد الانفراج', withLoan?.next_relief?.months_away, 6)
expect('وقيمته', withLoan?.next_relief?.amount, 400)

// وقائمة الفواتير تحمل حالة القسط لا مبلغه وحده.
const loanRow = (await call('sanawi_list_bills'))?.bills?.find((b) => b.name === 'قسط تلفون')
expect('القائمة تعرف أنه قسط', loanRow?.payments_left, 6)
expect('والباقي عليه', loanRow?.remaining_total, 2400)

// والبند الدائم يبقى بلا نهاية — لا يُحسب قسطاً بالخطأ.
const perpetual = (await call('sanawi_list_bills'))?.bills?.find((b) => b.name === 'كهرباء')
expect('الدائم بلا نهاية', perpetual?.ends_on, null)
expect('وبلا عدّ دفعات', perpetual?.payments_left, null)

// قسطٌ انتهى لا يُحمَّل: بقيت له صفر دفعة، فيخرج من الحمل الشهري.
await call('sanawi_add_fixed_commitment', {
  name: 'قسط منتهٍ',
  amount: 900,
  ends_on: monthsAgo(3),
})
expect('المنتهي لا يُحمَّل', (await call('sanawi_month_overview'))?.installments, 400)

await expectError(
  'sanawi_add_fixed_commitment',
  { name: 'ملتبس', amount: 100, installments: 5, ends_on: inMonths(5) },
  'اختر أحدهما',
)

/* ─── شركاء البنود الشهرية ─── */

// الحمل الشهري يُحسب على حصّتي — لا على المبلغ الكامل.
const loadBefore = (await call('sanawi_month_overview'))?.recurring_bills
const netShare = await call('sanawi_set_commitment_partners', {
  commitment: 'كهرباء',
  partners: [{ name: 'أخوي', share_percent: 50 }],
})
expect('حصّتي في البند', netShare?.my_share_percent, 50)
expect('وبالمبلغ', netShare?.my_amount, 150)
expect('وما على الشريك', netShare?.partners?.[0]?.owed, 150)

const loadAfter = (await call('sanawi_month_overview'))?.recurring_bills
expect('الحمل الشهري تبع حصّتي', loadAfter, loadBefore - 150)

// الشريك مشترك بين الالتزامات والبنود — لا يتكرّر.
expect(
  '«أخوي» لم يتضاعف',
  (await call('sanawi_list_reference', { kind: 'partners' }))?.items?.filter(
    (p) => p.name === 'أخوي',
  ).length,
  1,
)

await expectError(
  'sanawi_set_commitment_partners',
  { commitment: 'كهرباء', partners: [{ name: 'س', share_percent: 60 }, { name: 'ص', share_percent: 50 }] },
  '110',
)
await expectError('sanawi_set_commitment_partners', { commitment: 'لا يوجد', partners: [] }, 'لا بند شهري')

const backToMe = await call('sanawi_set_commitment_partners', { commitment: 'كهرباء', partners: [] })
expect('العودة إلى الكل عليّ', backToMe?.my_share_percent, 100)
expect('والحمل يعود كاملاً', (await call('sanawi_month_overview'))?.recurring_bills, loadBefore)

/* ─── البيانات المرجعية ─── */

const categories = await call('sanawi_list_reference', { kind: 'categories' })
expect('التصنيفات تصل', categories?.items?.length, 2)
expect('باسمها', categories?.items?.[0]?.name, 'أكل')

const methods = await call('sanawi_list_reference', { kind: 'payment_methods' })
expect('طرق الدفع تصل', methods?.items?.length, 2)
expect('ويُعرف الأوتوماتيكي منها', methods?.items?.[1]?.is_automatic, true)

const commitmentTemplates = await call('sanawi_list_reference', { kind: 'commitment_templates' })
expect('قوالب البنود تصل', commitmentTemplates?.items?.length, 1)
expect('بحدّها الأدنى', commitmentTemplates?.items?.[0]?.suggested_min, 80)

/* ─── الإعدادات ─── */

// هدف الادخار يدخل حساب الباقي، فالفرق هو ما يجب أن يظهر — لا رقمٌ مطلق
// يتغيّر مع كل تعديل سابق في الفحص.
const remainingBefore = (await call('sanawi_month_overview'))?.remaining

const profile = await call('sanawi_update_profile', { monthly_savings_target: 800 })
expect('هدف الادخار تبدّل', profile?.monthly_savings_target, 800)
expect(
  'والباقي نقص بالفرق تماماً',
  (await call('sanawi_month_overview'))?.remaining,
  Math.round((remainingBefore - 300) * 100) / 100,
)

const renamed = await call('sanawi_update_profile', { display_name: 'أحمد' })
expect('الاسم تبدّل', renamed?.display_name, 'أحمد')
expect('والهدف لم يُمَسّ', renamed?.monthly_savings_target, 800)

await expectError('sanawi_update_profile', {}, 'لم تُرسَل')
await call('sanawi_update_profile', { monthly_savings_target: 500 })

/* ─── ترتيب سداد الديون ─── */

// آخر التجربة عمداً: الدَّينان أدناه يرفعان الحمل الشهري، وكل فحصٍ بعدهما
// كان سيقرأ رقماً أكبر ممّا يتوقّع.
const netBeforeDebts = await call('sanawi_net_worth')

await call('sanawi_add_fixed_commitment', {
  name: 'قرض غالي',
  amount: 400,
  installments: 24,
  annual_interest_percent: 18,
})
await call('sanawi_add_fixed_commitment', {
  name: 'قرض رخيص',
  amount: 300,
  installments: 12,
  annual_interest_percent: 3,
})

const payoff = await call('sanawi_debt_payoff', { extra_monthly: 200 })
expect('الديون وُجدت', payoff?.has_debts, true)
expect('ليست كلها بفائدة صفر', payoff?.all_zero_interest, false)

/*
 * الترتيب يُقاس بين الدَّينين المعروفين لا بموقعٍ مطلق في القائمة:
 * الفحص ينشئ ديوناً أخرى قبل هذا القسم، وتثبيت "الأول" يجعل الفحص يفشل
 * لأن فحصاً سابقاً أضاف صفّاً — لا لأن الترتيب انكسر.
 */
const rank = (plan, name) => plan.lines.findIndex((l) => l.name === name)
if (!(rank(payoff.avalanche, 'قرض غالي') < rank(payoff.avalanche, 'قرض رخيص'))) {
  fail('الانهيار لم يقدّم الأعلى فائدة')
}
if (!(rank(payoff.snowball, 'قرض رخيص') < rank(payoff.snowball, 'قرض غالي'))) {
  fail('كرة الثلج لم تقدّم الأصغر رصيداً')
}
expect('لا خطة مستحيلة', payoff?.avalanche.is_impossible, false)
if (!(payoff?.interest_saved >= 0)) {
  fail('الانهيار خسر أمام كرة الثلج في الفائدة')
}
if (payoff?.avalanche.months === null) fail('خطة الانهيار لا تنتهي')

// الفاتورة الدائمة ليست ديناً: «كهرباء» بلا نهاية يجب ألّا تدخل الخطة.
if (payoff?.avalanche.lines.some((l) => l.name === 'كهرباء')) {
  fail('فاتورة دائمة دخلت خطة سداد الديون')
}

// وصافي الثروة ينزل بمقدار الديون الجديدة بالضبط — لا بأقلّ ولا بأكثر.
const netAfterDebts = await call('sanawi_net_worth')
expect(
  'الدَّين الجديد نزل من صافي الثروة',
  Math.round((netBeforeDebts.net_worth - netAfterDebts.net_worth) * 100) / 100,
  400 * 24 + 300 * 12,
)

await app.close()
await fake.stop()

// العدد يُقرأ من الخادم لا يُكتب هنا: رقمٌ ثابت في نصٍّ ينحرف عند كل أداة
// جديدة، وقد انحرف مرّتين من قبل.
if (!failed) {
  console.log(`✓ الأدوات كلها (${tools.length}) تعمل، والأرقام تطابق الحساب اليدوي.`)
}

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

/* ── 6. OAuth: كل مستخدم بحسابه ───────────────────────────── */

console.log('\n── OAuth متعدّد المستخدمين ──\n')
{
  const { createServer } = await import('node:http')
  const { createFetchHandler } = await import(new URL('mcp/dist/mcp/http.js', root).href)
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  )
  const { createHash, randomBytes } = await import('node:crypto')

  const oauthFake = await startFakeSupabase()
  const SECRET = 'a-secret-long-enough-for-the-check-32+'
  const handler = createFetchHandler({
    config: {
      url: oauthFake.url,
      anonKey: oauthFake.anonKey,
      email: '',
      password: '',
      readOnly: false,
    },
    token: '',
    oauthSecret: SECRET,
    loginUrl: 'https://app.example/connect.html',
  })

  const bridge = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: body.length > 0 ? body : undefined,
      redirect: 'manual',
    })
    const response = await handler(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  })
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${bridge.address().port}`

  // ١. الاكتشاف: بلا رمز يجب أن يدلّ الردّ على خادم التفويض لا أن يسدّ الباب.
  const anonymous = await fetch(`${base}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  expect('بلا رمز يُرفض', anonymous.status, 401)
  const challengeHeader = anonymous.headers.get('www-authenticate') ?? ''
  if (!challengeHeader.includes('resource_metadata=')) {
    fail(`WWW-Authenticate بلا resource_metadata — كلود لن يعرف أين يسجّل الدخول: ${challengeHeader}`)
  }

  const rsMeta = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()
  const asUrl = rsMeta.authorization_servers?.[0]
  if (!asUrl) fail('بيانات المورد بلا خادم تفويض')
  const asMeta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (!asMeta[field]) fail(`بيانات خادم التفويض بلا ${field}`)
  }
  if (!asMeta.code_challenge_methods_supported?.includes('S256')) fail('S256 غير معلن')

  /*
   * الروابط المعلَنة خلف وكيل Supabase.
   *
   * وكيل Supabase يقصّ `/functions/v1` قبل أن يصل الدالّة، فتُعلن الدالّة
   * روابط ناقصة ويجد كلود 404 عند أول خطوة. حدث ذلك في أول نشر حقيقي.
   * هنا نحاكي الترويسات نفسها فيصير عطلاً يُكتشف قبل النشر لا بعده.
   */
  {
    const proxied = (path, headers = {}) =>
      handler(
        new Request(`http://127.0.0.1${path}`, {
          headers: {
            'x-forwarded-host': 'demo.supabase.co',
            'x-forwarded-proto': 'https',
            ...headers,
          },
        }),
      )

    const meta = await (await proxied('/sanawi-mcp/.well-known/oauth-protected-resource')).json()
    expect(
      'العنوان المعلَن يعوّض ما يقصّه وكيل Supabase',
      meta.resource,
      'https://demo.supabase.co/functions/v1/sanawi-mcp',
    )

    const as = await (await proxied('/sanawi-mcp/.well-known/oauth-authorization-server')).json()
    expect(
      'وعنوان التفويض كذلك',
      as.authorization_endpoint,
      'https://demo.supabase.co/functions/v1/sanawi-mcp/authorize',
    )

    // وإعدادٌ صريح يغلب الاستنتاج — هو ما يضبطه التدفّق وهو يعرف العنوان يقيناً.
    const declared = createFetchHandler({
      config: { url: oauthFake.url, anonKey: oauthFake.anonKey, email: '', password: '', readOnly: false },
      token: '',
      oauthSecret: SECRET,
      publicUrl: 'https://sanawi.example/mcp/',
    })
    const explicit = await (
      await declared(new Request('http://127.0.0.1/.well-known/oauth-protected-resource'))
    ).json()
    expect('الإعداد الصريح يغلب', explicit.resource, 'https://sanawi.example/mcp')
  }

  // ٢. تسجيل ديناميكي
  const registration = await (
    await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        client_name: 'check',
      }),
    })
  ).json()
  if (!registration.client_id) fail('التسجيل بلا client_id')

  /**
   * يمرّ بالدورة كاملة كما تمرّ فعلاً: الدالّة تحوّل إلى صفحة الدخول على نطاق
   * التطبيق، والصفحة تبادل كلمة السرّ بجلسة عند Supabase مباشرةً، ثم تعيد
   * الجلسة وحدها إلى الدالّة. كلمة السرّ لا تمرّ بالخادم في أي خطوة.
   */
  async function authorize(email, password) {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback'

    const query = new URLSearchParams({
      response_type: 'code',
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    })

    // ١. الدالّة تحوّل إلى صفحة الدخول، محمّلةً وسائط الدورة.
    const started = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' })
    expect('البدء يحوّل إلى صفحة الدخول', started.status, 302)

    const login = new URL(started.headers.get('location'))
    expect('وإلى نطاق التطبيق', login.origin + login.pathname, 'https://app.example/connect.html')
    expect('ومعه التحدّي', login.searchParams.get('code_challenge'), challenge)
    expect('والحالة', login.searchParams.get('state'), 'xyz')

    // ٢. ما تفعله الصفحة في المتصفّح: كلمة السرّ إلى Supabase مباشرةً.
    const auth = await fetch(`${oauthFake.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: oauthFake.anonKey },
      body: JSON.stringify({ email, password }),
    })
    const session = await auth.json()
    if (!auth.ok || !session.access_token) return { failedLogin: true }

    // ٣. الجلسة وحدها تعود إلى الدالّة فتصدر الرمز.
    const issued = await fetch(`${base}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        client_id: login.searchParams.get('client_id'),
        redirect_uri: login.searchParams.get('redirect_uri'),
        code_challenge: login.searchParams.get('code_challenge'),
        state: login.searchParams.get('state'),
      }),
    })
    const result = await issued.json()
    if (!issued.ok || !result.redirect) {
      fail(`إصدار الرمز فشل: ${JSON.stringify(result)}`)
      return null
    }

    const back = new URL(result.redirect)
    expect('العودة إلى رابط العميل', back.origin + back.pathname, redirectUri)
    expect('الحالة تعود كما أُرسلت', back.searchParams.get('state'), 'xyz')
    const code = back.searchParams.get('code')

    const tokenResponse = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: registration.client_id,
      }),
    })
    const tokens = await tokenResponse.json()
    if (!tokens.access_token) fail(`تبادل الرمز فشل: ${JSON.stringify(tokens)}`)
    return { ...tokens, verifier, code, redirectUri }
  }

  // ٣. كلمة سر خاطئة لا توصل إلى رمز
  const badLogin = await authorize(oauthFake.email, 'wrong')
  if (!badLogin?.failedLogin) fail('كلمة سر خاطئة كان يجب أن تفشل قبل إصدار أي رمز')

  // وجلسة ملفّقة تُرفض عند الدالّة نفسها — لا يكفي أن تُرفض في المتصفّح.
  const forgedSession = await fetch(`${base}/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      access_token: 'not.a.real.token',
      refresh_token: 'nope',
      client_id: registration.client_id,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: createHash('sha256').update('v').digest('base64url'),
    }),
  })
  expect('جلسة ملفّقة تُرفض', forgedSession.status, 401)

  // ٤. رابط عودة غير مسجّل يُرفض — وإلا سُلّم الرمز لموقع غريب
  const evil = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: 'https://evil.example/callback',
    code_challenge: createHash('sha256').update('v').digest('base64url'),
    code_challenge_method: 'S256',
  })
  expect(
    'رابط عودة غريب يُرفض',
    (await fetch(`${base}/authorize?${evil}`, { redirect: 'manual' })).status,
    400,
  )

  const first = await authorize(oauthFake.email, oauthFake.password)

  // ٥. PKCE: نفس الرمز بمُتحقّقٍ خاطئ لا يُصرَف
  if (first) {
    const replay = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: first.code,
        code_verifier: randomBytes(32).toString('base64url'),
        redirect_uri: first.redirectUri,
      }),
    })
    expect('PKCE يرفض مُتحقّقاً خاطئاً', replay.status, 400)
  }

  // ٦. الأدوات تعمل بالرمز
  const asUser = new Client({ name: 'sanawi-check-oauth', version: '1.0.0' })
  await asUser.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/`), {
      requestInit: { headers: { authorization: `Bearer ${first.access_token}` } },
    }),
  )
  expect('عدد الأدوات عبر OAuth', (await asUser.listTools()).tools.length, tools.length)

  await asUser.callTool({
    name: 'sanawi_create_obligation',
    arguments: { name: 'سرّي', total_amount: 4800, next_due_date: inMonths(12) },
  })
  const mine = await asUser.callTool({ name: 'sanawi_list_obligations', arguments: {} })
  expect('الالتزام أُنشئ', mine.structuredContent?.count, 1)
  expect('العملة من ملفي أنا', mine.structuredContent?.currency, 'ILS')

  // ٧. العزل: مستخدم ثانٍ لا يرى صفّ الأول
  const second = await authorize(oauthFake.other.email, oauthFake.other.password)
  const asOther = new Client({ name: 'sanawi-check-oauth-2', version: '1.0.0' })
  await asOther.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/`), {
      requestInit: { headers: { authorization: `Bearer ${second.access_token}` } },
    }),
  )
  const theirs = await asOther.callTool({ name: 'sanawi_list_obligations', arguments: {} })
  expect('المستخدم الثاني لا يرى شيئاً', theirs.structuredContent?.count, 0)
  expect('وعملته عملته هو', theirs.structuredContent?.currency, 'USD')

  if (first.access_token === second.access_token) fail('رمزا المستخدمين متطابقان!')

  // ٨. التجديد يعطي رمزاً جديداً يعمل
  const refreshed = await (
    await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
      }),
    })
  ).json()
  if (!refreshed.access_token) fail(`التجديد فشل: ${JSON.stringify(refreshed)}`)

  const afterRefresh = await fetch(`${base}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${refreshed.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
  })
  expect('الرمز المجدَّد يعمل', afterRefresh.status, 200)

  // ٩. رمزٌ مزوّر أو موقّع بسرٍّ آخر لا يمرّ
  const forged = await createFetchHandler({
    config: { url: oauthFake.url, anonKey: oauthFake.anonKey, email: '', password: '', readOnly: false },
    token: '',
    oauthSecret: 'a-different-secret-also-long-enough!!',
  })(
    new Request(`${base}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${first.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  )
  expect('رمزٌ بسرٍّ آخر يُرفض', forged.status, 401)

  await asUser.close()
  await asOther.close()
  await new Promise((r) => bridge.close(r))
  await oauthFake.stop()

  if (!failed) console.log('✓ OAuth كامل، وكل مستخدم محبوس في بياناته.')
}

/* ── 7. نداء حقيقي، إن وُجد حساب ──────────────────────────── */

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
