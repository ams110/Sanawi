import { useState } from 'react'
import { PartnersField } from '@/features/partners/PartnersField'
import { PartnerSettlements } from '@/features/partners/PartnerSettlements'
import { BridgeNotice } from '@/components/ui/BridgeNotice'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { validateShares, type PartnerShareDraft } from '@/features/partners/api'
import type { PartnerSettlement } from '@/lib/db/types'

/**
 * معاينة المكوّنات بلا قاعدة بيانات ولا جلسة.
 *
 * مسار /preview متاح في وضع التطوير فقط (انظر App.tsx) ولا يدخل حزمة الإنتاج.
 * وجوده يسمح بفحص الشكل والاتجاه والوضعين قبل أن تكون البيانات جاهزة.
 */

const SETTLEMENTS: PartnerSettlement[] = [
  {
    obligation_id: 'x',
    user_id: 'u',
    partner_id: 'p1',
    partner_name: 'أخوي محمد',
    share_percent: 50,
    owed: 3000,
    deposited: 1200,
    outstanding: 1800,
  },
]

export function ComponentPreview() {
  const [mine, setMine] = useState(50)
  const [partners, setPartners] = useState<PartnerShareDraft[]>([
    { partnerId: null, name: 'أخوي محمد', sharePercent: 50 },
  ])

  return (
    <div className="mx-auto max-w-lg space-y-6 px-5 py-6">
      <h1 className="text-lg font-bold text-brand">معاينة المكوّنات</h1>

      <Section title="حقل الشركاء">
        <PartnersField
          mySharePercent={mine}
          onMyShareChange={setMine}
          partners={partners}
          onPartnersChange={setPartners}
          totalAmount={6000}
          error={validateShares(mine, partners)}
        />
      </Section>

      <Section title="تسوية الشركاء">
        <PartnerSettlements settlements={SETTLEMENTS} mine={{ owed: 3000, deposited: 3000 }} />
      </Section>

      <Section title="تحذير وضع الجسر">
        <BridgeNotice
          bridgeInstallment={2000}
          normalInstallment={500}
          monthsRemaining={3}
          recurrenceMonths={12}
        />
      </Section>

      <Section title="دوائر التقدّم">
        <div className="flex gap-4">
          <ProgressRing progress={0.9} status="on_track" />
          <ProgressRing progress={0.5} status="slightly_behind" />
          <ProgressRing progress={0.15} status="behind" />
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-text-muted">{title}</h2>
      {children}
    </section>
  )
}
