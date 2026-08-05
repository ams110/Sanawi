/**
 * نصوص الواجهة بالعربية — اللغة المرجعية.
 *
 * أي لغة جديدة تنسخ هذا الملف وتُترجمه. النوع `Translation` مشتق منه،
 * فأي مفتاح ناقص في لغة أخرى يصير خطأ في وقت البناء لا نصاً مفقوداً في الشاشة.
 */
export const ar = {
  app: {
    name: 'سنوي',
    tagline: 'الالتزامات السنوية الكبيرة، مقسّمة على شهور — فما بتفاجئك.',
  },

  common: {
    edit2: 'عدّل',
    saveEdit: 'احفظ التعديل',
    cancelEdit: 'ألغِ',
    save: 'احفظ',
    cancel: 'إلغاء',
    edit: 'عدّل',
    archive: 'أرشفه',
    back: 'ارجع',
    of: 'من',
    perMonth: 'بالشهر',
    total: 'المجموع',
    me: 'أنا',
    loading: '...',
    refresh: 'حدّث',
    /*
     * مدّةٌ مجرّدة بلا «بعد» ولا «خلال».
     *
     * الظرف يُركَّب في الجملة المستدعية لا هنا: «بتخلص بـ» و«بيقرّبلك» و«أول
     * دين بيسقط بعد» ثلاث جملٍ تحتاج المدّة نفسها، وحشوُ «بعد» داخلها يجعل
     * إحداها تقرأ «بتخلص بـ بعد ١٤ شهر».
     */
    durMonths: '{{count}} شهر',
    durYears: '{{years}} سنة',
    durYearsMonths: '{{years}} سنة و{{months}} شهر',
  },

  theme: {
    system: 'النظام',
    light: 'فاتح',
    dark: 'غامق',
    signOut: 'خروج',
  },

  auth: {
    signIn: 'تسجيل دخول',
    signUp: 'حساب جديد',
    email: 'الإيميل',
    password: 'كلمة السر',
    submitSignIn: 'ادخل',
    submitSignUp: 'افتح حساب',
    confirmSent: 'بعتنالك إيميل تأكيد. افتحه وبعدها سجّل دخول.',
    errors: {
      invalidLogin: 'الإيميل أو كلمة السر غلط',
      alreadyRegistered: 'هالإيميل مسجّل من قبل — سجّل دخول بدل ما تفتح حساب',
      shortPassword: 'كلمة السر لازم 6 حروف على الأقل',
      invalidEmail: 'الإيميل مش مكتوب صح',
      rateLimit: 'جرّبت كتير بسرعة — استنى دقيقة وجرّب كمان مرة',
    },
  },

  setup: {
    title: 'التطبيق مش مربوط بقاعدة البيانات بعد.',
    step1: 'افتح مشروعك على Supabase ← SQL Editor، والصق ملفات supabase/migrations بالترتيب واضغط Run.',
    step2: 'من Settings ← API انسخ Project URL و anon key.',
    step3: 'اعمل ملف .env بجذر المشروع وحط فيه:',
    restart: 'بعدها أعد تشغيل npm run dev — Vite بيقرأ ملف .env عند الإقلاع بس.',
  },

  onboarding: {
    skip: 'تخطّى',
    next: 'كمّل',
    start: 'يلا نبلش',
    step1Title: 'المصروف السنوي بيجي مرة وحدة',
    step1Body:
      'تأمين السيارة، טסט، إطارات، أعراس. عقلك بيحسبها "مش شهرية"، فميزانيتك بتقلك إنك مرتاح — لحد ما تيجي دفعة 6,000 ₪ وتوقعك.',
    step2Title: 'الحل: قسّمها على شهور',
    step2Body:
      'كل التزام ÷ الشهور اللي لموعده = قسط شهري بتدفعه لحالك بصندوق مخصص. لما ييجي الموعد، الفلوس جاهزة.',
    step3Title: 'ضيف أول التزام',
    step3Body: 'ابدأ بأكبر واحد عندك — عادةً تأمين السيارة. بتشوف قسطك بثانية.',
    createFailed: 'ما قدرنا نضيف الالتزام',
  },

  /*
   * أسماء التبويبات السبعة — كلّها هنا.
   *
   * كانت موزّعة على أربعة أماكن: أربعةٌ في `nav` وثلاثةٌ مبعثرة في
   * `bills.tab` و`expenses.tab` و`insights.tab`. فمن أراد قراءة أسماء
   * التنقّل قرأها من أربع نقاط، ومن أراد تغيير واحدٍ منها بحث عنه. والترتيب
   * في `App.tsx` مصفوفةٌ واحدة، فليكن الاسم كذلك.
   *
   * والنصوص قصيرة عمداً: سبعة تبويبات على شاشة 390px تعني 55px لكل واحد،
   * و«التزامات» بلا أل التعريف لأن أل وحدها تكفي لقصّ الكلمة.
   */
  nav: {
    month: 'الشهر',
    bills: 'الفواتير',
    expenses: 'مصاريف',
    money: 'الدخل',
    obligations: 'التزامات',
    calendar: 'التقويم',
    insights: 'تحليل',
  },

  expenses: {
    title: 'مصاريف الشهر',
    subtitle: 'الصغيرة اللي ما بتحسّ فيها — لحتى تتجمّع',
    total: 'صرفت هالشهر',
    dailyAverage: 'بمعدّل {{amount}} باليوم',
    projected: 'بهالوتيرة رح توصل {{amount}} بآخر الشهر',
    projectedDone: 'مجموع الشهر النهائي',
    unexpected: 'منها مفاجئ',
    daysElapsed: 'مرّ {{elapsed}} من {{total}} يوم',
    addTitle: 'ضيف مصروف',
    amountPlaceholder: 'المبلغ',
    pickCategory: 'اختار تصنيف',
    markUnexpected: 'كان مفاجئ',
    unexpectedHint: 'ما كان بالحسبان — تصليح، دكتور، طوارئ',
    notePlaceholder: 'ملاحظة (اختياري)',
    add: 'سجّل المصروف',
    addCategory: 'تصنيف جديد',
    categoryName: 'اسم التصنيف',
    categoryIcon: 'أيقونة',
    saveCategory: 'ضيف التصنيف',
    breakdown: 'وين راحت',
    entries: '{{count}} مرة',
    share: '{{percent}}%',
    listTitle: 'كل المصاريف',
    empty: 'ما سجّلت ولا مصروف هالشهر.',
    emptyHint: 'سجّل أول واحد — القهوة والبنزين هنّ اللي بيوكلوا الدخل بهدوء.',
    remove: 'احذف',
    uncategorized: 'بلا تصنيف',
    thisMonth: 'هذا الشهر',
    loadFailed: 'ما قدرنا نجيب المصاريف',
    saveFailed: 'ما قدرنا نسجّل المصروف',
    editTitle: 'عدّل المصروف',
    editFailed: 'ما قدرنا نحفظ التعديل',
  },

  month: {
    title: 'لازم يطلع من حسابك هالشهر',
    availableLabel: 'بيضل معك للصرف',
    overBudget: 'دخلك ما بيكفّي التزاماتك هالشهر',
    overBudgetHint: 'نقّص الادخار أو أجّل التزام — الأرقام مش بتكذب.',
    noIncome: 'ضيف دخلك عشان نحسبلك المتاح',
    addIncome: 'ضيف دخلك',
    breakdownTitle: 'وين بتروح',
    fixed: 'الالتزامات الثابتة',
    obligations: 'الأقساط السنوية',
    savings: 'الادخار',
    left: 'الباقي',
    income: 'الدخل الشهري',
  },

  calendar: {
    title: 'الـ12 شهر الجاية',
    subtitle: 'كل استحقاق بشهره — عشان ما تتفاجأ',
    empty: 'ما في استحقاقات بالسنة الجاية',
    heavy: 'شهر ثقيل',
    heaviestWarning: 'أثقل شهر عندك {{month}} بـ {{amount}}',
    monthTotal: 'مجموع الشهر',
    nothingDue: 'ما في استحقاق',
    yearTotal: 'مجموع السنة',
  },

  money: {
    title: 'الدخل والالتزامات الثابتة',
    incomeSection: 'مصادر الدخل',
    fixedSection: 'الالتزامات الثابتة',
    savingsSection: 'هدف الادخار الشهري',
    addIncome: '+ ضيف مصدر دخل',
    addFixed: '+ ضيف التزام ثابت',
    namePlaceholder: 'الاسم',
    amountPlaceholder: 'المبلغ',
    weekly: 'أسبوعي',
    biweekly: 'كل أسبوعين',
    monthly: 'شهري',
    monthlyEquivalent: 'يعني {{amount}} بالشهر',
    isVariable: 'دخل متغيّر — ما بعرف قديش بيجي',
    variableHint: 'متغيّر — بينحسب لما يوصل',
    remove: 'احذف',
    saved: 'انحفظ ✓',
    saveFailed: 'ما قدرنا نحفظ',
    loadFailed: 'ما قدرنا نجيب البيانات',
    editSource: 'عدّل المصدر',
    editFailed: 'ما قدرنا نحفظ التعديل',
    emptyIncome: 'ما ضفت ولا مصدر دخل',
    emptyFixed: 'ما ضفت ولا التزام ثابت',
  },

  payment: {
    markPaid: 'اندفع ✓',
    confirmTitle: 'أكّد الدفع',
    confirmBody: 'رح نسحب {{amount}} من الصندوق ونبلّش دورة جديدة.',
    shortfallWarning: 'بصندوقك {{balance}} بس، فرح تدفع {{shortfall}} من جيبك.',
    successTitle: 'دفعت {{amount}} بدون ما تحس 💪',
    successBody: 'قسطك الجديد {{installment}} بالشهر، وموعدك الجاي {{date}}.',
    carriedNote: 'ورحّلنا {{amount}} فاضلة للدورة الجاية.',
    finishedTitle: 'خلّصت هالالتزام 🎉',
    close: 'تمام',
    failed: 'ما قدرنا نسجّل الدفعة',
  },

  insights: {
    groupTitle: 'قديش بتكلفك فعلاً',
    groupSubtitle: 'كل شي بتدفعه على بند واحد، مجموع ومقسوم على 12',
    pickCategory: 'اختار بند',
    yearly: 'بالسنة',
    monthly: 'المعدل الشهري الحقيقي',
    noData: 'ضيف التزامات لهاد البند عشان نحسبلك',
    expensesLabel: 'مصاريف متفرقة',

    simulatorTitle: 'لو ادّخرت بدل ما تصرف',
    simulatorSubtitle: 'حرّك الأرقام وشوف وين بتوصل',
    monthlyAmount: 'شهرياً',
    years: 'لمدة',
    yearsUnit: 'سنة',
    annualReturn: 'عائد سنوي',
    resultTitle: 'بعد {{years}} سنة بيصير معك',
    deposited: 'اللي حطيته',
    growth: 'اللي ربحته',
    passiveTitle: 'دخل شهري بدون شغل',
    passiveNote: 'محسوب على سحب 4% بالسنة — القاعدة اللي بتخلّي المبلغ ما يخلص.',
  },

  backup: {
    title: 'بياناتك ملكك',
    subtitle: 'نزّل نسخة كاملة، أو ارجّعها لأي حساب.',
    export: '⬇ نزّل نسخة',
    import: '⬆ ارجّع نسخة',
    exporting: 'عم ننزّل...',
    importing: 'عم نرجّع...',
    imported: 'رجّعنا {{count}} صف. الصفوف الموجودة انتركت زي ما هي.',
    failed: 'ما قدرنا نكمّل',
  },

  update: {
    title: 'نسخة التطبيق',
    subtitle: 'الواجهة بتتحدّث من الإنترنت — ما بتحتاج تنصّب من جديد.',
    button: '⟳ حدّث التطبيق',
  },

  reminders: {
    title: '{{name}} قرب موعده',
    bodyWithAmount: 'باقي {{days}} يوم على {{name}}. لسا ناقصك {{amount}} بالصندوق.',
    bodyReady: 'باقي {{days}} يوم على {{name}} — وصندوقك جاهز 👌',
  },

  bills: {
    title: 'فواتير الشهر',
    subtitle: 'سجّل قديش إجت فعلاً، وشو دفعت',
    recorded: 'مسجّل',
    paid: 'مدفوع',
    outstanding: 'باقي عليك',
    missing: 'لسا {{count}} فاتورة ما سجّلتها',
    allRecorded: 'سجّلت كل الفواتير 👌',
    budgeted: 'بالميزانية {{amount}}',
    average: 'معدّل آخر سنة {{amount}}',
    aboveBudget: 'أعلى من ميزانيتك بـ {{amount}}',
    amountLabel: 'قديش إجت',
    markPaid: 'دفعتها',
    markUnpaid: 'ما دفعتها',
    notRecorded: 'ما سجّلتها',
    save: 'سجّل',
    clear: 'امسح',
    empty: 'ضيف التزاماتك الثابتة من شاشة الدخل، وبتظهر هون كل شهر.',
    goToMoney: 'روح لشاشة الدخل',
    loadFailed: 'ما قدرنا نجيب الفواتير',
    saveFailed: 'ما قدرنا نحفظ الفاتورة',
    thisMonth: 'هذا الشهر',

    addTitle: 'ضيف بند شهري',
    pickTemplate: 'اختار من الجاهز',
    customName: 'أو اكتب اسم البند',
    monthlyAmount: 'المبلغ الشهري',
    suggested: 'عادةً بين {{min}} و {{max}}',
    isInstallment: 'هذا قسط أو دين — بينتهي',
    startsOn: 'أول دفعة',
    startsOnHint: 'اتركه فاضي إذا بلّشت تدفع',
    startsAfterEnds: 'أول دفعة بعد آخر دفعة — راجع التاريخين',
    endsOn: 'آخر دفعة',
    totalAmount: 'أصل الدين (اختياري)',
    add: 'ضيف البند',
    addFailed: 'ما قدرنا نضيف البند',

    paymentsLeft: 'بقي {{count}} دفعة',
    lastPayment: 'آخر دفعة 🎉',
    remainingForMe: 'باقي عليك {{amount}}',
    finished: 'خلص',
    notStarted: 'بتبلّش {{date}}',

    loadTitle: 'الحمل الشهري',
    recurring: 'فواتير متكرّرة',
    installments: 'أقساط وديون',
    nextRelief: 'بعد {{count}} شهور بينزل حملك {{amount}} بالشهر',
    nextReliefSoon: 'الشهر الجاي بينزل حملك {{amount}} بالشهر',

    sharesTitle: 'مين بيدفع شو',
    myShare: 'حصّتك',
    partnerShare: 'حصّة {{name}}',
    myAmount: 'عليك {{amount}} من أصل {{total}}',
    sharesMustBe100: 'المجموع لازم يكون 100% — ناقص {{gap}}%',
    sharesOver100: 'المجموع أكثر من 100% بـ {{gap}}%',
    saveShares: 'احفظ الحصص',
    addPartner: 'ضيف شريك',
    partnerName: 'اسم الشريك',
    noPartners: 'ما في شركاء بعد',
    sharesSaved: 'انحفظت 👌',
    sharesFailed: 'ما قدرنا نحفظ الحصص',

    dayOfMonth: 'موعد الدفع',
    dayHint: 'أي يوم بالشهر بتنزل؟',
    dayValue: '{{day}} بالشهر',
    noDay: 'بلا موعد محدّد',
    dueToday: 'اليوم! 🔔',
    dueOverdue: 'متأخرة {{count}} يوم',
    dueSoon: 'بعد {{count}} يوم',
    dueLater: 'يوم {{day}}',
    method: 'طريقة الدفع',
    methodHint: 'كيف بتدفعها عادةً',
    automatic: 'اقتطاع تلقائي',
    automaticHint: 'بتنسحب لحالها — بس تأكّد إنها انسحبت',
    addMethod: 'طريقة جديدة',
    methodName: 'اسم الطريقة',
    isAutomaticMethod: 'اقتطاع تلقائي (هوراة كيفع)',
    saveMethod: 'ضيف الطريقة',
    payableCount: 'لازم تدفع {{count}} فاتورة',
    payableNone: 'ما ضل عليك ولا فاتورة تدفعها 👌',
    editTitle: 'عدّل البند',
    editName: 'الاسم',
    archive: 'شيل البند',
    archiveHint: 'بيختفي من الشاشات وبيضل تاريخ فواتيره محفوظ',
    editFailed: 'ما قدرنا نحفظ التعديل',
  },

  categories: {
    car: 'السيارة',
    health: 'الصحة',
    events: 'مناسبات',
    home: 'البيت',
    lifestyle: 'سفر وترفيه',
    goal: 'أهداف وشراء',
    other: 'متفرقات',
  },

  status: {
    on_track: 'ملحّق',
    slightly_behind: 'متأخر شوي',
    behind: 'متأخر',
  },

  /*
   * الحالة نفسها بلغة الهدف.
   *
   * "متأخر" حكمٌ عادلٌ على تأمين سيارةٍ له موعدٌ لا يؤجَّل، وظالمٌ لمن
   * يجمّع ثمن بلايستيشن — لا أحد يتأخّر عن رغبةٍ اختارها هو. الحساب واحد
   * والكلمة تختلف.
   */
  goalStatus: {
    on_track: 'ماشي تمام',
    slightly_behind: 'لسا بدك تزيد شوي',
    behind: 'بهالوتيرة رح يتأخر',
  },

  panel: {
    title: 'اللي بيدك هالشهر',
    incomeActual: 'دخلك اللي وصل',
    incomeExpected: 'دخلك المتوقّع',
    incomeNotLogged: 'ما سجّلت دخل هالشهر — بنحسب بالمتوقّع',
    incomeBelow: 'أقل من المعتاد بـ {{amount}}',
    incomeAbove: 'أعلى من المعتاد بـ {{amount}}',
    committed: 'ملتزم فيه',
    spent: 'صرفته',
    remaining: 'بيضل معك',
    overspent: 'تجاوزت بـ {{amount}}',
    projection: 'بوتيرة صرفك، رح تخلّص الشهر بـ {{amount}}',
    projectionBad: 'بوتيرة صرفك، رح تتجاوز بـ {{amount}} آخر الشهر',
    allowance: 'يعني {{amount}} لليوم لتوصل آخر الشهر',
    allowanceZero: 'ما ضل شي للصرف هالشهر',
    breakdown: 'وين بيروح',
    obligations: 'أقساط الالتزامات',
    bills: 'فواتير متكرّرة',
    installments: 'أقساط وديون',
    expenses: 'مصاريف يومية',
    savings: 'ادخار',
    logIncome: 'سجّل دخل وصلك',
    incomeAmount: 'المبلغ',
    incomeName: 'من وين (اختياري)',
    incomeDate: 'تاريخ الاستلام',
    addIncome: 'سجّل',
    incomeList: 'دخل هالشهر',
    noIncomeYet: 'ما سجّلت ولا دفعة دخل هالشهر',
    removeIncome: 'احذف',
    incomeFailed: 'ما قدرنا نسجّل الدخل',
    editIncome: 'عدّل الدفعة',
    editFailed: 'ما قدرنا نحفظ التعديل',
  },

  goal: {
    label: 'هدف',
    category: 'أهداف وشراء',
    ready: 'جاهز تشتريه 🎉',
    remaining: 'باقي {{amount}}',
    targetDate: 'بدك إياه بـ',
    monthlyToReach: 'وفّر {{amount}} بالشهر لتوصله',
    add: '+ ضيف هدف',
  },

  obligations: {
    monthlyTotalLabel: 'لازم يطلع من حسابك هالشهر',
    monthlyTotalHint: 'مجموع أقساط {{count}} التزام',
    add: '+ ضيف التزام',
    deposited: 'أودعت ✓',
    bridgeBadge: 'مضغوطة',
    emptyTitle: 'لسا ما ضفت ولا التزام',
    emptyBody: 'ابدأ بأكبر واحد — تأمين السيارة عادةً. بتشوف قسطك الشهري بثانية.',
    loadFailed: 'ما قدرنا نجيب الالتزامات',
    depositFailed: 'ما قدرنا نسجّل الإيداع',
    notFound: 'ما لقينا هالالتزام.',
    backToList: 'ارجع للالتزامات',
  },

  detail: {
    installment: 'قسطك الشهري',
    collected: 'جمعت لهلأ',
    myTotal: 'حصتك من المبلغ',
    remaining: 'باقي عليك',
    sharedNote:
      'مشترك: حصتك {{percent}}% من {{total}}. مجموع الصندوق من الكل {{fund}}.',
    depositAmount: 'أودعت {{amount}} ✓',
    whoDeposits: 'مين بيودع؟',
    archiveFailed: 'ما قدرنا نأرشفه',
  },

  form: {
    previewLabel: 'قسطك الشهري',
    name: 'الاسم',
    namePlaceholder: 'تأمين السيارة',
    amount: 'المبلغ الكامل',
    dueDate: 'الموعد الجاي',
    recurrence: 'بيتكرر',
    recurrenceYearly: 'كل سنة',
    recurrenceHalf: 'كل 6 شهور',
    recurrenceQuarter: 'كل 3 شهور',
    recurrenceOnce: 'مرة وحدة',
    shareNote: 'حصتك {{myTotal}} من أصل {{total}} — القسط محسوب على حصتك بس.',
    submitCreate: 'ضيفه',
    saveFailed: 'ما قدرنا نحفظ',
    loadFailed: 'ما قدرنا نجيب الالتزام',
  },

  templates: {
    title: 'شو بدك تضيف؟',
    subtitle: 'اختار من الجاهز، وبتعدّل الأرقام بعدين.',
    skip: 'مش من هدول — بكتبه بنفسي',
  },

  partners: {
    enable: '+ هاد الالتزام مشترك مع حدا',
    sharedLabel: 'مشترك',
    allMine: 'كله عليّ',
    namePlaceholder: 'اسم الشريك',
    addAnother: '+ شريك تاني',
    remove: 'شيل الشريك',
    totalIs: 'المجموع {{percent}}%',
    settlementsTitle: 'مين دفع شو',
    settled: 'خلّص ✓',
    outstanding: 'باقي {{amount}}',
    errors: {
      mustBe100: 'بلا شركاء لازم حصتك تكون 100%',
      needName: 'اكتب اسم كل شريك',
      sumMismatch: 'المجموع {{percent}}% — لازم يكون 100% بالضبط',
    },
  },

  /*
   * الثروة والحرية والسداد.
   *
   * لهجة هذه الشاشات أهدأ من باقي التطبيق عمداً: باقي الشاشات تنبّه من دفعةٍ
   * قادمة، وهذه تقيس مسافةً طويلة. التنبيه يرفع الصوت، والقياس لا يحتاجه.
   */
  wealth: {
    entryTitle: 'صافي ثروتك ورقم حريتك',
    entryHint: 'شوف وين وصلت — ووين رايح',
    title: 'صافي ثروتك',
    subtitle: 'كل اللي بتملكه، ناقص كل اللي عليك.',
    loadFailed: 'ما قدرنا نجيب أصولك',

    net: 'صافي الثروة',
    owned: 'اللي بتملكه',
    assetsTotal: 'أصول مسجّلة',
    restricted: 'صناديق التزاماتك',
    restrictedNote: 'مصاري جمعتها لبنود معيّنة — ملكك، بس محجوزة إلها.',
    debts: 'ديون عليك',
    debtsNote: 'أقساطك اللي إلها نهاية. الفواتير الشهرية مش دين — هي مصروف.',
    liquid: 'منها سائل',
    underwater: 'ديونك أكبر من ملكك. الرقم سالب، وهاي الحقيقة اللي جينا نشوفها.',

    breakdown: 'وين مصارك',
    kinds: {
      cash: 'كاش',
      savings: 'ادخار',
      investment: 'استثمار',
      property: 'عقار',
      receivable: 'ديون إلك',
      other: 'غير هيك',
    },

    staleTitle: 'قيم قديمة',
    staleNote: 'الرقم فوق مبني على قيم ما حدّثتها من زمان — حدّثها تصير تقرا حقيقة.',
    staleLine: '{{name}} — آخر تحديث من {{months}} شهر',

    emergencyTitle: 'صندوق الطوارئ',
    emergencyOf: 'من {{target}}',
    emergencyCovered: 'بيغطّي {{months}} شهر من مصروفك',
    emergencyFunded: 'مكتمل — وهاد أول أساس بينبني عليه غيره',
    emergencyEmpty: 'ما في صندوق طوارئ لسا. علّم أي أصل سائل إنه صندوق طوارئ.',
    /*
     * بلا مصروفٍ مسجَّل لا هدف، وبلا هدفٍ لا حُكم.
     *
     * المحرّك يمتنع عن الحكم في هذه الحال عمداً، وكانت الشاشة تحكم مكانه
     * فتقول «مكتمل» و«من ₪ 0» لمن ما سجّل ولا فاتورة.
     */
    emergencyNoTarget: 'سجّل فواتيرك ومصاريفك، وبنعرف قديش لازم يغطّي صندوقك.',
    emergencyMonths: 'بدك يغطّي كم شهر',

    assetsTitle: 'أصولك',
    assetsEmpty: 'ما سجّلت ولا أصل بعد. حتى الكاش اللي بالبنك أصل — سجّله.',
    addAsset: '+ ضيف أصل',
    assetName: 'اسم الأصل',
    assetAmount: 'القيمة',
    assetKind: 'النوع',
    assetReturn: 'العائد السنوي %',
    isLiquid: 'بقدر أصرفه هالأسبوع',
    isEmergency: 'هاد صندوق الطوارئ',
    updatedAgo: 'آخر تحديث {{date}}',
    remove: 'شيل الأصل',
    saveFailed: 'ما انحفظ',
    needName: 'اكتب اسم الأصل',
    needAmount: 'اكتب قيمة أكبر من صفر',

    trendTitle: 'مسار ثروتك',
    trendEmpty: 'احفظ لقطة هالشهر، وبالشهر الجاي بيصير في خط.',
    trendNote: 'لقطة بالشهر — الاتجاه بيهمّ أكتر من الرقم.',
    trendUp: 'زادت {{amount}} على مدى {{count}} لقطات.',
    trendDown: 'نزلت {{amount}} على مدى {{count}} لقطات.',
    saveSnapshot: 'احفظ لقطة هالشهر',
    snapshotSaved: 'انحفظت ✓',
  },

  freedom: {
    title: 'رقم الحرية',
    subtitle: 'رأس المال اللي دخله بيغطّي مصروفك — وبعدها الشغل بيصير اختيار.',
    number: 'رقم حريتك',
    numberNote: 'مصروفك السنوي × {{multiple}}',
    todayMoney: 'كل الأرقام هون بقيمة اليوم — التضخّم محسوب ومخصوم.',
    /*
     * «ما بتوصل» و«ما منعرف» جملتان مختلفتان.
     *
     * كانت الشاشة تقول للي ما سجّل ولا فاتورة «نقّص مصروفك» — مصروفٌ ما
     * أدخله أصلاً. المحرّك يفرّق بين الحالتين، والشاشة كانت تطمسه.
     */
    noSpendingYet: 'لسا ما منعرف مصروفك. سجّل فواتيرك ومصاريفك وبنحسبلك رقم حريتك وتاريخها.',
    /* رقمٌ مبنيّ على شهرٍ لم ينتهِ يتحرّك غداً، والصدق أن يُقال إنه يتحرّك. */
    provisional: 'رقم مبدئي — لسا ما في شهر كامل نبني عليه.',

    reached: 'وصلت. دخلك السلبي بيغطّي مصروفك.',
    dateTitle: 'تاريخ حريتك',
    after: 'بعد {{duration}}',
    never: 'بهالوتيرة ما بتوصل. زيد اللي بتدخّره، أو نقّص مصروفك السنوي.',
    coverage: 'قطعت {{percent}}% من الطريق',
    shortfall: 'ناقصك {{amount}}',

    passiveNow: 'دخلك السلبي اليوم',
    passiveNote: 'بيغطّي {{months}} شهر من كل ١٢ شهر من مصروفك',
    realReturn: 'عائد حقيقي {{percent}}% بعد التضخّم',

    inputsTitle: 'أرقامك',
    annualSpending: 'مصروفك السنوي',
    annualSpendingHint:
      'فواتيرك الدائمة + أقساط التزاماتك السنوية + مصروفك اليومي، × ١٢. أقساط الديون مش محسوبة — إلها نهاية.',
    monthlyContribution: 'بتدخّر بالشهر',
    expectedReturn: 'العائد السنوي المتوقّع',
    inflation: 'التضخّم',
    withdrawalRate: 'معدّل السحب الآمن',

    sensitivityTitle: 'وإذا زدت شوي',
    sensitivity: 'زيادة {{amount}} بالشهر بتقرّبلك الحرية {{months}}',
    /*
     * الحالة التي كانت تُقرأ مقلوبة.
     *
     * لمّا يكون مسارك الحالي ما بيوصل والزيادة بتوصّلك، الفرق بالشهور ما بينقاس
     * — فكانت الشاشة تقرأ الفراغ وتقول «ما بتكفّي»، وهي أحسن خبر ممكن يُقال.
     */
    sensitivityOpens: 'زيادة {{amount}} بالشهر لحالها بتفتحلك الطريق — بتوصل بعد {{months}}',
    sensitivityNone: 'زيادة {{amount}} بالشهر لحالها ما بتوصلك.',
  },

  payoff: {
    title: 'ترتيب سداد الديون',
    subtitle: 'نفس المصاري، ترتيب مختلف — والفرق بيبان بالفايدة.',
    empty: 'ما في ديون مسجّلة. سجّل أقساطك بشاشة البنود وحط نسبة الفايدة.',
    noInterest:
      'كل ديونك بفايدة صفر، فالترتيب ما بيوفّر مصاري — بس كرة الثلج بتسقّط أول دين أبكر.',

    avalanche: 'الأعلى فايدة أول',
    snowball: 'الأصغر مبلغ أول',
    avalancheWhy: 'بتوفّر أكتر مصاري.',
    snowballWhy: 'بتشوف أول دين بيسقط أبكر.',

    extra: 'كم بتقدر تدفع زيادة بالشهر',
    finishesIn: 'بتخلص بـ',
    totalInterest: 'مجموع الفايدة',
    saves: 'الأعلى فايدة بتوفّرلك {{amount}}',
    savesMonths: 'وبتختصر {{months}}',
    same: 'الطريقتين بيعطوا نفس النتيجة عندك.',
    firstWin: 'أول دين بيسقط بعد {{months}}',
    clearedAt: 'بيخلص بعد {{months}}',
    notCleared: 'ما بيخلص',
    interestPaid: 'فايدة {{amount}}',
    impossible: 'الحد الأدنى ما بيغطّي الفايدة، فالرصيد ما بينزل. لازم تزيد الدفعة.',
    balance: 'الباقي',
    ratePercent: '% فايدة',
  },

  bridge: {
    title: 'دفعة مضغوطة — وهاي مؤقتة',
    body: 'موعد هالالتزام أقرب من دورته الكاملة، فلازم تودّع {{amount}} بالشهر لمدة {{months}}.',
    after: 'بعد ما تخلص هالدورة بينزل القسط لـ {{amount}} بالشهر بشكل دائم.',
    reassure:
      'الضغط هاد مرة وحدة بس — لأنك بلّشت تجمع متأخر، مش لأن الالتزام غالي. الدورة الجاية بتبلش من أولها وبتتوزّع على {{months}} شهر كاملة.',
  },

  time: {
    overdue: 'فات موعده',
    thisMonth: 'هذا الشهر',
    inOneMonth: 'بعد شهر',
    inTwoMonths: 'بعد شهرين',
    inFewMonths: 'بعد {{count}} شهور',
    inManyMonths: 'بعد {{count}} شهراً',
    oneMonth: 'شهر',
    twoMonths: 'شهرين',
    fewMonths: 'شهور',
    // لا أسماء شهور: التواريخ بالأرقام (8/2026). أسماء الشهور العربية
    // مذهبان — «أغسطس» و«آب» — وأيُّهما اخترتَ بدا غريباً لنصف القرّاء،
    // والأرقام تسقط المسألة من أصلها وتطابق ما تكتبه الفواتير والبنوك.
  },
} as const

export type Translation = typeof ar
