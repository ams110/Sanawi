import { useCallback, type ReactNode } from 'react'
import {
  QueryClient,
  QueryClientProvider,
  useIsFetching,
  useQueryClient,
} from '@tanstack/react-query'

/**
 * جلب البيانات كلّه على react-query.
 *
 * قبلها كان لكل شاشة نمطُها اليدوي: `useState` ثلاثي (صفوف/تحميل/خطأ) مع
 * `useCallback` يعتمد على عدّاد تحديثٍ عام — خمس عشرة نسخةً من الكود نفسه،
 * وكل تنقّلٍ بين المقاطع يمسح الشاشة إلى هيكلٍ عظمي ويجلب من الصفر.
 *
 * القرار الجوهري: **بقاء `staleTime` صفراً**. العودة إلى شاشةٍ تُظهر
 * نسختها المخزّنة فوراً ثم تجلب الجديد في الخلفية — سرعة الكاش بنضارة
 * الجلب عند كل فتح، ولا نافذة يظهر فيها رقمٌ قديم بعد كتابةٍ من شاشةٍ
 * أخرى. رفعُه قرارُ موازنةٍ يُتّخذ صراحةً حين تظهر حاجته، لا افتراضاً.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // محاولةٌ ثانية تكفي: الفشل الحقيقي يظهر بسرعة، وتعثّر الشبكة العابر يُبلع.
      retry: 1,
      /*
       * لا جلب عند عودة التركيز: داخل تغليف أندرويد تتقلّب الرؤية مع كل
       * إقفال شاشةٍ وفتحها، فيصير التطبيق يجلب في جيب صاحبه. زرّ التحديث
       * وإعادةُ الجلب عند التركيب هما قناتا النضارة المقصودتان.
       */
      refetchOnWindowFocus: false,
    },
  },
})

export function RefreshProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

interface RefreshValue {
  /** يوسم كل الاستعلامات قديمةً فيعاد جلب المعروض منها — زرّ التحديث اليدوي. */
  refresh: () => void
  /** جلبٌ جارٍ في أي مكان — تدور به أيقونة الزر. */
  busy: boolean
  /** إعادة تحميل التطبيق نفسه لالتقاط نسخة واجهة جديدة — تخصّ النسخ لا البيانات. */
  reloadApp: () => void
}

/**
 * تحديث يدوي لكل الشاشات.
 *
 * داخل تطبيق مغلّف لا يوجد زر تحديث المتصفح ولا سحب لأسفل، فبدون هذا لا
 * سبيل إلى بيانات جديدة إلا إغلاق التطبيق وفتحه. الإبطال عامٌّ عمداً:
 * البيانات هنا عشرات الصفوف، وضغطةُ التحديث تعني «ورّيني كل الجديد» لا
 * «حدّث هذه الشاشة وحدها».
 */
export function useRefresh(): RefreshValue {
  const client = useQueryClient()
  const busy = useIsFetching() > 0

  const refresh = useCallback(() => {
    void client.invalidateQueries()
  }, [client])

  const reloadApp = useCallback(() => {
    window.location.reload()
  }, [])

  return { refresh, busy, reloadApp }
}
