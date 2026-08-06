import { differenceInCalendarMonths } from 'date-fns'

/**
 * صافي الثروة — الطرف الآخر من المعادلة.
 *
 * كل ما بناه التطبيق حتى الآن يعرف ما يخرج من الجيب. هذا الملف يعرف ما بقي
 * فيه. والصعب هنا ليس الجمع والطرح — بل التعاريف، ولذلك يدافع الملف عنها:
 *
 * • **المال يعيش في الحسابات، والصناديق مظاريف فوقه لا بجانبه.** صندوق
 *   الالتزام ليس مالاً — هو تخصيصٌ على مالٍ موجودٍ في حساب. وجمعُه على رصيد
 *   الحساب يعدّ نفس الشيكل مرّتين ويخرج بضعف الثروة الحقيقية. فمصدر النقد
 *   الوحيد هو أرصدة الحسابات، والصناديق تُعرَض تخصيصاتٍ ولا تُجمع أبداً.
 *
 * • ويبقى استثناءٌ واحد انتقالي: صندوقٌ غير مربوطٍ بحساب. ماله موجودٌ في
 *   مكانٍ ما لم يقله صاحبه، وإسقاطه يهبط بصافي الثروة كذباً. فيُحتسب ملكاً
 *   كما كان قبل الحسابات، ويخرج معه تحذيرٌ صريح: اربطه ليصحّ الحساب.
 *
 * • ما لم يُجمع بعدُ من الالتزام ليس ديناً. هو مصروفٌ مستقبليّ: لم يقترضه
 *   أحد ولا يطالب به أحد اليوم. لو عددناه ديناً لظهر كل مستخدمٍ مُعسِراً
 *   إلى الأبد — فالتزامات السنة القادمة تولد كل سنة ولا تنقرض — ولخالفنا
 *   التعريف المتعارف عليه: صافي الثروة لا يخصم استهلاكاً لم يقع.
 *
 * • الأقساط ذات تاريخ النهاية ديونٌ حقيقية: مبلغٌ مُلزِمٌ معلوم الآخِر،
 *   ورصيده = حصّتي الشهرية × ما بقي من دفعات.
 *
 * • الفاتورة المتكرّرة بلا نهاية ليست ديناً. لا آخِر لها فلا رصيد لها،
 *   واحتسابها ديناً هو ضربُ مبلغٍ شهريّ في ما لا نهاية.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

export type AssetKind = 'cash' | 'savings' | 'investment' | 'property' | 'receivable' | 'other'

export interface AssetInput {
  name: string
  kind: AssetKind
  amount: number
  isLiquid: boolean
  isEmergencyFund: boolean
  annualReturnPercent?: number
  /** آخر تحديث للقيمة — به نكشف الأصل الذي صار رقمه قديماً. */
  updatedAt?: Date | string | null
}

export interface DebtInput {
  name: string
  /** حصّتي من القسط الشهري. */
  monthlyAmount: number
  /** الدفعات المتبقية شاملةً شهر الانتهاء. */
  paymentsLeft: number
}

/** حسابٌ بنكي — الرصيد الفعلي، وكم منه مخصَّصٌ لصناديق مربوطة به. */
export interface CashAccountInput {
  name: string
  balance: number
  /** مجموع أرصدة الصناديق المربوطة بهذا الحساب. */
  reserved?: number
}

/**
 * رصيد صندوق التزام.
 *
 * رقمٌ مجرّد = صندوقٌ غير مربوط بحساب، فيُحتسب ملكاً (الحالة الانتقالية).
 * والشكل الكامل يقول صراحةً هل هو مربوط: المربوط ماله معدودٌ أصلاً في رصيد
 * حسابه، فعدُّه ثانيةً يضاعف نفس الشيكل.
 */
export type RestrictedFundInput = number | { amount: number; isLinked: boolean }

export interface NetWorthInput {
  assets: readonly AssetInput[]
  /**
   * الحسابات البنكية — مصدر النقد الوحيد.
   *
   * غيابها يعني مستخدماً لم يسجّل حساباً بعد، وعندها تبقى الصناديق غير
   * المربوطة هي كل ما يُعرف عن نقده.
   */
  accounts?: readonly CashAccountInput[]
  /** أرصدة صناديق الالتزامات — مالي أنا، محجوزٌ لبندٍ بعينه. */
  restrictedFunds: readonly RestrictedFundInput[]
  debts: readonly DebtInput[]
  /** المصروف الشهري الأساسي — عليه يُقاس صندوق الطوارئ. */
  monthlyEssentials: number
  /** كم شهراً يجب أن يغطّيه صندوق الطوارئ. */
  emergencyMonths: number
  /** بعد كم شهرٍ تُعدّ قيمة الأصل قديمة. الافتراضي 6. */
  staleAfterMonths?: number
  today?: Date
}

