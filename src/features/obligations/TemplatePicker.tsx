import { formatMoney } from '@/lib/format'
import type { ObligationTemplate } from '@/lib/db/types'

interface Props {
  templates: ObligationTemplate[]
  onPick: (template: ObligationTemplate) => void
  onSkip: () => void
}

/**
 * اختيار من قائمة لا كتابة من الصفر.
 *
 * أول التزام هو أخطر لحظة: صفحة فارغة تسأل "اسم الالتزام؟" تجعل المستخدم
 * يفكّر بدل أن يتحرّك. القالب يملأ الاسم والدورية والمبلغ المقترح بضغطة.
 */
export function TemplatePicker({ templates, onPick, onSkip }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text">شو بدك تضيف؟</h2>
        <p className="text-sm text-text-muted">اختار من الجاهز، وبتعدّل الأرقام بعدين.</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t)}
            className="rounded-2xl border border-border bg-surface p-3 text-start transition active:scale-[0.98]"
          >
            <span className="text-2xl" aria-hidden="true">
              {t.icon ?? '📌'}
            </span>
            <p className="mt-1.5 text-sm font-bold text-text">{t.name_ar}</p>
            {t.suggested_min != null && t.suggested_max != null && (
              <p className="num mt-0.5 text-[11px] text-text-muted">
                {formatMoney(Number(t.suggested_min))} – {formatMoney(Number(t.suggested_max))}
              </p>
            )}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onSkip}
        className="w-full rounded-2xl border border-dashed border-border py-3 text-sm font-semibold text-text-muted"
      >
        مش من هدول — بكتبه بنفسي
      </button>
    </div>
  )
}
