import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ParseKeys } from 'i18next'

export interface HubTab {
  to: string
  /** مفتاح ترجمة حقيقي لا نصّ حر — المفتاح الغائب خطأ بناءٍ هنا أيضاً. */
  labelKey: ParseKeys
  /** true (الافتراضي): المقطع نشط على مساره وحده — لمقاطع الفهرس مثل /wealth. */
  end?: boolean
}

/**
 * شريط مقاطع المحور — يُصمَّم مرة ويُستعمل في كل تبويبٍ يضمّ شاشات.
 *
 * كل مقطعٍ مسارٌ فرعي حقيقي عبر NavLink لا حالة محلية: الرابط العميق
 * يُفتح ويُشارك ويُحفظ، وزرّ الرجوع في المتصفح يتنقّل بين المقاطع.
 * وهذا ما فكّ عقدة السبعة: التبويب السفلي بابُ المحور، والمقاطع غرفُه.
 */
export function HubTabs({ tabs }: { tabs: readonly HubTab[] }) {
  const { t } = useTranslation()

  return (
    <>
      <nav className="border-b border-border bg-bg">
        <div className="mx-auto flex max-w-lg gap-1 px-5 py-2">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end ?? true}
              className={({ isActive }) =>
                `min-h-10 flex-1 content-center rounded-xl px-2 text-center text-[13px] font-semibold transition ${
                  isActive ? 'bg-brand-soft text-brand' : 'text-text-muted'
                }`
              }
            >
              {t(tab.labelKey)}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </>
  )
}
