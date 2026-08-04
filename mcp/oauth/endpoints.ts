/**
 * خادم التفويض (OAuth 2.1) — عديم الحالة.
 *
 * كلود لا يعرف مستخدمي سنوي، وسنوي لا يعرف كلود. OAuth هو اللغة المشتركة:
 * كلود يوجّه المستخدم إلى صفحة دخولٍ على **نطاق التطبيق** (`connect.html`)،
 * والمستخدم يسجّل دخوله هناك لا في محادثة، ثم نعيد إلى كلود رمزاً يخصّه وحده.
 *
 * ولماذا الصفحة هناك لا هنا؟ لأن Supabase يحوّل أي `text/html` تردّه دالّة إلى
 * `text/plain` عمداً — قيدُ منصّة، جُرّب فظهرت الصفحة نصّاً خاماً. والنقل مكسبٌ
 * لا تنازل: **كلمة السرّ لا تمرّ بهذا الخادم أصلاً**، تذهب من المتصفّح إلى
 * Supabase مباشرةً، فلا نملك ما نخزّنه حتى لو أردنا. لا يصلنا إلا أثرُها:
 * جلسةٌ نتحقّق منها.
 *
 * ولا نحتاج مفتاح خدمة، لأن الجلسة تأتي من دخولٍ حقيقي لا من انتحال. وهي
 * جلسة مستقلة عن جلسة التطبيق، فتدويرُ رموزها لا يُخرج المستخدم من تلفونه.
 *
 * كل ما يحتاج الخادمُ تذكّره يعيش داخل الرموز مشفّراً (انظر `tokens.ts`):
 * لا جدول، ولا صفّ يُقرأ قبل معرفة صاحبه.
 */

import { createClient } from '@supabase/supabase-js'
import type { Config } from '../session.js'
import { open, seal, verifyPkce, readJwtClaims } from './tokens.js'

/** رمز التفويض يعيش دقيقة: يكفي لإكمال التحويل ولا يكفي لالتقاطه واستعماله. */
const CODE_TTL = 60
const ACCESS_TTL = 55 * 60
const REFRESH_TTL = 30 * 24 * 60 * 60
const CLIENT_TTL = 365 * 24 * 60 * 60

const JSON_HEADERS = { 'content-type': 'application/json' }
const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8' }

export interface OAuthContext {
  config: Config
  secret: string
  /** جذر الخادم كما يراه العميل — منه تُبنى كل الروابط المعلنة. */
  baseUrl: string
  /** صفحة الدخول على نطاق التطبيق. */
  loginUrl: string
  now: number
}

interface ClientClaims extends Record<string, unknown> {
  redirect_uris: string[]
  name?: string
}

interface CodeClaims extends Record<string, unknown> {
  refresh_token: string
  access_token: string
  challenge: string
  redirect_uri: string
  resource?: string
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

const oauthError = (error: string, description: string, status = 400): Response =>
  json({ error, error_description: description }, status)

/* ── الاكتشاف ─────────────────────────────────────────────── */

export function protectedResourceMetadata({ baseUrl }: OAuthContext): Response {
  return json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
  })
}

export function authorizationServerMetadata({ baseUrl }: OAuthContext): Response {
  return json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // S256 وحده: `plain` يجعل من يعترض الرمز قادراً على استبداله.
    code_challenge_methods_supported: ['S256'],
    // عميل عام بلا سرّ — الحماية من PKCE لا من سرٍّ مخزَّن في تطبيق.
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['sanawi'],
  })
}

/* ── تسجيل العميل ─────────────────────────────────────────── */

/**
 * تسجيل ديناميكي: نقبل أي عميل ونعيد معرّفاً يحمل تسجيله بداخله.
 *
 * لا سجلّ عملاء نحرسه، والمعرّف نفسه هو السجلّ. وما يهمّنا من التسجيل شيء
 * واحد: روابط العودة المسموحة — فبها وحدها نمنع تحويل الرمز إلى موقع غريب.
 */
