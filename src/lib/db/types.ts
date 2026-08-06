/**
 * أنواع قاعدة البيانات.
 *
 * مكتوبة يدوياً لتطابق ملفات supabase/migrations. حين يصير المشروع متاحاً
 * يمكن توليدها آلياً بـ `supabase gen types typescript` واستبدال هذا الملف.
 *
 * تحذير: صفوف الجداول هنا `type` لا `interface` عن قصد.
 * الـ interface لا يملك index signature ضمنياً فلا يطابق
 * `Record<string, unknown>` الذي يشترطه supabase-js، فيفشل الشرط صمتاً
 * ويستنتج TypeScript أن كل صف هو never — فتنهار كل استدعاءات select
 * و insert برسائل لا تشير إلى السبب من قريب ولا بعيد.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type IncomeFrequency = 'weekly' | 'biweekly' | 'monthly'

export type Profile = {
  id: string
  display_name: string | null
  currency: string
  locale: string
  country: string
  theme_preference: ThemePreference
  onboarding_completed: boolean
  monthly_savings_target: number
  /** كم شهراً يجب أن يغطّيه صندوق الطوارئ من المصروف الأساسي. */
  emergency_months: number
  /** معدّل السحب الآمن — ٤٪ يعني أن رقم الحرية = المصروف السنوي × ٢٥. */
  withdrawal_rate_percent: number
  /** التضخّم المفترض — به يصير الإسقاط بقيمة اليوم لا بقيمة اسمية. */
  inflation_percent: number
  created_at: string
}

/** نوع الأصل — يحدّد معنى الرقم لا شكله. */
export type AssetKind = 'cash' | 'savings' | 'investment' | 'property' | 'receivable' | 'other'

export type Asset = {
  id: string
  user_id: string
  name: string
  kind: AssetKind
  amount: number
  /** العائد السنوي المتوقّع — يدخل في الإسقاط وحده. */
  annual_return_percent: number
  /** هل يُصرف هذا الأسبوع؟ صندوق الطوارئ لا يكون إلا سائلاً. */
  is_liquid: boolean
  is_emergency_fund: boolean
  icon: string | null
  note: string | null
  is_active: boolean
  /** آخر تحديث للقيمة — قيمةٌ قديمة تجعل صافي الثروة يكذب بثقة. */
  updated_at: string
  created_at: string
}

/** الجاري يُصرف منه، والادخار يُجمَّع فيه — وأيّ تصنيفٍ أدقّ لا يغيّر رقماً. */
export type AccountKind = 'checking' | 'savings'

export type Account = {
  id: string
  user_id: string
  name: string
  kind: AccountKind
  /** الرصيد الفعلي كما في كشف البنك — يُدخَل يدوياً. */
  balance: number
  /** متى أُدخل الرصيد — رصيدٌ قديم يجعل «غير مخصّص» يكذب بثقة. */
  balance_updated_at: string
  /** فارغ = نشط. لا حذف: التحويلات تشير إليه. */
  archived_at: string | null
  created_at: string
}

export type AccountTransfer = {
  id: string
  user_id: string
  from_account_id: string
  to_account_id: string
  amount: number
  transferred_at: string
  note: string | null
  created_at: string
}

/** دفعةٌ خرجت من حسابٍ غير حساب صندوقها — تُعلَّم ولا تُرفض. */
export type AccountSettlement = {
  id: string
  user_id: string
  /** الحساب الذي تحرّر ماله — حساب الصندوق. */
  debtor_account_id: string
  /** الحساب الذي خرج منه الدفع فعلاً. */
  creditor_account_id: string
  amount: number
  obligation_id: string | null
  note: string | null
  /** فارغ = معلّقة. */
  settled_at: string | null
  settled_by_transfer_id: string | null
  created_at: string
}

export type NetWorthSnapshot = {
  id: string
  user_id: string
  /** أول يوم في الشهر — مفتاح الشهر لا تاريخ اللقطة. */
  snapshot_month: string
  assets_total: number
  restricted_total: number
  debts_total: number
  net_worth: number
  created_at: string
}

export type ObligationGroup = {
  id: string
  user_id: string
  name: string
  icon: string | null
  color: string | null
  created_at: string
}

