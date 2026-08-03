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
  created_at: string
}

export type IncomeSource = {
  id: string
  user_id: string
  name: string
  amount: number
  frequency: IncomeFrequency
  is_active: boolean
  created_at: string
}

export type FixedCommitment = {
  id: string
  user_id: string
  name: string
  amount: number
  day_of_month: number | null
  is_active: boolean
  created_at: string
}

export type Expense = {
  id: string
  user_id: string
  group_id: string | null
  category: string | null
  amount: number
  spent_at: string
  note: string | null
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
      obligation_templates: Table<ObligationTemplate>
      events: Table<AppEvent>
      bill_payments: Table<BillPayment>
    }
    Views: {
      obligation_balances: View<ObligationBalance>
      partner_settlements: View<PartnerSettlement>
      bill_averages: View<BillAverage>
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
