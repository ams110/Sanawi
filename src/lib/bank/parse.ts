/**
 * قراءة كشف الحساب البنكي — من ملف CSV أو لصقٍ من إكسل/موقع البنك.
 * ملف نقي — لا React ولا Supabase.
 *
 * الربط البنكي الرسمي يتطلّب ترخيص مزوّد خدمةٍ مالية، والسكرابرز تريد
 * سيرفراً يخزّن كلمات سر البنك. هذا هو الطريق الثالث: **الورقة التي
 * يعطيك إياها بنكك أصلاً**. تنزّل الكشف أو تنسخ جدوله، والتطبيق يقرؤه —
 * ولا اعتمادٌ بنكي يلمس هذا الكود ولا يُحفظ في أي مكان.
 *
 * الكشوف الإسرائيلية لا شكل موحّداً لها: رؤوسٌ بالعبرية أو الإنجليزية،
 * فاصلةٌ أو تبويب (اللصق من إكسل تبويب)، مبلغٌ واحد بإشارته أو عمودا
 * חובה/זכות، وتواريخ dd/mm/yyyy. القارئ يتعرّف كلَّ ذلك بالرؤوس أولاً
 * وبالاستدلال حين تغيب — وما عجز عن قراءته يعدّه ويقوله، لا يبتلعه.
 */

export interface BankRow {
  /** YYYY-MM-DD */
  date: string
  /** وصف الحركة كما كتبه البنك. */
  name: string
  /** موجب دائماً — الاتجاه في حقله. */
  amount: number
  direction: 'in' | 'out'
}

export interface ParseResult {
  rows: BankRow[]
  /** سطورٌ لم تُقرأ — تُقال أعدادها ولا تُبتلع. */
  skipped: number
}

/* ── رؤوس الأعمدة المعروفة ─────────────────────────────────── */

const DATE_HEADERS = ['תאריך', 'تاريخ', 'date']
const AMOUNT_HEADERS = ['סכום', 'مبلغ', 'amount', 'סכום החיוב', 'סכום העסקה']
const DEBIT_HEADERS = ['חובה', 'حوبة', 'debit', 'חיוב']
const CREDIT_HEADERS = ['זכות', 'زخوت', 'credit', 'זיכוי']
const NAME_HEADERS = [
  'תיאור',
  'פרטים',
  'הפעולה',
  'תאור',
  'שם בית העסק',
  'بيان',
  'وصف',
  'description',
  'details',
]

const matchHeader = (cell: string, candidates: string[]): boolean => {
  const clean = cell.trim().toLowerCase()
  return candidates.some((c) => clean === c || clean.includes(c))
}

/* ── قراءة القيم ────────────────────────────────────────────── */

/**
 * تاريخٌ بصيَغ الكشوف: dd/mm/yyyy وdd.mm.yy وyyyy-mm-dd.
 *
 * اليوم قبل الشهر دائماً في الصيغ المفصولة بشرطة مائلة أو نقطة — هكذا
 * تكتب البنوك هنا، وقراءة mm/dd تجعل 03/08 آذارَ وهو آب.
 */
