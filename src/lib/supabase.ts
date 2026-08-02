import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './db/types'

const url = import.meta.env.VITE_SUPABASE_URL
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
