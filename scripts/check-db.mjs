/**
 * فحص اتصال قاعدة البيانات: هل الهجرات مطبَّقة؟
 * التشغيل: node scripts/check-db.mjs
 * لا يكتب أي بيانات — قراءة فقط.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const envPath = fileURLToPath(new URL('../.env', import.meta.url))
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const TABLES = [
  'profiles',
  'obligation_groups',
  'obligations',
  'obligation_partners',
  'obligation_partner_shares',
  'fund_deposits',
  'obligation_payments',
  'income_sources',
  'fixed_commitments',
  'expenses',
  'obligation_templates',
  'events',
  'obligation_balances',
  'partner_settlements',
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

console.log(`\n${missing === 0 ? 'كل الجداول موجودة.' : `${missing} جدول ناقص — طبّق الهجرات.`}`)
process.exit(missing === 0 ? 0 : 1)
