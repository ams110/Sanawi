/**
 * يولّد `supabase/all-in-one.sql` من الهجرات.
 *
 * الملف الموحَّد وعدٌ في README: «الصقه في SQL Editor واضغط Run». وكان
 * يُحدَّث باليد، فتوقّف عند 0013 بينما الهجرات وصلت 0015 — فمن أنشأ قاعدةً
 * منه حصل على سكيما ناقصة `annual_interest_percent` و`net_worth_snapshots`،
 * وبعرضِ `commitment_details` قديم. ونقصٌ كهذا لا يظهر خطأً عند اللصق، بل
 * يظهر بعد أسابيع حين تفشل شاشةٌ لا علاقة لها به.
 *
 * التوليد يجعل الانحراف مستحيلاً: مصدرٌ واحد، والملف الموحَّد أثرٌ منه.
 *
 *   node scripts/build-schema.mjs           يكتب الملف
 *   node scripts/build-schema.mjs --check   يفشل إن كان قديماً (لـ CI)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const target = join(root, 'supabase', 'all-in-one.sql')

const HEADER = `-- ============================================================
-- سنوي — سكيما قاعدة البيانات كاملة
-- الصق هذا الملف كله في Supabase → SQL Editor واضغط Run.
--
-- آمن للتكرار فعلاً لا وعداً: كل جدول \`if not exists\`، وكل عمود
-- \`add column if not exists\`، وكل سياسة يسبقها \`drop policy if exists\`.
-- الأخيرة كانت ناقصة: تسعٌ وعشرون سياسة بلا حارس تعني أن تشغيل الملف
-- مرّةً ثانية يُجهض عند أول \`create policy\` — والترويسة تقول «آمن للتكرار».
--
-- لا يحتوي أي DELETE ولا TRUNCATE ولا DROP TABLE، ولا يمسّ أي صف بيانات.
-- وحذفُ السياسة ثم إعادة إنشائها فوراً لا يفتح ثغرة: RLS تبقى مفعّلة،
-- وجدولٌ بلا سياسة يُغلق لا ينفتح.
--
-- مولَّد: node scripts/build-schema.mjs — لا تعدّله يدوياً، عدّل الهجرة.
-- ============================================================
`

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const body = files
  .map((name) => {
    const sql = readFileSync(join(migrationsDir, name), 'utf8').trimEnd()
    return [
      '-- ─────────────────────────────────────────────',
      `-- ${name}`,
      '-- ─────────────────────────────────────────────',
      sql,
    ].join('\n')
  })
  .join('\n\n')

const output = `${HEADER}\n${body}\n`

/*
 * حارسٌ ضدّ ما وقع فعلاً: `drop table` أو `delete` تتسلّل إلى هجرة، فتصل
 * الملفَّ الموحَّد الذي يُلصق على قاعدةٍ فيها بيانات. الوعد في الترويسة
 * يجب أن يكون مفحوصاً لا مكتوباً.
 */
const FORBIDDEN = /\b(drop\s+table|truncate|delete\s+from)\b/i
const offending = files.filter((name) =>
  FORBIDDEN.test(readFileSync(join(migrationsDir, name), 'utf8')),
)
if (offending.length > 0) {
  console.error(`✗ هجرات فيها أمرٌ متلِف: ${offending.join('، ')}`)
  process.exit(1)
}

/*
 * وحارسٌ ثانٍ: كل `create policy` يسبقها `drop policy if exists`.
 *
 * ‏Postgres لا يعرف `create policy if not exists`، فسياسةٌ بلا حارس تجعل
 * الهجرة تُجهض عند إعادة تشغيلها — ويكفي أن ينساها كاتبُ هجرةٍ واحدة ليعود
 * الملف الموحَّد إلى الكذب. القاعدة تُفحص هنا لا تُترك للذاكرة.
 */
const unguarded = []
for (const name of files) {
  const lines = readFileSync(join(migrationsDir, name), 'utf8').split('\n')
  lines.forEach((line, i) => {
    const match = /^create policy "([^"]+)"/.exec(line)
    if (!match) return
    const before = lines[i - 1] ?? ''
    if (!before.includes(`drop policy if exists "${match[1]}"`)) {
      unguarded.push(`${name}: ${match[1]}`)
    }
  })
}
if (unguarded.length > 0) {
  console.error('✗ سياسات بلا `drop policy if exists` قبلها:')
  for (const item of unguarded) console.error(`  - ${item}`)
  process.exit(1)
}

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8')
  if (current !== output) {
    console.error('✗ all-in-one.sql قديم — شغّل: node scripts/build-schema.mjs')
    process.exit(1)
  }
  console.log(`✓ all-in-one.sql محدَّث (${files.length} هجرة).`)
} else {
  writeFileSync(target, output)
  console.log(`✓ كُتب all-in-one.sql من ${files.length} هجرة.`)
}