export function parseBankDate(raw: string): string | null {
  const value = raw.trim()

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const dmy = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (!dmy) return null

  const day = Number(dmy[1])
  const month = Number(dmy[2])
  let year = Number(dmy[3])
  if (year < 100) year += 2000
  if (day < 1 || day > 31 || month < 1 || month > 12) return null

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** مبلغ بكشوفهم: ‏₪ وفواصل آلاف وأقواس سالب — أو لا رقم أصلاً. */
export function parseBankAmount(raw: string): number | null {
  let value = raw.trim().replace(/[₪$€,\s]/g, '')
  if (!value) return null

  let negative = false
  if (/^\(.*\)$/.test(value)) {
    negative = true
    value = value.slice(1, -1)
  }
  if (value.startsWith('-')) {
    negative = true
    value = value.slice(1)
  }

  if (!/^\d+(\.\d+)?$/.test(value)) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return null
  return negative ? -n : n
}

/* ── تقسيم السطور ───────────────────────────────────────────── */

/** فاصل CSV مع احترام علامات الاقتباس — يكفي لما تُخرجه البنوك. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

function detectDelimiter(lines: string[]): string {
  // اللصق من إكسل تبويبٌ دائماً — وهو الأولى لأنه لا يظهر في النصوص.
  if (lines.some((l) => l.includes('\t'))) return '\t'
  const commas = lines.filter((l) => l.includes(',')).length
  const semis = lines.filter((l) => l.includes(';')).length
  return semis > commas ? ';' : ','
}

/* ── القارئ ─────────────────────────────────────────────────── */

interface ColumnMap {
  date: number
  name: number
  amount: number | null
  debit: number | null
  credit: number | null
}

function mapFromHeader(cells: string[]): ColumnMap | null {
  const date = cells.findIndex((c) => matchHeader(c, DATE_HEADERS))
  if (date === -1) return null

  const debit = cells.findIndex((c) => matchHeader(c, DEBIT_HEADERS))
  const credit = cells.findIndex((c) => matchHeader(c, CREDIT_HEADERS))
  let amount = cells.findIndex((c) => matchHeader(c, AMOUNT_HEADERS))
  if (debit !== -1 && credit !== -1) amount = -1

  let name = cells.findIndex((c) => matchHeader(c, NAME_HEADERS))
  if (name === -1) {
    // أول عمودٍ ليس تاريخاً ولا مبلغاً — أفضل تخمينٍ للوصف.
    name = cells.findIndex(
      (_, i) => i !== date && i !== debit && i !== credit && i !== amount,
    )
  }
  if (name === -1) return null
  if (amount === -1 && (debit === -1 || credit === -1)) return null

  return {
    date,
    name,
    amount: amount === -1 ? null : amount,
    debit: debit === -1 ? null : debit,
    credit: credit === -1 ? null : credit,
  }
}

/** بلا رأسٍ معروف: يُستدلّ من أول سطرٍ فيه تاريخٌ ورقم. */
function mapByInference(cells: string[]): ColumnMap | null {
  const date = cells.findIndex((c) => parseBankDate(c) !== null)
  if (date === -1) return null

  const amount = cells.findIndex((c, i) => i !== date && parseBankAmount(c) !== null)
  if (amount === -1) return null

  // الوصف: أطول خليةٍ ليست تاريخاً ولا رقماً.
  let name = -1
  let best = -1
  cells.forEach((c, i) => {
    if (i === date || i === amount) return
    if (parseBankAmount(c) !== null) return
    if (c.trim().length > best) {
      best = c.trim().length
      name = i
    }
  })
  if (name === -1) return null

  return { date, name, amount, debit: null, credit: null }
}

function rowFrom(cells: string[], map: ColumnMap): BankRow | null {
  const date = parseBankDate(cells[map.date] ?? '')
  if (!date) return null

  const name = (cells[map.name] ?? '').trim()
  if (!name) return null

  if (map.amount !== null) {
    const amount = parseBankAmount(cells[map.amount] ?? '')
    if (amount === null) return null
    return { date, name, amount: Math.abs(amount), direction: amount < 0 ? 'out' : 'in' }
  }

  /*
   * عمودا חובה/זכות: الخارج في عمودٍ والداخل في آخر، وكلاهما موجب.
   * صفٌّ فيه الاثنان معاً غلطُ كشفٍ — يُتجاهل لا يُخمَّن.
   */
  const debit = map.debit !== null ? parseBankAmount(cells[map.debit] ?? '') : null
  const credit = map.credit !== null ? parseBankAmount(cells[map.credit] ?? '') : null
  if (debit !== null && credit !== null) return null
  if (debit !== null) return { date, name, amount: Math.abs(debit), direction: 'out' }
  if (credit !== null) return { date, name, amount: Math.abs(credit), direction: 'in' }
  return null
}

export function parseBankText(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) return { rows: [], skipped: 0 }

  const delimiter = detectDelimiter(lines)
  const table = lines.map((l) => splitCsvLine(l, delimiter))

  /* الرأس يُبحث عنه في أول خمسة سطور — فوقه سطورُ عناوين وأرصدة افتتاحية. */
  let map: ColumnMap | null = null
  let dataStart = 0
  for (let i = 0; i < Math.min(5, table.length); i++) {
    const fromHeader = mapFromHeader(table[i]!)
    if (fromHeader) {
      map = fromHeader
      dataStart = i + 1
      break
    }
  }
  if (!map) {
    for (let i = 0; i < table.length; i++) {
      const inferred = mapByInference(table[i]!)
      if (inferred) {
        map = inferred
        dataStart = i
        break
      }
    }
  }
  if (!map) return { rows: [], skipped: lines.length }

  const rows: BankRow[] = []
  let skipped = 0
  for (let i = dataStart; i < table.length; i++) {
    const row = rowFrom(table[i]!, map)
    if (row) rows.push(row)
    else skipped++
  }

  return { rows, skipped }
}

/** مفتاح التكرار: تاريخ + مبلغ + اتجاه — به تُميَّز الحركة المستورَدة سابقاً. */
export function bankRowKey(row: { date: string; amount: number; direction: 'in' | 'out' }): string {
  return `${row.date}|${row.amount.toFixed(2)}|${row.direction}`
}
