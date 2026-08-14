// مسارٌ نسبيّ لا `@/`: هذا الملف يبنيه خادم MCP أيضاً (tsconfig.mcp.json)،
// وبناؤه بـnodenext لا يعرف اختصار الجذر — نفس أسلوب بقيّة المحرّكات المشتركة.
import { toDateKey } from '../date.js'

/**
 * الحركة وحسابها — محرّك الربط بين حساب البنك وحساب سنوي.
 *
 * سؤالان اثنان لا ثالث لهما، وكلاهما من **عالم الواقع** (ما وقع فعلاً في
 * البنك) لا من عالم الخطة:
 *
 *   1. هذه الحركة — أيّ حسابٍ في سنوي تخصّ؟            `resolveAccountId`
 *   2. كم وصل إلى هذا الحساب بعد لقطة رصيده الأخيرة؟   `movementsSinceBalance`
 *
 * والسؤال الثاني هو المهمّ، ولا بدّ من تحرير سببه بدقّة:
 *
 * ‏`accounts.balance` **لقطةٌ من كشف البنك** يُدخلها صاحبها بيده. والحركة
 * الواصلة من Financy داخلةٌ في تلك اللقطة أصلاً إن كانت أقدم منها — البنك
 * حسبها قبل أن يعرضها. فخصمُها من الرصيد عند تسجيلها خصمٌ ثانٍ لها، وهو
 * القرار المحسوم في `sanawi_add_expense` منذ 0016: «الربط يقول من أين خرج
 * لا كم بقي».
 *
 * ولذلك لا يخصم هذا الملف شيئاً. يجيب سؤالاً واحداً صريحاً: **ما الذي وصل
 * بعد لقطتك؟** — وهو الفرق الوحيد بين الرصيد المخزَّن ورصيد البنك الحقيقي.
 * والضغط على «حدّث رصيدك» يبقى قرار صاحبه.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

/** عنوان حسابٍ عند مزوّد البنك — المعرّف وحده ليس فريداً بين المزوّدين. */
export interface BankLink {
  providerId: string | null
  externalId: string | null
}

export interface LinkedAccount extends BankLink {
  id: string
}

export interface BankMovement extends BankLink {
  /** موجب دائماً — الاتجاه في `direction` لا في الإشارة، نفس قاعدة 0017. */
  amount: number
  direction: 'in' | 'out'
  /** يوم الحركة، `YYYY-MM-DD`. */
  txDate: string
}

/**
 * حركةٌ وحساب: هل هما واحد؟
 *
 * التطبيع بالقصّ والحروف الصغيرة لأن المعرّف يمرّ بيد المستخدم في شاشة
 * الربط، ومسافةٌ ملصقةٌ بالنسخ تجعل الحسابين غريبين وهما واحد.
 *
 * والمعرّف الفارغ لا يطابق شيئاً — ولا يطابق فارغاً مثله: حسابان بلا معرّف
 * ليسا نفس الحساب، بل مجهولان. مطابقتهما تنسب حركات البنك إلى أوّل حسابٍ
 * غير مربوط في القائمة.
 */
export function sameBankAccount(a: BankLink, b: BankLink): boolean {
  const externalA = normalize(a.externalId)
  const externalB = normalize(b.externalId)
  if (!externalA || !externalB) return false
  if (externalA !== externalB) return false

  /*
   * المزوّد يُفحص حين يعرفه الطرفان.
   *
   * ‏Financy لا ترسل `providerId` في كل حركة، وحسابٌ رُبط بمزوّدٍ معلوم ثم
   * وصلته حركةٌ بلا مزوّد ليس حساباً آخر — إسقاطها يترك حركاتٍ يتيمةً بلا
   * سببٍ يفهمه صاحبها.
   */
  const providerA = normalize(a.providerId)
  const providerB = normalize(b.providerId)
  if (!providerA || !providerB) return true
  return providerA === providerB
}

/** حساب هذه الحركة في سنوي، أو `null` إن لم يُربط حسابها بعد. */
export function resolveAccountId(
  movement: BankLink,
  accounts: readonly LinkedAccount[],
): string | null {
  const match = accounts.find((account) => sameBankAccount(movement, account))
  return match?.id ?? null
}