export type Obligation = {
  id: string
  user_id: string
  group_id: string | null
  /** الحساب الذي يحتفظ بصندوق هذا الالتزام — فارغ = صندوق غير مربوط. */
  account_id: string | null
  name: string
  category: string | null
  total_amount: number
  next_due_date: string
  recurrence_months: number
  cycle_start_date: string
  baseline_installment: number
  my_share_percent: number
  is_active: boolean
  notes: string | null
  created_at: string
}

export type ObligationPartner = {
  id: string
  user_id: string
  name: string
  color: string | null
  created_at: string
}

export type ObligationPartnerShare = {
  id: string
  user_id: string
  obligation_id: string
  partner_id: string
  share_percent: number
}

export type FundDeposit = {
  id: string
  user_id: string
  obligation_id: string
  /** فارغ يعني أنني أنا من أودع. */
  partner_id: string | null
  amount: number
  deposit_date: string
  /** الحساب الذي دخله المبلغ فعلاً. */
  account_id: string | null
  note: string | null
  created_at: string
}

export type ObligationPayment = {
  id: string
  user_id: string
  obligation_id: string
  amount_paid: number
  paid_date: string
  next_due_date_after: string
  /** الحساب الذي خرج منه الدفع — إن خالف حساب الصندوق نشأت تسوية معلّقة. */
  paid_from_account_id: string | null
  created_at: string
}

export type IncomeSource = {
  id: string
  user_id: string
  name: string
  amount: number
  frequency: IncomeFrequency
  /** دخلٌ لا تقدير ثابت له — يُحتسب حين يصل، ولا يدخل الدخل المتوقَّع. */
  is_variable: boolean
  is_active: boolean
  created_at: string
}

export type FixedCommitment = {
  id: string
  user_id: string
  name: string
  amount: number
  day_of_month: number | null
  default_method_id: string | null
  icon: string | null
  /** أول دفعة — فارغ يعني أن الدفعات بدأت فعلاً. */
  starts_on: string | null
  /** آخر دفعة — فارغ يعني متكرّر بلا نهاية. */
  ends_on: string | null
  /** أصل الدين للعرض؛ الحساب يقوم على amount و ends_on. */
  total_amount: number | null
  /** الفائدة السنوية — صفر للفاتورة، وغير صفر للقرض؛ عليها يُرتَّب السداد. */
  annual_interest_percent: number
  my_share_percent: number
  /** حساب الدفع الافتراضي لهذا البند. */
  account_id: string | null
  is_active: boolean
  created_at: string
}

export type CommitmentPartnerShare = {
  id: string
  user_id: string
  commitment_id: string
  partner_id: string
  share_percent: number
}

export type CommitmentTemplate = {
  id: string
  name_ar: string
  name_he: string | null
  name_en: string | null
  category: string
  icon: string
  suggested_min: number | null
  suggested_max: number | null
  is_installment: boolean
  /** جملة واحدة: ما هو البند ومتى يُدفع. */
  hint: string | null
  country: string
  sort_order: number
}

export type CommitmentDetail = {
  commitment_id: string
  user_id: string
  name: string
  icon: string | null
  amount: number
  ends_on: string | null
  total_amount: number | null
  my_share_percent: number
  annual_interest_percent: number
  my_amount: number
  /** فارغ للبنود بلا نهاية. */
  payments_left: number | null
  /** أول دفعة — فارغ يعني أن الدفعات بدأت فعلاً. */
  starts_on: string | null
  /** حان شهر أول دفعة؛ ما لم يبدأ لا يُحمَّل على الشهر. */
  has_started: boolean
}

export type Expense = {
  id: string
  user_id: string
  group_id: string | null
  /** نصّ حرّ قديم سبق التصنيفات المفهرسة — يبقى للتوافق ولا يُكتب فيه. */
  category: string | null
  category_id: string | null
  is_unexpected: boolean
  amount: number
  spent_at: string
  note: string | null
  created_at: string
  method_id: string | null
  /** الحساب الذي خرج منه المصروف. */
  account_id: string | null
}

