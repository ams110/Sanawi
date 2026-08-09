import { HubTabs } from '@/components/HubTabs'

/**
 * محور الثروة — تسعة أقسامٍ كانت شاشةً واحدة بلا تبويب.
 *
 * التقسيم على أربع صفحات أعاد لكل همٍّ بيته: النظرة (الرقم وتفصيله
 * والطوارئ والمسار)، الحسابات (السيولة والتحويل والربط)، الأصول،
 * والخطط (رقم الحرية وسداد الديون).
 */
const TABS = [
  { to: '/wealth', labelKey: 'hub.overview' },
  { to: '/wealth/accounts', labelKey: 'hub.accounts' },
  { to: '/wealth/assets', labelKey: 'hub.assets' },
  { to: '/wealth/plans', labelKey: 'hub.plans' },
] as const

export function WealthHub() {
  return <HubTabs tabs={TABS} />
}
