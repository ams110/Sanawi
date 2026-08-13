import { differenceInCalendarDays } from 'date-fns'

/**
 * الحساب ومظاريفه.
 *
 * القاعدة الواحدة التي يقوم عليها الملف: **المال يعيش في الحسابات، والصناديق
 * مظاريف توضع فوق نفس المال لا بجانبه.**
 *
 *     reserved  = مجموع أرصدة الصناديق المربوطة بهذا الحساب
 *     available = balance − reserved
 *     shortfall = available < 0
 *
 * و`available` هو أهمّ رقم في الميزانية كلها. موجباً أو صفراً فالوضع مضبوط،
 * وسالباً فالتطبيق يَعِد بمالٍ ليس في البنك — وهي الحالة التي لا يستطيع أحد
 * اكتشافها بعينه: كل صندوقٍ على حدة يبدو سليماً، والمجموع وحده يفضح النقص.
 *
 * ولا يُخزَّن منها شيء: الرصيد يتغيّر والصناديق تتغيّر، وعمودٌ محسوبٌ مخزَّن
 * يجرف عن الحقيقة مع أول تعديلٍ من جهازٍ ثانٍ — نفس السبب الذي منع عمود
 * `fund_balance` من الوجود.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

export type AccountKind = 'checking' | 'savings'

export interface EnvelopeInput {
  /** اسم الالتزام صاحب الصندوق. */
  name: string
  /** رصيد صندوقه — ما أودعتُه أنا فيه. */
  balance: number
  obligationId?: string
}

export interface AccountInput {
  id?: string
  name: string
  kind?: AccountKind
  balance: number
  /** متى أُدخل الرصيد — به يُكشف الرصيد الذي صار قديماً. */
  balanceUpdatedAt?: Date | string | null
  envelopes?: readonly EnvelopeInput[]
}

export interface EnvelopeView {
  name: string
  balance: number
  obligationId: string | null
  /** نصيب المظروف من رصيد الحساب، كسرٌ من 0 إلى 1 — وجهته شريطٌ في الواجهة. */
  share: number
}

export interface AccountView {
  id: string | null
  name: string
  kind: AccountKind
  balance: number
  /** مجموع المظاريف الموضوعة على هذا الحساب. */
  reserved: number
  /** ما بقي بلا تخصيص. سالب = وعدٌ بمالٍ غير موجود. */
  available: number
  shortfall: boolean
  envelopes: EnvelopeView[]
  /** تاريخ إدخال الرصيد كما وصل — يمرّ كما هو ليُعرَض بجانب عمره. */
  balanceUpdatedAt: string | null
  /** كم يوماً مضى على إدخال الرصيد، أو null إن كان التاريخ مجهولاً. */
  daysSinceBalanceUpdate: number | null
  balanceIsStale: boolean
}

export interface AccountsSummary {
  accounts: AccountView[]
  balanceTotal: number
  reservedTotal: number
  availableTotal: number
  /** هل في واحدٍ منها نقص — سؤالٌ واحد يكفي لإطلاق التحذير. */
  hasShortfall: boolean
  staleCount: number
}

export interface AccountsOptions {
  today?: Date
  /** بعد كم يومٍ يُعدّ الرصيد قديماً. الافتراضي أسبوعان. */
  staleAfterDays?: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const atLeastZero = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0)

/**
 * رقمٌ يجوز أن يكون سالباً ولا يجوز أن يكون NaN.
 *
 * الرصيد وحده من مدخلات هذا الملف لا يُقصّ عند الصفر: حسابٌ مكشوف حقيقةٌ
 * تحدث، وقصُّه عند الصفر يخفي أسوأ حالةٍ يمكن أن يكون فيها صاحبه.
 */
const finite = (n: number): number => (Number.isFinite(n) ? n : 0)

