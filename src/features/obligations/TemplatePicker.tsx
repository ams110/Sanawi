import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text">{t('templates.title')}</h2>
        <p className="text-sm text-text-muted">{t('templates.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {templates.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onPick(tpl)}
            className="rounded-2xl border border-border bg-surface p-3 text-start transition active:scale-[0.98]"
          >
            <span className="text-2xl" aria-hidden="true">
              {tpl.icon ?? '📌'}
            </span>
            <p className="mt-1.5 text-sm font-bold text-text">{tpl.name_ar}</p>
            {tpl.suggested_min != null && tpl.suggested_max != null && (
              <p className="num mt-0.5 text-[11px] text-text-muted">
                {formatMoney(Number(tpl.suggested_min))} – {formatMoney(Number(tpl.suggested_max))}
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
        {t('templates.skip')}
      </button>
    </div>
  )
}
