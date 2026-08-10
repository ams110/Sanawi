import { HubTabs } from '@/components/HubTabs'

/** محور التقارير — التحليل والتوقّع النقدي والاشتراكات. */
const TABS = [
  { to: '/reports', labelKey: 'hub.insights' },
  { to: '/reports/forecast', labelKey: 'hub.forecast' },
  { to: '/reports/subscriptions', labelKey: 'hub.subscriptions' },
] as const

export function ReportsHub() {
  return <HubTabs tabs={TABS} />
}