export async function register(context: OAuthContext, request: Request): Promise<Response> {
  let body: { redirect_uris?: unknown; client_name?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return oauthError('invalid_client_metadata', 'جسم الطلب ليس JSON صالحاً.')
  }

  const uris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : []

  if (uris.length === 0) {
    return oauthError('invalid_redirect_uri', 'redirect_uris مطلوبة ولا يمكن أن تكون فارغة.')
  }

  const clientId = await seal(
    context.secret,
    'client',
    { redirect_uris: uris, name: typeof body.client_name === 'string' ? body.client_name : '' },
    CLIENT_TTL,
    context.now,
  )

  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(context.now / 1000),
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
  )
}

/* ── التفويض ──────────────────────────────────────────────── */

interface AuthorizeParams {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  resource: string
}

async function readAuthorizeParams(
  context: OAuthContext,
  params: URLSearchParams,
): Promise<AuthorizeParams | Response> {
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const challenge = params.get('code_challenge') ?? ''

  if (params.get('response_type') !== 'code') {
    return oauthError('unsupported_response_type', 'response_type يجب أن يكون code.')
  }
  if (!challenge || params.get('code_challenge_method') !== 'S256') {
    return oauthError('invalid_request', 'PKCE بطريقة S256 مطلوب.')
  }

  const client = await open<ClientClaims>(context.secret, 'client', clientId, context.now)
  if (!client) return oauthError('invalid_client', 'client_id غير معروف أو انتهت صلاحيته.')

  // التحقّق من رابط العودة هو الحارس الوحيد ضد تسليم الرمز لموقع غريب.
  if (!client.redirect_uris.includes(redirectUri)) {
    return oauthError('invalid_request', 'redirect_uri غير مسجّل لهذا العميل.')
  }

  return {
    clientId,
    redirectUri,
    state: params.get('state') ?? '',
    challenge,
    resource: params.get('resource') ?? '',
  }
}

/**
 * بدء الدورة: تحقّقٌ ثم تحويلٌ إلى صفحة الدخول على نطاق التطبيق.
 *
 * التحقّق هنا قبل التحويل هو ما يمنع تسليم الرمز لموقع غريب: الصفحة تمرّر
 * الوسائط كما وصلتها، فلو لم نتحقّق الآن لصارت أيُّ قيمةٍ في سطر العنوان
 * مقبولة. ونتحقّق منها ثانيةً عند الإصدار، فلا يكفي تعديلها في المتصفّح.
 */
export async function authorizeStart(
  context: OAuthContext,
  params: URLSearchParams,
): Promise<Response> {
  const parsed = await readAuthorizeParams(context, params)
  if (parsed instanceof Response) return parsed

  const target = new URL(context.loginUrl)
  target.searchParams.set('client_id', parsed.clientId)
  target.searchParams.set('redirect_uri', parsed.redirectUri)
  target.searchParams.set('code_challenge', parsed.challenge)
  if (parsed.state) target.searchParams.set('state', parsed.state)
  if (parsed.resource) target.searchParams.set('resource', parsed.resource)

  return new Response(null, { status: 302, headers: { location: target.toString() } })
}

/**
 * إتمام الدورة: جلسةٌ من صفحة الدخول، فرمزُ تفويض.
 *
 * لا تصل كلمةُ سرٍّ إلى هنا — الصفحة بادلتها بجلسة عند Supabase مباشرةً.
 * والجلسة تُتحقَّق قبل قبولها: رمزٌ ملفَّق يُرفض هنا بدل أن يصير رمز تفويضٍ
 * صالحاً ينكسر لاحقاً عند أول استعلام بخطأٍ لا يفهمه أحد.
 */