/** حسابات البنك الظاهرة في الوارد ولم يُربط لها حسابٌ بعد — وقودُ شاشة الربط. */
export function unlinkedBankAccounts(
  movements: readonly BankLink[],
  accounts: readonly LinkedAccount[],
): BankLink[] {
  const seen = new Set<string>()
  const out: BankLink[] = []
  for (const movement of movements) {
    const externalId = normalize(movement.externalId)
    if (!externalId) continue
    if (resolveAccountId(movement, accounts)) continue
    const key = `${normalize(movement.providerId)}|${externalId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ providerId: movement.providerId, externalId: movement.externalId })
  }
  return out
}

export interface MovementsSince {
  /** كم حركةً وصلت بعد اللقطة. */
  count: number
  /** مجموع الداخل، موجب. */
  inflow: number
  /** مجموع الخارج، موجب. */
  outflow: number
  /** الداخل ناقص الخارج — هذا ما يُضاف إلى الرصيد المخزَّن ليطابق البنك. */
  net: number
  /** يوم اللقطة نفسه، `YYYY-MM-DD` — يُعرض بجانب الرقم ليُقرأ سببه. */
  sinceKey: string | null
}

const EMPTY: MovementsSince = { count: 0, inflow: 0, outflow: 0, net: 0, sinceKey: null }

export interface MovementsSinceOptions {
  /** لقطة الرصيد الأخيرة — `balance_updated_at` كما وصل. */
  balanceUpdatedAt: Date | string | null | undefined
}

/**
 * ما وصل إلى الحساب **بعد** لقطة رصيده — الفرق بين المخزَّن وحقيقة البنك.
 *
 * ثلاث قواعد تحكم من يدخل في العدّ، وكلّها وُلدت من سؤالٍ يُخطئ الحدس فيه:
 *
 * **الحالة لا تدخل الحساب.** الحركة المتجاهَلة وقعت في البنك كما وقعت
 * المسجَّلة — «تجاهلتها» قرارُ دفترٍ في سنوي لا إلغاءٌ للسحب من الحساب.
 * فالعدّ هنا يشمل المعلّق والمسجَّل والمتجاهَل سواء، وعلى النادي أن يمرّر
 * الحركات كلّها لا المعلّق وحده (رقم من عالم الواقع لا يسأل عن دفترنا).
 *
 * **المقارنة بمفاتيح يوم لا بطوابع زمنية.** `tx_date` يومٌ مجرّد
 * و`balance_updated_at` طابعٌ بالساعة، ومقارنتهما خاماً تجعل حركة اليوم
 * نفسه «قبل اللقطة» أو «بعدها» حسب ساعة الإدخال (قاعدة 7).
 *
 * **يوم اللقطة نفسه خارج العدّ.** لأنه مجهولٌ حقيقةً: من أدخل رصيده ظهراً
 * لا نعرف أنُشرت حركة الصباح في كشفه أم لا. وإسقاطه يُنقص الاقتراح بحركةٍ
 * يوماً واحداً — يصلحها التحديث التالي — بينما إدخاله يخصم حركةً محسوبةً
 * أصلاً، فيصير الرصيد كاذباً بثقة. والنقص أهون من الكذب.
 */
export function movementsSinceBalance(
  movements: readonly BankMovement[],
  account: BankLink,
  options: MovementsSinceOptions,
): MovementsSince {
  const sinceKey = dateKeyOf(options.balanceUpdatedAt)
  // لقطةٌ بلا تاريخ مقروء: لا مرجع يُقاس عليه، و«كل الحركات» جوابٌ يكذب.
  if (!sinceKey) return EMPTY

  let count = 0
  let inflow = 0
  let outflow = 0

  for (const movement of movements) {
    if (!sameBankAccount(movement, account)) continue

    const key = dayKeyOf(movement.txDate)
    if (!key || key <= sinceKey) continue

    /*
     * بوّابة المدخل الفاسد (قاعدة 6): القاعدة تشترط `amount > 0`، لكن
     * الحركة تمرّ بـ`Number()` على نصٍّ من الشبكة قبل أن تصل هنا — و`NaN`
     * جمعُه يسمّم المجموع كلّه لا سطره وحده، فيخرج «حدّث رصيدك بـNaN».
     */
    const amount = Number(movement.amount)
    if (!Number.isFinite(amount) || amount <= 0) continue

    count += 1
    if (movement.direction === 'in') inflow += amount
    else outflow += amount
  }

  // الجمع خام والتقريب عند الحدّ — نفس قاعدة `summarizeAccounts`.
  return {
    count,
    inflow: round2(inflow),
    outflow: round2(outflow),
    net: round2(inflow - outflow),
    sinceKey,
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const normalize = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

/** يومٌ مجرّد من نصّ `YYYY-MM-DD` — ما سواه `null` لا اليوم. */
function dayKeyOf(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const key = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
}

/**
 * يوم اللقطة بالتقويم المحلي.
 *
 * ‏`balance_updated_at` طابعٌ بمنطقة زمنية، و`slice(0, 10)` عليه يقصّ يوم
 * ‏UTC — فلقطةٌ أُدخلت الساعة ٢ بعد منتصف الليل بتوقيت القدس تُقرأ يوم أمس،
 * فتدخل حركاتُ أمس في العدّ وقد حسبها البنك. القصّ يقع على التقويم المحلي
 * عبر `toDateKey` كما في بقيّة المشروع.
 */
function dateKeyOf(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toDateKey(value)
  }
  // يومٌ مجرّد يبقى كما هو: قراءته تاريخاً تقفز به يوماً في نصف الكرة الشرقي.
  if (!value.includes('T')) return dayKeyOf(value)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : toDateKey(parsed)
}
