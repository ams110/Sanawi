import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { failureText } from '@/lib/i18n/failure'
import { useRefresh } from '@/lib/refresh'
import {
  BACKUP_VERSION,
  BackupFileError,
  downloadBackup,
  exportBackup,
  importBackup,
  parseBackup,
} from './api'

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
      setError(failureText(err, t, t('backup.failed')))
    } finally {
      setBusy(null)
    }
  }

  /*
   * عطبُ الملف يُقال باسمه، لا يُصنَّف.
   *
   * `failureText` تصنّف ما لا تعرفه «خللاً ما بنعرفه، جرّب كمان مرة» — وهي
   * نصيحةٌ خاطئة هنا: نفس الملف يفشل في كل مرة. والمستخدم يحتاج أن يعرف أن
   * عليه اختيار ملفٍ آخر.
   */
  const fileProblem = (err: unknown): string | null => {
    if (!(err instanceof BackupFileError)) return null
    return err.reason === 'badFile'
      ? t('backup.badFile')
      : t('backup.versionMismatch', { found: err.found, supported: BACKUP_VERSION })
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
      setError(fileProblem(err) ?? failureText(err, t, t('backup.failed')))
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

/** تحديث الواجهة إلى آخر نسخة منشورة — بلا تنصيب APK. */
export function UpdateSection() {
  const { t } = useTranslation()
  const { reloadApp } = useRefresh()

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-bold text-text">{t('update.title')}</h2>
        <p className="text-xs text-text-muted">{t('update.subtitle')}</p>
        {/*
         * رقم النسخة مكتوبٌ لا مخفيّ.
         *
         * «مش ظاهر ولا إشي ممّا عملناه» سؤالٌ لا جواب له ما دام لا أحد — لا
         * صاحب التطبيق ولا من يساعده — يستطيع أن يقول أيّ نسخةٍ يفتحها. سطرٌ
         * واحد يحوّل السؤال إلى مقارنة رقمين.
         */}
        <p className="num mt-1 text-[11px] text-text-muted">
          {t('update.build', { id: __BUILD_ID__ })}
        </p>
      </div>
      <Button type="button" variant="secondary" className="w-full" onClick={reloadApp}>
        {t('update.button')}
      </Button>
    </section>
  )
}