/**
 * قراءة تاريخٍ قد يأتي يوماً مجرّداً أو طابعاً زمنياً كاملاً.
 *
 * ‏`balance_updated_at` في القاعدة timestamptz، لكن الاختبارات والاستيراد
 * يكتبان «2026-08-01» وحدها — وهذه يقرأها المتصفّح بتوقيت UTC لا بالمحلي،
 * فيقفز اليوم إلى ما قبله في نصف الكرة الشرقي. نفس المعالجة في networth.ts.
 */
function toDate(value: Date | string): Date {
  if (value instanceof Date) return value
  return new Date(value.includes('T') ? value : `${value}T00:00:00`)
}

const DEFAULT_STALE_DAYS = 14

export function viewAccount(input: AccountInput, options: AccountsOptions = {}): AccountView {
  const today = options.today ?? new Date()
  const staleAfterDays = atLeastZero(options.staleAfterDays ?? DEFAULT_STALE_DAYS)

  const balance = round2(finite(Number(input.balance)))

  /*
   * الصندوق السالب لا يُخصم من التخصيص.
   *
   * رصيد الصندوق مجموعُ قيود، وقيدُ السحب عند الدفع سالب — فصندوقٌ سُحب منه
   * أكثر ممّا فيه يخرج بسالبٍ صغير. عدُّه «تخصيصاً سالباً» يزيد `available`
   * فيقول للمستخدم إن معه مالاً أكثر مما في البنك، وهو الاتجاه الخطأ بالضبط.
   */
  const envelopes = (input.envelopes ?? []).map((envelope) => ({
    name: envelope.name,
    balance: round2(atLeastZero(Number(envelope.balance))),
    obligationId: envelope.obligationId ?? null,
    share: 0,
  }))

  const reservedRaw = envelopes.reduce((sum, envelope) => sum + envelope.balance, 0)
  const reserved = round2(reservedRaw)

  /*
   * التقريب قبل الحكم، والصفر السالب يُلغى معه.
   *
   * من خصّص رصيده كلّه يخرج من الطرح بكسرٍ عائمٍ سالبٍ في المرتبة الرابعة
   * عشرة — و`0.1 + 0.2` وحدها تكفي لصنعه — فيقرأ «−₪ 0» بلون الخطر وتحته
   * «وعدتَ بمالٍ غير موجود»، وهو لم يعد بشيء. نفس الفخّ الموثَّق في
   * `computeNetWorth`، والحكم يقع على الرقم الذي يراه المستخدم.
   */
  const rounded = round2(balance - reservedRaw)
  const available = rounded === 0 ? 0 : rounded

  const days = daysSince(input.balanceUpdatedAt, today)

  return {
    id: input.id ?? null,
    name: input.name,
    kind: input.kind ?? 'checking',
    balance,
    reserved,
    available,
    shortfall: available < 0,
    // الأكبر أولاً: المظروف الذي يبتلع الحساب هو ما يُقرأ أولاً.
    envelopes: envelopes
      .map((envelope) => ({
        ...envelope,
        // القسمة على الرصيد الخام لا المقرَّب — التقريب قبل القسمة يوزّع خطأه
        // على كل سطر. والحساب الفارغ أو المكشوف بلا نسب: شريطٌ بعرضٍ سالب
        // أو لا نهائي لا يُقرأ.
        share: balance > 0 ? Math.min(1, envelope.balance / balance) : 0,
      }))
      .sort((a, b) => b.balance - a.balance),
    // تاريخٌ غير مقروء يخرج فارغاً لا يرمي: `toISOString` على تاريخٍ فاسد
    // يرمي RangeError، فيسقط الردّ كلّه بسبب حقلٍ لا يُقرأ إلا للعرض.
    balanceUpdatedAt: days === null ? null : toDate(input.balanceUpdatedAt!).toISOString(),
    daysSinceBalanceUpdate: days,
    // تاريخٌ غائب ليس قِدَماً بل جهل — نفس قاعدة `staleAssets` في networth.ts.
    balanceIsStale: days !== null && days > staleAfterDays,
  }
}