export type IncomeEntry = {
  id: string
  user_id: string
  /** فارغ = دخل بلا مصدر ثابت. */
  source_id: string | null
  name: string | null
  amount: number
  received_at: string
  note: string | null
  created_at: string
}

export type PaymentMethod = {
  id: string
  /** فارغ = طريقة افتراضية يراها الجميع. */
  user_id: string | null
  name_ar: string
  icon: string
  /** اقتطاع تلقائي: يُراجَع ولا يُدفع باليد. */
  is_automatic: boolean
  sort_order: number
  created_at: string
}

export type ExpenseCategory = {
  id: string
  /** فارغ = تصنيف افتراضي يراه الجميع ولا يملكه أحد. */
  user_id: string | null
  name_ar: string
  icon: string
  sort_order: number
  created_at: string
}

export type ObligationTemplate = {
  id: string
  name_ar: string
  name_he: string | null
  name_en: string | null
  category: string
  icon: string | null
  default_recurrence_months: number
  suggested_min: number | null
  suggested_max: number | null
  /** جملة واحدة: ما هو البند ومتى يُدفع. */
  hint: string | null
  country: string
  sort_order: number
}

export type AppEvent = {
  id: string
  user_id: string
  event_name: string
  payload: Record<string, unknown>
  created_at: string
}

/** مشهد محسوب — لا يُكتب فيه. */
export type ObligationBalance = {
  obligation_id: string
  user_id: string
  fund_balance: number
  my_fund_balance: number
  my_total: number
  last_deposit_date: string | null
  deposit_count: number
}

/** مشهد محسوب — لا يُكتب فيه. */
export type PartnerSettlement = {
  obligation_id: string
  user_id: string
  partner_id: string
  partner_name: string
  share_percent: number
  owed: number
  deposited: number
  outstanding: number
}

/**
 * supabase-js يشترط حقل Relationships على كل جدول ومشهد. بدونه لا يطابق
 * النوعُ GenericSchema فيستنتج TypeScript صمتاً أن كل صف هو never،
 * وتنهار كل استدعاءات select و insert برسائل لا تشير إلى السبب.
 * مصفوفة فارغة كافية: لا نستعمل الضمّ التلقائي عبر العلاقات.
 */
type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type View<Row> = { Row: Row; Relationships: [] }

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>
      obligation_groups: Table<ObligationGroup>
      obligations: Table<Obligation>
      obligation_partners: Table<ObligationPartner>
      obligation_partner_shares: Table<ObligationPartnerShare>
      fund_deposits: Table<FundDeposit>
      obligation_payments: Table<ObligationPayment>
      income_sources: Table<IncomeSource>
      fixed_commitments: Table<FixedCommitment>
      expenses: Table<Expense>
      expense_categories: Table<ExpenseCategory>
      payment_methods: Table<PaymentMethod>
      income_entries: Table<IncomeEntry>
      commitment_partner_shares: Table<CommitmentPartnerShare>
      obligation_templates: Table<ObligationTemplate>
      commitment_templates: Table<CommitmentTemplate>
      events: Table<AppEvent>
      bill_payments: Table<BillPayment>
      assets: Table<Asset>
      net_worth_snapshots: Table<NetWorthSnapshot>
      accounts: Table<Account>
      account_transfers: Table<AccountTransfer>
      account_settlements: Table<AccountSettlement>
    }
    Views: {
      obligation_balances: View<ObligationBalance>
      partner_settlements: View<PartnerSettlement>
      bill_averages: View<BillAverage>
      commitment_details: View<CommitmentDetail>
    }
    // نفس شكل ما يولّده `supabase gen types` للمجموعات الفارغة.
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type BillPayment = {
  id: string
  user_id: string
  commitment_id: string
  /** أول يوم في الشهر — مفتاح الشهر لا تاريخ الفاتورة. */
  billing_month: string
  amount: number
  /** فارغ = مسجّلة ولم تُدفع بعد. */
  paid_at: string | null
  note: string | null
  created_at: string
  method_id: string | null
}

/** مشهد محسوب — لا يُكتب فيه. */
export type BillAverage = {
  commitment_id: string
  user_id: string
  name: string
  budgeted_amount: number
  paid_count: number
  average_amount: number
}
