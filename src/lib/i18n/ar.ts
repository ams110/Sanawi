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

  nav: {
    month: 'الشهر',
    obligations: 'الالتزامات',
    calendar: 'التقويم',
    money: 'الدخل',
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
    remove: 'احذف',
    saved: 'انحفظ ✓',
    saveFailed: 'ما قدرنا نحفظ',
    loadFailed: 'ما قدرنا نجيب البيانات',
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
    tab: 'تحليل',
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

  reminders: {
    title: '{{name}} قرب موعده',
    bodyWithAmount: 'باقي {{days}} يوم على {{name}}. لسا ناقصك {{amount}} بالصندوق.',
    bodyReady: 'باقي {{days}} يوم على {{name}} — وصندوقك جاهز 👌',
  },

  categories: {
    car: 'السيارة',
    health: 'الصحة',
    events: 'مناسبات',
    home: 'البيت',
    lifestyle: 'سفر وترفيه',
    other: 'متفرقات',
  },

  status: {
    on_track: 'ملحّق',
    slightly_behind: 'متأخر شوي',
    behind: 'متأخر',
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
    months: [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
    ],
  },
} as const

export type Translation = typeof ar
