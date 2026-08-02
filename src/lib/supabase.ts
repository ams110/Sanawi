import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './db/types'

// رابط نسبيّ يعني التمرير عبر خادم التطوير (انظر vite.config.ts)؛
// نحوّله إلى مطلق لأن supabase-js يشترط ذلك.
const rawUrl = import.meta.env.VITE_SUPABASE_URL
const url = rawUrl?.startsWith('/') ? `${window.location.origin}${rawUrl}` : rawUrl
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
