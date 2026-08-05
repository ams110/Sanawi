/**
 * ترتيب سداد الديون وثمنه.
 *
 * التطبيق يعرف متى ينتهي الدَّين، ولا يعرف كم يكلّف ولا بأيّ ترتيبٍ يُقتل.
 * وعند أول شيكلٍ زائدٍ في الشهر يفترق الطريقان: البدء بالأعلى فائدةً
 * (الانهيار) يوفّر مالاً حقيقياً، والبدء بالأصغر رصيداً (كرة الثلج) يشتري
 * فرحةً مبكّرة — وهي ما يُبقي الناس على الخطة أصلاً.
 *
 * لذلك يحسب هذا الملف الطريقين معاً ولا يفتي بأحدهما، ويُخرج الفرق بينهما
 * بالشيكل وبالشهر: من اختار المريح من حقّه أن يرى ثمنه قبل أن يختاره.
 */

export type PayoffStrategy = 'avalanche' | 'snowball'

export interface PayoffDebt {
  id: string
  name: string
  /** أصل الدين المتبقّي عليّ أنا. */
  balance: number
  /** أقلّ دفعة شهرية ملزمة — حصّتي منها. */
  minimumPayment: number
  annualInterestPercent: number
}

export interface PayoffLine {
  id: string
  name: string
  /** ترتيب المهاجمة، يبدأ من 1. */
  order: number
  /** الشهر الذي يسقط فيه هذا الدين، يبدأ من 1. فارغ = لم يسقط ضمن السقف. */
  clearedAtMonth: number | null
  interestPaid: number
  totalPaid: number
}

export interface PayoffPlan {
  strategy: PayoffStrategy
  lines: PayoffLine[]
  /** الشهور حتى آخر دين. فارغ = لم تنتهِ ضمن السقف. */
  months: number | null
  totalInterest: number
  totalPaid: number
  /**
   * متى يسقط أول دين — أول فرحة، وهي ما يبقي الناس على الخطة.
   * فارغ = لا دين يسقط ضمن السقف، أو ما سقط كان ميتاً قبل أن تبدأ.
   */
  firstClearedMonth: number | null
  /**
   * الحد الأدنى لا يغطّي الفائدة، فالرصيد لا ينزل أبداً.
   * الصمت هنا كارثة: خطةٌ تقول "٦٠٠ شهر" تُقرأ رقماً، و"مستحيلة" تُقرأ إنذاراً.
   */
  isImpossible: boolean
}

export interface PayoffInput {
  debts: readonly PayoffDebt[]
  /** ما تدفعه فوق مجموع الحدود الدنيا، شهرياً. */
  extraMonthly?: number
  strategy?: PayoffStrategy
  maxMonths?: number
}

export interface PayoffComparison {
  avalanche: PayoffPlan
  snowball: PayoffPlan
  /** ما توفّره الأولى على الثانية من فائدة. سالب = العكس. */
  interestSaved: number
  /** وكم شهراً تختصر. فارغ إن لم تنتهِ إحداهما. */
  monthsSaved: number | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** المُدخَل يأتي من قاعدة البيانات ومن حقول الإدخال، وNaN واحدٌ يسمّم المحاكاة كلها. */
const atLeastZero = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0)

/**
 * رصيدٌ دون هذا الحدّ ميت.
 * بدونه يبقى كسرُ أغورةٍ ناتجٌ عن الفاصلة العائمة ديناً حيّاً إلى آخر السقف.
 */
const EPSILON = 1e-9

/**
 * وأقلُّ من نصف أغورة ليس ديناً، مهما قالت الفاصلة العائمة.
 *
 * ‏`EPSILON` يحرس من ضجيج الفاصلة العائمة وحده، وهذا يحرس من شيءٍ آخر:
 * الأغورة هي أصغر ما يُدفع فعلاً، وما دونها لا يطالب به دائن ولا يستطيع
 * مدينٌ تسديده. إبقاؤه ديناً حيّاً يضيف شهراً كاملاً إلى الخطة لأجل كسرٍ
 * لا وجود له في العالم.
 */
const SETTLED = 0.01

/** خمسون سنة — أطول من أيّ قرضٍ استهلاكي، وسقفٌ يمنع الدوران بلا نهاية. */
const DEFAULT_MAX_MONTHS = 600

/**
 * أصل الدَّين من القسط وعدد الدفعات — كل ما يملكه التطبيق عن قرضٍ لم يُسجَّل أصلُه.
 *
 * القيمة الحالية لا مجموع الدفعات. والفرق ليس تدقيقاً محاسبياً: مجموعُ ما
 * سيُدفع يتضمّن فائدةً لم تُستحقّ بعد، فإن أدخلناه المحاكاةَ بوصفه أصلاً
 * ركّبت عليه الفائدةَ مرّةً ثانية. وقرضٌ حقيقيّ منتهٍ — ٣٠٠ شهرياً لستين
 * شهراً بثلاثين بالمئة — يصير عندها رصيده ١٨٬٠٠٠ وفائدتُه الشهرية ٤٥٠ فوق
 * قسطه، فتُعلَن خطّتُه «مستحيلة» وهو يُسدَّد فعلاً كل شهر. أصلُه الحقيقي
 * نحو ٩٬٣٠٠، ويُسدَّد في ستين شهراً بالضبط.
 *
 *     الأصل = القسط × (1 − (1+i)^−n) ÷ i
 *
 * وبفائدة صفر تنهار المعادلة على قسمةٍ على صفر، وناتجها الصحيح حاصل الضرب:
 * قسطٌ بلا فائدة أصلُه مجموع دفعاته. وهذه حال أكثر بنود التطبيق — «قسط
 * التلفون» وما يشبهه — فالسلوك القديم يبقى كما هو لمن لم يسجّل فائدة.
 */