export interface AssetKindLine {
  kind: AssetKind
  total: number
  /**
   * نصيب النوع من مجموع الأصول، كسرٌ من 0 إلى 1 — لا نسبة مئوية.
   *
   * في المشروع صيغتان: lib/expenses/calc.ts يخرج بـ 0..100 لأن رقمه يُقرأ
   * مكتوباً («٣٤٪ طعام»)، وlib/budget/groupCost.ts يخرج بـ 0..1 لأن رقمه
   * يُسنَد إلى عرض شريط. وجهة هذا الرقم شريطٌ أيضاً، فاخترنا الكسر: لتُكتب
   * `width: ${share * 100}%` مرةً واحدة في الواجهة، بدل قسمةٍ على مئة تُنسى
   * في مكانٍ فتنكسر النسبة صامتةً.
   */
  share: number
  count: number
}

export interface EmergencyFundView {
  current: number
  target: number
  /** كم شهراً من المصروف الأساسي يغطّيه الموجود فعلاً. */
  monthsCovered: number
  progress: number
  isFunded: boolean
}

export interface StaleAsset {
  name: string
  monthsSinceUpdate: number
}

export interface AccountLine {
  name: string
  balance: number
  reserved: number
  /** الرصيد ناقص المخصَّص. سالب = وعدٌ بمالٍ ليس في البنك. */
  available: number
  shortfall: boolean
}

export interface NetWorthResult {
  assetsTotal: number
  liquidTotal: number
  restrictedTotal: number
  /** مجموع أرصدة الحسابات — النقد كما هو في البنك، مرّةً واحدة. */
  accountsTotal: number
  accountsReserved: number
  accountsAvailable: number
  /** توزيع النقد على الحسابات، مرتّباً تنازلياً. */
  accounts: AccountLine[]
  /**
   * صناديق بلا حساب — تُحتسب ملكاً بالحالة الانتقالية.
   *
   * وجودها يعني أن الرقم أعلاه مبنيّ على تخمينٍ لمكان المال، ولذلك يخرج
   * معه `hasUnlinkedFunds` ليُقال صراحةً لا ليُستنتج.
   */
  unlinkedRestrictedTotal: number
  hasUnlinkedFunds: boolean
  /** كل ما أملك: الأصول المسجّلة + أرصدة الحسابات + الصناديق غير المربوطة. */
  ownedTotal: number
  debtsTotal: number
  netWorth: number
  /** مرتّبة تنازلياً — العين تقرأ الأول لا الأخير. */
  byKind: AssetKindLine[]
  emergencyFund: EmergencyFundView
  staleAssets: StaleAsset[]
  /** متوسط العائد المرجّح بالمبالغ على الأصول كلها. */
  weightedReturnPercent: number
  /** هل الديون تفوق الملك. */
  isUnderwater: boolean
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const atLeastZero = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0)

/**
 * رقمٌ يجوز أن يكون سالباً، ولا يجوز أن يكون NaN.
 *
 * العائد وحده من كل مدخلات هذا الملف لا يُقصّ عند الصفر، فلا يمرّ من
 * `atLeastZero` ولا يُنظَّف معها. وصفٌّ ناقصٌ من القاعدة يجعل
 * `Number(undefined)` = NaN، وNaN واحدٌ في الضرب يُفسد المتوسط كله ثم
 * يخرج من هنا إلى شاشة الإسقاط فتصير كل أرقامها «—».
 */
