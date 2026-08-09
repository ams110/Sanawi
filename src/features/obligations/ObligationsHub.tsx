import { HubTabs } from '@/components/HubTabs'

/**
 * محور الالتزامات — القائمة والتقويم (والشركاء لاحقاً).
 *
 * صفحات التفاصيل (/obligations/new و/:id) خارج المحور عمداً: هي صفحات
 * ملء شاشةٍ بزرّ رجوع، وشريط المقاطع فوقها ضجيج.
 */
const TABS = [
  { to: '/obligations', labelKey: 'hub.obligations' },
  { to: '/obligations/calendar', labelKey: 'hub.calendar' },
] as const

export function ObligationsHub() {
  return <HubTabs tabs={TABS} />
}