export function debtBalanceFrom(
  monthlyAmount: number,
  paymentsLeft: number,
  annualInterestPercent = 0,
): number {
  const payment = atLeastZero(monthlyAmount)
  const months = atLeastZero(paymentsLeft)
  const monthlyRate = atLeastZero(annualInterestPercent) / 100 / 12

  if (monthlyRate < EPSILON) return round2(payment * months)
  return round2((payment * (1 - Math.pow(1 + monthlyRate, -months))) / monthlyRate)
}

/**
 * ترتيب المهاجمة.
 *
 * كسر التعادل ليس زينة: دينان بالفائدة نفسها يُقتل أصغرهما أولاً ليتحرّر حدّه
 * الأدنى مبكّراً، ودينان بالرصيد نفسه يُقتل أغلاهما أولاً. وبدون الرجوع إلى
 * الترتيب الأصلي عند تساوي كل شيء تختلف الخطة بين استدعاءين على البيانات نفسها.
 *
 * والمقارنة تقع على الأرقام بعد تنظيفها لا كما وردت: NaN واحدٌ يجعل الفرق NaN،
 * و NaN ‏`!== 0` فيرجع المقارِن NaN ويصير ترتيب المصفوفة غير معرَّف. ورصيدٌ سالب
 * كان يقفز إلى رأس كرة الثلج وهو دينٌ تعدّه المحاكاة ميتاً — الترتيب يجب أن يرى
 * ما تراه المحاكاة بالضبط.
 */
export function orderDebts(
  debts: readonly PayoffDebt[],
  strategy: PayoffStrategy,
): PayoffDebt[] {
  return debts
    .map((debt, index) => ({ debt, index }))
    .sort((a, b) => {
      const rateGap =
        atLeastZero(b.debt.annualInterestPercent) - atLeastZero(a.debt.annualInterestPercent)
      const balanceGap = atLeastZero(a.debt.balance) - atLeastZero(b.debt.balance)
      const primary = strategy === 'avalanche' ? rateGap : balanceGap
      if (primary !== 0) return primary
      const secondary = strategy === 'avalanche' ? balanceGap : rateGap
      if (secondary !== 0) return secondary
      return a.index - b.index
    })
    .map((entry) => entry.debt)
}

interface DebtState {
  readonly source: PayoffDebt
  /**
   * الفائدة الشهرية = السنوية ÷ ١٢، بسيطةً لا مركّبةً سنوياً.
   * هكذا تُقتبس قروض المستهلك هنا، ومطابقة ورقة البنك أولى من دقّةٍ أكاديمية
   * تُخرج رقماً لا يشبه شيئاً يعرفه صاحب القرض.
   */
  readonly monthlyRate: number
  readonly minimum: number
  balance: number
  interestPaid: number
  totalPaid: number
  clearedAtMonth: number | null
}

