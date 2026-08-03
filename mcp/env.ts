/**
 * قراءة متغيّرات البيئة في Node وDeno معاً.
 *
 * الخادم يعمل في مكانين: عمليةُ Node يشغّلها عميل MCP على جهاز، ودالّةُ Deno
 * على Supabase. `process.env` غير موجود في الثانية و`Deno.env` غير موجود في
 * الأولى، ولمسُ أيّهما مباشرةً يكسر النصف الآخر عند التحميل لا عند الاستعمال.
 */

interface DenoLike {
  env?: { get(key: string): string | undefined }
}
interface ProcessLike {
  env?: Record<string, string | undefined>
}

export function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: DenoLike }).Deno
  if (deno?.env) return deno.env.get(name)
  return (globalThis as { process?: ProcessLike }).process?.env?.[name]
}
