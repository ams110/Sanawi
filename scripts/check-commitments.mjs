/**
 * فحص المرحلة 2 على قاعدة حقيقية:
 * قوالب الفواتير → بند بأيقونة → قسط بنهاية → حصص شركاء → العرض → RLS → تنظيف.
 *
 * التشغيل: npm run check:commitments
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { summarizeMonthlyLoad, validateShares } from '../src/lib/commitments/calc.ts'

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

let failures = 0
const step = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const CRED_PATH = fileURLToPath(new URL('../.test-account.json', import.meta.url))
if (!existsSync(CRED_PATH)) {
  console.log('❌ لا حساب فحص محفوظ — شغّل npm run check:flow أولاً')
  process.exit(1)
}
const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'))
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword(creds)
if (authErr || !auth.session) {
  step('دخول بحساب الفحص', false, authErr?.message ?? 'بلا جلسة')
  process.exit(1)
}
step('دخول بحساب الفحص', true, creds.email)
const userId = auth.session.user.id

// 1) القوالب.
const { data: tpls, error: tplErr } = await supabase
  .from('commitment_templates')
  .select('*')
  .order('sort_order')
if (tplErr) {
  step('قراءة قوالب الفواتير', false, tplErr.message)
  process.exit(1)
}
step('قوالب الفواتير', tpls.length >= 15, `${tpls.length} قالب`)
step('لكل قالب أيقونة', tpls.every((x) => x.icon?.length > 0))
const debts = tpls.filter((x) => x.is_installment)
step('قوالب الديون معلّمة', debts.length === 4, debts.map((d) => d.name_ar).join('، '))

const power = tpls.find((x) => x.name_ar === 'كهرباء')
const carLoan = tpls.find((x) => x.name_ar === 'قرض سيارة')

// 2) فاتورة متكرّرة بأيقونة.
const { data: bill, error: billErr } = await supabase
  .from('fixed_commitments')
  .insert({
    user_id: userId,
    name: 'كهرباء فحص',
    amount: 400,
    icon: power?.icon ?? '💡',
    my_share_percent: 100,
  })
  .select()
  .single()
step('بند متكرّر بأيقونة', !billErr && bill?.icon === (power?.icon ?? '💡'), billErr?.message ?? bill?.icon)

// 3) قسط ينتهي بعد 4 شهور بالضبط (شاملاً الشهر الجاري).
const now = new Date()
const end = new Date(now.getFullYear(), now.getMonth() + 3, 15)
const endsOn = end.toISOString().slice(0, 10)
const { data: loan, error: loanErr } = await supabase
  .from('fixed_commitments')
  .insert({
    user_id: userId,
    name: 'قرض فحص',
    amount: 1000,
    icon: carLoan?.icon ?? '🚗',
    ends_on: endsOn,
    total_amount: 12000,
    my_share_percent: 100,
  })
  .select()
  .single()
step('قسط بتاريخ نهاية', !loanErr && loan?.ends_on === endsOn, loanErr?.message ?? endsOn)

// 4) العرض يحسب الدفعات المتبقية — شاملةً شهر الانتهاء.
const { data: details, error: detErr } = await supabase.from('commitment_details').select('*')
if (detErr) {
  step('قراءة commitment_details', false, detErr.message)
  process.exit(1)
}
const loanDetail = details.find((d) => d.commitment_id === loan?.id)
const billDetail = details.find((d) => d.commitment_id === bill?.id)
step('الدفعات المتبقية للقسط', loanDetail?.payments_left === 4, `${loanDetail?.payments_left}`)
step('البند المتكرّر بلا عدّاد', billDetail?.payments_left === null, `${billDetail?.payments_left}`)

// 5) حصص الشركاء.
const { data: partner, error: pErr } = await supabase
  .from('obligation_partners')
  .insert({ user_id: userId, name: 'شريك فحص' })
  .select()
  .single()
step('إنشاء شريك', !pErr && Boolean(partner?.id), pErr?.message ?? '')

const { error: shareErr } = await supabase.from('commitment_partner_shares').insert({
  user_id: userId,
  commitment_id: bill.id,
  partner_id: partner.id,
  share_percent: 40,
})
await supabase.from('fixed_commitments').update({ my_share_percent: 60 }).eq('id', bill.id)
step('حصّة شريك على فاتورة', !shareErr, shareErr?.message ?? '60/40')

const { data: after } = await supabase
  .from('commitment_details')
  .select('*')
  .eq('commitment_id', bill.id)
  .single()
step('حصّتي بالشيكل من العرض', Number(after?.my_amount) === 240, `${after?.my_amount} من 400`)

// 6) القاعدة ترفض حصّة خارج المدى.
const { error: badErr } = await supabase.from('commitment_partner_shares').insert({
  user_id: userId,
  commitment_id: loan.id,
  partner_id: partner.id,
  share_percent: 140,
})
step('القاعدة ترفض حصّة > 100', Boolean(badErr), badErr ? 'مرفوضة' : 'قُبلت!')

// 7) المحرّك يطابق العرض.
const load = summarizeMonthlyLoad(
  details
    .filter((d) => d.commitment_id === bill.id || d.commitment_id === loan.id)
    .map((d) => ({
      amount: Number(d.amount),
      endsOn: d.ends_on,
      mySharePercent: Number(d.my_share_percent),
    })),
)
step('المحرّك يفصل المتكرّر عن الأقساط', load.installments === 1000, `${load.installments} ₪`)
step('أقرب فرَج مرصود', load.nextRelief?.monthsAway === 4, `بعد ${load.nextRelief?.monthsAway} شهور`)
step('التحقق من الحصص', validateShares(60, [40]).isValid && !validateShares(60, [50]).isValid)

// 8) عزل RLS.
await supabase.auth.signOut()
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data: leakedShares } = await anon.from('commitment_partner_shares').select('id')
const { data: leakedDetails } = await anon.from('commitment_details').select('commitment_id')
step('لا تسرّب للحصص بلا جلسة', (leakedShares ?? []).length === 0)
step('لا تسرّب للتفاصيل بلا جلسة', (leakedDetails ?? []).length === 0)

// 9) تنظيف.
await supabase.auth.signInWithPassword(creds)
await supabase.from('commitment_partner_shares').delete().eq('user_id', userId)
await supabase.from('fixed_commitments').delete().in('id', [bill.id, loan.id])
await supabase.from('obligation_partners').delete().eq('id', partner.id)
step('تنظيف', true)

console.log(failures === 0 ? '\n✅ كل الفحوص نجحت' : `\n❌ ${failures} فحص فشل`)
process.exit(failures === 0 ? 0 : 1)