export function buildPayoffPlan(input: PayoffInput): PayoffPlan {
  const strategy = input.strategy ?? 'avalanche'
  const requestedMax = Math.floor(atLeastZero(input.maxMonths ?? DEFAULT_MAX_MONTHS))
  // السقف سقفٌ على من يطلب أكثر منه أيضاً: `maxMonths` يصل من مُدخَلٍ خارجي،
  // وطلبُ مليون شهرٍ يجمّد الخيط الذي يرسم الشاشة بدل أن يحسب شيئاً مفيداً.
  const maxMonths =
    requestedMax > 0 ? Math.min(requestedMax, DEFAULT_MAX_MONTHS) : DEFAULT_MAX_MONTHS
  const extraMonthly = atLeastZero(input.extraMonthly ?? 0)

  const state: DebtState[] = orderDebts(input.debts, strategy).map((source) => {
    const balance = atLeastZero(source.balance)
    return {
      source,
      monthlyRate: atLeastZero(source.annualInterestPercent) / 100 / 12,
      minimum: atLeastZero(source.minimumPayment),
      balance,
      interestPaid: 0,
      totalPaid: 0,
      // دينٌ رصيده صفر ميتٌ قبل أن تبدأ الخطة، فلا يستهلك شهراً: صفرٌ يميّزه
      // عن الفارغ الذي يعني "لم يمُت أبداً".
      clearedAtMonth: balance <= SETTLED ? 0 : null,
    }
  })

  /**
   * المحفظة الشهرية ثابتة: الزائد + كل الحدود الدنيا، بما فيها حدود من مات.
   * هذا هو التدحرّج نفسه وهو مقصد الخطة كلها؛ وخطةٌ لا تدوّر الحدّ المحرَّر
   * تُبطئ السداد سنواتٍ على الورق وحده.
   */
  const purseTotal = state.reduce((sum, debt) => sum + debt.minimum, extraMonthly)

  for (let month = 1; month <= maxMonths; month += 1) {
    const alive = state.filter((debt) => debt.clearedAtMonth === null)
    if (alive.length === 0) break

    // الفائدة تُحتسب قبل الدفع لا بعده: البنك يحسبها على رصيد أول الشهر،
    // وعكس الترتيب يُسقط فائدة شهرٍ كامل عن كل دين فتبدو الخطة أرخص مما هي.
    for (const debt of alive) {
      const interest = debt.balance * debt.monthlyRate
      debt.balance += interest
      debt.interestPaid += interest
    }

    let purse = purseTotal
    const pay = (debt: DebtState, amount: number): void => {
      // الدفعة لا تتجاوز الرصيد أبداً — ما زاد يبقى في المحفظة لمن بعده.
      const paid = Math.min(amount, debt.balance, purse)
      if (paid <= 0) return
      debt.balance -= paid
      debt.totalPaid += paid
      purse -= paid
    }

    // الهدف هو أول حيٍّ في الترتيب؛ ما عداه يأخذ حدّه الأدنى فقط.
    for (const debt of alive.slice(1)) pay(debt, debt.minimum)

    // ثم يُرمى كل ما بقي على الهدف، وما فاض عنه ينزل إلى الذي يليه في الشهر
    // نفسه: الفائض المهدور يعني شهراً ضائعاً بلا سبب.
    for (const debt of alive) {
      if (purse <= SETTLED) break
      pay(debt, purse)
    }

    for (const debt of alive) {
      if (debt.balance <= SETTLED) {
        debt.balance = 0
        debt.clearedAtMonth = month
      }
    }
  }

  const lines: PayoffLine[] = state.map((debt, index) => ({
    id: debt.source.id,
    name: debt.source.name,
    order: index + 1,
    clearedAtMonth: debt.clearedAtMonth,
    interestPaid: round2(debt.interestPaid),
    totalPaid: round2(debt.totalPaid),
  }))

  /**
   * الاستحالة تُكتشف بالمحاكاة لا بفحصٍ تحليلي.
   * "الحدّ الأدنى ≤ فائدة الشهر" يكذب في اتجاهٍ يهمّ: دينٌ عاجزٌ اليوم قد
   * يقتله التدحرّج بعد سنة حين يتفرّغ له كل شيء، فيُعلَن مستحيلاً وهو ممكن.
   * ومن بقي حيّاً عند السقف تُترك شهورُه فارغة، وتبقى فائدته المدفوعة مسجّلة:
   * هي المال الذي ضاع فعلاً خلال المدة، وهو أبلغ ما يقال لصاحب خطةٍ لا تنتهي.
   */
  const isImpossible = state.some((debt) => debt.clearedAtMonth === null)
  const clearedMonths = state
    .map((debt) => debt.clearedAtMonth)
    .filter((month): month is number => month !== null)

  /**
   * أول فرحة تُحسب من الشهور المعاشة وحدها.
   * دينٌ رصيده صفرٌ قبل أن تبدأ الخطة يحمل الشهر صفراً، وأخذُه هنا يُخرج
   * «أول دين يسقط بعد ٠ شهر» — جملةٌ تُعرَض للمستخدم ولا تعني شيئاً، والفارغ
   * أصدق منها: لا فرحة قادمة لأنها وقعت قبل الخطة.
   */
  const firstWins = clearedMonths.filter((month) => month > 0)

  return {
    strategy,
    lines,
    months: isImpossible ? null : clearedMonths.length === 0 ? 0 : Math.max(...clearedMonths),
    // التقريب عند حدود الناتج فقط: تقريبُ كل شهرٍ على حدة يتراكم عبر ٦٠٠ شهراً
    // فيظهر انحرافه شواكل فائدةٍ لم تُدفع.
    totalInterest: round2(state.reduce((sum, debt) => sum + debt.interestPaid, 0)),
    totalPaid: round2(state.reduce((sum, debt) => sum + debt.totalPaid, 0)),
    firstClearedMonth: firstWins.length === 0 ? null : Math.min(...firstWins),
    isImpossible,
  }
}

export function comparePayoff(input: Omit<PayoffInput, 'strategy'>): PayoffComparison {
  const avalanche = buildPayoffPlan({ ...input, strategy: 'avalanche' })
  const snowball = buildPayoffPlan({ ...input, strategy: 'snowball' })

  return {
    avalanche,
    snowball,
    interestSaved: round2(snowball.totalInterest - avalanche.totalInterest),
    // خطةٌ لا تنتهي لا تُطرح من خطةٍ تنتهي: الفرق بينهما ليس عدداً.
    monthsSaved:
      avalanche.months === null || snowball.months === null
        ? null
        : snowball.months - avalanche.months,
  }
}
