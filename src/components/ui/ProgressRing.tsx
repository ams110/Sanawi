import type { ObligationStatus } from '@/lib/obligations/calc'

const STATUS_COLOR: Record<ObligationStatus, string> = {
  on_track: 'var(--color-brand)',
  slightly_behind: 'var(--color-accent)',
  behind: 'var(--color-danger)',
}

interface Props {
  /** 0..1 */
  progress: number
  status: ObligationStatus
  size?: number
  label?: string
}

/**
 * دائرة تقدّم الصندوق.
 *
 * تدور عكس عقارب الساعة (transform: scaleX(-1)) لتتّبع اتجاه الواجهة العربية:
 * الامتلاء يبدأ من الأعلى ويمضي يميناً كما تقرأ العين هنا.
 */
export function ProgressRing({ progress, status, size = 56, label }: Props) {
  const stroke = size >= 56 ? 6 : 5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(1, Math.max(0, progress))

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90 scale-x-[-1]"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={STATUS_COLOR[status]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold num">
        {label ?? `${Math.round(clamped * 100)}%`}
      </span>
    </div>
  )
}
