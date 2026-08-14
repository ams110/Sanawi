/**
 * تنفيذ التوقيع — الخطوة الوحيدة التي تحتاج `crypto.subtle`.
 *
 * ‏`exchanges.ts` يقول **ما** يُوقَّع، وهذا الملف يقول **كيف**: مفتاحٌ يُستورد،
 * وهضمٌ يُحسب، وترميزٌ يُختار، والتوقيع يوضع في ترويسةٍ أو في الـ query.
 * والفصل مقصود: نصّ التوقيع هو ما يختلف بين ست منصّات، وهذا الجزء واحدٌ
 * لها كلها — فيُكتب مرة.
 *
 * ‏WebCrypto قياسيٌّ في المتصفح وDeno وNode معاً، فالملف يعمل في دالّة الحافة
 * ويُختبر في vitest بلا نسخةٍ ثانية.
 *
 * **السرّ يدخل هنا ولا يخرج**: لا يُسجَّل ولا يُعاد في أي حقل — رسائل الخطأ
 * تقول «فشل التوقيع» ولا تقتبس شيئاً من مدخلاتها.
 */

import type { SignedRequest } from './exchanges.js'

export interface PreparedRequest {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: string
}

const encoder = new TextEncoder()

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

const toBase64 = (bytes: ArrayBuffer): string => {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** ضمّ مصفوفتَي بايت — نصّ Kraken نصفُه حروفٌ ونصفُه هضمٌ ثنائي. */
const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/**
 * توقيع الطلب وإخراجه جاهزاً للإرسال.
 *
 * ‏`signatureHeader === null` تعني Binance: التوقيع باراميترٌ يُلحق بالـ query
 * **بعد** كل شيء — إلحاقُه قبل باراميترٍ آخر يُبطله لأن النصّ الموقَّع هو
 * الـ query بلا التوقيع.
 */
export async function signRequest(
  request: SignedRequest,
  apiSecret: string,
): Promise<PreparedRequest> {
  const secretBytes = request.secretIsBase64
    ? fromBase64(apiSecret)
    : encoder.encode(apiSecret)

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes as unknown as BufferSource,
    { name: 'HMAC', hash: request.algorithm },
    false,
    ['sign'],
  )

  /*
   * Kraken وحدها: النصّ = المسار + SHA256(nonce + الجسم) — بايتاتٍ لا حروفاً.
   * تحويل الهضم إلى hex قبل الضمّ خطأٌ صامت يردّ «Invalid key» بلا أن يقول أين.
   */
  const message = request.prehash
    ? concat(
        encoder.encode(request.prehash.prefix),
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', encoder.encode(request.prehash.sha256Of)),
        ),
      )
    : encoder.encode(request.payload)

  const raw = await crypto.subtle.sign('HMAC', key, message as unknown as BufferSource)
  const signature = request.encoding === 'hex' ? toHex(raw) : toBase64(raw)

  const headers = { ...request.headers }
  let url = request.url

  if (request.signatureHeader) headers[request.signatureHeader] = signature
  else url += `${url.includes('?') ? '&' : '?'}signature=${signature}`

  return request.body === undefined
    ? { method: request.method, url, headers }
    : { method: request.method, url, headers, body: request.body }
}