export function summarizeAccounts(
  accounts: readonly AccountInput[],
  options: AccountsOptions = {},
): AccountsSummary {
  const views = accounts.map((account) => viewAccount(account, options))

  // الجمع خام والتقريب عند الحدّ: جمعُ أرقامٍ مقرَّبة يجمع أخطاءها معها،
  // فيصير مجموع السطور المعروضة مخالفاً للمجموع المحسوب.
  const balanceTotal = views.reduce((sum, a) => sum + finite(a.balance), 0)
  const reservedTotal = views.reduce((sum, a) => sum + a.reserved, 0)

  return {
    accounts: views,
    balanceTotal: round2(balanceTotal),
    reservedTotal: round2(reservedTotal),
    /*
     * المجموع يجمع الفائض على الناقص، والنقص يُقال وحده.
     *
     * حسابٌ فائضٌ بـ500 وآخر ناقصٌ بـ500 يعطيان مجموعاً صفراً — وهو صادق
     * كجواب عن «كم عندي بلا تخصيص»، وكاذبٌ لو قُرئ «كل شيء مضبوط»: الفائض
     * في حسابٍ لا يسدّ نقص حسابٍ آخر إلا بتحويل. ولذلك يخرج `hasShortfall`
     * بجانبه دائماً، ولا يُستنتج النقص من المجموع.
     */
    availableTotal: round2(balanceTotal - reservedTotal),
    hasShortfall: views.some((a) => a.shortfall),
    staleCount: views.filter((a) => a.balanceIsStale).length,
  }
}

export interface LinkedFundRow {
  obligationId: string
  name: string
  balance: number
  accountId: string | null
}

/**
 * توزيع الصناديق غير الصفرية على حساباتها.
 *
 * كان هذا التجميع يُكتب في كل واجهةٍ من جديد — شاشة الحسابات، خادم كلود،
 * لوحة الشهر — وقاعدته ليست بديهية: الصندوق الفارغ يسقط (صفرٌ لا يخصّص
 * شيئاً)، وغير المربوط لا يدخل أي حساب — ماله محسوبٌ ملكاً وخارج «غير
 * المخصّص» معاً. نسخةٌ رابعة كانت ستنحرف يوماً عن الثلاث.
 */
export function envelopesByAccount(
  rows: readonly LinkedFundRow[],
): Map<string, EnvelopeInput[]> {
  const byAccount = new Map<string, EnvelopeInput[]>()
  for (const row of rows) {
    const balance = Number(row.balance)
    if (balance === 0 || !row.accountId) continue
    const list = byAccount.get(row.accountId) ?? []
    list.push({ name: row.name, balance, obligationId: row.obligationId })
    byAccount.set(row.accountId, list)
  }
  return byAccount
}

/**
 * كم يوماً تكفي السيولة غير المخصّصة بوتيرة الصرف الحالية.
 *
 * التحويل من «بقي ₪1,600» إلى «بيكفيك 12 يوم» — لأن الأولى تُقرأ رصيداً
 * والثانية تُقرأ عدّاً تنازلياً، والعدّ هو الذي يوقف يد الصرف قبل الأزمة
 * لا بعدها.
 *
 * `null` = لا وتيرة بعد: شهرٌ بلا مصاريف مسجَّلة جهلٌ لا سيولةً لا نهائية.
 */
export function runwayDays(available: number, dailyRate: number): number | null {
  if (!Number.isFinite(dailyRate) || dailyRate <= 0) return null
  if (!Number.isFinite(available) || available <= 0) return 0
  return Math.floor(available / dailyRate)
}

/** عمر الرصيد بالأيام، أو null إن كان التاريخ مجهولاً أو غير مقروء. */
function daysSince(value: Date | string | null | undefined, today: Date): number | null {
  if (value === null || value === undefined) return null
  const updated = toDate(value)
  if (Number.isNaN(updated.getTime())) return null
  // تاريخٌ في المستقبل يُردّ إلى صفر: ساعةٌ مضبوطة خطأً لا تُنتج «قبل ‎-3 أيام».
  return Math.max(0, differenceInCalendarDays(today, updated))
}
