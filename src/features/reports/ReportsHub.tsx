import { HubTabs } from '@/components/HubTabs'

/** محور التقارير — التحليل والتوقّع والاشتراكات والتقرير الشهري. */
const TABS = [
  { to: '/reports', labelKey: 'hub.insights' },
  { to: '/reports/forecast', labelKey: 'hub.forecast' },
  { to: '/reports/subscriptions', labelKey: 'hub.subscriptions' },
  { to: '/reports/monthly', labelKey: 'hub.monthlyReport' },
] as const

export function ReportsHub() {
  return <HubTabs tabs={TABS} />
}
