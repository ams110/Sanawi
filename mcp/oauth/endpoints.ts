/**
 * خادم التفويض (OAuth 2.1) — عديم الحالة.
 *
 * كلود لا يعرف مستخدمي سنوي، وسنوي لا يعرف كلود. OAuth هو اللغة المشتركة:
 * كلود يوجّه المستخدم إلى صفحة دخولٍ **عندنا**، والمستخدم يكتب بريده وكلمة
 * سرّه في موقعنا لا في محادثة، ونحن نعيد إلى كلود رمزاً يخصّه وحده.
 *
 * والمكسب الذي دفعنا إلى هنا: نستبدل كلمة السرّ بجلسة Supabase في اللحظة
 * نفسها، فلا نخزّنها أبداً — ولا نحتاج مفتاح خدمة، لأن الجلسة تأتي من دخولٍ
 * حقيقي لا من انتحال. وهي جلسة مستقلة عن جلسة التطبيق، فتدويرُ رموزها لا
 * يُخرج المستخدم من تلفونه.
 *
 * كل ما يحتاج الخادمُ تذكّره يعيش داخل الرموز مشفّراً (انظر `tokens.ts`):
 * لا جدول، ولا صفّ يُقرأ قبل معرفة صاحبه.
 */

import { createClient } from '@supabase/supabase-js'
import type { Config } from '../session.js'
import { loginPage, noticePage } from './login-page.js'
import { open, seal, verifyPkce, readJwtClaims } from './tokens.js'

/** رمز التفويض يعيش دقيقة: يكفي لإكمال التحويل ولا يكفي لالتقاطه واستعماله. */
const CODE_TTL = 60
const ACCESS_TTL = 55 * 60
const REFRESH_TTL = 30 * 24 * 60 * 60
const CLIENT_TTL = 365 * 24 * 60 * 60

const JSON_HEADERS = { 'content-type': 'application/json' }
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' }

export interface OAuthContext {
  config: Config
  secret: string
  /** جذر الخادم كما يراه العميل — منه تُبنى كل الروابط المعلنة. */
  baseUrl: string
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

export async function authorizeForm(
  context: OAuthContext,
  params: URLSearchParams,
): Promise<Response> {
  const parsed = await readAuthorizeParams(context, params)
  if (parsed instanceof Response) return parsed

  return new Response(loginPage({ ...parsed, error: '' }), { headers: HTML_HEADERS })
}

export async function authorizeSubmit(
  context: OAuthContext,
  request: Request,
): Promise<Response> {
  const form = await request.formData()
  const params = new URLSearchParams()
  for (const [key, value] of form) if (typeof value === 'string') params.set(key, value)

  const parsed = await readAuthorizeParams(context, params)
  if (parsed instanceof Response) return parsed

  const email = (params.get('email') ?? '').trim()
  const password = params.get('password') ?? ''

  if (!email || !password) {
    return new Response(loginPage({ ...parsed, error: 'اكتب البريد وكلمة السر.' }), {
      status: 400,
      headers: HTML_HEADERS,
    })
  }

  /*
   * هنا تُستبدل كلمة السرّ بجلسة — ولا تُخزَّن.
   *
   * الدخول بالمفتاح العام لا بمفتاح خدمة: من يكتب بريده وكلمة سرّه هو من
   * يملكهما، ولا ينتحل الخادم أحداً. وهذه جلسة مستقلة عن جلسة التطبيق، فلا
   * يخرج المستخدم من تلفونه حين تُدوَّر رموز هذه.
   */
  const auth = createClient(context.config.url, context.config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await auth.auth.signInWithPassword({ email, password })

  if (error || !data.session) {
    return new Response(
      loginPage({ ...parsed, error: 'البريد أو كلمة السر غير صحيحة.' }),
      { status: 401, headers: HTML_HEADERS },
    )
  }

  const code = await seal(
    context.secret,
    'code',
    {
      refresh_token: data.session.refresh_token,
      access_token: data.session.access_token,
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

  return new Response(null, { status: 302, headers: { location: target.toString() } })
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

/** صفحة تُعرض حين يُفتح رابط الخادم في متصفّح بلا سياق OAuth. */
export function landing(context: OAuthContext): Response {
  return new Response(noticePage(context.baseUrl), { headers: HTML_HEADERS })
}
