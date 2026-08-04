/**
 * الرموز: مغلّفات مشفّرة، بلا جدول ولا حالة.
 *
 * خادم التفويض يحتاج أن يتذكّر أشياء بين نداءين: مَن سجّل العميل، وأيُّ رمزِ
 * تفويضٍ يخصّ أيَّ مستخدم. الطريقة المعتادة جدولٌ في القاعدة — لكن قراءته قبل
 * معرفة المستخدم تستلزم مفتاح خدمة، وهو بالضبط ما رفضناه.
 *
 * فبدل أن نخزّن ونستعلم، نضع المحتوى **داخل الرمز نفسه** مشفّراً بمفتاح لا
 * يملكه إلا الخادم. الرمز يصير حاملاً لمعناه: من يمسكه بلا المفتاح يرى ضجيجاً،
 * ومن يعدّله يكسر بصمة AES-GCM فيُرفض.
 *
 * ولكل نوعِ رمزٍ «غرضٌ» يدخل في البصمة (AAD): رمزُ تفويضٍ لا يُقبل مكان رمز
 * وصول ولو كان المفتاح واحداً. بدون ذلك يصير أضعفُ الرموز عمراً مفتاحاً لأقواها.
 *
 * الثمن المقبول: لا إلغاء لرمزٍ بعينه. تبديل SANAWI_TOKEN_SECRET يُلغي الجميع،
 * وهو ما يناسب حجم هذا التطبيق. والرموز قصيرة العمر أصلاً.
 */

export type Purpose = 'client' | 'code' | 'access' | 'refresh'

/*
 * `crypto.subtle` موجود في Node 22 وDeno معاً، لكن نوع `CryptoKey` يأتي من
 * مكتبة DOM وهي غير محمّلة هنا (الخادم ليس متصفّحاً). الاسم المستعار يكفي:
 * المفتاح لا يُقرأ ولا يُفكَّك، إنما يُمرَّر كما هو إلى `encrypt` و`decrypt`.
 */
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let cached: { secret: string; key: Key } | null = null

async function keyFor(secret: string): Promise<Key> {
  if (cached?.secret === secret) return cached.key
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
  cached = { secret, key }
  return key
}

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/** يغلّف قيمةً مع تاريخ انتهائها. الغرض يدخل البصمة فلا يصلح رمزٌ مكان آخر. */
export async function seal(
  secret: string,
  purpose: Purpose,
  payload: Record<string, unknown>,
  ttlSeconds: number,
  now: number,
): Promise<string> {
  const key = await keyFor(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = encoder.encode(JSON.stringify({ ...payload, exp: now + ttlSeconds * 1000 }))

  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(purpose) },
    key,
    body,
  )

  const out = new Uint8Array(iv.length + sealed.byteLength)
  out.set(iv)
  out.set(new Uint8Array(sealed), iv.length)
  return base64url(out)
}

/** يفكّ الغلاف ويتحقّق من الغرض والانتهاء. أي خلل يعيد null لا استثناءً. */
export async function open<T extends Record<string, unknown>>(
  secret: string,
  purpose: Purpose,
  token: string,
  now: number,
): Promise<T | null> {
  try {
    const raw = fromBase64url(token)
    if (raw.length < 13) return null

    const key = await keyFor(secret)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: encoder.encode(purpose) },
      key,
      raw.slice(12),
    )

    const value = JSON.parse(decoder.decode(plain)) as T & { exp?: number }
    if (typeof value.exp !== 'number' || value.exp < now) return null
    return value
  } catch {
    return null
  }
}

/** تحقّق PKCE: S256 فقط — `plain` يجعل اعتراضَ الرمز كافياً لسرقته. */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return base64url(new Uint8Array(digest)) === challenge
}

/** قراءة `sub` و`exp` من JWT بلا تحقّق — التحقّق تفعله Supabase عند الاستعمال. */
export function readJwtClaims(jwt: string): { sub?: string; exp?: number } {
  try {
    const part = jwt.split('.')[1]
    if (!part) return {}
    return JSON.parse(decoder.decode(fromBase64url(part))) as { sub?: string; exp?: number }
  } catch {
    return {}
  }
}
