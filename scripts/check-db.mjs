/**
 * فحص اتصال قاعدة البيانات: هل الهجرات مطبَّقة؟
 * التشغيل: node scripts/check-db.mjs
 * لا يكتب أي بيانات — قراءة فقط، وبالمفتاح العام وحده.
 *
 * يقرأ الإعداد من `.env` محلياً، ومن متغيّرات البيئة في التدفّق — فيصلح
 * بوّابةً قبل النشر بلا سرٍّ جديد: المفتاحان اللذان يحتاجهما موجودان أصلاً.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fromFile = () => {
  try {
    const envPath = fileURLToPath(new URL('../.env', import.meta.url))
    return Object.fromEntries(
      readFileSync(envPath, 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
  } catch {
    // لا ملف: نعتمد البيئة. الغياب ليس خطأً — التدفّق لا يملك `.env`.
    return {}
  }
}

const file = fromFile()
const env = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || file.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || file.VITE_SUPABASE_ANON_KEY,
}

if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  console.error('✗ ناقص VITE_SUPABASE_URL أو VITE_SUPABASE_ANON_KEY — من .env أو من البيئة.')
  process.exit(1)
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

/*
 * القائمة تُشتقّ من الهجرات، وتقادُمها عطلٌ صامت: جدولٌ جديد لا يُضاف هنا
 * لا يُفحص أبداً، والسطر الأخير يقول "كل الجداول موجودة" وهو لم يسأل عنه.
 * حصل ذلك فعلاً: ستة جداول بقيت خارج الفحص.
 */
const TABLES = [
  // 0001
  'profiles',
  'obligation_groups',
  // 0002
  'obligations',
  'obligation_partners',
  'obligation_partner_shares',
  'fund_deposits',
  'obligation_payments',
  // 0003
  'income_sources',
  'fixed_commitments',
  'expenses',
  // 0004
  'obligation_templates',
  // 0005
  'events',
  // 0006
  'obligation_balances',
  'partner_settlements',
  // 0008
  'bill_payments',
  'bill_averages',
  // 0009
  'expense_categories',
  // 0010
  'commitment_partner_shares',
  'commitment_templates',
  'commitment_details',
  // 0012
  'income_entries',
  // 0013
  'payment_methods',
  // 0014
  'assets',
  'net_worth_snapshots',
  // 0016
  'accounts',
  'account_transfers',
  'account_settlements',
]

console.log(`الاتصال بـ ${env.VITE_SUPABASE_URL}\n`)

let missing = 0
for (const table of TABLES) {
  // select عادي لا head: طلب HEAD لا يحمل جسماً، فلا تصل رسالة الخطأ
  // ويبدو الجدول المفقود كأنه موجود. هذا الفحص كذب مرة بسبب ذلك.
  const { error } = await supabase.from(table).select('*').limit(1)

  if (!error) {
    console.log(`✅ ${table}`)
  } else if (error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message)) {
    console.log(`❌ ${table} — غير موجود (الهجرة لم تُطبَّق)`)
    missing++
  } else {
    // خطأ صلاحيات يعني أن الجدول موجود و RLS تعمل — وهذا هو المطلوب.
    console.log(`🔒 ${table} — موجود، محمي بـ RLS (${error.code})`)
  }
}

/*
 * الأعمدة أيضاً، لا الجداول وحدها.
 *
 * كل هجرة بعد 0005 تقريباً تضيف أعمدةً إلى جداول قائمة لا جداول جديدة —
 * و0015 كذلك. ففحصٌ يسأل عن الجداول فقط يقول «كل شيء موجود» على قاعدةٍ
 * ينقصها نصف السكيما، وهو نفس العطل الصامت الذي كُتب هذا الملف لأجله.
 *
 * والسؤال يُطرح بـ`select('عمود')`: العمود المفقود يردّ 42703 صراحةً،
 * بينما `select('*')` ينجح مهما نقص.
 */
const COLUMNS = [
  // 0010
  ['fixed_commitments', 'ends_on'],
  ['fixed_commitments', 'my_share_percent'],
  // 0013
  ['fixed_commitments', 'default_method_id'],
  // 0014
  ['fixed_commitments', 'annual_interest_percent'],
  // 0015
  ['fixed_commitments', 'starts_on'],
  ['commitment_details', 'has_started'],
  ['income_sources', 'is_variable'],
  ['obligation_templates', 'hint'],
  ['commitment_templates', 'hint'],
  // 0016 — الربط كلّه أعمدة على جداول قائمة، فغيابها لا يظهر في فحص الجداول.
  ['accounts', 'balance_updated_at'],
  ['accounts', 'archived_at'],
  ['obligations', 'account_id'],
  ['fund_deposits', 'account_id'],
  ['obligation_payments', 'paid_from_account_id'],
  ['fixed_commitments', 'account_id'],
  ['expenses', 'account_id'],
  // 0018 — رابع مكوّنات الصافي: بدونه لا تجتمع اللقطة على صافيها.
  ['net_worth_snapshots', 'accounts_total'],
]

console.log('')
for (const [table, column] of COLUMNS) {
  const { error } = await supabase.from(table).select(column).limit(1)

  if (!error) {
    console.log(`✅ ${table}.${column}`)
  } else if (error.code === '42703' || /column .* does not exist/i.test(error.message)) {
    console.log(`❌ ${table}.${column} — العمود ناقص (الهجرة لم تُطبَّق)`)
    missing++
  } else {
    console.log(`🔒 ${table}.${column} — موجود، محمي بـ RLS (${error.code})`)
  }
}

console.log(
  `\n${missing === 0 ? 'كل الجداول والأعمدة موجودة.' : `${missing} ناقص — طبّق الهجرات.`}`,
)
process.exit(missing === 0 ? 0 : 1)
