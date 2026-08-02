/**
 * أنواع قاعدة البيانات.
 *
 * مكتوبة يدوياً لتطابق ملفات supabase/migrations. حين يصير المشروع متاحاً
 * يمكن توليدها آلياً بـ `supabase gen types typescript` واستبدال هذا الملف.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type IncomeFrequency = 'weekly' | 'biweekly' | 'monthly'

export interface Profile {
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

export interface ObligationGroup {
  id: string
  user_id: string
  name: string
  icon: string | null
  color: string | null
  created_at: string
}

export interface Obligation {
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

export interface ObligationPartner {
  id: string
  user_id: string
  name: string
  color: string | null
  created_at: string
}

export interface ObligationPartnerShare {
  id: string
  user_id: string
  obligation_id: string
  partner_id: string
  share_percent: number
}

export interface FundDeposit {
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

export interface ObligationPayment {
  id: string
  user_id: string
  obligation_id: string
  amount_paid: number
  paid_date: string
  next_due_date_after: string
  created_at: string
}

export interface IncomeSource {
  id: string
  user_id: string
  name: string
  amount: number
  frequency: IncomeFrequency
  is_active: boolean
  created_at: string
}

export interface FixedCommitment {
  id: string
  user_id: string
  name: string
  amount: number
  day_of_month: number | null
  is_active: boolean
  created_at: string
}

export interface Expense {
  id: string
  user_id: string
  group_id: string | null
  category: string | null
  amount: number
  spent_at: string
  note: string | null
  created_at: string
}

export interface ObligationTemplate {
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

export interface AppEvent {
  id: string
  user_id: string
  event_name: string
  payload: Record<string, unknown>
  created_at: string
}

/** مشهد محسوب — لا يُكتب فيه. */
export interface ObligationBalance {
  obligation_id: string
  user_id: string
  fund_balance: number
  my_fund_balance: number
  my_total: number
  last_deposit_date: string | null
  deposit_count: number
}

/** مشهد محسوب — لا يُكتب فيه. */
export interface PartnerSettlement {
  obligation_id: string
  user_id: string
  partner_id: string
  partner_name: string
  share_percent: number
  owed: number
  deposited: number
  outstanding: number
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
}

type View<Row> = { Row: Row }

export interface Database {
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
    }
    Views: {
      obligation_balances: View<ObligationBalance>
      partner_settlements: View<PartnerSettlement>
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
