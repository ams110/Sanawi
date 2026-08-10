import { HubTabs } from '@/components/HubTabs'

/**
 * محور الحركة — كل ما يدخل ويخرج خلال الشهر: مصاريف، دخل، فواتير.
 *
 * ثلاث شاشاتٍ كانت ثلاثة تبويبات سفلية؛ جمعُها هنا حرّر مكانين في
 * الشريط السفلي للثروة والتقارير. الشاشات نفسها لم تتغيّر.
 */
const TABS = [
  { to: '/flow/expenses', labelKey: 'hub.expenses' },
  { to: '/flow/income', labelKey: 'hub.income' },
  { to: '/flow/bills', labelKey: 'hub.bills' },
  { to: '/flow/import', labelKey: 'hub.bankImport' },
] as const

export function FlowHub() {
  return <HubTabs tabs={TABS} />
}
