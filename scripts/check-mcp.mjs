/**
 * فحص خادم MCP: هل يقلع، وهل يعلن أدواته، وهل تردّ القراءة على حساب حقيقي؟
 * التشغيل: node scripts/check-mcp.mjs   (بعد `npm run build:mcp`)
 *
 * لا يكتب أي بيانات: لا ينادي إلا أدوات القراءة، ويشغّل الخادم بوضع
 * SANAWI_READ_ONLY=1 فلا تكون أدوات الكتابة مسجّلة أصلاً أثناء الفحص.
 *
 * القيم تُقرأ من .env: SANAWI_EMAIL و SANAWI_PASSWORD لحساب الفحص،
 * وبدونهما يتوقّف الفحص عند إعلان الأدوات — وهو وحده يكشف أغلب الأعطال.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

/* ── 4. نداء حقيقي، إن وُجد حساب ──────────────────────────── */

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
