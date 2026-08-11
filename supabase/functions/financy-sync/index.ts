/**
 * financy-sync — دالّة الحافة التي تجلب حركات البنك من Financy إلى الوارد.
 *
 * لماذا دالّة حافة لا نداءٌ من المتصفح؟ لأن `client_secret` سرٌّ لا يغادر
 * الخادم (توثيق Financy نفسه يشدّد على ذلك)، والجدول الذي يحمله أعمى عن
 * PostgREST — مفتاح الخدمة هنا هو القارئ الوحيد.
 *
 * ولماذا تُستدعى يدوياً (زرّ «اسحب الجديد») لا بجدولة؟ لأن أول نسخةٍ من كل
 * ميزةٍ في هذا المشروع تبدأ بأصغر ما يعمل: زرٌّ يضغطه صاحبه حين يريد. الجدولة
 * إضافة كرونٍ لاحقة لا تغيّر حرفاً هنا.
 *
 * العقد: POST بلا جسم، ترويسة Authorization بجلسة المستخدم.
 * الردّ: { fetched, inserted, since } أو { error } برمزٍ مفهوم للواجهة.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.111.0'
import { inboxDraftFromTransaction, syncWindowStart, type FinancyTransaction } from './map.ts'

const FINANCY_TOKEN_URL = 'https://api.open-finance.ai/oauth/token'
const FINANCY_TRANSACTIONS_URL = 'https://api.open-finance.ai/v2/data/transactions'
/** سقف صفحات السحبة الواحدة — 20 صفحة × 100 حركة تفوق أي شهرٍ بشري. */
const MAX_PAGES = 20

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: 'misconfigured' })

  /*
   * هوية النادي من جلسته هو، لا من جسم الطلب: دالّةٌ تقبل user_id كوسيطٍ
   * تسحب حركات أي مستخدمٍ لمن عرف معرّفه.
   */
  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await asUser.auth.getUser()
  const user = userData?.user
  if (userError || !user) return json(401, { error: 'unauthenticated' })

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: creds, error: credsError } = await admin
    .from('financy_credentials')
    .select('client_id, client_secret, financy_user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (credsError) return json(500, { error: 'credentials_read_failed' })
  if (!creds) return json(400, { error: 'not_connected' })

  const tokenRes = await fetch(FINANCY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
      userId: creds.financy_user_id,
    }),
  })
  if (!tokenRes.ok) {
    // 401 من Financy = مفاتيح غلط — تُقال للواجهة لتقول «راجع مفاتيحك»،
    // لا 502 عاماً يوحي بعطلٍ عندهم.
    return json(502, {
      error: tokenRes.status === 401 || tokenRes.status === 403 ? 'bad_credentials' : 'financy_auth_failed',
    })
  }
  const { accessToken } = (await tokenRes.json()) as { accessToken?: string }
  if (!accessToken) return json(502, { error: 'financy_auth_failed' })

  const { data: lastRow } = await admin
    .from('bank_inbox')
    .select('tx_date')
    .eq('user_id', user.id)
    .order('tx_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  const since = syncWindowStart(lastRow?.tx_date ?? null, new Date())

  let fetched = 0
  const drafts = []
  let nextPage: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(FINANCY_TRANSACTIONS_URL)
    url.searchParams.set('dateFrom', since)
    url.searchParams.set('limit', '100')
    url.searchParams.set('sort', '1')
    if (nextPage) url.searchParams.set('nextPage', nextPage)

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return json(502, { error: 'financy_fetch_failed' })

    const body = (await res.json()) as { items?: FinancyTransaction[]; nextPage?: string }
    const items = body.items ?? []
    fetched += items.length
    for (const tx of items) {
      const draft = inboxDraftFromTransaction(tx)
      if (draft) drafts.push(draft)
    }

    nextPage = body.nextPage ?? null
    if (!nextPage || items.length === 0) break
  }

  /*
   * ‏`ignoreDuplicates` على (user_id, tx_sk): السحب المتداخل عمداً (ثلاثة
   * أيام رجوعاً) يعيد حركاتٍ موجودة، والفرادة تسقطها صامتةً — والحركة التي
   * قرّر فيها صاحبها (سُجّلت أو تُوجّهت) لا تُلمس ولا تعود «معلّقة».
   */
  let inserted = 0
  if (drafts.length > 0) {
    const { data: upserted, error: upsertError } = await admin
      .from('bank_inbox')
      .upsert(
        drafts.map((d) => ({ ...d, user_id: user.id })),
        { onConflict: 'user_id,tx_sk', ignoreDuplicates: true },
      )
      .select('id')
    if (upsertError) return json(500, { error: 'inbox_write_failed' })
    inserted = upserted?.length ?? 0
  }

  return json(200, { fetched, inserted, since })
})
