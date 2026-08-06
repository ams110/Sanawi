import { useTranslation } from 'react-i18next'
import { useAppUpdate } from './useAppUpdate'

/**
 * «في نسخة جديدة» — شريطٌ يظهر فقط حين يكون له معنى.
 *
 * يجلس أعلى الشاشة لا أسفلها: الأسفل مزدحمٌ بشريط التبويبات والزرّ العائم،
 * وثالثٌ هناك يغطّي أحدهما — وهي الغلطة نفسها التي أُصلحت مرّة.
 */
export function UpdateBanner() {
  const { t } = useTranslation()
  const { stale, reload } = useAppUpdate()

  if (!stale) return null

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-brand px-5 py-2.5 text-white">
      <span className="text-[13px] font-semibold">{t('update.available')}</span>
      <button
        type="button"
        onClick={reload}
        className="shrink-0 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-bold"
      >
        {t('update.apply')}
      </button>
    </div>
  )
}
