/**
 * تجهيز دالّة Supabase من مصدر الخادم نفسه.
 * التشغيل: node scripts/build-edge.mjs   (أو `npm run build:edge`)
 *
 * لماذا توليد لا كتابة يدوية؟ لأن البديل نسخةٌ ثانية من الأدوات كلها تعيش
 * في مجلد آخر وتنحرف عن الأولى بعد أول تعديل. المصدر واحد — `mcp/` و
 * `src/lib/` — والفرق بين البيئتين تحويلُ مسارات لا تحويلُ منطق:
 *
 * - Node ينتظر `./x.js` (مخرَج البناء) وDeno ينتظر `./x.ts` (المصدر نفسه).
 * - الحزم في Node تُحلّ من node_modules، وفي Deno بسابقة `npm:` وبنسخة مثبّتة.
 * - `src/lib/**` يقع خارج مجلد الدالّة، فيُنسخ تحتها ويُعاد توجيه مساراته.
 *
 * المخرَج غير محفوظ في git: يُولَّد في التدفّق قبل النشر مباشرةً، فلا يوجد في
 * المستودع ملفٌّ مولَّد يبدو مصدراً ويُعدَّل بالخطأ.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'supabase/functions/sanawi-mcp')
/**
 * ‏`crypto-sync` مكتوبةٌ بيدٍ ومحفوظة في git — الذي يُولَّد منها مجلد `lib/`
 * وحده: محرّكاتها تعيش في `src/lib` كغيرها (قاعدة «سؤال واحد = محرّك واحد»)،
 * ونسخُها اليدوي تحتها كان سيصنع نسختين تنحرفان بعد أول تعديل.
 */
const cryptoOut = join(root, 'supabase/functions/crypto-sync')

/** النسخ تُثبَّت هنا لا تُترك مفتوحة: نشرٌ يجلب نسخةً جديدة صامتاً ليس نشراً. */
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = (name) => (pkg.dependencies[name] ?? '').replace(/^[\^~]/, '')

const NPM = {
  '@modelcontextprotocol/sdk': version('@modelcontextprotocol/sdk'),
  '@supabase/supabase-js': version('@supabase/supabase-js'),
  zod: version('zod'),
  'date-fns': version('date-fns'),
}

/** ملفات الخادم، ثم محرّكات الحساب النقيّة التي يستوردها. */
const SERVER_FILES = [
  'mcp/env.ts',
  'mcp/session.ts',
  'mcp/oauth/tokens.ts',
  'mcp/oauth/endpoints.ts',
  'mcp/format.ts',
  'mcp/data.ts',
  'mcp/schemas.ts',
  'mcp/server.ts',
  'mcp/http.ts',
  'mcp/tools/read.ts',
  'mcp/tools/write.ts',
]

/**
 * القائمة يدوية ويحرسها فحص المسارات في آخر هذا الملف.
 *
 * محرّكٌ جديد يستورده الخادم ولا يُذكَر هنا لا يُكسر البناء ولا الاختبارات —
 * يُكسر النشر وحده، ولا يظهر إلا في التدفّق. فإن أضفتَ استيراداً من
 * `src/lib/**` في `mcp/**` فأضف ملفه هنا.
 */
const LIB_FILES = [
  'src/lib/db/types.ts',
  'src/lib/obligations/calc.ts',
  'src/lib/obligations/renewal.ts',
  'src/lib/obligations/payment.ts',
  'src/lib/obligations/deposits.ts',
  'src/lib/month/pending.ts',
  'src/lib/month/advice.ts',
  'src/lib/month/actuals.ts',
  'src/lib/month/cadence.ts',
  'src/lib/obligations/calendar.ts',
  'src/lib/budget/calc.ts',
  'src/lib/budget/month.ts',
  'src/lib/commitments/calc.ts',
  'src/lib/commitments/bills.ts',
  'src/lib/commitments/payoff.ts',
  'src/lib/expenses/calc.ts',
  'src/lib/budget/groupCost.ts',
  'src/lib/accounts/calc.ts',
  'src/lib/accounts/transfer.ts',
  'src/lib/bank/link.ts',
  'src/lib/date.ts',
  'src/lib/wealth/networth.ts',
  'src/lib/wealth/freedom.ts',
  'src/lib/wealth/baseline.ts',
  'src/lib/wealth/essentials.ts',
]

/** محرّكات `crypto-sync` — نفس القاعدة: تُذكر هنا وإلا كُسر النشر وحده. */
const CRYPTO_LIB_FILES = [
  'src/lib/wealth/crypto.ts',
  'src/lib/crypto/exchanges.ts',
  'src/lib/crypto/sign.ts',
  'src/lib/crypto/prices.ts',
]

