import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { downloadBackup, exportBackup, importBackup, parseBackup } from './api'

/** تصدير واستيراد النسخة الاحتياطية — يظهر أسفل شاشة الدخل. */
export function BackupSection() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doExport = async () => {
    if (!user) return
    setBusy('export')
    setError(null)
    try {
      downloadBackup(await exportBackup(user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('backup.failed'))
    } finally {
      setBusy(null)
    }
  }

  const doImport = async (file: File) => {
    if (!user) return
    setBusy('import')
    setError(null)
    setNotice(null)
    try {
      const summary = await importBackup(parseBackup(await file.text()), user.id)
      const count = Object.values(summary.inserted).reduce((a, b) => a + b, 0)
      setNotice(t('backup.imported', { count }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('backup.failed'))
    } finally {
      setBusy(null)
      // تصفير القيمة يسمح باختيار نفس الملف مرة ثانية بعد التصحيح.
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-bold text-text">{t('backup.title')}</h2>
        <p className="text-xs text-text-muted">{t('backup.subtitle')}</p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          loading={busy === 'export'}
          onClick={() => void doExport()}
        >
          {t('backup.export')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          loading={busy === 'import'}
          onClick={() => fileInput.current?.click()}
        >
          {t('backup.import')}
        </Button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void doImport(file)
        }}
      />

      {notice && (
        <p role="status" className="rounded-xl bg-brand-soft px-3 py-2.5 text-sm text-brand">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
