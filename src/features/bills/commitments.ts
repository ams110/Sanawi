import { supabase } from '@/lib/supabase'
import type {
  CommitmentDetail,
  CommitmentPartnerShare,
  CommitmentTemplate,
  ObligationPartner,
  PaymentMethod,
} from '@/lib/db/types'

/**
 * طرق الدفع: الافتراضية والخاصة معاً.
 *
 * سياسة القراءة في القاعدة تضمّ الاثنين، فلا حاجة لاستعلامين.
 */
export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name_ar', { ascending: true })
  if (error) throw error
  return (data ?? []) as PaymentMethod[]
}

export async function addPaymentMethod(
  userId: string,
  input: { nameAr: string; icon: string; isAutomatic: boolean },
): Promise<PaymentMethod> {
  const { data, error } = await supabase
    .from('payment_methods')
    .insert({
      user_id: userId,
      name_ar: input.nameAr,
      icon: input.icon,
      is_automatic: input.isAutomatic,
      sort_order: 900,
    })
    .select()
    .single()
  if (error) throw error
  return data as PaymentMethod
}

export async function listCommitmentTemplates(
  country = 'IL',
): Promise<CommitmentTemplate[]> {
  const { data, error } = await supabase
    .from('commitment_templates')
    .select('*')
    .eq('country', country)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as CommitmentTemplate[]
}

export async function listCommitmentDetails(): Promise<CommitmentDetail[]> {
  const { data, error } = await supabase.from('commitment_details').select('*')
  if (error) throw error
  return (data ?? []) as CommitmentDetail[]
}

export async function addCommitment(
  userId: string,
  input: {
    name: string
    amount: number
    icon: string | null
    endsOn: string | null
    totalAmount: number | null
    mySharePercent: number
    dayOfMonth: number | null
    defaultMethodId: string | null
  },
): Promise<string> {
  const { data, error } = await supabase
    .from('fixed_commitments')
    .insert({
      user_id: userId,
      name: input.name,
      amount: input.amount,
      icon: input.icon,
      ends_on: input.endsOn,
      total_amount: input.totalAmount,
      my_share_percent: input.mySharePercent,
      day_of_month: input.dayOfMonth,
      default_method_id: input.defaultMethodId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function listPartners(): Promise<ObligationPartner[]> {
  const { data, error } = await supabase
    .from('obligation_partners')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ObligationPartner[]
}

export async function listCommitmentShares(): Promise<CommitmentPartnerShare[]> {
  const { data, error } = await supabase.from('commitment_partner_shares').select('*')
  if (error) throw error
  return (data ?? []) as CommitmentPartnerShare[]
}

/**
 * استبدال حصص بندٍ دفعةً واحدة.
 *
 * الحصص مجموعةٌ لا صفوفٌ مستقلّة: تعديلُ واحدةٍ يغيّر معنى البقية، وحذفٌ
 * ثم إدراجٌ أوضح من مطابقة صفٍّ بصفّ. المجموع يُتحقَّق منه في الواجهة قبل
 * الوصول إلى هنا — لأنه يشمل حصّتي أنا وهي في جدولٍ آخر.
 */
export async function replaceCommitmentShares(
  userId: string,
  commitmentId: string,
  mySharePercent: number,
  shares: readonly { partnerId: string; percent: number }[],
): Promise<void> {
  const { error: delError } = await supabase
    .from('commitment_partner_shares')
    .delete()
    .eq('commitment_id', commitmentId)
  if (delError) throw delError

  if (shares.length > 0) {
    const { error: insError } = await supabase.from('commitment_partner_shares').insert(
      shares.map((s) => ({
        user_id: userId,
        commitment_id: commitmentId,
        partner_id: s.partnerId,
        share_percent: s.percent,
      })),
    )
    if (insError) throw insError
  }

  const { error: updError } = await supabase
    .from('fixed_commitments')
    .update({ my_share_percent: mySharePercent })
    .eq('id', commitmentId)
  if (updError) throw updError
}

export async function addPartner(userId: string, name: string): Promise<ObligationPartner> {
  const { data, error } = await supabase
    .from('obligation_partners')
    .insert({ user_id: userId, name })
    .select()
    .single()
  if (error) throw error
  return data as ObligationPartner
}
