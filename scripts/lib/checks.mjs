import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * أدوات الفحص المشتركة.
 *
 * كل فحوص هذا المشروع سقطت مرةً في العائلة نفسها: فحصٌ يقول "تمام" وهو لم
 * يفحص شيئاً.
 *
 *   - `head: true` لا يحمل جسماً، فلا تصل رسالة الخطأ ويبدو الجدول المفقود
 *     موجوداً. قال لنا مرةً إن أربعة عشر جدولاً موجودة ولم يكن ثمّة واحد.
 *   - `every` على مصفوفة فارغة تُرجع `true`. مرّ فحصان بينما القوالب صفر.
 *   - غيابُ جدولٍ يجعل كل إدراجٍ يفشل، فيمرّ كل فحصٍ يتوقّع فشلاً — لا لأن
 *     القيد عمل بل لأن الجدول مفقود.
 *
 * المشترك بينها أن الفراغ يُقرأ نجاحاً. هذه الوحدة تجعل الفراغ فشلاً صريحاً.
 */

export function createReporter() {
  let failures = 0

  const step = (label, ok, detail = '') => {
    if (!ok) failures++
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  }

  const finish = () => {
    console.log(failures === 0 ? '\n✅ كل الفحوص نجحت' : `\n❌ ${failures} فحص فشل`)
    process.exit(failures === 0 ? 0 : 1)
  }

  return { step, finish }
}

/**
 * `every` التي لا تُكافئ الفراغَ بالنجاح.
 *
 * "كل القوالب لها أيقونة" جملةٌ صادقةٌ منطقياً حين لا قوالب، وكاذبةٌ عملياً:
 * السؤال المقصود هو "هل القوالب موجودة وكلها لها أيقونة".
 */
export function allOf(rows, predicate) {
  const list = rows ?? []
  return list.length > 0 && list.every(predicate)
}

/**
 * صفوفٌ مضمونة أو فشلٌ صريح.
 *
 * PostgREST يُرجع `data: null` مع الخطأ، فكلّ `data.length` بعده انهيارٌ
 * بـ TypeError يقطع الفحص في منتصفه ويخفي ما بعده.
 */
export function rowsOf(result, label, step) {
  if (result.error) {
    step(label, false, result.error.message)
    return null
  }
  return result.data ?? []
}

/**
 * التثبّت من وجود الجداول قبل أي فحصٍ يعتمد عليها.
 *
 * بدونه يفشل نصف الفحوص برسالة "الجدول مفقود" وينجح نصفها كذباً. خطأٌ
 * واحدٌ واضح خيرٌ من عشرة أنصاف حقائق.
 *
 * `select` عادي لا `head`: الأول يحمل رسالة الخطأ والثاني يبتلعها.
 */
export async function requireTables(supabase, names, migrationHint) {
  const missing = []
  for (const name of names) {
    const { error } = await supabase.from(name).select('*').limit(1)
    // خطأ صلاحيات يعني أن الجدول موجود و RLS تعمل — وهذا هو المطلوب.
    if (error && (error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message))) {
      missing.push(name)
    }
  }

  if (missing.length > 0) {
    console.log(`❌ جداول ناقصة: ${missing.join('، ')}`)
    if (migrationHint) console.log(`   شغّل ${migrationHint} في SQL Editor أولاً.`)
    process.exit(1)
  }
}

/** قراءة .env بلا اعتماد على أداة خارجية. */
export function readEnv(importMetaUrl) {
  const path = fileURLToPath(new URL('../.env', importMetaUrl))
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
}

/**
 * الدخول بحساب الفحص المحفوظ.
 *
 * الحساب يُعاد استعماله بين التشغيلات: إنشاء واحدٍ جديد في كل مرة يستهلك
 * حصة الإيميلات في Supabase فيفشل الفحص لسببٍ لا علاقة له بالمفحوص.
 */
export async function signInTestAccount(supabase, importMetaUrl, step) {
  const path = fileURLToPath(new URL('../.test-account.json', importMetaUrl))
  if (!existsSync(path)) {
    console.log('❌ لا حساب فحص محفوظ — شغّل npm run check:flow أولاً')
    process.exit(1)
  }

  const creds = JSON.parse(readFileSync(path, 'utf8'))
  const { data, error } = await supabase.auth.signInWithPassword(creds)
  if (error || !data.session) {
    step('دخول بحساب الفحص', false, error?.message ?? 'بلا جلسة')
    process.exit(1)
  }

  step('دخول بحساب الفحص', true, creds.email)
  return { creds, userId: data.session.user.id }
}
