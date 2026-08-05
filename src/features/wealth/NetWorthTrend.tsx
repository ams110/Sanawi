import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { formatMoney, formatMonthYear } from '@/lib/format'
import type { NetWorthSnapshot } from '@/lib/db/types'

/**
 * خطّ الثروة.
 *
 * مرسومٌ بـ SVG باليد لا بمكتبة رسوم: النقاط أربعٌ وعشرون على الأكثر وخطٌّ
 * واحد، وإدخال مكتبةٍ كاملة لأجلها يضيف إلى الحزمة أضعاف ما يضيفه هذا
 * الملف — والتطبيق يُفتح على تلفونٍ بشبكةٍ متوسطة.
 *
 * والمقياس يبدأ من الأدنى لا من الصفر، وهذا اختيارٌ لا سهو: الفرق بين
 * ٤٠ ألفاً و٤٢ ألفاً يختفي تماماً على محورٍ يبدأ من الصفر، وهو بالضبط
 * الفرق الذي جاء المستخدم ليراه.
 */
export function NetWorthTrend({
  snapshots,
  saved,
  onSave,
}: {
  snapshots: readonly NetWorthSnapshot[]
  saved: boolean
  onSave: (() => Promise<void>) | null
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const points = snapshots.map((s) => Number(s.net_worth))
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  // نقطتان على الأقل: نقطةٌ واحدة ليست خطّاً، ورسمُها يوهم باتجاهٍ لا وجود له.
  const hasLine = points.length >= 2 && first !== undefined && last !== undefined

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-text">{t('wealth.trendTitle')}</h2>
        {last && (
          <span className="num text-sm font-bold text-brand">
            {formatMoney(Number(last.net_worth))}
          </span>
        )}
      </div>

      {hasLine ? (
        <>
          <Sparkline values={points} />
          {/*
            * الصفّ بترتيب لاتيني رغم الواجهة العربية: محور الرسم يمضي من
            * اليسار إلى اليمين، وصفٌّ يتبع اتجاه الصفحة يضع القديم فوق
            * الطرف الجديد فيقرأ المستخدم الخطّ مقلوباً.
            */}
          <div dir="ltr" className="flex justify-between text-[11px] text-text-muted">
            <span>{formatMonthYear(first.snapshot_month)}</span>
            <span>{formatMonthYear(last.snapshot_month)}</span>
          </div>
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-text-muted">{t('wealth.trendEmpty')}</p>
      )}

      {/* الرسم مخفيٌّ عن قارئ الشاشة، فاتجاهه — وهو كل مقصد البطاقة — يُقال نصّاً. */}
      {hasLine && (
        <p className="text-[12px] font-semibold text-text">
          {t(points[points.length - 1]! >= points[0]! ? 'wealth.trendUp' : 'wealth.trendDown', {
            amount: formatMoney(Math.abs(points[points.length - 1]! - points[0]!)),
            count: points.length,
          })}
        </p>
      )}
      <p className="text-[12px] text-text-muted">{t('wealth.trendNote')}</p>

      {onSave && (
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave()
            } finally {
              setBusy(false)
            }
          }}
        >
          {saved ? t('wealth.snapshotSaved') : t('wealth.saveSnapshot')}
        </Button>
      )}
    </section>
  )
}

const WIDTH = 300
const HEIGHT = 72

/** يستقبل نقطتين فأكثر — يضمنها المستدعي. */
function Sparkline({ values }: { values: readonly number[] }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  // مدىً صفريّ يقسم على صفر ويسطّح الخطّ على حافة الإطار؛ واحدٌ يجعله وسطاً.
  const span = max - min || 1

  const x = (i: number) => (i / (values.length - 1)) * WIDTH
  const y = (v: number) => HEIGHT - ((v - min) / span) * (HEIGHT - 8) - 4

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')
  const area = `${line} L ${WIDTH} ${HEIGHT} L 0 ${HEIGHT} Z`

  const start = values[0] ?? 0
  const end = values[values.length - 1] ?? start
  const color = end >= start ? 'var(--color-brand)' : 'var(--color-danger)'

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-20 w-full"
      // الرسم زينةٌ للرقم المكتوب فوقه، فلا يُقرأ مرتين بقارئ الشاشة.
      aria-hidden="true"
    >
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(end)} r={3.5} fill={color} />
    </svg>
  )
}