const finiteOr = (n: number | undefined | null, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback

/**
 * قراءة تاريخٍ قد يأتي يوماً مجرّداً أو طابعاً زمنياً كاملاً.
 *
 * عمود updated_at في القاعدة timestamptz فيصل بصيغة ISO كاملة، لكن الاختبارات
 * والاستيراد اليدوي يكتبان «2026-01-05» وحدها — وهذه يقرأها المتصفّح بتوقيت
 * UTC لا بالتوقيت المحلي، فيقفز اليوم إلى ما قبله في نصف الكرة الشرقي.
 * إلحاق منتصف الليل المحلي يُلغي القفزة، ولا نلحقه بما فيه وقتٌ أصلاً.
 */
function toDate(value: Date | string): Date {
  if (value instanceof Date) return value
  return new Date(value.includes('T') ? value : `${value}T00:00:00`)
}

/**
 * رصيد الدَّين = ما سأدفعه حتى آخر قسط، لا أصل الدين.
 *
 * الفرق بينهما هو الفائدة، ونحن لا نملك جدول الإطفاء لنفصلها. والمبالغة في
 * الدَّين خطأٌ في الاتجاه الآمن: يجعل صافي الثروة أقلّ مما هو، ولا يعِد
 * صاحبه بمالٍ ليس له.
 */
export function debtBalance(debt: DebtInput): number {
  return round2(atLeastZero(debt.monthlyAmount) * atLeastZero(debt.paymentsLeft))
}

export function computeNetWorth(input: NetWorthInput): NetWorthResult {
  const today = input.today ?? new Date()
  const staleAfterMonths = atLeastZero(input.staleAfterMonths ?? 6)

  let assetsTotal = 0
  let liquidTotal = 0
  let emergencyCurrent = 0
  let returnWeighted = 0
  const buckets = new Map<AssetKind, AssetKindLine>()
  const staleAssets: StaleAsset[] = []

  for (const asset of input.assets) {
    // القاعدة تمنع السالب بـ check، والحماية هنا لمسارٍ آخر: استيرادٌ أو
    // خادم MCP يمرّ من فوق القاعدة، فيقلب أصلاً واحدٌ إشارةَ الثروة كلها.
    const amount = atLeastZero(asset.amount)
    assetsTotal += amount
    if (asset.isLiquid) liquidTotal += amount

    // صندوق طوارئٍ غير سائل تناقض: مالٌ لا يصل صاحبه إليه يوم الحاجة ليس
    // صندوق طوارئ مهما سُمّي. نُخرجه من الحساب ولا نصحّح العَلَم نيابةً عنه.
    if (asset.isEmergencyFund && asset.isLiquid) emergencyCurrent += amount

    // العائد يُترك على سالبه: أصلٌ يخسر جزءٌ من الحقيقة، وقصّه عند الصفر
    // يرفع متوسط المحفظة كذباً.
    returnWeighted += amount * finiteOr(asset.annualReturnPercent, 0)

    const bucket = buckets.get(asset.kind)
    if (bucket) {
      bucket.total += amount
      bucket.count += 1
    } else {
      buckets.set(asset.kind, { kind: asset.kind, total: amount, share: 0, count: 1 })
    }

    const age = monthsSinceUpdate(asset.updatedAt, today)
    // تاريخٌ غائب ليس قِدَماً بل جهل. من لم يسجّل تاريخاً لم يقل إن رقمه
    // قديم، واتّهامه بالقِدَم يغرق القائمة بتحذيراتٍ لا يستطيع أحدٌ إغلاقها.
    if (age !== null && age > staleAfterMonths) {
      staleAssets.push({ name: asset.name, monthsSinceUpdate: age })
    }
  }

  const byKind = [...buckets.values()]
    .map((b) => ({
      ...b,
      total: round2(b.total),
      // القسمة على المجموع الخام لا المقرَّب: التقريب قبل القسمة يوزّع خطأه
      // على كل سطر، فلا تجتمع الحصص على واحد.
      share: assetsTotal > 0 ? b.total / assetsTotal : 0,
    }))
    .sort((a, b) => b.total - a.total)

  /*
   * الحسابات: مصدر النقد الوحيد.
   *
   * الرصيد لا يُقصّ عند الصفر — حسابٌ مكشوف حقيقةٌ تحدث، وقصُّه يخفي أسوأ ما
   * يمكن أن يكون فيه صاحبه. أمّا المخصَّص فيُقصّ: تخصيصٌ سالب يرفع «المتاح»
   * فوق رصيد البنك.
   */
  const accountsRaw = input.accounts ?? []
  const accountsTotal = accountsRaw.reduce((sum, a) => sum + finiteOr(a.balance, 0), 0)
  const accountsReserved = accountsRaw.reduce((sum, a) => sum + atLeastZero(a.reserved ?? 0), 0)

  const accounts: AccountLine[] = accountsRaw
    .map((a) => {
      const balance = finiteOr(a.balance, 0)
      const reserved = atLeastZero(a.reserved ?? 0)
      const rounded = round2(balance - reserved)
      const available = rounded === 0 ? 0 : rounded
      return {
        name: a.name,
        balance: round2(balance),
        reserved: round2(reserved),
        available,
        shortfall: available < 0,
      }
    })
    .sort((a, b) => b.balance - a.balance)

  /*
   * الصندوق المربوط لا يُجمع، وغير المربوط يُجمع.
   *
   * هذا هو الإصلاح كلّه في سطرين: مالُ الصندوق المربوط معدودٌ في رصيد حسابه،
   * فجمعُه ثانيةً يضاعف نفس الشيكل — وهو العطل الذي كان يُخرج ثروةً ضعف
   * الحقيقة. وغير المربوط لا يعرف التطبيق أين هو، فيبقى على السلوك القديم
   * لئلّا يهبط الرقم كذباً، ويُقال ذلك صراحةً.
   */
  let restrictedTotal = 0
  let unlinkedRestrictedTotal = 0
  for (const fund of input.restrictedFunds) {
    const amount = atLeastZero(typeof fund === 'number' ? fund : fund.amount)
    restrictedTotal += amount
    if (typeof fund === 'number' || !fund.isLinked) unlinkedRestrictedTotal += amount
  }

  // الجمع خام والتقريب عند الحدّ — هنا كما في الأصول. جمعُ `debtBalance`
  // يقرّب كل دَينٍ وحده، فيجتمع تقريبان على قرشٍ لا وجود له، ويصير مجموع
  // السطور المعروضة مخالفاً للمجموع المحسوب.
  const debtsTotal = input.debts.reduce(
    (sum, d) => sum + atLeastZero(d.monthlyAmount) * atLeastZero(d.paymentsLeft),
    0,
  )

  const ownedTotal = assetsTotal + accountsTotal + unlinkedRestrictedTotal

  /**
   * التقريب قبل الحكم لا بعده.
   *
   * من تساوى ملكه ودينه يخرج من الطرح بكسرٍ عائمٍ سالبٍ في المرتبة الرابعة
   * عشرة — و‍`0.1 + 0.2` وحدها تكفي لصنعه. فيقرأ صاحبه «₪ 0» بلون الخطر
   * وتحته «ديونك تفوق ملكك»، وهو لا يفوقه شيء. الحكم يقع على الرقم الذي
   * يراه المستخدم، والمقارنة بالصفر تُلغي إشارة الصفر السالب معها.
   */
  const rounded = round2(ownedTotal - debtsTotal)
  const netWorth = rounded === 0 ? 0 : rounded

  // الأقدم أولاً: الترتيب هنا ترتيب إلحاح، لا ترتيب عرضٍ جميل.
  staleAssets.sort((a, b) => b.monthsSinceUpdate - a.monthsSinceUpdate)

  return {
    assetsTotal: round2(assetsTotal),
    // النقد في الحساب سائلٌ بحكم تعريفه — هو ما يُسحب من الصرّاف اليوم.
    liquidTotal: round2(liquidTotal + accountsTotal),
    restrictedTotal: round2(restrictedTotal),
    accountsTotal: round2(accountsTotal),
    accountsReserved: round2(accountsReserved),
    accountsAvailable: round2(accountsTotal - accountsReserved),
    accounts,
    unlinkedRestrictedTotal: round2(unlinkedRestrictedTotal),
    hasUnlinkedFunds: unlinkedRestrictedTotal > 0,
    ownedTotal: round2(ownedTotal),
    debtsTotal: round2(debtsTotal),
    // لا يُقصّ عند الصفر: صافي ثروةٍ سالب حقيقةٌ جاء التطبيق ليريها.
    netWorth,
    byKind,
    emergencyFund: buildEmergencyFund(
      emergencyCurrent,
      atLeastZero(input.monthlyEssentials),
      atLeastZero(input.emergencyMonths),
    ),
    staleAssets,
    // العائد يُرجّح بالأصول وحدها: صناديق الالتزامات نقدٌ راكد لا عائد له،
    // وإدخالها في المقام يخفض المتوسط بلا سبب.
    weightedReturnPercent: assetsTotal > 0 ? round2(returnWeighted / assetsTotal) : 0,
    isUnderwater: netWorth < 0,
  }
}

/**
 * عمر آخر تحديث بالشهور، أو null إن كان التاريخ مجهولاً أو غير مقروء.
 *
 * التاريخ في المستقبل يُردّ إلى صفر: ساعةٌ مضبوطة خطأً على جهاز المستخدم لا
 * ينبغي أن تُنتج «حُدِّث قبل ‎-3 شهور».
 */
function monthsSinceUpdate(value: Date | string | null | undefined, today: Date): number | null {
  if (value === null || value === undefined) return null
  const updated = toDate(value)
  if (Number.isNaN(updated.getTime())) return null
  return Math.max(0, differenceInCalendarMonths(today, updated))
}

function buildEmergencyFund(
  current: number,
  monthlyEssentials: number,
  emergencyMonths: number,
): EmergencyFundView {
  const target = round2(monthlyEssentials * emergencyMonths)

  /**
   * من لا مصروف أساسيّ له لا هدف له، فهو مكتفٍ بحكم التعريف.
   *
   * البديل — قسمةٌ تُخرج Infinity أو NaN — يسري في الواجهة إلى شريطٍ بعرضٍ
   * لا نهائي ورقمٍ لا يُقرأ. والصفر هنا ليس هروباً: من لم يخبر التطبيق بمصروفه
   * لم يطلب منه أن يحكم عليه.
   */
  const monthsCovered = monthlyEssentials > 0 ? round2(current / monthlyEssentials) : 0
  const progress = target > 0 ? Math.min(1, current / target) : 1

  return {
    current: round2(current),
    target,
    monthsCovered,
    progress,
    isFunded: current >= target,
  }
}
