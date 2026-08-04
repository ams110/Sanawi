/**
 * نقل HTTP — لخادمٍ بعيد يُضاف إلى كلود برابط، بلا جهاز يشغّله.
 *
 * مبنيّ على `Request`/`Response` القياسيين لا على أنواع Node، فيعمل كما هو في
 * Deno وSupabase Edge Functions وأي بيئة تفهم fetch. هذا هو الفرق الذي يجعل
 * الخادم قابلاً للنشر أصلاً: صاحب التطبيق على تلفونه، ولا كمبيوتر يشغّل
 * عمليةً عبر stdio.
 *
 * عديم الحالة: كل نداء POST يحمل رسالة JSON-RPC واحدة، ويُبنى له خادمٌ جديد
 * فيردّ ثم يُغلق. لا جلسات ولا SSE — أبسط ما يفي بالبروتوكول، وأقلّ ما يمكن
 * أن ينكسر في بيئة تُطفَأ فيها العملية بين النداءين.
 *
 * أمّا جلسة Supabase فتُشارَك بين النداءات داخل النسخة الواحدة: `connect`
 * يُمرَّر من الخارج محفوظاً، فلا يتكرّر تسجيل الدخول مع كل رسالة.
 */

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createSanawiServer, SERVER_INFO } from './server.js'
import {
  createSession,
  createUserSession,
  readConfig,
  type Config,
  type Connection,
} from './session.js'
import { env } from './env.js'
import { open } from './oauth/tokens.js'
import {
  authorizationServerMetadata,
  authorizeForm,
  authorizeSubmit,
  landing,
  protectedResourceMetadata,
  register,
  token as token_,
  type OAuthContext,
} from './oauth/endpoints.js'

/**
 * نقلٌ لرسالة واحدة.
 *
 * `StreamableHTTPServerTransport` في SDK مكتوب على `IncomingMessage` و
 * `ServerResponse` من Node، وهما غير موجودين في Deno. النقل هنا يحقّق الواجهة
 * نفسها بأبسط شكل: ندفع الرسالة الواردة، وننتظر أول رسالة صادرة.
 */
class SingleMessageTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void
  onclose?: () => void
  onerror?: (error: Error) => void

  private settle!: (message: JSONRPCMessage | null) => void
  readonly reply: Promise<JSONRPCMessage | null>

  constructor() {
    this.reply = new Promise((resolve) => {
      this.settle = resolve
    })
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.settle(message)
  }

  async close(): Promise<void> {
    // من لم يردّ لا يُنتظر إلى الأبد: الإشعارات تُغلق بلا رد وهذا صحيح.
    this.settle(null)
    this.onclose?.()
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

/**
 * ترويسات CORS.
 *
 * كلود ينادي الخادم من متصفّح المستخدم في بعض المسارات، فبدونها يُرفض النداء
 * قبل أن يصل إلى الكود. `mcp-protocol-version` و`mcp-session-id` ترويستان
 * يرسلهما العميل، ويجب أن تكونا مسموحتين صراحةً.
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id, x-sanawi-token',
  'access-control-max-age': '86400',
}

/** ترويسات CORS على ردود OAuth أيضاً: العميل قد ينادي الاكتشاف من متصفّح. */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

function jsonRpcError(id: unknown, code: number, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }),
    { status, headers: { ...JSON_HEADERS, ...CORS_HEADERS } },
  )
}

/**
 * هل يحمل النداء المفتاح؟
 *
 * الرابط عام، والبيانات مالية. المفتاح يُقبل من ثلاثة مواضع لأن عملاء MCP
 * يختلفون فيما يسمحون بضبطه: ترويسة `Authorization: Bearer`، أو ترويسة
 * `x-sanawi-token`، أو آخر مقطع في المسار — وهذا الأخير هو ما يعمل مع عميلٍ
 * لا يقبل إلا رابطاً مجرّداً.
 *
 * المقارنة بطول ثابت: مقارنة النصوص العادية تخرج عند أول حرف مختلف، وفرقُ
 * الزمن يسرّب المفتاح حرفاً حرفاً لمن يقيسه.
 */
function tokenMatches(request: Request, url: URL, expected: string): boolean {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const header = request.headers.get('x-sanawi-token')
  const tail = url.pathname.split('/').filter(Boolean).at(-1)

  return [bearer, header, tail].some((value) => value !== undefined && safeEqual(value, expected))
}

