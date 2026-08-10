import { HubTabs } from '@/components/HubTabs'

/** محور التقارير — التحليل والتوقّع النقدي. */
const TABS = [
  { to: '/reports', labelKey: 'hub.insights' },
  { to: '/reports/forecast', labelKey: 'hub.forecast' },
] as const

export function ReportsHub() {
  return <HubTabs tabs={TABS} />
}
