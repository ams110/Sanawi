import { supabase } from '@/lib/supabase'
import type { ObligationPartner, PartnerSettlement } from '@/lib/db/types'

/** حصة شريك كما تتعامل معها الواجهة قبل الحفظ. */
export interface PartnerShareDraft {
  /** فارغ يعني شريك جديد لم يُنشأ بعد. */
  partnerId: string | null
  name: string
  sharePercent: number
}

export async function listPartners(): Promise<ObligationPartner[]> {
  const { data, error } = await supabase
    .from('obligation_partners')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ObligationPartner[]
}

export async function listShares(obligationId: string): Promise<PartnerShareDraft[]> {
  const { data, error } = await supabase
    .from('obligation_partner_shares')
    .select('partner_id, share_percent, obligation_partners(name)')
    .eq('obligation_id', obligationId)
  if (error) throw error

  return (data ?? []).map((row) => {
    // العلاقة تعود كائناً أو مصفوفة حسب طريقة الاستنتاج — نتعامل مع الحالتين.
    const rel = (row as { obligation_partners?: { name?: string } | { name?: string }[] })
      .obligation_partners
    const name = Array.isArray(rel) ? (rel[0]?.name ?? '') : (rel?.name ?? '')
    return {
      partnerId: row.partner_id as string,
      name,
      sharePercent: Number(row.share_percent),
    }
  })
}

export async function listSettlements(obligationId: string): Promise<PartnerSettlement[]> {
  const { data, error } = await supabase
    .from('partner_settlements')
    .select('*')
    .eq('obligation_id', obligationId)
  if (error) throw error
  return (data ?? []) as PartnerSettlement[]
}

/** ينشئ الشريك إن كان جديداً، أو يعيد استعمال الموجود بنفس الاسم. */
async function ensurePartner(
  draft: PartnerShareDraft,
  userId: string,
  existing: ObligationPartner[],
): Promise<string> {
  if (draft.partnerId) return draft.partnerId

  const name = draft.name.trim()
  const match = existing.find((p) => p.name.trim() === name)
  if (match) return match.id

  const { data, error } = await supabase
    .from('obligation_partners')
    .insert({ user_id: userId, name })
    .select()
    .single()
  if (error) throw error
  return (data as ObligationPartner).id
}

/**
 * يستبدل حصص الالتزام بالكامل: حذف ثم إدراج.
 *
 * الاستبدال الكامل أبسط من المطابقة صفاً صفاً، والحذف هنا يطال جدول الحصص
 * فقط — لا الإيداعات ولا الشركاء أنفسهم، فلا يضيع تاريخ من دفع ماذا.
 */
export async function saveShares(
  obligationId: string,
  userId: string,
  drafts: PartnerShareDraft[],
): Promise<void> {
  const existing = await listPartners()

  const rows = []
  for (const draft of drafts) {
    if (!draft.name.trim() || draft.sharePercent <= 0) continue
    rows.push({
      user_id: userId,
      obligation_id: obligationId,
      partner_id: await ensurePartner(draft, userId, existing),
      share_percent: draft.sharePercent,
    })
  }

  const { error: deleteError } = await supabase
    .from('obligation_partner_shares')
    .delete()
    .eq('obligation_id', obligationId)
  if (deleteError) throw deleteError

  if (rows.length === 0) return

  const { error } = await supabase.from('obligation_partner_shares').insert(rows)
  if (error) throw error
}

/**
 * مجموع حصتي وحصص الشركاء يجب أن يساوي 100 بالضبط.
 * نتحقق هنا لا في القاعدة: قيدٌ في القاعدة سيفشل في منتصف تعديل متعدد الصفوف.
 */
export function validateShares(
  mySharePercent: number,
  partners: PartnerShareDraft[],
): string | null {
  // فحص الاسم أولاً: شريك بحصة بلا اسم لا يُحتسب ضمن الشركاء الفعليين،
  // فلو تأخّر هذا الفحص لقيل للمستخدم "بلا شركاء..." وهو يرى شريكاً أمامه.
  const unnamed = partners.find((p) => !p.name.trim() && p.sharePercent > 0)
  if (unnamed) return 'اكتب اسم كل شريك'

  const active = partners.filter((p) => p.name.trim() && p.sharePercent > 0)
  if (active.length === 0) {
    return mySharePercent === 100 ? null : 'بلا شركاء لازم حصتك تكون 100%'
  }

  const total = active.reduce((sum, p) => sum + p.sharePercent, mySharePercent)
  if (Math.abs(total - 100) > 0.01) {
    return `المجموع ${Math.round(total)}% — لازم يكون 100% بالضبط`
  }
  return null
}