function safeEqual(a: string | null | undefined, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface HttpHandlerOptions {
  config: Config
  /** جلسة الحساب الواحد — للوضع الشخصي بمفتاح ثابت. غائبة مع OAuth وحده. */
  connect?: () => Promise<Connection>
  /** المفتاح الثابت للوضع الشخصي. فارغ = لا وضع شخصي. */
  token: string
  /** سرّ تشفير رموز OAuth. فارغ = لا OAuth. */
  oauthSecret: string
  /** العنوان العام المعلن. فارغ = يُستنتج من الترويسات. */
  publicUrl?: string
  /** لحقن زمنٍ ثابت في الفحص. */
  now?: () => number
}

/**
 * جذر الخادم كما يراه العميل.
 *
 * كل روابط OAuth تُبنى منه، وخطؤه يكسر الدورة كلها: العميل يقرأ عنوان خادم
 * التفويض من هنا ويذهب إليه، فإن كان ناقصاً وجد 404 وتوقّف عند أول خطوة.
 *
 * ولا يكفي أن نقرأه من الطلب. Supabase يقصّ `/functions/v1` قبل أن يصل
 * الدالّة، فترى `/sanawi-mcp` بينما العنوان العام `/functions/v1/sanawi-mcp`.
 * حدث ذلك فعلاً في أول نشر: أُعلنت روابط ناقصة، وما كان لأي فحص محلي أن يكشفه
 * لأن القصّ يقع في وكيلٍ لا يوجد إلا هناك.
 *
 * فالترتيب: إعدادٌ صريح أولاً (`SANAWI_PUBLIC_URL` — يضبطه التدفّق وهو يعرف
 * العنوان يقيناً)، ثم استنتاجٌ من الترويسات يعوّض قصّ Supabase، ثم الطلب نفسه.
 */
function baseUrlOf(request: Request, url: URL, declared: string): string {
  if (declared) return declared.replace(/\/+$/, '')

  const host = request.headers.get('x-forwarded-host') ?? url.host
  const proto =
    request.headers.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')

  // مسارات OAuth ومسار الاكتشاف ليست جزءاً من هوية المورد — تُقصّ منها.
  let path = url.pathname
    .replace(/\/(authorize|token|register)$/, '')
    .replace(/\/\.well-known\/[^/]+$/, '')
    .replace(/\/+$/, '')

  // تعويض ما يقصّه وكيل Supabase حين لا يُضبط العنوان صراحةً.
  if (host.endsWith('.supabase.co') && !path.startsWith('/functions/v1')) {
    path = `/functions/v1${path}`
  }

  return `${proto}://${host}${path}`
}

export function createFetchHandler(options: HttpHandlerOptions) {
  const { config, connect, token, oauthSecret } = options
  const publicUrl = (options.publicUrl ?? '').trim()
  const clock = options.now ?? (() => Date.now())

  /** يحدّد بأيّ هويةٍ يعمل هذا النداء: مستخدمُ OAuth، أم الحساب الشخصي. */
  async function resolve(
    request: Request,
    url: URL,
  ): Promise<{ connect: () => Promise<Connection> } | Response> {
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')?.trim()

    if (oauthSecret && bearer) {
      const claims = await open<{ jwt: string; sub?: string }>(
        oauthSecret,
        'access',
        bearer,
        clock(),
      )
      if (claims?.jwt && claims.sub) {
        return { connect: createUserSession(config, claims.jwt, claims.sub) }
      }
      // رمزٌ لا يُفكّ قد يكون المفتاح الثابت — نُكمل إليه قبل الرفض.
    }

    if (token && tokenMatches(request, url, token) && connect) return { connect }

    if (oauthSecret) {
      /*
       * 401 مع `WWW-Authenticate` هي بداية دورة OAuth لا نهايتها: بها يعرف
       * كلود أين يسأل عن خادم التفويض، فيفتح صفحة الدخول من تلقائه. حذفُها
       * يجعل الرفض جداراً مسدوداً بدل أن يكون دعوةً لتسجيل الدخول.
       */
      const resource = `${baseUrlOf(request, url, publicUrl)}/.well-known/oauth-protected-resource`
      return new Response(
        JSON.stringify({ error: 'unauthorized', error_description: 'سجّل دخولك أولاً.' }),
        {
          status: 401,
          headers: {
            ...JSON_HEADERS,
            ...CORS_HEADERS,
            'www-authenticate': `Bearer resource_metadata="${resource}"`,
          },
        },
      )
    }

    return jsonRpcError(null, -32001, 'مفتاح غير صحيح.', 401)
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    /* ── مسارات OAuth ─────────────────────────────────────── */

    if (oauthSecret) {
      const context: OAuthContext = {
        config,
        secret: oauthSecret,
        baseUrl: baseUrlOf(request, url, publicUrl),
        now: clock(),
      }

      if (path.endsWith('/.well-known/oauth-protected-resource')) {
        return withCors(protectedResourceMetadata(context))
      }
      if (
        path.endsWith('/.well-known/oauth-authorization-server') ||
        path.endsWith('/.well-known/openid-configuration')
      ) {
        return withCors(authorizationServerMetadata(context))
      }
      if (path.endsWith('/register') && request.method === 'POST') {
        return withCors(await register(context, request))
      }
      if (path.endsWith('/authorize')) {
        return request.method === 'POST'
          ? await authorizeSubmit(context, request)
          : await authorizeForm(context, url.searchParams)
      }
      if (path.endsWith('/token') && request.method === 'POST') {
        return withCors(await token_(context, request))
      }
    }

    if (request.method === 'GET') {
      // العميل يفتح GET ليطلب قناة SSE. لا نملكها — والبروتوكول يجعل 405 هي
      // الإجابة الصحيحة، فينتقل العميل إلى الردّ المباشر بدل أن ينتظر بثّاً
      // لا يأتي.
      if ((request.headers.get('accept') ?? '').includes('text/event-stream')) {
        return jsonRpcError(null, -32601, 'لا بثّ SSE — الردود مباشرة على POST.', 405)
      }
      // متصفّحٌ فتح الرابط: صفحةٌ تشرح ما هذا بدل JSON لا يعني له شيئاً.
      if ((request.headers.get('accept') ?? '').includes('text/html') && oauthSecret) {
        return landing({ config, secret: oauthSecret, baseUrl: baseUrlOf(request, url, publicUrl), now: clock() })
      }
      return new Response(
        JSON.stringify({
          ...SERVER_INFO,
          transport: 'http',
          readOnly: config.readOnly,
          auth: oauthSecret ? 'oauth' : 'token',
        }),
        { headers: { ...JSON_HEADERS, ...CORS_HEADERS } },
      )
    }

    if (request.method === 'DELETE') {
      // إنهاء جلسة — لا جلسات هنا، فالإنهاء ناجح بلا عمل.
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (request.method !== 'POST') {
      return jsonRpcError(null, -32600, 'الطريقة غير مدعومة — استعمل POST.', 405)
    }

    const identity = await resolve(request, url)
    if (identity instanceof Response) return identity

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return jsonRpcError(null, -32700, 'جسم الطلب ليس JSON صالحاً.', 400)
    }

    // الدفعات أُزيلت من البروتوكول، لكن عميلاً قديماً قد يرسلها — نرفضها بوضوح
    // بدل أن نعالج أول رسالة ونُسقط الباقي صامتين.
    if (Array.isArray(payload)) {
      return jsonRpcError(null, -32600, 'الدفعات غير مدعومة — أرسل رسالة واحدة.', 400)
    }

    const message = payload as JSONRPCMessage & { id?: unknown; method?: unknown }
    const server = createSanawiServer(config, identity.connect)
    const transport = new SingleMessageTransport()

    /*
     * الإشعار لا رد له.
     *
     * `notifications/initialized` يصل بلا `id`، فانتظارُ ردٍّ عليه انتظارٌ لما
     * لا يأتي — وهو تعليقٌ تامّ للنداء لا خطأ يظهر. نميّزه قبل الانتظار لا
     * بعده، ونردّ 202 كما يتوقّع البروتوكول.
     */
    const isNotification = message.id === undefined || message.id === null

    try {
      await server.connect(transport)
      transport.onmessage?.(message)

      if (isNotification) return new Response(null, { status: 202, headers: CORS_HEADERS })

      const reply = await transport.reply
      if (!reply) return new Response(null, { status: 202, headers: CORS_HEADERS })

      return new Response(JSON.stringify(reply), {
        headers: { ...JSON_HEADERS, ...CORS_HEADERS },
      })
    } catch (error) {
      return jsonRpcError(
        message.id,
        -32603,
        error instanceof Error ? error.message : String(error),
        500,
      )
    } finally {
      await server.close().catch(() => {})
    }
  }
}

/**
 * المدخل الجاهز لبيئات fetch.
 *
 * يقرأ الإعداد ويُنشئ الجلسة مرة واحدة عند تحميل الوحدة، فتُعاد على كل النداءات
 * ما دامت النسخة حيّة. سقوط الإعداد يصير رداً 500 مفهوماً لا انهياراً صامتاً
 * عند أول رسالة.
 */
export function createSanawiFetchHandler(): (request: Request) => Promise<Response> {
  try {
    const config = readConfig()
    const token = (env('SANAWI_MCP_TOKEN') ?? '').trim()
    const oauthSecret = (env('SANAWI_TOKEN_SECRET') ?? '').trim()

    if (!oauthSecret && !token) {
      throw new Error(
        'لا SANAWI_TOKEN_SECRET ولا SANAWI_MCP_TOKEN. الرابط عام والبيانات مالية،\n' +
          'فبلا أحدهما يقرأ الحساباتِ من يعرف الرابط.\n' +
          'لوضع متعدّد المستخدمين (OAuth): ولّد SANAWI_TOKEN_SECRET عشوائياً طويلاً.\n' +
          'وللوضع الشخصي بحسابٍ واحد: SANAWI_MCP_TOKEN مع SANAWI_EMAIL و SANAWI_PASSWORD.',
      )
    }

    // المفتاح يشفّر رموز كل المستخدمين، فقِصَره يكسر الجميع دفعةً واحدة.
    if (oauthSecret && oauthSecret.length < 32) {
      throw new Error('SANAWI_TOKEN_SECRET أقصر من 32 حرفاً — به تُشفَّر رموز كل المستخدمين.')
    }

    // جلسة الحساب الواحد تُبنى فقط حين يوجد وضعٌ شخصي فعلاً.
    const personal = token && config.email && config.password ? createSession(config) : undefined

    return createFetchHandler({
      config,
      connect: personal,
      token,
      oauthSecret,
      publicUrl: (env('SANAWI_PUBLIC_URL') ?? '').trim(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return async () =>
      new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...JSON_HEADERS, ...CORS_HEADERS },
      })
  }
}
