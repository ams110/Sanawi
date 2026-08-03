/**
 * فحص المسار الكامل على قاعدة بيانات حقيقية:
 * تسجيل → جلب القوالب → إنشاء التزام → إيداع → قراءة الرصيد → تنظيف.
 *
 * يُنشئ حساباً تجريبياً ويحذف كل ما كتبه في النهاية.
 * التشغيل: node scripts/check-flow.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const env = Object.fromEntries(
  readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

/** مفتاح تاريخ من التقويم المحلي — نظير `toDateKey` في src/lib/format.ts. */
const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

let failures = 0
const step = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/*
 * حساب الفحص يُعاد استعماله بين التشغيلات.
 * إنشاء حساب جديد في كل مرة يستهلك حصة الإيميلات في Supabase (بضعة إيميلات
 * في الساعة على الخطة المجانية) فيفشل الفحص بـ "email rate limit exceeded"
 * لسبب لا علاقة له بالكود المفحوص.
 */
const CRED_PATH = fileURLToPath(new URL('../.test-account.json', import.meta.url))

let creds = existsSync(CRED_PATH) ? JSON.parse(readFileSync(CRED_PATH, 'utf8')) : null
let session = null

if (creds) {
  const { data, error } = await supabase.auth.signInWithPassword(creds)
  if (!error && data.session) {
    session = data.session
    step('دخول بحساب الفحص المحفوظ', true, creds.email)
  } else {
    console.log(`ℹ️  الحساب المحفوظ لم يعمل (${error?.message ?? 'بلا جلسة'}) — ننشئ واحداً جديداً.`)
    creds = null
  }
}

if (!session) {
  const stamp = String(process.hrtime.bigint())
  creds = { email: `sanawi.check.${stamp}@gmail.com`, password: `Test-${stamp.slice(-8)}!` }

  const { data, error } = await supabase.auth.signUp(creds)
  if (error) {
    step('تسجيل حساب', false, error.message)
    if (/rate limit/i.test(error.message)) {
      console.log('\nحصة الإيميلات في Supabase استُهلكت. تُستعاد خلال ساعة تقريباً،')
      console.log('أو عطّل تأكيد الإيميل: Authentication → Sign In / Providers → Confirm email')
    }
    process.exit(1)
  }
  if (!data.session) {
    console.log('⚠️  تأكيد الإيميل مفعّل — لا تُنشأ جلسة عند التسجيل.')
    console.log('    عطّله من: Authentication → Sign In / Providers → Confirm email')
    process.exit(2)
  }
  session = data.session
  writeFileSync(CRED_PATH, JSON.stringify(creds, null, 2))
  step('تسجيل حساب جديد', true, creds.email)
}

const userId = session.user.id

// 2) الملف الشخصي يُنشأ تلقائياً بالمُشغِّل
const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', userId)
  .maybeSingle()
step('إنشاء الملف الشخصي تلقائياً', Boolean(profile) && !profileError, profileError?.message ?? `العملة ${profile?.currency}`)

// 3) القوالب مقروءة
const { data: templates, error: templatesError } = await supabase
  .from('obligation_templates')
  .select('*')
  .eq('country', 'IL')
  .order('sort_order')
step('جلب القوالب', !templatesError && (templates?.length ?? 0) > 0, templatesError?.message ?? `${templates?.length} قالب`)

// 4) إنشاء التزام في وضع الجسر: 6000 ₪ بعد 3 شهور
const due = new Date()
due.setMonth(due.getMonth() + 3)
const { data: obligation, error: createError } = await supabase
  .from('obligations')
  .insert({
    user_id: userId,
    name: 'تأمين السيارة (فحص)',
    category: 'car',
    total_amount: 6000,
    next_due_date: dateKey(due),
    recurrence_months: 12,
    cycle_start_date: dateKey(),
    baseline_installment: 500,
    my_share_percent: 100,
    is_active: true,
  })
  .select()
  .single()
step('إنشاء التزام', Boolean(obligation) && !createError, createError?.message)

if (obligation) {
  // 5) إيداع
  const { error: depositError } = await supabase.from('fund_deposits').insert({
    user_id: userId,
    obligation_id: obligation.id,
    partner_id: null,
    amount: 2000,
    deposit_date: dateKey(),
  })
  step('تسجيل إيداع', !depositError, depositError?.message)

  // 6) المشهد المحسوب يعكس الإيداع
  const { data: balance, error: balanceError } = await supabase
    .from('obligation_balances')
    .select('*')
    .eq('obligation_id', obligation.id)
    .maybeSingle()
  step(
    'الرصيد المحسوب صحيح',
    Number(balance?.my_fund_balance) === 2000 && Number(balance?.my_total) === 6000,
    balanceError?.message ?? `رصيدي ${balance?.my_fund_balance} من ${balance?.my_total}`,
  )

  // 7) التتبّع
  const { error: eventError } = await supabase
    .from('events')
    .insert({ user_id: userId, event_name: 'flow_check', payload: { ok: true } })
  step('تسجيل حدث تتبّع', !eventError, eventError?.message)

  // 8) عزل RLS: مستخدم خارج الجلسة لا يرى شيئاً
  const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  const { data: leaked } = await anon.from('obligations').select('id')
  step('RLS تمنع القراءة بلا جلسة', (leaked?.length ?? 0) === 0, `رأى ${leaked?.length ?? 0} صف`)

  // تنظيف: الحذف المتتالي يزيل الإيداعات مع الالتزام
  await supabase.from('events').delete().eq('user_id', userId)
  await supabase.from('obligations').delete().eq('id', obligation.id)
  const { data: after } = await supabase.from('obligations').select('id').eq('id', obligation.id)
  step('تنظيف بيانات الفحص', (after?.length ?? 0) === 0)
}

console.log(
  `\n${failures === 0 ? 'كل الفحوص نجحت.' : `${failures} فحص فشل.`}` +
    `\nحساب الفحص: ${creds.email} (محفوظ في .test-account.json ويُعاد استعماله).`,
)
process.exit(failures ? 1 : 0)