export async function authorizeComplete(
  context: OAuthContext,
  request: Request,
): Promise<Response> {
  let body: Record<string, string>
  try {
    body = (await request.json()) as Record<string, string>
  } catch {
    return oauthError('invalid_request', 'جسم الطلب ليس JSON صالحاً.')
  }

  const params = new URLSearchParams({
    response_type: 'code',
    code_challenge_method: 'S256',
    client_id: body.client_id ?? '',
    redirect_uri: body.redirect_uri ?? '',
    code_challenge: body.code_challenge ?? '',
    state: body.state ?? '',
    resource: body.resource ?? '',
  })

  const parsed = await readAuthorizeParams(context, params)
  if (parsed instanceof Response) return parsed

  const accessToken = body.access_token ?? ''
  const refreshToken = body.refresh_token ?? ''
  if (!accessToken || !refreshToken) {
    return oauthError('invalid_request', 'الجلسة ناقصة.')
  }

  const auth = createClient(context.config.url, context.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await auth.auth.getUser(accessToken)
  if (error || !data.user) {
    return oauthError('invalid_grant', 'الجلسة غير صالحة — أعد تسجيل الدخول.', 401)
  }

  const code = await seal(
    context.secret,
    'code',
    {
      refresh_token: refreshToken,
      access_token: accessToken,
      challenge: parsed.challenge,
      redirect_uri: parsed.redirectUri,
      resource: parsed.resource,
    } satisfies CodeClaims,
    CODE_TTL,
    context.now,
  )

  const target = new URL(parsed.redirectUri)
  target.searchParams.set('code', code)
  if (parsed.state) target.searchParams.set('state', parsed.state)

  return json({ redirect: target.toString() })
}

/* ── الرموز ───────────────────────────────────────────────── */

async function issue(
  context: OAuthContext,
  session: { access_token: string; refresh_token: string },
): Promise<Response> {
  const claims = readJwtClaims(session.access_token)

  const [access, refresh] = await Promise.all([
    seal(context.secret, 'access', { jwt: session.access_token, sub: claims.sub }, ACCESS_TTL, context.now),
    seal(context.secret, 'refresh', { refresh_token: session.refresh_token }, REFRESH_TTL, context.now),
  ])

  return json({
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    scope: 'sanawi',
  })
}

export async function token(context: OAuthContext, request: Request): Promise<Response> {
  const form = await request.formData()
  const grant = form.get('grant_type')

  const supabase = createClient(context.config.url, context.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (grant === 'authorization_code') {
    const claims = await open<CodeClaims>(
      context.secret,
      'code',
      String(form.get('code') ?? ''),
      context.now,
    )
    if (!claims) return oauthError('invalid_grant', 'رمز التفويض غير صالح أو انتهت صلاحيته.')

    const verifier = String(form.get('code_verifier') ?? '')
    if (!verifier || !(await verifyPkce(verifier, claims.challenge))) {
      return oauthError('invalid_grant', 'code_verifier لا يطابق code_challenge.')
    }
    if (String(form.get('redirect_uri') ?? '') !== claims.redirect_uri) {
      return oauthError('invalid_grant', 'redirect_uri لا يطابق ما طُلب به الرمز.')
    }

    return issue(context, claims)
  }

  if (grant === 'refresh_token') {
    const claims = await open<{ refresh_token: string }>(
      context.secret,
      'refresh',
      String(form.get('refresh_token') ?? ''),
      context.now,
    )
    if (!claims) return oauthError('invalid_grant', 'رمز التجديد غير صالح أو انتهت صلاحيته.')

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: claims.refresh_token,
    })
    if (error || !data.session) {
      return oauthError('invalid_grant', 'انتهت الجلسة — يلزم الدخول من جديد.')
    }

    return issue(context, data.session)
  }

  return oauthError('unsupported_grant_type', 'المدعوم: authorization_code و refresh_token.')
}

/**
 * ما يُعرض حين يُفتح رابط الخادم في متصفّح.
 *
 * نصٌّ لا HTML: المنصّة تحوّل صفحات الدوالّ إلى نصّ خام، فصفحةٌ منسّقة تصل
 * مشوّهةً بحروفٍ محروقة. النصّ المجرّد يصل كما كُتب.
 */
export function landing(context: OAuthContext): Response {
  return new Response(
    [
      'خادم سنوي — هذا ليس موقعاً يُفتح، بل خادمٌ يُضاف إلى كلود.',
      '',
      'في كلود: Settings ← Connectors ← Add custom connector، وضع هذا العنوان:',
      '',
      `  ${context.baseUrl}`,
      '',
      'سيفتح لك كلود صفحة دخول سنوي، وبعدها ترى أدواتك في المحادثة.',
      'لا يوجد رابط سرّي تنسخه ولا مفتاح تحفظه.',
    ].join('\n'),
    { headers: TEXT_HEADERS },
  )
}