const HEADER = `// مولَّد من mcp/ و src/lib/ بـ scripts/build-edge.mjs — لا تعدّله هنا.\n`

/**
 * إعادة توجيه المسارات.
 *
 * `../../src/lib/x.js` من داخل `mcp/tools/` و`../src/lib/x.js` من داخل `mcp/`
 * كلاهما يشير إلى الملف نفسه، ويصير `lib/x.ts` تحت مجلد الدالّة — بعمقٍ يوافق
 * موضع الملف الذي يستورده.
 */
function rewrite(source, depth) {
  const up = depth === 0 ? './' : '../'.repeat(depth)

  return source.replace(/(from\s+')([^']+)(')/g, (whole, a, spec, c) => {
    if (spec.startsWith('.')) {
      const libMatch = /^\.\.\/(?:\.\.\/)?src\/lib\/(.+)\.js$/.exec(spec)
      if (libMatch) return `${a}${up}lib/${libMatch[1]}.ts${c}`
      return `${a}${spec.replace(/\.js$/, '.ts')}${c}`
    }

    for (const [name, ver] of Object.entries(NPM)) {
      if (spec === name) return `${a}npm:${name}@${ver}${c}`
      if (spec.startsWith(`${name}/`)) {
        return `${a}npm:${name}@${ver}/${spec.slice(name.length + 1)}${c}`
      }
    }

    throw new Error(`حزمة بلا نسخة مثبّتة في build-edge.mjs: ${spec}`)
  })
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const file of SERVER_FILES) {
  const target = join(out, file.replace(/^mcp\//, ''))
  const depth = file.replace(/^mcp\//, '').split('/').length - 1
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, HEADER + rewrite(readFileSync(join(root, file), 'utf8'), depth))
}

function emitLib(target, files) {
  for (const file of files) {
    const relative = file.replace(/^src\/lib\//, '')
    const path = join(target, 'lib', relative)
    const depth = relative.split('/').length - 1
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, HEADER + rewrite(readFileSync(join(root, file), 'utf8'), depth))
  }
}

emitLib(out, LIB_FILES)

rmSync(join(cryptoOut, 'lib'), { recursive: true, force: true })
emitLib(cryptoOut, CRYPTO_LIB_FILES)

writeFileSync(
  join(out, 'index.ts'),
  `${HEADER}/**
 * خادم MCP لسنوي على Supabase Edge Functions.
 *
 * يُنشر بـ \`--no-verify-jwt\`: كلود ليس مستخدماً في Supabase ولا يملك JWT منها،
 * فبوّابةُ Supabase لا تصلح حارساً هنا. الحارس هو OAuth: كلُّ مستخدمٍ يسجّل
 * دخوله بنفسه ويأخذ رمزاً يخصّه، وتنطبق سياسات RLS على صاحب الرمز وحده.
 */
import { createSanawiFetchHandler } from './http.ts'

const handle = createSanawiFetchHandler()

Deno.serve((request: Request) => handle(request))
`,
)

writeFileSync(
  join(out, 'deno.json'),
  `${JSON.stringify({ imports: {}, lock: false }, null, 2)}\n`,
)

/*
 * فحص المسارات قبل النشر.
 *
 * مسارٌ مكسور في Deno لا يظهر عند التوليد ولا عند النشر — يظهر عند أول نداء
 * من كلود، خطأَ تشغيلٍ في دالّةٍ بعيدة لا يراها صاحبها. الفحص هنا يكلّف
 * ميلي ثانية ويحوّل ذلك العطل إلى فشلٍ في التدفّق قبل أن يصل.
 */
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

let broken = 0
let checked = 0
for (const file of [...walk(out), ...walk(cryptoOut)]) {
  if (!file.endsWith('.ts')) continue
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
    if (!spec.startsWith('.')) continue
    checked++
    try {
      statSync(resolve(dirname(file), spec))
    } catch {
      console.error(`مسار مكسور: ${file} ← ${spec}`)
      broken++
    }
  }
}

if (broken > 0) {
  console.error(`\n${broken} مساراً مكسوراً — لا تنشر.`)
  process.exit(1)
}

console.log(`جاهزة: supabase/functions/sanawi-mcp (${SERVER_FILES.length + LIB_FILES.length + 1} ملفاً)`)
console.log(`جاهزة: supabase/functions/crypto-sync/lib (${CRYPTO_LIB_FILES.length} ملفاً)`)
console.log(`${checked} مساراً نسبياً، كلها تُحلّ.`)
for (const [name, ver] of Object.entries(NPM)) console.log(`  npm:${name}@${ver}`)
