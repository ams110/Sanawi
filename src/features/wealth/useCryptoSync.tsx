import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listCryptoWallets, syncCryptoWallets, type CryptoSyncResult } from './crypto'

/**
 * تحديث قيم المحافظ عند فتح شاشة الثروة — الوتيرة التي اختارها صاحب التطبيق.
 *
 * لماذا عند الفتح لا بجدولة؟ لأن سعر العملات يتحرّك كل دقيقة، ورقمٌ محفوظٌ من
 * أمس يكذب بثقة؛ والجدولة تنادي المنصّات ألف مرة لأحدٍ لا ينظر. فالنداء يقع
 * حين — وحين فقط — يُفتح السؤال الذي يحتاجه.
 *
 * و`staleTime` دقيقة: التنقّل بين مقاطع المحور الأربعة فتحٌ واحدٌ لا أربعة،
 * ومنصّاتُ التداول تحدّ النداءات وتحجب من يتجاوز.
 */
const STALE_MS = 60_000

export function useCryptoWallets() {
  return useQuery({ queryKey: ['crypto-wallets'], queryFn: listCryptoWallets })
}

export interface CryptoSyncState {
  /** ما رجع من آخر مزامنة — لعرض «هذه المحفظة فشلت ولماذا». */
  result: CryptoSyncResult | null
  syncing: boolean
  /** فشلٌ عامّ (لا فشل محفظةٍ بعينها): شبكةٌ أو دالّةٌ لم تردّ. */
  failed: boolean
}

/**
 * المزامنة نفسها.
 *
 * تُنادى من `useWealth` فتغطّي مقاطع المحور الأربعة بمفتاحٍ واحد. ونجاحُها
 * يُبطل `['wealth']` كي تُقرأ الأصول من جديد — بلا ذلك يُكتب الرقم في القاعدة
 * ويبقى على الشاشة القديم، وهو أسوأ من ألّا يُكتب.
 *
 * ولا محافظ = لا نداء: `enabled` تمنع رحلةً لا جواب لها.
 */
export function useCryptoSync(hasWallets: boolean): CryptoSyncState {
  const client = useQueryClient()

  const { data, isFetching, isError } = useQuery({
    queryKey: ['crypto-sync'],
    queryFn: async () => {
      const result = await syncCryptoWallets()
      await client.invalidateQueries({ queryKey: ['wealth'] })
      await client.invalidateQueries({ queryKey: ['crypto-wallets'] })
      return result
    },
    enabled: hasWallets,
    staleTime: STALE_MS,
    // منصّةٌ لا تردّ لا تُعاد محاولتها ثلاثاً: التأخير يظهر شاشةً متجمّدة،
    // والقيمة السابقة معروضةٌ أصلاً — الفشل يُقال ولا يُلحّ عليه.
    retry: false,
  })

  return { result: data ?? null, syncing: isFetching, failed: isError }
}
