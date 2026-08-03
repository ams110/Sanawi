import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './db/types'

/**
 * رابط نسبيّ يعني التمرير عبر خادم التطوير (انظر vite.config.ts)، ونحوّله
 * إلى مطلق لأن supabase-js يرفض غير ذلك.
 *
 * خارج المتصفح لا يوجد origin نبني عليه، فنرجع undefined ليقع الاستدعاء على
 * القيمة البديلة أدناه. بدون هذا ينهار استيراد الملف في Node وتسقط معه كل
 * ملفات الاختبار التي تمسّ طبقة البيانات — ولو كان ما تختبره دوالَّ نقية.
 */
function resolveUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (!raw.startsWith('/')) return raw
  return typeof window === 'undefined' ? undefined : `${window.location.origin}${raw}`
}

const url = resolveUrl(import.meta.env.VITE_SUPABASE_URL)
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * هل التطبيق مضبوط أصلاً؟
 *
 * لا ننشئ عميلاً بقيم فارغة ثم ننهار عند أول نداء: نكشف الحالة هنا،
 * وتعرض الواجهة شاشة إعداد مفهومة بدل شاشة بيضاء وخطأ في وحدة التحكم.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient<Database> = createClient<Database>(
  url ?? 'http://localhost:54321',
  anonKey ?? 'anon',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // الجلسة تُحفظ محلياً فيبقى المستخدم داخلاً بعد إغلاق التطبيق.
      storageKey: 'sanawi.auth',
    },
  },
)
