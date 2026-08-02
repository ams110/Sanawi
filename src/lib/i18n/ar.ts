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
