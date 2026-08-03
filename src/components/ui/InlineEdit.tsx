import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

/**
 * تعديل سطرٍ في مكانه.
 *
 * التعديل هنا لا يستحقّ شاشةً: الحقول قليلة، والسياق حول السطر هو ما يذكّر
 * المستخدم بما كان يعدّله. وشاشةٌ منفصلة لكل نوع تعني أربع شاشاتٍ تتباعد
 * مع الوقت، بينما هذا الغلاف واحدٌ لأربعتها.
 *
 * لا يملك حالة الحقول — يملكها المستدعي: كلُّ نوعٍ حقولُه مختلفة، ومحاولةُ
 * تعميمها تنتهي بغلافٍ أعقد من أربع نسخٍ مباشرة.
 */
/** زر فتح التعديل — مفصول عن النموذج فلا يُنادى المكوّن مرتين للسطر الواحد. */
export function EditButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('common.edit2')}
      className="shrink-0 rounded-lg px-1.5 text-sm text-text-muted"
    >
      ✎
    </button>
  )
}

export function InlineEdit({
  open,
  onCancel,
  onSave,
  title,
  children,
  error,
  canSave = true,
  extraAction,
}: {
  open: boolean
  onCancel: () => void
  onSave: () => Promise<void>
  title: string
  children: ReactNode
  error?: string | null
  canSave?: boolean
  /** زرٌّ إضافي داخل نموذج التعديل — الأرشفة مثلاً. */
  extraAction?: ReactNode
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  if (!open) return null

  return (
    <div className="w-full space-y-2 rounded-2xl bg-surface-muted p-3">
      <p className="text-xs font-bold text-text">{title}</p>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {children}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
          {t('common.cancelEdit')}
        </Button>
        <Button
          type="button"
          className="flex-[2]"
          loading={busy}
          disabled={!canSave}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave()
            } finally {
              setBusy(false)
            }
          }}
        >
          {t('common.saveEdit')}
        </Button>
      </div>

      {extraAction}
    </div>
  )
}

export const editInputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-brand'
