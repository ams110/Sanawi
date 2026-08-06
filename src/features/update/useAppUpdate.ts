import { useCallback, useEffect, useRef, useState } from 'react'
import { isNewBuild, readBuildId } from '@/lib/version'

/**
 * النسخة الجديدة تصل بلا أن يُطلب من صاحبها شيء.
 *
 * التطبيق على الهاتف قشرةٌ تفتح الموقع، فالنشر يصل بإعادة تحميلٍ لا بتنصيب.
 * لكن من يستأنف تطبيقاً كان في الخلفية لا يقع عنده تحميل: الصفحة القديمة
 * ما زالت حيّة، فيرى شهراً مضى وميزةً لم تصل ويظنّ أن النشر لم يقع. حدث هذا
 * بعد دمجٍ نجح فعلاً.
 *
 * فهنا قاعدتان تفصل بينهما لحظةُ المستخدم:
 *   - عاد إلى التطبيق بعد غياب: يُعاد التحميل فوراً — لا شيء يُكتب الآن،
 *     وإعادةُ التحميل في هذه اللحظة تبدو كفتحةٍ عادية.
 *   - وهو داخل التطبيق يعمل: لا يُقطع عليه. شريطٌ يقول «في نسخة جديدة»
 *     وزرُّه بيده.
 */

/** كم يبقى التطبيق مخفياً حتى يُعدّ غياباً — أقلّ من ذلك تنقّلٌ بين النوافذ. */
const AWAY_MS = 20_000

/** كل عشر دقائق سؤالٌ واحد عن ملفٍ من عشرات البايتات. */
const POLL_MS = 10 * 60 * 1000

/*
 * حاجزٌ ضدّ حلقة التحميل.
 *
 * لو خدمت الشبكة فهرساً قديماً وملف نسخةٍ جديد لبقي الرقمان مختلفين بعد كل
 * تحميل، فيعيد التطبيق فتح نفسه بلا نهاية أمام صاحبه. مرّةٌ في كل عشر دقائق
 * سقفٌ يجعل أسوأ الحالات إزعاجاً محتمَلاً لا تطبيقاً معطَّلاً.
 */
const RELOAD_KEY = 'sanawi:auto-reload-at'
const RELOAD_GAP_MS = 10 * 60 * 1000

async function fetchLatestBuild(): Promise<string> {
  const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) return ''
  return readBuildId(await response.json())
}

function autoReloadAllowed(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_GAP_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    return true
  } catch {
    // متصفّحٌ يمنع التخزين: الشريط يكفي، والتحميل التلقائي بلا حاجزه خطر.
    return false
  }
}

export function useAppUpdate(): { stale: boolean; reload: () => void } {
  const [stale, setStale] = useState(false)
  const hiddenSince = useRef<number | null>(null)

  const reload = useCallback(() => {
    window.location.reload()
  }, [])

  useEffect(() => {
    const current = __BUILD_ID__
    let cancelled = false

    // التحميل التلقائي فقط بعد غياب؛ وإلا فالشريط.
    const check = async (mayReload: boolean) => {
      try {
        const latest = await fetchLatestBuild()
        if (cancelled || !isNewBuild(current, latest)) return
        if (mayReload && autoReloadAllowed()) {
          window.location.reload()
          return
        }
        setStale(true)
      } catch {
        // بلا شبكة لا يُقال شيء: الصمت هنا صحيح، والتطبيق بلا شبكة معطّلٌ أصلاً.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince.current = Date.now()
        return
      }
      const away = hiddenSince.current === null ? 0 : Date.now() - hiddenSince.current
      hiddenSince.current = null
      void check(away >= AWAY_MS)
    }

    void check(false)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check(false)
    }, POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return { stale, reload }
}
