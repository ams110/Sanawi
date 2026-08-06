/**
 * فحص المرحلة 2 على قاعدة حقيقية:
 * قوالب الفواتير → بند بأيقونة → قسط بنهاية → حصص شركاء → العرض → RLS → تنظيف.
 *
 * التشغيل: npm run check:commitments
 */
import { createClient } from '@supabase/supabase-js'
import { summarizeMonthlyLoad, validateShares, viewCommitment } from '../src/lib/commitments/calc.ts'
import { allOf, createReporter, readEnv, requireTables, rowsOf, signInTestAccount } from './lib/checks.mjs'

const env = readEnv(import.meta.url)
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { step, finish } = createReporter()

await requireTables(
  supabase,
  ['commitment_templates', 'commitment_partner_shares', 'commitment_details'],
  'supabase/migrations/0010_commitments_upgrade.sql',
)

const { creds, userId } = await signInTestAccount(supabase, import.meta.url, step)

// 1) القوالب.
const tpls = rowsOf(
  await supabase.from('commitment_templates').select('*').order('sort_order'),
  'قراءة قوالب الفواتير',
  step,
)
if (!tpls) finish()
step('قوالب الفواتير', tpls.length >= 15, `${tpls.length} قالب`)
step('لكل قالب أيقونة', allOf(tpls, (x) => x.icon?.length > 0))
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
const details = rowsOf(
  await supabase.from('commitment_details').select('*'),
  'قراءة commitment_details',
  step,
)
if (!details) finish()
const loanDetail = details.find((d) => d.commitment_id === loan?.id)
const billDetail = details.find((d) => d.commitment_id === bill?.id)
step('الدفعات المتبقية للقسط', loanDetail?.payments_left === 4, `${loanDetail?.payments_left}`)
step('البند المتكرّر بلا عدّاد', billDetail?.payments_left === null, `${billDetail?.payments_left}`)

// 4ب) قسط لم تبدأ دفعاته بعد.
//
// الحالة التي وُلد منها `starts_on`: بندٌ يُسجَّل اليوم وأول دفعة له بعد
// شهرين. بلا العمود كان العرض يعدّ من هذا الشهر فيزيد دفعتين، ويُحمَّل على
// شهرٍ لا دفعة فيه. هنا نتحقّق من العرض نفسه لا من المحرّك — النسختان
// تُصانان معاً أو تنحرفان.
const startMonth = new Date(now.getFullYear(), now.getMonth() + 2, 15)
const startsOn = startMonth.toISOString().slice(0, 10)
const { data: deferred, error: defErr } = await supabase
  .from('fixed_commitments')
  .insert({
    user_id: userId,
    name: 'قسط مؤجَّل فحص',
    amount: 500,
    starts_on: startsOn,
    ends_on: endsOn,
    my_share_percent: 100,
  })
  .select()
  .single()
step('قسط بتاريخ بدء', !defErr && deferred?.starts_on === startsOn, defErr?.message ?? startsOn)

const withDeferred = rowsOf(
  await supabase.from('commitment_details').select('*').eq('commitment_id', deferred?.id ?? ''),
  'قراءة العرض للمؤجَّل',
  step,
)
const defDetail = withDeferred?.[0]
// من شهر البدء (+2) إلى شهر النهاية (+3) شاملاً الطرفين = دفعتان.
step('العرض يعدّ من شهر البدء', defDetail?.payments_left === 2, `${defDetail?.payments_left}`)
step('والعرض يعلن أنه لم يبدأ', defDetail?.has_started === false, `${defDetail?.has_started}`)
step('والبند الذي بلا تاريخ بدء يكون بدأ', loanDetail?.has_started === true, `${loanDetail?.has_started}`)

// والمحرّك يوافق العرض على الرقم نفسه — لا نسختان تفترقان.
const deferredView = viewCommitment({
  amount: Number(defDetail?.amount ?? 0),
  startsOn: defDetail?.starts_on,
  endsOn: defDetail?.ends_on,
  mySharePercent: Number(defDetail?.my_share_percent ?? 100),
})
step(
  'المحرّك والعرض يتفقان على الدفعات',
  deferredView.paymentsLeft === defDetail?.payments_left,
  `${deferredView.paymentsLeft} مقابل ${defDetail?.payments_left}`,
)

// والحمل الشهري يتخطّاه: شهرٌ قبل أول دفعة لا دفعة فيه.
const loadWithDeferred = summarizeMonthlyLoad([
  {
    amount: Number(defDetail?.amount ?? 0),
    startsOn: defDetail?.starts_on,
    endsOn: defDetail?.ends_on,
    mySharePercent: Number(defDetail?.my_share_percent ?? 100),
  },
])
step('المؤجَّل خارج حمل هذا الشهر', loadWithDeferred.total === 0, `${loadWithDeferred.total} ₪`)

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
      startsOn: d.starts_on,
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
await supabase.from('fixed_commitments').delete().in('id', [bill.id, loan.id, deferred.id])
await supabase.from('obligation_partners').delete().eq('id', partner.id)
step('تنظيف', true)

finish()
