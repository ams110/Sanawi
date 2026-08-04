/**
 * الاتصال بحساب المستخدم في سنوي.
 *
 * ندخل بالبريد وكلمة السر عبر المفتاح العام (anon)، لا بمفتاح الخدمة:
 * هكذا يبقى حارسُ البيانات هو نفسه الذي يحرس التطبيق — سياسات RLS — فلا يرى
 * هذا الخادم صفاً واحداً لا يراه المستخدم في شاشته. مفتاح الخدمة يتجاوز RLS
 * كلها، وخادمٌ يعمل بصلاحية مطلقة على بيانات مالية ويُسلَّم لنموذج لغوي هو
 * بالضبط ما لا نريد.
 *
 * ملف نقي من MCP: لا يعرف شيئاً عن الأدوات ولا عن البروتوكول.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'
import type { Database } from '../src/lib/db/types.js'

export type Db = SupabaseClient<Database>

export interface Config {
  url: string
  anonKey: string
  /** حساب واحد للوضع الشخصي (stdio أو مفتاح ثابت). فارغ مع OAuth. */
  email: string
  password: string
  /** يخفي أدوات الكتابة كلها — لا يعطّلها فقط. */
  readOnly: boolean
}

/** خطأ إعداد: رسالته تُطبع للمستخدم كما هي، فلتكن قابلة للتنفيذ لا للتشخيص. */
export class ConfigError extends Error {}

/**
 * `VITE_*` بديلٌ مقبول لأن ملف `.env` الموجود أصلاً في المشروع يحملهما،
 * فمن يشغّل الخادم من داخل المستودع لا يحتاج نسخ القيم مرتين.
 */
function readEnv(primary: string, fallback?: string): string | undefined {
  const value = env(primary) ?? (fallback ? env(fallback) : undefined)
  return value?.trim() || undefined
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

/**
 * `requireAccount` يفرّق بين وضعين: خادم stdio يعمل بحساب واحد فيلزمه بريدٌ
 * وكلمة سرّ، وخادم OAuth يدخل كلُّ مستخدمٍ إليه بنفسه فلا يلزمه حسابٌ في إعداده.
 */
export function readConfig(options: { requireAccount?: boolean } = {}): Config {
  const url = readEnv('SANAWI_SUPABASE_URL', 'VITE_SUPABASE_URL')
  const anonKey = readEnv('SANAWI_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
  const email = readEnv('SANAWI_EMAIL')
  const password = readEnv('SANAWI_PASSWORD')

  const missing = [
    !url && 'SANAWI_SUPABASE_URL',
    !anonKey && 'SANAWI_SUPABASE_ANON_KEY',
    ...(options.requireAccount ? [!email && 'SANAWI_EMAIL', !password && 'SANAWI_PASSWORD'] : []),
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new ConfigError(
      `ناقص في إعداد خادم سنوي: ${missing.join('، ')}.\n` +
        'ضَعها في قسم env داخل إعداد الخادم عند كلود.\n' +
        'الرابط والمفتاح العام من Supabase ← Settings ← API،\n' +
        'والبريد وكلمة السر هما نفسهما اللذان تدخل بهما التطبيق.',
    )
  }

  // نتحقق من الرابط هنا لا عند أول نداء: خطأ مطبعي في الرابط يظهر عند التشغيل
  // برسالة مفهومة، بدل أن يظهر لاحقاً كفشل شبكة غامض داخل أداة.
  try {
    new URL(url!)
  } catch {
    throw new ConfigError(
      `SANAWI_SUPABASE_URL ليس رابطاً صالحاً: ${url}\n` +
        'الشكل المتوقّع: https://YOUR_PROJECT_REF.supabase.co',
    )
  }

  return {
    url: url!,
    anonKey: anonKey!,
    email: email ?? '',
    password: password ?? '',
    readOnly: TRUTHY.has((env('SANAWI_READ_ONLY') ?? '').trim().toLowerCase()),
  }
}

export interface Connection {
  db: Db
  userId: string
  /** العملة واللغة من ملف المستخدم — لا تُثبَّت في الكود. */
  currency: string
}

/**
 * جلسة واحدة تُعاد على كل الأدوات.
 *
 * الدخول كسول ومحفوظ في وعد واحد: عشرُ أدوات تُنادى بالتوازي تُنتج دخولاً
 * واحداً لا عشرة. وإن فشل الدخول نُفرغ الوعد ليُعاد المحاولة في النداء التالي،
 * فلا تبقى الجلسة عالقة على فشل عابر في الشبكة.
 */
/**
 * جلسة مستخدمٍ بعينه من رمز وصوله.
 *
 * الرمز يُمرَّر في ترويسة كل نداء إلى PostgREST، فتنطبق سياسات RLS على صاحبه
 * هو — لا على حسابٍ واحدٍ مشترك. هذا ما يجعل خادماً واحداً يخدم كل مستخدمي
 * التطبيق بلا أن يرى أحدهم صفّاً لغيره.
 *
 * ولا نسأل الشبكة عن هوية صاحب الرمز: `sub` مقروء من داخل JWT، والتحقّق من
 * التوقيع تفعله Supabase عند أول استعلام. سؤالٌ إضافي هنا يضيف رحلةَ شبكةٍ
 * على كل نداء بلا أن يضيف أماناً.
 */
export function createUserSession(
  config: Config,
  accessToken: string,
  userId: string,
): () => Promise<Connection> {
  const db: Db = createClient<Database>(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  let pending: Promise<Connection> | null = null

  return function connect(): Promise<Connection> {
    if (!pending) {
      pending = (async () => {
        const { data } = await db.from('profiles').select('currency').eq('id', userId).maybeSingle()
        return { db, userId, currency: data?.currency ?? 'ILS' }
      })().catch((error: unknown) => {
        pending = null
        throw error
      })
    }
    return pending
  }
}

export function createSession(config: Config): () => Promise<Connection> {
  const db: Db = createClient<Database>(config.url, config.anonKey, {
    auth: {
      // لا تخزين على القرص: العملية قصيرة العمر ولا نريد أثراً لجلسة مالية
      // في ملف مؤقّت. التحديث التلقائي يبقى فعّالاً في الذاكرة.
      persistSession: false,
      autoRefreshToken: true,
    },
  })

  let pending: Promise<Connection> | null = null

  async function login(): Promise<Connection> {
    const { data, error } = await db.auth.signInWithPassword({
      email: config.email,
      password: config.password,
    })

    if (error) {
      throw new Error(
        `فشل الدخول إلى سنوي: ${error.message}\n` +
          'تأكّد من SANAWI_EMAIL و SANAWI_PASSWORD، ومن أن الحساب نفسه يفتح التطبيق.',
      )
    }
    if (!data.user) {
      throw new Error('الدخول نجح بلا مستخدم — أعد المحاولة، وإن تكرّر فراجع إعدادات Supabase.')
    }

    const { data: profile } = await db
      .from('profiles')
      .select('currency')
      .eq('id', data.user.id)
      .maybeSingle()

    return { db, userId: data.user.id, currency: profile?.currency ?? 'ILS' }
  }

  return function connect(): Promise<Connection> {
    if (!pending) {
      pending = login().catch((error: unknown) => {
        pending = null
        throw error
      })
    }
    return pending
  }
}
