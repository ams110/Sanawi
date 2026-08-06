import { supabase } from '@/lib/supabase'

/**
 * تصدير واستيراد نسخة كاملة بصيغة JSON.
 *
 * ليست ميزة تقنية: هي الجواب على "هل بياناتي ملكي فعلاً؟". مستخدم يعرف أنه
 * يستطيع أخذ بياناته والخروج، يبقى بثقة أكبر ممن يشعر أنه محتجَز.
 */

export const BACKUP_VERSION = 1

/**
 * خطأ الملف برمزه لا بنصّه.
 *
 * كان النصّ العربي مكتوباً هنا ويصل الشاشة عبر `err.message` — فعمِل صدفةً،
 * وخالف قاعدة «كل العربي في ar.ts». وبعد أن صار الفشل يمرّ على `failureText`
 * صنّفه المصنّف «خللاً ما بنعرفه، جرّب كمان مرة» — ودعوةُ إعادةِ المحاولة على
 * ملفٍ خاطئ تفشل في كل مرة. فالرمز هنا، والجملة في `ar.ts`.
 */
export class BackupFileError extends Error {
  reason: 'badFile' | 'versionMismatch'
  /** نسخة الملف كما وُجدت — تُعرض في جملة عدم التطابق. */
  found: number

  constructor(reason: 'badFile' | 'versionMismatch', found = 0) {
    super(reason)
    this.name = 'BackupFileError'
    this.reason = reason
    this.found = found
  }
}

/** الترتيب مقصود: الأب قبل الابن حتى لا يفشل الاستيراد على مفتاح أجنبي. */
const TABLES = [
  'obligation_groups',
  'obligation_partners',
  'obligations',
  'obligation_partner_shares',
  'fund_deposits',
  'obligation_payments',
  'income_sources',
  'fixed_commitments',
  'expenses',
] as const

type BackupTable = (typeof TABLES)[number]

export interface Backup {
  version: number
  exportedAt: string
  profile: Record<string, unknown> | null
  data: Record<BackupTable, Record<string, unknown>[]>
}

export async function exportBackup(userId: string): Promise<Backup> {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()

  const data = {} as Record<BackupTable, Record<string, unknown>[]>
  for (const table of TABLES) {
    const { data: rows, error } = await supabase.from(table).select('*')
    if (error) throw error
    data[table] = (rows ?? []) as Record<string, unknown>[]
  }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: (profile as Record<string, unknown> | null) ?? null,
    data,
  }
}

export interface ImportSummary {
  inserted: Record<string, number>
  skipped: number
}

/**
 * استيراد إضافي لا استبدالي: الصفوف الموجودة تُترك كما هي.
 *
 * الاستبدال يعني حذف بيانات المستخدم الحالية، وملفٌ خاطئ عندها يمحو سنةً من
 * التسجيل بلا رجعة. الإضافة أسوأ ما فيها تكرارٌ يمكن حذفه يدوياً.
 */
export async function importBackup(backup: Backup, userId: string): Promise<ImportSummary> {
  if (backup.version !== BACKUP_VERSION) {
    throw new BackupFileError('versionMismatch', backup.version)
  }

  const inserted: Record<string, number> = {}
  let skipped = 0

  for (const table of TABLES) {
    const rows = backup.data?.[table] ?? []
    if (rows.length === 0) continue

    // user_id يُعاد كتابته دائماً: ملف من حساب آخر يجب أن يصير ملك المستورِد
    // لا أن يُرفض بصمت من سياسات RLS.
    const owned = rows.map((row) => ({ ...row, user_id: userId }))

    const { data, error } = await supabase
      .from(table)
      .upsert(owned, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')

    if (error) throw error
    inserted[table] = data?.length ?? 0
    skipped += owned.length - (data?.length ?? 0)
  }

  return { inserted, skipped }
}

export function downloadBackup(backup: Backup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `sanawi-${backup.exportedAt.slice(0, 10)}.json`
  link.click()
  // بدون revoke يبقى الملف في الذاكرة إلى أن تُغلق الصفحة.
  URL.revokeObjectURL(url)
}

export function parseBackup(text: string): Backup {
  let parsed: Backup
  try {
    parsed = JSON.parse(text) as Backup
  } catch {
    // ملفٌّ ليس JSON أصلاً هو نفس الغلط: اختار الملف الخطأ. و`SyntaxError`
    // بنصّه الإنجليزي لا يقول له ذلك.
    throw new BackupFileError('badFile')
  }
  if (typeof parsed?.version !== 'number' || !parsed?.data) {
    throw new BackupFileError('badFile')
  }
  return parsed
}
