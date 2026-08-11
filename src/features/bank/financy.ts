import { supabase } from '@/lib/supabase'
import type { BankInboxRow } from '@/lib/db/types'

/**
 * طبقة بيانات الربط الحي — Financy.
 *
 * المفاتيح تُكتب ولا تُقرأ: `save_financy_credentials` دالة قاعدةٍ آمنة تكتب
 * في جدولٍ أعمى عن الواجهة، و`financy_status` تعيد «مربوط أم لا ومتى» بلا
 * حرفٍ من السرّ. فتسريب جلسة المتصفح لا يسرّب مفاتيح البنك.
 *
 * والسحب نفسه في دالّة حافة (`financy-sync`) لأن `client_secret` لا يغادر
 * الخادم — الواجهة تنادي وتقرأ العدّ: كم وصل وكم أُدرج جديداً.
 */

/**
 * ‏rpc بتوقيعٍ يدوي لا عبر `Database.Functions`: تعبئةُ تلك الخريطة فجّرت
 * عمق أنواع المترجم (TS2589 يظهر في failure.ts الذي لا يمسّ Supabase أصلاً).
 * الدوال ثلاثٌ معدودة، فالحصر هنا — أسماؤها اتحادٌ حرفي وخطأُ الاسم خطأُ
 * بناءٍ كما لو بقيت الخريطة.
 */
type FinancyRpc =
  | 'save_financy_credentials'
  | 'financy_status'
  | 'clear_financy_credentials'

const rpc = (
  fn: FinancyRpc,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: { message?: string } | null }> =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>)(
    fn,
    args,
  )

export interface FinancyStatus {
  connected: boolean
  updatedAt: string | null
}

export async function financyStatus(): Promise<FinancyStatus> {
  const { data, error } = await rpc('financy_status')
  if (error) throw error
  const payload = (data ?? {}) as { connected?: boolean; updated_at?: string }
  return {
    connected: Boolean(payload.connected),
    updatedAt: payload.updated_at ?? null,
  }
}

export async function saveFinancyCredentials(
  clientId: string,
  clientSecret: string,
  financyUserId: string,
): Promise<void> {
  const { error } = await rpc('save_financy_credentials', {
    p_client_id: clientId,
    p_client_secret: clientSecret,
    p_financy_user_id: financyUserId,
  })
  if (error) throw error
}

export async function clearFinancyCredentials(): Promise<void> {
  const { error } = await rpc('clear_financy_credentials')
  if (error) throw error
}

export interface SyncResult {
  fetched: number
  inserted: number
  since: string
}

/**
 * نداء السحب. فشله يخرج برمزٍ لا بجسم HTTP: الواجهة تحتاج «مفاتيح غلط» أو
 * «مش مربوط» لتقول جملةً مفيدة، لا 502 عارياً.
 */
export async function syncFinancy(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke('financy-sync')
  if (error) {
    let code = 'sync_failed'
    // ‏FunctionsHttpError يحمل الردّ في context — الرمز في جسمه إن وُجد.
    const context = (error as { context?: Response }).context
    if (context) {
      try {
        code = ((await context.json()) as { error?: string }).error ?? code
      } catch {
        /* جسمٌ غير JSON — يكفي الرمز العام. */
      }
    }
    throw new Error(code)
  }
  return data as SyncResult
}

/** المعلّق أولاً والأحدث أولاً — صندوق قراراتٍ لا سجلّ. */
export async function listInbox(limit = 60): Promise<BankInboxRow[]> {
  const { data, error } = await supabase
    .from('bank_inbox')
    .select('*')
    .eq('status', 'pending')
    .order('tx_date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as BankInboxRow[]
}

/**
 * تعليم القرار. الحركة لا تُحذف أبداً: «تجاهلتها» تاريخٌ أيضاً، ومن غيّر
 * رأيه يجدها لا يعيد سحبها.
 */
export async function setInboxStatus(
  id: string,
  status: 'recorded' | 'dismissed',
  recordedKind: 'expense' | 'income' | 'deposit' | null = null,
): Promise<void> {
  const { error } = await supabase
    .from('bank_inbox')
    .update({ status, recorded_kind: recordedKind })
    .eq('id', id)
  if (error) throw error
}
