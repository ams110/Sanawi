import { HubTabs } from '@/components/HubTabs'

/**
 * محور الالتزامات — القائمة والتقويم والشركاء.
 *
 * صفحات التفاصيل (/obligations/new و/:id) خارج المحور عمداً: هي صفحات
 * ملء شاشةٍ بزرّ رجوع، وشريط المقاطع فوقها ضجيج.
 */
const TABS = [
  { to: '/obligations', labelKey: 'hub.obligations' },
  { to: '/obligations/calendar', labelKey: 'hub.calendar' },
  { to: '/obligations/partners', labelKey: 'hub.partners' },
] as const

export function ObligationsHub() {
  return <HubTabs tabs={TABS} />
}
