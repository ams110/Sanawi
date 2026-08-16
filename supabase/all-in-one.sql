-- ============================================================
-- سنوي — سكيما قاعدة البيانات كاملة
-- الصق هذا الملف كله في Supabase → SQL Editor واضغط Run.
--
-- آمن للتكرار فعلاً لا وعداً: كل جدول `if not exists`، وكل عمود
-- `add column if not exists`، وكل سياسة يسبقها `drop policy if exists`.
-- الأخيرة كانت ناقصة: تسعٌ وعشرون سياسة بلا حارس تعني أن تشغيل الملف
-- مرّةً ثانية يُجهض عند أول `create policy` — والترويسة تقول «آمن للتكرار».
--
-- لا يُنفَّذ عند اللصق أي DELETE ولا TRUNCATE ولا DROP TABLE، ولا يُمَسّ
-- أي صف بيانات. (ما بداخل أجسام الدوال يُنفَّذ حين يستدعيها صاحبها بقراره
-- — كفكّ ربط Financy الذي يمسح مفاتيح صاحبه بطلبه — لا عند اللصق.)
-- وحذفُ السياسة ثم إعادة إنشائها فوراً لا يفتح ثغرة: RLS تبقى مفعّلة،
-- وجدولٌ بلا سياسة يُغلق لا ينفتح.
--
-- مولَّد: node scripts/build-schema.mjs — لا تعدّله يدوياً، عدّل الهجرة.
-- ============================================================

-- ─────────────────────────────────────────────
-- 0001_profiles_and_groups.sql
-- ─────────────────────────────────────────────
-- الملفات الشخصية والمجموعات.
--
-- العملة واللغة والدولة أعمدة هنا لا ثوابت في الكود: التطبيق شخصي اليوم
-- وقد يصير منتجاً، ولا نريد إعادة بناء حين يستعمله شخص خارج إسرائيل.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  currency text not null default 'ILS',
  locale text not null default 'ar',
  country text not null default 'IL',
  theme_preference text not null default 'system'
    check (theme_preference in ('system', 'light', 'dark')),
  onboarding_completed boolean not null default false,
  monthly_savings_target numeric(12, 2) not null default 0
    check (monthly_savings_target >= 0),
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'ملف المستخدم — صف واحد لكل حساب';

-- ينشأ الملف تلقائياً عند التسجيل، فلا يصل المستخدم إلى التطبيق بلا ملف.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.obligation_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text,
  color text,
  created_at timestamptz not null default now()
);

comment on table public.obligation_groups is 'مجموعات مثل: السيارة، العيلة، شخصي، مناسبات';

create index if not exists obligation_groups_user_idx
  on public.obligation_groups (user_id);

-- RLS على كل جدول من اليوم الأول، حتى والمستخدم واحد.
alter table public.profiles enable row level security;
alter table public.obligation_groups enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check ((select auth.uid()) = id);

drop policy if exists "groups_all_own" on public.obligation_groups;
create policy "groups_all_own" on public.obligation_groups
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────
-- 0002_obligations.sql
-- ─────────────────────────────────────────────
-- الالتزامات وصناديقها والشركاء فيها.

create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid references public.obligation_groups (id) on delete set null,
  name text not null,
  category text,
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  next_due_date date not null,
  -- 12 سنوي | 6 نصف سنوي | 3 ربع سنوي | 0 = مرة واحدة فقط
  recurrence_months int not null default 12 check (recurrence_months >= 0),
  cycle_start_date date not null default current_date,
  -- القسط المرجعي المثبّت عند بدء الدورة. نقيس التأخير عليه لا على القسط
  -- المُعاد حسابه، لأن الأخير يبلع التأخير من تلقائه فيخفيه عن المستخدم.
  baseline_installment numeric(12, 2) not null default 0,
  -- حصتي أنا. الباقي موزّع على الشركاء في obligation_partner_shares،
  -- ومجموع الكل يجب أن يساوي 100 — يتحقق التطبيق من ذلك عند الحفظ.
  my_share_percent numeric(5, 2) not null default 100
    check (my_share_percent > 0 and my_share_percent <= 100),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.obligations is 'الالتزامات الدورية — قلب التطبيق';

create index if not exists obligations_user_active_idx
  on public.obligations (user_id, is_active, next_due_date);
create index if not exists obligations_group_idx
  on public.obligations (group_id);

-- شريك: مجرد اسم يملكه المستخدم، لا حساب مستقل في التطبيق.
-- هذا يكفي لتتبّع من دفع ماذا دون بناء نظام مستخدمين متعدد.
create table if not exists public.obligation_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now()
);

create index if not exists obligation_partners_user_idx
  on public.obligation_partners (user_id);

create table if not exists public.obligation_partner_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  obligation_id uuid not null references public.obligations (id) on delete cascade,
  partner_id uuid not null references public.obligation_partners (id) on delete cascade,
  share_percent numeric(5, 2) not null
    check (share_percent > 0 and share_percent <= 100),
  unique (obligation_id, partner_id)
);

create index if not exists partner_shares_obligation_idx
  on public.obligation_partner_shares (obligation_id);

-- إيداع في الصندوق. partner_id فارغ يعني أنني أنا من أودع.
create table if not exists public.fund_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  obligation_id uuid not null references public.obligations (id) on delete cascade,
  partner_id uuid references public.obligation_partners (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  deposit_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists fund_deposits_obligation_idx
  on public.fund_deposits (obligation_id, deposit_date desc);

create table if not exists public.obligation_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  obligation_id uuid not null references public.obligations (id) on delete cascade,
  amount_paid numeric(12, 2) not null check (amount_paid >= 0),
  paid_date date not null default current_date,
  next_due_date_after date not null,
  created_at timestamptz not null default now()
);

create index if not exists obligation_payments_obligation_idx
  on public.obligation_payments (obligation_id, paid_date desc);

alter table public.obligations enable row level security;
alter table public.obligation_partners enable row level security;
alter table public.obligation_partner_shares enable row level security;
alter table public.fund_deposits enable row level security;
alter table public.obligation_payments enable row level security;

drop policy if exists "obligations_all_own" on public.obligations;
create policy "obligations_all_own" on public.obligations
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "partners_all_own" on public.obligation_partners;
create policy "partners_all_own" on public.obligation_partners
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "partner_shares_all_own" on public.obligation_partner_shares;
create policy "partner_shares_all_own" on public.obligation_partner_shares
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "fund_deposits_all_own" on public.fund_deposits;
create policy "fund_deposits_all_own" on public.fund_deposits
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "obligation_payments_all_own" on public.obligation_payments;
create policy "obligation_payments_all_own" on public.obligation_payments
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────
-- 0003_income_and_expenses.sql
-- ─────────────────────────────────────────────
-- الدخل والالتزامات الثابتة والمصاريف.

create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'biweekly', 'monthly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column public.income_sources.frequency is
  'التحويل إلى شهري: أسبوعي × 4.333 ونصف شهري × 2.167 — لا × 4، وإلا ضاع راتب أسبوعين في السنة';

create index if not exists income_sources_user_idx
  on public.income_sources (user_id, is_active);

create table if not exists public.fixed_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  day_of_month int check (day_of_month between 1 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.fixed_commitments is 'الالتزامات الشهرية الثابتة: مساعدة الأهل، بنزين، تلفون';

create index if not exists fixed_commitments_user_idx
  on public.fixed_commitments (user_id, is_active);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid references public.obligation_groups (id) on delete set null,
  category text,
  amount numeric(12, 2) not null check (amount >= 0),
  spent_at date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.expenses is 'مصاريف متفرقة تُربط بمجموعة لحساب التكلفة الحقيقية لها';

create index if not exists expenses_user_date_idx
  on public.expenses (user_id, spent_at desc);
create index if not exists expenses_group_idx
  on public.expenses (group_id, spent_at desc);

alter table public.income_sources enable row level security;
alter table public.fixed_commitments enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "income_sources_all_own" on public.income_sources;
create policy "income_sources_all_own" on public.income_sources
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "fixed_commitments_all_own" on public.fixed_commitments;
create policy "fixed_commitments_all_own" on public.fixed_commitments
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "expenses_all_own" on public.expenses;
create policy "expenses_all_own" on public.expenses
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────
-- 0004_templates.sql
-- ─────────────────────────────────────────────
-- قوالب الالتزامات — جدول عام بلا user_id، قراءة فقط.
--
-- مستخدم جديد لا يكتب "تأمين السيارة" من الصفر: يختار من قائمة فتصله
-- لحظة "آها" في أقل من دقيقتين. العمود country يجعل التوسّع لدول أخرى
-- إضافةَ صفوف لا تعديلَ سكيما.

create table if not exists public.obligation_templates (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_he text,
  name_en text,
  category text not null,
  icon text,
  default_recurrence_months int not null default 12,
  suggested_min numeric(12, 2),
  suggested_max numeric(12, 2),
  country text not null default 'IL',
  sort_order int not null default 100
);

create index if not exists obligation_templates_country_idx
  on public.obligation_templates (country, sort_order);

alter table public.obligation_templates enable row level security;

-- قراءة فقط ولكل المستخدمين المسجّلين. لا سياسة كتابة: الصفوف تُدار بالهجرات.
drop policy if exists "templates_read_all" on public.obligation_templates;
create policy "templates_read_all" on public.obligation_templates
  for select to authenticated using (true);

insert into public.obligation_templates
  (name_ar, name_he, name_en, category, icon, default_recurrence_months, suggested_min, suggested_max, country, sort_order)
values
  ('تأمين السيارة',      'ביטוח רכב',       'Car insurance',     'car',       '🚗', 12, 2500, 9000,  'IL', 10),
  ('טסט (فحص سنوي)',    'טסט שנתי',        'Annual test',       'car',       '🔧', 12,  400,  900,  'IL', 20),
  ('טיפול (صيانة)',      'טיפול תקופתי',    'Service',           'car',       '🛠️',  6,  600, 2500,  'IL', 30),
  ('إطارات',             'צמיגים',          'Tires',             'car',       '⚙️', 24, 1200, 3500,  'IL', 40),
  -- «رسوم» لا «رسائل»: אגרת = رسم، والخطأ أسقط التزاماً سنوياً كاملاً من
  -- ميزانية أول مستخدم لأنه لم يفهم البند فتجاوزه. صُحّح في 0015 للقواعد
  -- القائمة، وهنا للقواعد الجديدة.
  ('رسوم الترخيص',       'אגרת רישוי',      'Vehicle licence',   'car',       '📄', 12,  500, 1500,  'IL', 50),
  ('تأمين صحي مكمّل',     'ביטוח משלים',     'Health insurance',  'health',    '🏥', 12,  600, 2400,  'IL', 60),
  ('طبيب أسنان',         'טיפול שיניים',    'Dentist',           'health',    '🦷', 12,  500, 3000,  'IL', 70),
  ('نظارات',             'משקפיים',         'Glasses',           'health',    '👓', 24,  400, 2000,  'IL', 80),
  ('أعراس ومناسبات',     'חתונות ואירועים', 'Weddings & events', 'events',    '💍', 12, 1500, 8000,  'IL', 90),
  ('أعياد وهدايا',       'חגים ומתנות',     'Holidays & gifts',  'events',    '🎁', 12,  800, 4000,  'IL', 100),
  ('سفر وإجازة',         'טיול וחופשה',     'Travel',            'lifestyle', '✈️', 12, 2000, 12000, 'IL', 110),
  ('أرنونا (ضريبة البلدية)','ארנונה',        'Municipal tax',     'home',      '🏠',  6,  800, 4000,  'IL', 120),
  ('صيانة البيت',        'תחזוקת בית',      'Home maintenance',  'home',      '🔨', 12,  500, 5000,  'IL', 130),
  ('اشتراكات سنوية',     'מנויים שנתיים',   'Annual subscriptions', 'other',  '💳', 12,  200, 2000,  'IL', 140),
  ('طوارئ وأعطال',       'תקלות ובלת"מ',    'Emergencies',       'other',     '🚨', 12, 1000, 6000,  'IL', 150)
on conflict do nothing;

-- ─────────────────────────────────────────────
-- 0005_events.sql
-- ─────────────────────────────────────────────
-- تتبّع أحداث بسيط.
--
-- بدون هذه الأرقام يستحيل تطوير التطبيق كمنتج: هل وصل المستخدم إلى التقويم؟
-- كم التزاماً أضاف؟ هل عاد بعد أسبوع؟ لا نخزّن أي مبالغ هنا — أسماء أحداث فقط.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_user_created_idx
  on public.events (user_id, created_at desc);
create index if not exists events_name_idx
  on public.events (event_name, created_at desc);

alter table public.events enable row level security;

-- الكتابة والقراءة للمستخدم نفسه فقط. لا حذف ولا تعديل: سجلّ لا يُنقّح.
drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own" on public.events
  for insert with check ((select auth.uid()) = user_id);
drop policy if exists "events_select_own" on public.events;
create policy "events_select_own" on public.events
  for select using ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────
-- 0006_balances_view.sql
-- ─────────────────────────────────────────────
-- أرصدة الصناديق محسوبة من الإيداعات لا مخزّنة في عمود.
--
-- العمود المخزّن يجرف: أي إيداع يُحذف أو يُعدّل أو يُضاف من جهاز ثانٍ يترك
-- الرصيد كاذباً، وتطبيق يكذب في رصيده لا قيمة له. الحساب من المصدر أبطأ
-- نظرياً وصحيح دائماً، والأرقام هنا عشرات الصفوف لا ملايين.

create or replace view public.obligation_balances
with (security_invoker = on) as
select
  o.id as obligation_id,
  o.user_id,
  -- مجموع ما في الصندوق من الجميع — للعرض والتسوية مع الشركاء.
  coalesce(sum(d.amount), 0)::numeric(12, 2) as fund_balance,
  -- ما أودعتُه أنا وحدي — عليه يُحسب قسطي أنا.
  coalesce(sum(d.amount) filter (where d.partner_id is null), 0)::numeric(12, 2)
    as my_fund_balance,
  -- حصتي من المبلغ الكامل.
  round(o.total_amount * o.my_share_percent / 100, 2) as my_total,
  max(d.deposit_date) as last_deposit_date,
  count(d.id) as deposit_count
from public.obligations o
left join public.fund_deposits d on d.obligation_id = o.id
group by o.id, o.user_id, o.total_amount, o.my_share_percent;

comment on view public.obligation_balances is
  'أرصدة محسوبة من fund_deposits — لا عمود fund_balance مخزّن، فلا جرف';

-- تسوية الشركاء: كم يفترض أن يدفع كل شريك وكم دفع فعلاً.
create or replace view public.partner_settlements
with (security_invoker = on) as
select
  s.obligation_id,
  s.user_id,
  s.partner_id,
  p.name as partner_name,
  s.share_percent,
  round(o.total_amount * s.share_percent / 100, 2) as owed,
  coalesce(sum(d.amount), 0)::numeric(12, 2) as deposited,
  round(o.total_amount * s.share_percent / 100, 2) - coalesce(sum(d.amount), 0)
    as outstanding
from public.obligation_partner_shares s
join public.obligations o on o.id = s.obligation_id
join public.obligation_partners p on p.id = s.partner_id
left join public.fund_deposits d
  on d.obligation_id = s.obligation_id and d.partner_id = s.partner_id
group by s.obligation_id, s.user_id, s.partner_id, p.name, s.share_percent, o.total_amount;

comment on view public.partner_settlements is
  'من دفع كم ومن باقي عليه — لكل شريك في كل التزام';

-- ─────────────────────────────────────────────
-- 0007_allow_fund_withdrawals.sql
-- ─────────────────────────────────────────────
-- السماح بالسحب من الصندوق عند الدفع.
--
-- عند دفع الالتزام يُفرَّغ الصندوق. الطريقة المختارة قيدٌ سالب في fund_deposits
-- لا حذفُ الإيداعات: الحذف يمحو تاريخ من دفع ماذا، وهو بالضبط ما بُني تتبّع
-- الشركاء لأجله. القيد القديم (amount > 0) كان يرفض ذلك.
--
-- هذا يغيّر قيداً ولا يمسّ صفاً واحداً من البيانات: لا حذف ولا تعديل قيم.

alter table public.fund_deposits
  drop constraint if exists fund_deposits_amount_check;

alter table public.fund_deposits
  add constraint fund_deposits_amount_check check (amount <> 0);

comment on column public.fund_deposits.amount is
  'موجب = إيداع، سالب = سحب عند دفع الالتزام. الصفر مرفوض لأنه لا يعني شيئاً.';

-- ─────────────────────────────────────────────
-- 0008_bill_payments.sql
-- ─────────────────────────────────────────────
-- تتبّع الفواتير الشهرية.
--
-- fixed_commitments كان رقماً للميزانية فقط: كم أتوقّع أن أدفع للكهرباء شهرياً.
-- لكن الفاتورة الحقيقية تتغيّر كل شهر، والسؤال العملي "هل دفعتُها؟ وبكم؟"
-- لم يكن له جواب. هذا الجدول يحفظ الواقع بجانب التوقّع.

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  commitment_id uuid not null references public.fixed_commitments (id) on delete cascade,
  -- أول يوم في الشهر يمثّل الشهر كله: تاريخ كامل يقبل المقارنة والترتيب
  -- بلا حيل نصّية، وسطر واحد لكل شهر يمنع التكرار من الأساس.
  billing_month date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_at date,
  note text,
  created_at timestamptz not null default now(),
  unique (commitment_id, billing_month)
);

comment on table public.bill_payments is
  'فاتورة شهر واحد لبند ثابت: المبلغ الفعلي، وهل دُفع';
comment on column public.bill_payments.billing_month is
  'أول يوم في الشهر — مفتاح الشهر لا تاريخ الفاتورة';
comment on column public.bill_payments.paid_at is
  'فارغ = مسجّلة ولم تُدفع بعد';

create index if not exists bill_payments_user_month_idx
  on public.bill_payments (user_id, billing_month desc);
create index if not exists bill_payments_commitment_idx
  on public.bill_payments (commitment_id, billing_month desc);

alter table public.bill_payments enable row level security;

drop policy if exists "bill_payments_all_own" on public.bill_payments;
create policy "bill_payments_all_own" on public.bill_payments
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- متوسط ما دُفع فعلاً لكل بند خلال آخر 12 شهراً.
-- يكشف الفجوة بين المبلغ المقدَّر في الميزانية والواقع، وهي الفجوة التي
-- تجعل المستخدم يظن نفسه مرتاحاً وهو ليس كذلك.
create or replace view public.bill_averages
with (security_invoker = on) as
select
  c.id as commitment_id,
  c.user_id,
  c.name,
  c.amount as budgeted_amount,
  count(b.id) filter (where b.paid_at is not null) as paid_count,
  coalesce(round(avg(b.amount) filter (where b.billing_month >= (current_date - interval '12 months')), 2), 0)
    as average_amount
from public.fixed_commitments c
left join public.bill_payments b on b.commitment_id = c.id
where c.is_active
group by c.id, c.user_id, c.name, c.amount;

comment on view public.bill_averages is
  'المبلغ المقدَّر مقابل المتوسط الفعلي لآخر 12 شهراً';

-- ─────────────────────────────────────────────
-- 0009_expense_categories.sql
-- ─────────────────────────────────────────────
-- المصاريف اليومية: تصنيفات بأيقونات، وتمييز المصروف المفاجئ.
--
-- جدول expenses كان موجوداً بلا واجهة ولا تصنيف مفهرس: عمود category نصّي
-- حرّ. النص الحرّ يصنع تصنيفاتٍ متكرّرة بفروق مسافةٍ أو إملاء، ولا يحمل
-- أيقونة. هذه الهجرة تعطي التصنيف هويةً وأيقونةً وترتيباً.

-- user_id فارغ = تصنيف افتراضي يراه الجميع. غير الفارغ = تصنيف أضافه صاحبه.
-- عمودٌ واحد يخدم الحالتين بدل جدولين متطابقين.
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name_ar text not null,
  icon text not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

comment on table public.expense_categories is
  'تصنيفات المصاريف — الصفوف بلا user_id افتراضية للجميع';

create index if not exists expense_categories_user_idx
  on public.expense_categories (user_id, sort_order);

alter table public.expense_categories enable row level security;

-- القراءة تشمل الافتراضي والخاص. الكتابة على الخاص وحده: الافتراضي
-- تُديره الهجرات، فلا يستطيع مستخدم حذف تصنيف يراه غيره.
drop policy if exists "expense_categories_read" on public.expense_categories;
create policy "expense_categories_read" on public.expense_categories
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "expense_categories_write_own" on public.expense_categories;
create policy "expense_categories_write_own" on public.expense_categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "expense_categories_update_own" on public.expense_categories;
create policy "expense_categories_update_own" on public.expense_categories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "expense_categories_delete_own" on public.expense_categories;
create policy "expense_categories_delete_own" on public.expense_categories
  for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into public.expense_categories (user_id, name_ar, icon, sort_order)
values
  (null, 'أكل ومشروبات', '🍽️', 10),
  (null, 'تسوّق البيت',  '🛒', 20),
  (null, 'بنزين ومواصلات', '⛽', 30),
  (null, 'قهوة وسناكات', '☕', 40),
  (null, 'مطاعم وخروجات', '🍔', 50),
  (null, 'صحة ودواء',    '💊', 60),
  (null, 'ملابس',        '👕', 70),
  (null, 'هدايا',        '🎁', 80),
  (null, 'ترفيه واشتراكات', '🎮', 90),
  (null, 'تصليحات',      '🔧', 100),
  (null, 'شخصي',         '💇', 110),
  (null, 'غير ذلك',      '📦', 120)
on conflict do nothing;

-- الربط بالتصنيف الجديد. عمود category النصّي القديم يبقى كما هو: لا بيانات
-- فيه (الجدول لم تُستعمل له واجهة قط) وحذفه هجرةٌ هادمة لا داعي لها.
alter table public.expenses
  add column if not exists category_id uuid
    references public.expense_categories (id) on delete set null;

-- المصروف المفاجئ سؤالٌ مستقلّ عن التصنيف: تصليح مفاجئ تصنيفه "تصليحات"
-- وصفتُه أنه لم يكن في الحسبان. عمودٌ منفصل يجيب "كم يكلّفني غير المتوقَّع
-- شهرياً" دون إفساد التصنيف.
alter table public.expenses
  add column if not exists is_unexpected boolean not null default false;

create index if not exists expenses_user_category_idx
  on public.expenses (user_id, category_id, spent_at desc);

comment on column public.expenses.category_id is 'التصنيف المفهرس — يحلّ محلّ category النصّي';
comment on column public.expenses.is_unexpected is 'مصروف لم يكن في الحسبان';

-- ─────────────────────────────────────────────
-- 0010_commitments_upgrade.sql
-- ─────────────────────────────────────────────
-- الفواتير الشهرية: أيقونة، ونهاية للأقساط، وحصص شركاء.
--
-- ثلاث حاجاتٍ يجمعها أن fixed_commitments كان اسماً ومبلغاً فحسب:
--   1) الفاتورة بلا أيقونة تُقرأ بالنص وحده، وشاشةٌ من عشرة أسطر نصّية
--      تُمسح بالعين ولا تُقرأ.
--   2) قرض السيارة فاتورةٌ شهرية بكل شيء إلا أنه ينتهي. جدولٌ مستقلّ له
--      يكرّر تتبّع الدفع والشركاء واللوحة؛ عمودُ نهايةٍ يكفي.
--   3) فاتورة البيت تُقسَم مع شريك تماماً كما يُقسَم التأمين، والقسمة
--      موجودة للالتزامات وحدها.

alter table public.fixed_commitments
  add column if not exists icon text;

-- تاريخ آخر دفعة. فارغ = متكرّر بلا نهاية (كهرباء، إنترنت).
-- غير فارغ = قسط أو دين ينتهي، فيُعرض معه "بقي كذا دفعة".
alter table public.fixed_commitments
  add column if not exists ends_on date;

-- المبلغ الكلّي للقرض — للعرض والسياق لا للحساب: القسط الشهري هو amount،
-- وعدد الدفعات يُشتقّ من ends_on. تخزينُ الثلاثة يفتح باب تناقضها.
alter table public.fixed_commitments
  add column if not exists total_amount numeric(12, 2)
    check (total_amount is null or total_amount >= 0);

-- حصّتي من الفاتورة. الباقي على الشركاء في commitment_partner_shares،
-- مطابقةً لما في obligations حرفاً بحرف حتى يبقى المفهوم واحداً.
alter table public.fixed_commitments
  add column if not exists my_share_percent numeric(5, 2) not null default 100
    check (my_share_percent > 0 and my_share_percent <= 100);

comment on column public.fixed_commitments.ends_on is
  'آخر دفعة — فارغ يعني متكرّر بلا نهاية';
comment on column public.fixed_commitments.total_amount is
  'أصل الدين للعرض؛ الحساب يقوم على amount و ends_on';

-- الشريك نفسه المستعمل في الالتزامات: obligation_partners. لا جدول شركاء
-- ثانٍ — الشريك شخصٌ واحد سواء قاسمك التأمين أو فاتورة الكهرباء.
create table if not exists public.commitment_partner_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  commitment_id uuid not null references public.fixed_commitments (id) on delete cascade,
  partner_id uuid not null references public.obligation_partners (id) on delete cascade,
  share_percent numeric(5, 2) not null
    check (share_percent > 0 and share_percent <= 100),
  unique (commitment_id, partner_id)
);

comment on table public.commitment_partner_shares is
  'حصص الشركاء في فاتورة شهرية — نظيرة obligation_partner_shares';

create index if not exists commitment_shares_commitment_idx
  on public.commitment_partner_shares (commitment_id);

alter table public.commitment_partner_shares enable row level security;

drop policy if exists "commitment_partner_shares_all_own" on public.commitment_partner_shares;
create policy "commitment_partner_shares_all_own" on public.commitment_partner_shares
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- قوالب البنود الشهرية. جدولٌ مستقلّ عن obligation_templates لا عمودُ نوعٍ
-- فيه: الأعمدة تختلف فعلاً — القالب السنوي يحمل دورةً ومبلغاً مقترحاً
-- للسنة، والشهريّ يحمل مبلغاً مقترحاً للشهر وصفةَ "هل ينتهي".
create table if not exists public.commitment_templates (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_he text,
  name_en text,
  category text not null,
  icon text not null,
  suggested_min numeric(12, 2),
  suggested_max numeric(12, 2),
  -- قالبُ قرضٍ يفتح حقل تاريخ النهاية عند الاختيار.
  is_installment boolean not null default false,
  country text not null default 'IL',
  sort_order int not null default 100
);

create index if not exists commitment_templates_country_idx
  on public.commitment_templates (country, sort_order);

alter table public.commitment_templates enable row level security;

drop policy if exists "commitment_templates_read_all" on public.commitment_templates;
create policy "commitment_templates_read_all" on public.commitment_templates
  for select to authenticated using (true);

insert into public.commitment_templates
  (name_ar, name_he, name_en, category, icon, suggested_min, suggested_max, is_installment, country, sort_order)
values
  ('كهرباء',          'חשמל',          'Electricity',   'home',    '💡',  150, 900, false, 'IL', 10),
  ('مي',              'מים',           'Water',         'home',    '💧',   80, 400, false, 'IL', 20),
  ('غاز',             'גז',            'Gas',           'home',    '🔥',   50, 300, false, 'IL', 30),
  ('إنترنت',          'אינטרנט',       'Internet',      'home',    '🌐',   80, 250, false, 'IL', 40),
  ('تلفون',           'סלולר',         'Mobile',        'home',    '📱',   30, 200, false, 'IL', 50),
  ('أرنونا',          'ארנונה',        'Municipal tax', 'home',    '🏛️',  200, 900, false, 'IL', 60),
  ('إيجار',           'שכר דירה',      'Rent',          'home',    '🏠', 2000, 8000, false, 'IL', 70),
  ('واد بيت',         'ועד בית',       'Building fee',  'home',    '🏢',   50, 400, false, 'IL', 80),
  ('اشتراكات رقمية',  'מנויים דיגיטליים', 'Subscriptions', 'other', '📺',  20, 200, false, 'IL', 90),
  ('نادي رياضي',      'חדר כושר',      'Gym',           'other',   '🏋️',  100, 400, false, 'IL', 100),
  ('مساعدة الأهل',    'עזרה למשפחה',   'Family support','other',   '👨‍👩‍👦', 200, 3000, false, 'IL', 110),
  ('قرض سيارة',       'הלוואת רכב',    'Car loan',      'debt',    '🚗',  500, 4000, true,  'IL', 120),
  ('قرض شخصي',        'הלוואה אישית',  'Personal loan', 'debt',    '🏦',  300, 5000, true,  'IL', 130),
  ('تقسيط جهاز',      'תשלומים למכשיר','Device instalment','debt', '📦',  100, 1500, true,  'IL', 140),
  ('دين لحدا',        'חוב לחבר',      'Debt to a friend','debt',  '🤝',  100, 3000, true,  'IL', 150)
on conflict do nothing;

-- حصّتي بالشيكل من كل بند نشط، وكم دفعة بقيت إن كان له نهاية.
-- الحساب في العرض لا في الواجهة: سطرٌ واحد يخدم كل شاشة تسأل السؤال نفسه.
create or replace view public.commitment_details
with (security_invoker = on) as
select
  c.id as commitment_id,
  c.user_id,
  c.name,
  c.icon,
  c.amount,
  c.ends_on,
  c.total_amount,
  c.my_share_percent,
  round(c.amount * c.my_share_percent / 100, 2) as my_amount,
  case
    when c.ends_on is null then null
    -- الدفعات المتبقية تشمل شهر الاستحقاق نفسه: قسطٌ ينتهي هذا الشهر
    -- بقيت له دفعةٌ واحدة لا صفر.
    else greatest(
      0,
      (date_part('year', c.ends_on) - date_part('year', current_date)) * 12
        + (date_part('month', c.ends_on) - date_part('month', current_date)) + 1
    )::int
  end as payments_left
from public.fixed_commitments c
where c.is_active;

comment on view public.commitment_details is
  'حصّتي بالشيكل وعدد الدفعات المتبقية لكل بند شهري نشط';

-- ─────────────────────────────────────────────
-- 0011_goal_templates.sql
-- ─────────────────────────────────────────────
-- أهداف الشراء: قوالب لما يُشترى مرةً واحدة.
--
-- الهدف ليس نوعاً جديداً في السكيما: obligations تدعم recurrence_months = 0
-- منذ البداية بمعنى "مرة واحدة، لا يتجدّد". الناقص كان قوالبَ تقول للمستخدم
-- إن هذا ممكن — فلا أحد يخمّن أن حقلاً اسمه "التزام" يصلح لبلايستيشن.
--
-- الفرق كلّه في اللغة لا في الحساب: القسط نفسه، والتقدّم نفسه، لكن "متأخر"
-- كلمةٌ ظالمة لمن يجمّع ثمن جهاز، و"لسا بدك تجمّع" هي الصادقة.

insert into public.obligation_templates
  (name_ar, name_he, name_en, category, icon, default_recurrence_months, suggested_min, suggested_max, country, sort_order)
values
  ('كمبيوتر / لابتوب', 'מחשב / לפטופ',  'Computer',       'goal', '💻', 0, 2000, 12000, 'IL', 200),
  ('بلايستيشن / جيمنغ','פלייסטיישן',     'Gaming console', 'goal', '🎮', 0, 1500,  4000, 'IL', 210),
  ('تلفون جديد',       'טלפון חדש',      'New phone',      'goal', '📱', 0, 1000,  6000, 'IL', 220),
  ('سيارة',            'רכב',            'Car',            'goal', '🚙', 0, 20000, 150000, 'IL', 230),
  ('أثاث',             'ריהוט',          'Furniture',      'goal', '🛋️', 0, 2000, 20000, 'IL', 240),
  ('دراجة / سكوتر',    'אופניים / קורקינט','Bike / scooter','goal', '🛵', 0, 1500, 10000, 'IL', 250),
  ('كورس أو دراسة',    'קורס או לימודים','Course / studies','goal', '🎓', 0, 1000, 30000, 'IL', 260),
  ('سفرة',             'טיול',           'A trip',         'goal', '🧳', 0, 3000, 25000, 'IL', 270),
  ('عرس',              'חתונה',          'Wedding',        'goal', '💒', 0, 20000, 200000, 'IL', 280),
  ('صندوق طوارئ',      'קרן חירום',      'Emergency fund', 'goal', '🛟', 0, 5000, 50000, 'IL', 290)
on conflict do nothing;

-- ─────────────────────────────────────────────
-- 0012_income_entries.sql
-- ─────────────────────────────────────────────
-- الدخل الفعلي: ما وصل فعلاً لا ما يُتوقَّع.
--
-- income_sources تقدير: "راتبي 5,000 كل شهر". وهو يكفي من يقبض ثابتاً
-- ولا يكفي من يشتغل حرّاً أو بساعات متغيّرة أو بإكراميات — فتصير كل حسبة
-- في التطبيق مبنيّة على رقمٍ لم يصل.
--
-- الجدول نظير bill_payments تماماً: التقدير في جدولٍ والواقع في آخر،
-- والفجوة بينهما هي ما يريد المستخدم رؤيته.

create table if not exists public.income_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- المصدر اختياري: دخلٌ مفاجئ (هدية، بيع غرض) لا مصدر ثابت له.
  source_id uuid references public.income_sources (id) on delete set null,
  name text,
  amount numeric(12, 2) not null check (amount > 0),
  received_at date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.income_entries is
  'دفعة دخل وصلت فعلاً — نظيرة bill_payments في جهة الدخل';
comment on column public.income_entries.source_id is
  'فارغ = دخل بلا مصدر ثابت';

create index if not exists income_entries_user_date_idx
  on public.income_entries (user_id, received_at desc);

alter table public.income_entries enable row level security;

drop policy if exists "income_entries_all_own" on public.income_entries;
create policy "income_entries_all_own" on public.income_entries
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────
-- 0013_payment_methods.sql
-- ─────────────────────────────────────────────
-- موعد الدفع وطريقته.
--
-- day_of_month موجود منذ 0003 وبلا واجهة قطّ. وطريقة الدفع ناقصة، وهي
-- ليست تفصيلاً: فاتورةٌ على هوراة كيفع لا تحتاج تذكيراً بدفعها بل تذكيراً
-- بمراجعتها، وفاتورةٌ بالكاش تحتاج أن يكون المبلغ في الجيب يوم استحقاقها.

-- جدولٌ لا عمودٌ نصّي: "فيزا" وحدها لا تكفي لمن يحمل بطاقتين، والاسم
-- الحقيقي للبطاقة هو ما يربط السطر بكشف الحساب.
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  -- فارغ = طريقة افتراضية يراها الجميع، كما في expense_categories.
  user_id uuid references auth.users (id) on delete cascade,
  name_ar text not null,
  icon text not null,
  -- الاقتطاع التلقائي لا يُدفع باليد، فلا يُذكَّر به كما يُذكَّر بغيره.
  is_automatic boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

comment on table public.payment_methods is
  'طرق الدفع — الصفوف بلا user_id افتراضية للجميع';
comment on column public.payment_methods.is_automatic is
  'اقتطاع تلقائي: يُراجَع ولا يُدفع باليد';

create index if not exists payment_methods_user_idx
  on public.payment_methods (user_id, sort_order);

alter table public.payment_methods enable row level security;

drop policy if exists "payment_methods_read" on public.payment_methods;
create policy "payment_methods_read" on public.payment_methods
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "payment_methods_insert_own" on public.payment_methods;
create policy "payment_methods_insert_own" on public.payment_methods
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "payment_methods_update_own" on public.payment_methods;
create policy "payment_methods_update_own" on public.payment_methods
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "payment_methods_delete_own" on public.payment_methods;
create policy "payment_methods_delete_own" on public.payment_methods
  for delete to authenticated using ((select auth.uid()) = user_id);

insert into public.payment_methods (user_id, name_ar, icon, is_automatic, sort_order)
values
  (null, 'كاش',              '💵', false, 10),
  (null, 'بطاقة ائتمان',      '💳', false, 20),
  (null, 'هوراة كيفع',        '🔁', true,  30),
  (null, 'هوراة بنكية',       '🏦', false, 40),
  (null, 'شيك',              '🧾', false, 50),
  (null, 'بيت / تطبيق',       '📲', false, 60)
on conflict do nothing;

-- الطريقة المعتادة للبند: تُقترح عند تسجيل كل فاتورة فلا تُختار كل شهر.
alter table public.fixed_commitments
  add column if not exists default_method_id uuid
    references public.payment_methods (id) on delete set null;

-- والطريقة الفعلية للفاتورة: قد تدفع الكهربا كاشاً هذا الشهر استثناءً.
alter table public.bill_payments
  add column if not exists method_id uuid
    references public.payment_methods (id) on delete set null;

-- وللمصاريف اليومية أيضاً: "كم صرفت بالبطاقة مقابل الكاش" سؤالٌ حقيقي.
alter table public.expenses
  add column if not exists method_id uuid
    references public.payment_methods (id) on delete set null;

create index if not exists bill_payments_method_idx on public.bill_payments (method_id);
create index if not exists expenses_method_idx on public.expenses (user_id, method_id);

-- ─────────────────────────────────────────────
-- 0014_wealth.sql
-- ─────────────────────────────────────────────
-- الثروة: الطرف الآخر من المعادلة.
--
-- كل ما بناه التطبيق حتى الآن يجيب على سؤالٍ واحد: «كم يخرج من جيبي». وهو
-- نصف السؤال. النصف الثاني — «كم تراكم لي» — لم يكن له جدولٌ ولا عمود، فلا
-- يستطيع التطبيق أن يقول لصاحبه أين هو من الحرية المالية، وهي في جوهرها
-- معادلةٌ من طرفين:
--
--     دخلٌ من الأصول ≥ مصاريف الحياة
--
-- هذه الهجرة تضيف الطرف الغائب: الأصول، ولقطاتها الشهرية لتتبّع النمو،
-- ونسبة الفائدة على الديون (بدونها لا يمكن ترتيب سدادها)، وثوابت التخطيط
-- الشخصية في الملف.
--
-- ما لا تضيفه عمداً: لا عرض `net_worth` محسوب في SQL. صافي الثروة قرارُ
-- تعريفٍ لا جمعُ أعمدة — أيّ شيء يُعدّ أصلاً، وأيّ التزامٍ يُعدّ ديناً —
-- ومكان قرارات التعريف في هذا المشروع هو المحرّك النقي المُختبَر
-- (src/lib/wealth/networth.ts) لا تعريفُ عرضٍ لا اختبار له.

/* ── الأصول ────────────────────────────────────────────────── */

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,

  -- النوع يحدّد معنى الرقم لا شكله: النقد يُصرف اليوم، والعقار لا يُصرف
  -- إلا ببيعه، والدَّين لك عند غيرك قد لا يعود. جمعها في رقمٍ واحد بلا
  -- تمييز يعطي «ثروةً» لا يستطيع صاحبها أن يأكل منها.
  kind text not null default 'cash'
    check (kind in ('cash', 'savings', 'investment', 'property', 'receivable', 'other')),

  amount numeric(14, 2) not null default 0 check (amount >= 0),

  -- العائد السنوي المتوقّع لهذا الأصل — يدخل في الإسقاط وحده.
  -- النقد صفر، ومحفظة المؤشرات ٧، والعقار ما يقدّره صاحبه.
  annual_return_percent numeric(5, 2) not null default 0
    check (annual_return_percent >= -100 and annual_return_percent <= 100),

  -- السيولة: هل أستطيع الوصول إليه هذا الأسبوع؟ صندوق الطوارئ يُقاس بها،
  -- ولا معنى لصندوق طوارئ في شقّة.
  is_liquid boolean not null default true,

  -- صندوق الطوارئ يُعلَّم ولا يُشتقّ: أصلان نقديّان بالمبلغ نفسه أحدهما
  -- محجوزٌ للطوارئ والآخر مرصودٌ لسفرةٍ في الصيف، والتطبيق لا يفرّق بينهما
  -- إلا إن قال صاحبهما.
  is_emergency_fund boolean not null default false,

  icon text,
  note text,
  is_active boolean not null default true,

  -- تاريخ آخر تحديثٍ للقيمة — عمودٌ ضروريّ لا زينة.
  -- صافي ثروةٍ مبنيّ على قيمةٍ أُدخلت قبل سنتين رقمٌ يكذب بثقة، والتطبيق
  -- يحتاج أن يقول «هذا الأصل لم يُحدَّث منذ ١٤ شهراً» بدل أن يجمعه صامتاً.
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.assets is
  'الأصول — الطرف الآخر من صافي الثروة، مقابل الالتزامات والديون';
comment on column public.assets.is_liquid is
  'هل يُصرف هذا الأسبوع؟ صندوق الطوارئ لا يكون إلا سائلاً';
comment on column public.assets.updated_at is
  'آخر تحديث للقيمة — قيمةٌ قديمة تجعل صافي الثروة يكذب بثقة';

create index if not exists assets_user_idx
  on public.assets (user_id, is_active);

-- التحديث التلقائي للعمود: تركُه للعميل يعني أن أي مسارٍ ينسى ضبطه
-- (استيراد، خادم MCP، سكربت) يترك تاريخاً كاذباً — والكذب هنا أسوأ من
-- الغياب لأنه يُقرأ حقيقةً.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
-- مسارُ البحث مثبَّت كما في handle_new_user بـ 0001: دالّةٌ بمسارٍ متغيّر
-- تُنفَّذ بما يجده المستدعي لا بما قصده كاتبها.
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assets_touch_updated_at on public.assets;
create trigger assets_touch_updated_at
  before update on public.assets
  for each row execute function public.touch_updated_at();

/* ── لقطات صافي الثروة ─────────────────────────────────────── */

-- الرقم الحالي وحده لا يجيب على السؤال الحقيقي: «هل أنا أتقدّم؟».
-- لقطةٌ شهرية تحوّل رقماً إلى خطّ، والخطّ هو ما يُبقي الناس على الطريق.
--
-- لماذا تُخزَّن ولا تُشتقّ: قيمة الأصل يُكتب فوقها عند التحديث، فتاريخُها
-- يضيع. لا يمكن استرجاع صافي ثروة شهرٍ مضى من جدولٍ يحمل الحاضر وحده.
create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- أول يوم في الشهر — مفتاح الشهر لا تاريخ اللقطة، تماماً كـ bill_payments.
  snapshot_month date not null,

  assets_total numeric(14, 2) not null default 0,
  -- صناديق الالتزامات: مالٌ حقيقيّ جمعه صاحبه ولم يُنفقه بعد.
  restricted_total numeric(14, 2) not null default 0,
  debts_total numeric(14, 2) not null default 0,
  net_worth numeric(14, 2) not null default 0,

  created_at timestamptz not null default now(),

  -- لقطةٌ واحدة لكل شهر: الثانية تحديثٌ للأولى لا صفٌّ جديد، وإلا صار
  -- الخطُّ البيانيّ يقفز داخل الشهر الواحد بلا معنى.
  unique (user_id, snapshot_month)
);

comment on table public.net_worth_snapshots is
  'لقطة شهرية لصافي الثروة — لأن الاتجاه يهمّ أكثر من الرقم';

create index if not exists net_worth_snapshots_user_month_idx
  on public.net_worth_snapshots (user_id, snapshot_month desc);

/* ── الفائدة على الديون ────────────────────────────────────── */

-- بدون هذا العمود يعرف التطبيق متى ينتهي الدَّين ولا يعرف كم يكلّف.
-- والفرق عمليّ لا نظريّ: من عنده دينان ودفعةٌ زائدة، ترتيبُ سدادهما
-- بالفائدة الأعلى أولاً يوفّر عليه مبلغاً حقيقياً — ولا يمكن ترتيبهما
-- بلا الرقم.
alter table public.fixed_commitments
  add column if not exists annual_interest_percent numeric(5, 2) not null default 0
    check (annual_interest_percent >= 0 and annual_interest_percent <= 100);

comment on column public.fixed_commitments.annual_interest_percent is
  'الفائدة السنوية — صفر للفاتورة، وغير صفر للقرض؛ عليها يُرتَّب السداد';

-- العرض يُعاد إنشاؤه ليحمل العمود الجديد.
--
-- والعمود الجديد في آخر القائمة لا في موضعه «المنطقي» بجانب my_share_percent:
-- ‏`create or replace view` في Postgres لا يعيد تعريف الأعمدة القائمة، إنما
-- يسمح بإلحاق أعمدةٍ بعدها فقط. إقحامُ عمودٍ في الوسط يجعل الأمر يحاول إعادة
-- تسمية `my_amount` إلى `annual_interest_percent` فيُجهض بـ
-- «cannot change name of view column» — والهجرة كلها معه، على كل قاعدةٍ
-- فيها العرض القديم.
create or replace view public.commitment_details
with (security_invoker = on) as
select
  c.id as commitment_id,
  c.user_id,
  c.name,
  c.icon,
  c.amount,
  c.ends_on,
  c.total_amount,
  c.my_share_percent,
  round(c.amount * c.my_share_percent / 100, 2) as my_amount,
  case
    when c.ends_on is null then null
    -- الدفعات المتبقية تشمل شهر الاستحقاق نفسه: قسطٌ ينتهي هذا الشهر
    -- بقيت له دفعةٌ واحدة لا صفر.
    else greatest(
      0,
      (date_part('year', c.ends_on) - date_part('year', current_date)) * 12
        + (date_part('month', c.ends_on) - date_part('month', current_date)) + 1
    )::int
  end as payments_left,
  c.annual_interest_percent
from public.fixed_commitments c
where c.is_active;

comment on view public.commitment_details is
  'حصّتي بالشيكل وعدد الدفعات المتبقية لكل بند شهري نشط';

/* ── ثوابت التخطيط ─────────────────────────────────────────── */

-- ثلاثة أرقام تحوّل «ادّخر» إلى «متى تصل»، وهي شخصيّةٌ بطبعها:
-- من يعيش على ٤٪ ليس كمن يحتاط بـ ٣٪، ومن يقرأ التضخّم عنده ٢ ليس كمن
-- يقرأه ٥. تثبيتها في الكود يجعل الرقم النهائي رأياً لا حساباً.
alter table public.profiles
  add column if not exists emergency_months int not null default 3
    check (emergency_months between 1 and 24);

alter table public.profiles
  add column if not exists withdrawal_rate_percent numeric(4, 2) not null default 4
    check (withdrawal_rate_percent > 0 and withdrawal_rate_percent <= 20);

alter table public.profiles
  add column if not exists inflation_percent numeric(4, 2) not null default 3
    check (inflation_percent >= 0 and inflation_percent <= 50);

comment on column public.profiles.emergency_months is
  'كم شهراً يجب أن يغطّيه صندوق الطوارئ من المصروف الأساسي';
comment on column public.profiles.withdrawal_rate_percent is
  'معدّل السحب الآمن — ٤٪ يعني أن رقم الحرية = المصروف السنوي × ٢٥';
comment on column public.profiles.inflation_percent is
  'التضخّم المفترض — بدونه يعِد الإسقاط بثروةٍ اسمية لا تشتري ما تعِد به';

/* ── RLS ───────────────────────────────────────────────────── */

alter table public.assets enable row level security;
alter table public.net_worth_snapshots enable row level security;

drop policy if exists "assets_all_own" on public.assets;
create policy "assets_all_own" on public.assets
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "net_worth_snapshots_all_own" on public.net_worth_snapshots;
create policy "net_worth_snapshots_all_own" on public.net_worth_snapshots
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────
-- 0015_start_dates_variable_income_and_hints.sql
-- ─────────────────────────────────────────────
-- تاريخ بدء للبنود الثابتة، دخلٌ متغيّر، وشرحٌ لكل قالب.
--
-- ثلاثُ حاجاتٍ كشفتها أول جلسة استخدام حقيقية:
--
--   1) رخصة سيارة بـ1,900 على ثلاث دفعات أولها 15/9، سُجّلت في 5/8 فقيل
--      «بقيت 4 دفعة — مجموعها 2,532». آب لا يحوي دفعة أصلاً. السبب أن
--      `ends_on` وحده يفترض أن الدفعة الأولى في الشهر الحالي، ولا حقل
--      لتاريخ أول دفعة. و«اشتريت اليوم والدفع يبدأ الشهر الجاي» ليس حالةً
--      نادرة — هو النمط الشائع في الأقساط.
--
--   2) `income_sources.amount` مطلوب، فالشغل الجانبي المتغيّر يُجبَر على رقمٍ
--      مخترَع يضخّم الدخل المتوقَّع. ومن دخلُه مصادرُ متعددة — ثابتٌ ومتغيّر —
--      يصير كل رقم في التطبيق مبنيّاً على تقديرٍ لم يصل.
--
--   3) «رسائل الترخيص» في القوالب — و«رسائل» = letters، والصحيح «رسوم» =
--      fees (אגרת רישוי). المستخدم يتجاوز أي بند لا يفهمه، فالتزامٌ سنوي
--      بـ500–1,500 كان يسقط بصمت من ميزانيته. والعلاج ليس تصحيح الكلمة
--      وحدها: القوالب بلا شرحٍ تترك المستخدم يخمّن ما هو البند ومتى يُدفع.

/* ── 1. تاريخ أول دفعة ─────────────────────────────────────── */

alter table public.fixed_commitments
  add column if not exists starts_on date;

comment on column public.fixed_commitments.starts_on is
  'أول دفعة — فارغ يعني أن الدفعات بدأت فعلاً (سلوك ما قبل هذا العمود)';

-- العرض يُعاد إنشاؤه: تعبير `payments_left` يتغيّر، والعمودان الجديدان
-- يُلحقان في الآخر.
--
-- الإلحاق في الآخر ليس ترتيباً جمالياً: `create or replace view` لا يعيد
-- تعريف الأعمدة القائمة ولا يقحم عموداً في الوسط — يحاول عندها إعادة تسمية
-- ما بعده فيُجهض بـ «cannot change name of view column». نفس القيد الذي
-- وُثّق في 0014 حين أُلحق annual_interest_percent. وتغييرُ *تعبير* عمودٍ
-- قائم مسموح ما دام اسمه ونوعه لم يتغيّرا — ولذلك يمرّ payments_left.
create or replace view public.commitment_details
with (security_invoker = on) as
select
  c.id as commitment_id,
  c.user_id,
  c.name,
  c.icon,
  c.amount,
  c.ends_on,
  c.total_amount,
  c.my_share_percent,
  round(c.amount * c.my_share_percent / 100, 2) as my_amount,
  case
    when c.ends_on is null then null
    -- الدفعات المتبقية تشمل شهر الاستحقاق نفسه: قسطٌ ينتهي هذا الشهر
    -- بقيت له دفعةٌ واحدة لا صفر.
    --
    -- والعدّ يبدأ من الأكبر بين شهر أول دفعة وهذا الشهر: قسطٌ يبدأ الشهر
    -- الجاي وينتهي بعد ثلاثة له ثلاث دفعات لا أربع.
    else greatest(
      0,
      (date_part('year', c.ends_on)
        - date_part('year', greatest(current_date, coalesce(c.starts_on, current_date)))) * 12
        + (date_part('month', c.ends_on)
          - date_part('month', greatest(current_date, coalesce(c.starts_on, current_date))))
        + 1
    )::int
  end as payments_left,
  c.annual_interest_percent,
  c.starts_on,
  -- البند الذي لم يبدأ يبقى في القائمة — المستخدم سجّله ويريد رؤيته — ولا
  -- يُحمَّل على شهرٍ لا دفعة فيه. الفلترة في محرّك الحساب لا في العرض.
  (c.starts_on is null
    or date_trunc('month', c.starts_on) <= date_trunc('month', current_date)) as has_started
from public.fixed_commitments c
where c.is_active;

comment on view public.commitment_details is
  'حصّتي بالشيكل وعدد الدفعات المتبقية لكل بند شهري نشط، وهل بدأت دفعاته';

/* ── 2. دخلٌ بلا تقدير ─────────────────────────────────────── */

-- الشغل الجانبي لا رقم ثابت له. والصادق ألّا يُخترع له رقم: يبقى المصدر
-- ظاهراً في القوائم، ويدخل في «ما وصل» عبر income_entries حين يصل فعلاً،
-- ولا يدخل في «المتوقَّع». وهو امتداد لنفس القسمة التي بُني عليها
-- income_entries في 0012: التقدير في جدول والواقع في آخر.
alter table public.income_sources
  add column if not exists is_variable boolean not null default false;

comment on column public.income_sources.is_variable is
  'دخلٌ لا تقدير ثابت له — يُحتسب حين يصل فعلاً ولا يدخل الدخل المتوقَّع';

/* ── 3. شرحٌ لكل قالب ──────────────────────────────────────── */

alter table public.obligation_templates
  add column if not exists hint text;
alter table public.commitment_templates
  add column if not exists hint text;

comment on column public.obligation_templates.hint is
  'جملة واحدة: ما هو البند ومتى يُدفع — بندٌ غامض التزامٌ لا يُسجَّل';
comment on column public.commitment_templates.hint is
  'جملة واحدة: ما هو البند ومتى يُدفع';

-- التصحيح: «رسائل» ← «رسوم». مطابقةٌ بالاسم القديم فيبقى قابلاً لإعادة
-- التشغيل بلا أثر، ولا يمسّ صفّاً صُحّح من قبل.
update public.obligation_templates
  set name_ar = 'رسوم الترخيص'
  where name_ar = 'رسائل الترخيص';

-- «ضريبة الأرنونا» ← «أرنونا (ضريبة البلدية)»: الاسم وحده كان يلتبس بالبند
-- الشهري المسمّى «أرنونا»، وهما وجهان لدفعةٍ واحدة — من يدفعها دفعةً كبيرة
-- يسجّلها هنا، ومن يدفعها بأمر دفع شهري يسجّلها هناك. والشرح يفصل بينهما.
update public.obligation_templates
  set name_ar = 'أرنونا (ضريبة البلدية)'
  where name_ar = 'ضريبة الأرنونا';

update public.obligation_templates as t set hint = v.hint
from (values
  ('تأمين السيارة',        'إجباري وطرف ثالث أو شامل — يُدفع عند تجديد البوليصة مرة بالسنة.'),
  ('טסט (فحص سنوي)',      'الفحص السنوي الإجباري للسيارة — بلا نجاحه لا تتجدّد الرخصة.'),
  ('טיפול (صيانة)',        'الصيانة الدورية عند الكراج: زيت وفلاتر — كل نصف سنة أو حسب الكيلومترات.'),
  ('إطارات',               'تبديل الإطارات — كل سنتين تقريباً أو حين يقلّ عمق النقشة عن الحدّ.'),
  ('رسوم الترخيص',         'אגרת רישוי — رسم سنوي لوزارة المواصلات لتجديد رخصة السيارة، يصلك إشعاره بالبريد.'),
  ('تأمين صحي مكمّل',       'שב"ן — المكمّل من صندوق المرضى (مكابي، كلاليت…) فوق سلّة الصحة الأساسية.'),
  ('طبيب أسنان',           'الأسنان خارج سلّة الصحة: تنظيف وحشوات وتقويم — كلها من الجيب.'),
  ('نظارات',               'نظارات أو عدسات ومعها فحص النظر — كل سنتين تقريباً.'),
  ('أعراس ومناسبات',       'نقوط الأعراس والهدايا — تتجمّع في الموسم ولا أحد يحسبها شهرياً.'),
  ('أعياد وهدايا',         'مصروف الأعياد: هدايا وضيافة وملابس العيد.'),
  ('سفر وإجازة',           'تذاكر وفنادق ومصروف السفرة — يُجمَّع على مدار السنة لأجل أسبوع.'),
  ('أرنونا (ضريبة البلدية)','ضريبة البلدية — تُدفع كل شهرين، أو دفعةً واحدة أول السنة بخصم. إن كنت تدفعها بأمر دفع شهري فسجّلها بنداً شهرياً بدلها.'),
  ('صيانة البيت',          'دهان وتسريبات وتصليحات — ما لا بدّ منه ولا موعد ثابت له.'),
  ('اشتراكات سنوية',       'ما يُدفع مرة بالسنة: برامج، نقابة، عضويات.'),
  ('طوارئ وأعطال',         'احتياطٌ لما لا يُتوقَّع: عطل سيارة أو جهاز بيت أو طبيب مستعجل. غير «صندوق طوارئ» — هذا مصروفٌ متوقَّع حدوثه مجهولٌ موعده، وذاك هدفُ ادّخارٍ يُجمَّع مرة.'),
  ('كمبيوتر / لابتوب',     'هدف شراء: تجمّع ثمنه شهرياً، وينتهي البند بالشراء ولا يتجدّد.'),
  ('بلايستيشن / جيمنغ',    'هدف شراء لمرة واحدة — جهاز الألعاب وملحقاته.'),
  ('تلفون جديد',           'هدف شراء: ثمن التلفون كاملاً بدل تقسيطه على فاتورة الخلوي.'),
  ('سيارة',                'هدف شراء كبير — الدفعة الأولى أو ثمن السيارة كاملاً.'),
  ('أثاث',                 'هدف شراء: تأثيث غرفة أو بيت.'),
  ('دراجة / سكوتر',        'هدف شراء لمرة واحدة.'),
  ('كورس أو دراسة',        'هدف: رسوم كورس أو فصل دراسي.'),
  ('سفرة',                 'هدف سفرةٍ بعينها لها ثمنٌ وموعد — غير «سفر وإجازة» المتكرّر كل سنة.'),
  ('عرس',                  'هدف كبير: تكاليف العرس — قاعة وذهب وتصوير.'),
  ('صندوق طوارئ',          'هدف ادّخار: مصروف ثلاثة إلى ستة شهور جانباً لليوم الأسود. يُجمَّع مرة ويبقى.')
) as v(name_ar, hint)
where t.name_ar = v.name_ar;

update public.commitment_templates as t set hint = v.hint
from (values
  ('كهرباء',          'فاتورة חשמל — تصل كل شهرين، والمبلغ هنا حصّة الشهر الواحد.'),
  ('مي',              'فاتورة المياه من البلدية أو شركة المياه.'),
  ('غاز',             'غاز البيت: مركزي بفاتورة شهرية، أو جرّة تُبدَّل.'),
  ('إنترنت',          'خط الإنترنت ومعه التلفزيون إن كانا بحزمة واحدة.'),
  ('تلفون',           'خط الخلوي — وتكبر الفاتورة إن كان الجهاز مقسّطاً عليها.'),
  ('أرنونا',          'ضريبة البلدية بأمر دفع شهري. إن كنت تدفعها دفعةً كبيرة كل شهرين فسجّلها التزاماً بدلها.'),
  ('إيجار',           'إيجار البيت الشهري.'),
  ('واد بيت',         'ועד בית — رسم صيانة العمارة: الدرج والمصعد وكهرباء المشترك.'),
  ('اشتراكات رقمية',  'نتفلكس وسبوتيفاي وأمثالهما — صغيرة منفردةً وكبيرة مجتمعةً.'),
  ('نادي رياضي',      'اشتراك الجيم أو النادي.'),
  ('مساعدة الأهل',    'ما ترسله شهرياً للأهل.'),
  ('قرض سيارة',       'قسط قرض السيارة — حدّد تاريخ آخر دفعة ليخرج من حملك حين ينتهي.'),
  ('قرض شخصي',        'قسط قرض من البنك — له عدد دفعات وتاريخ نهاية.'),
  ('تقسيط جهاز',      'تلفون أو أثاث أو جهاز مقسّط — ينتهي بانتهاء أقساطه.'),
  ('دين لحدا',        'دين لصاحب أو قريب تسدّده على دفعات متّفق عليها.')
) as v(name_ar, hint)
where t.name_ar = v.name_ar;

-- ─────────────────────────────────────────────
-- 0016_accounts.sql
-- ─────────────────────────────────────────────
-- الحسابات: المال يعيش في مكان.
--
-- كل ما بناه التطبيق حتى الآن يعامل صندوق الالتزام كأنه **مال**، وهو ليس
-- مالاً — هو **تخصيص على مالٍ موجود في حساب**. والفرق ليس فلسفياً: من سجّل
-- رصيده البنكي أصلاً وسجّل صناديقه كان صافي ثروته يُحتسب مرّتين، لأن الألفين
-- التي في البنك هي نفسها الألفان التي في صندوق التأمين.
--
--     حساب الالتزامات        ₪2,000
--       ├─ مظروف: تأمين السيارة   ₪2,000
--       └─ غير مخصّص                  ₪0
--
-- المظروف يوضع **فوق** المال لا بجانبه. و«غير مخصّص» هو أهمّ رقم في الميزانية
-- كلها: موجباً أو صفراً فالوضع مضبوط، وسالباً فالتطبيق يَعِد بمالٍ ليس في
-- البنك. بدونه تبقى الصناديق دفتراً لا ميزانية.
--
-- ولماذا اليوم: كل الصناديق اليوم صفر، فلا رصيد يُرحَّل ولا رقم يُصحَّح.
-- أرخص لحظة ممكنة لهذا التغيير.
--
-- ما لا تضيفه عمداً: لا عرض `account_balances` يحسب `reserved` في SQL.
-- ‏`reserved` و`available` قرارُ تعريفٍ لا جمعُ أعمدة — أيُّ صندوقٍ يُنسب إلى
-- أيّ حساب — ومكان قرارات التعريف في هذا المشروع هو المحرّك النقي المُختبَر
-- (src/lib/accounts/calc.ts) لا تعريفُ عرضٍ لا اختبار له. نفس القرار المكتوب
-- في 0014 حين رُفض عرضُ `net_worth`.

/* ── الحسابات ──────────────────────────────────────────────── */

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,

  -- نوعان لا ستة: الجاري يُصرف منه، والادخار يُجمَّع فيه. وأيّ تصنيفٍ أدقّ
  -- من ذلك لا يغيّر رقماً واحداً في التطبيق، فيبقى حقلاً يُملأ بلا أثر.
  kind text not null default 'checking' check (kind in ('checking', 'savings')),

  -- الرصيد الفعلي كما في كشف البنك — يُدخَل يدوياً. لا ربط API ولا استيراد
  -- حركات: مشروعٌ مستقل يوقف كل شيء، وقرارُ إبقائه خارج النطاق محسوم.
  balance numeric(14, 2) not null default 0,

  -- متى قال صاحبه إن هذا هو الرصيد. رصيدٌ عمره شهر يجعل «غير مخصّص» رقماً
  -- يكذب بثقة، والتطبيق يحتاج أن يقول «حدّث رصيدك» بدل أن يحسب عليه صامتاً.
  balance_updated_at timestamptz not null default now(),

  -- لا حذف: الحساب يُؤرشف. التحويلات والدفعات تشير إليه، ومحوُه يقطع تاريخاً.
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.accounts is
  'حسابات البنك — المال يعيش هنا، وصناديق الالتزامات مظاريف فوقه لا بجانبه';
comment on column public.accounts.balance is
  'الرصيد الفعلي، يُدخَل يدوياً — لا ربط API ولا استيراد حركات';
comment on column public.accounts.balance_updated_at is
  'متى أُدخل الرصيد — رصيدٌ قديم يجعل «غير مخصّص» يكذب بثقة';

-- الاسم مفتاح المطابقة في أدوات MCP («حوّلت من حساب المصاريف»)، فتكراره يجعل
-- الاختيار قرعةً. والقيد على النشط وحده: المؤرشف يترك اسمه لمن بعده.
create unique index if not exists accounts_user_name_idx
  on public.accounts (user_id, name)
  where archived_at is null;

create index if not exists accounts_user_idx
  on public.accounts (user_id, archived_at);

-- تاريخ الرصيد يتبع الرصيد، ولا يُترك للعميل.
--
-- ثلاثة مسارات تغيّر الرصيد — الإدخال اليدوي، والتحويل، وتسجيل الدفع — ومَن
-- نسي منها ضبطَ العمود ترك تاريخاً كاذباً. والكذب هنا أسوأ من الغياب لأنه
-- يُقرأ حقيقةً. نفس المبدأ المطبَّق في `touch_updated_at` بـ 0014.
create or replace function public.touch_balance_updated_at()
returns trigger
language plpgsql
-- مسارُ البحث مثبَّت: دالّةٌ بمسارٍ متغيّر تُنفَّذ بما يجده المستدعي.
set search_path = public
as $$
begin
  if new.balance is distinct from old.balance then
    new.balance_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_touch_balance on public.accounts;
create trigger accounts_touch_balance
  before update on public.accounts
  for each row execute function public.touch_balance_updated_at();

/* ── التحويل بين الحسابات ──────────────────────────────────── */

-- التحويل والإيداع حدثان مختلفان يجب ألّا يختلطا:
--
--                    | التحويل | الإيداع في صندوق
--   ما هو            | نقل مالٍ حقيقي بين حسابين | تخصيص مالٍ موجود أصلاً
--   يغيّر الأرصدة    | نعم | لا
--   يغيّر `reserved` | لا  | نعم
--   يغيّر الثروة     | لا  | لا
--
-- وواقعياً المستخدم يفعلهما معاً («حوّلت ₪2,000 للتأمين»)، ولذلك تقبل
-- `sanawi_add_deposit` معامل `from_account` فتكتب الاثنين. لكنهما يبقيان
-- صفّين في جدولين: خلطهما في صفٍّ واحد يجعل «كم انتقل بين حساباتي» سؤالاً
-- بلا جواب.
create table if not exists public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid not null references public.accounts (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  transferred_at date not null default current_date,
  note text,
  created_at timestamptz not null default now(),

  -- تحويلٌ من الحساب إلى نفسه لا معنى له، ويترك رصيداً يبدو متغيّراً وهو ثابت.
  constraint account_transfers_distinct check (from_account_id <> to_account_id)
);

comment on table public.account_transfers is
  'نقل مالٍ حقيقي بين حسابين — لا يغيّر صافي الثروة ولا أرصدة الصناديق';

create index if not exists account_transfers_user_date_idx
  on public.account_transfers (user_id, transferred_at desc);

/* ── التسويات المعلّقة ─────────────────────────────────────── */

-- من دفع التأمين من «بنك B» وصندوقه في «بنك A» لم يخطئ: هذا ما يحدث فعلاً
-- حين تكون البطاقة في الجيب والصندوق في حسابٍ آخر. فلا نرفض الدفعة — نُعلّمها.
--
--   بنك B: الرصيد −5,000
--   بنك A: الرصيد بلا تغيير، و`reserved` −5,000 → صار عنده 5,000 غير مخصّصة
--   ⚠️ بنك A مدين لبنك B بـ 5,000 — حوِّل لتضبط الأرصدة
--
-- والسطر يُغلق حين يقع التحويل المقابل، لا قبله: التسوية التلقائية بلا موافقة
-- المستخدم خارج النطاق عمداً — رقمٌ يتحرّك من تلقائه في تطبيقٍ ماليّ يفقد
-- صاحبَه الثقةَ في كل رقمٍ آخر.
create table if not exists public.account_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- المدين: الحساب الذي تحرّر ماله (حساب الصندوق).
  debtor_account_id uuid not null references public.accounts (id) on delete restrict,
  -- الدائن: الحساب الذي خرج منه الدفع فعلاً.
  creditor_account_id uuid not null references public.accounts (id) on delete restrict,

  amount numeric(14, 2) not null check (amount > 0),
  -- من أين وُلدت التسوية — الالتزام الذي دُفع من حسابٍ غير حساب صندوقه.
  obligation_id uuid references public.obligations (id) on delete set null,
  note text,

  -- فارغ = معلّقة. والإغلاق يشير إلى التحويل الذي أغلقها، فيبقى «لماذا أُغلقت»
  -- مقروءاً بعد شهور.
  settled_at timestamptz,
  settled_by_transfer_id uuid references public.account_transfers (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint account_settlements_distinct check (debtor_account_id <> creditor_account_id)
);

comment on table public.account_settlements is
  'دفعةٌ خرجت من حسابٍ غير حساب صندوقها — تُعلَّم ولا تُرفض، وتُغلق بتحويلٍ مقابل';

create index if not exists account_settlements_open_idx
  on public.account_settlements (user_id, settled_at);

/* ── الربط: أيّ حسابٍ يخصّ أيّ بند ─────────────────────────── */

-- الربط **لكل التزام على حدة** لا دورٌ ثابت للحساب: من عنده حسابٌ واحد يربط
-- كل شيء به، ومن عنده حسابان يوزّع. وجعلُ الحساب «حساب الالتزامات» بعَلَمٍ
-- عليه يفرض ترتيباً على من لا يريده.
--
-- وكلها **nullable**: البيانات القائمة تبقى صالحة بلا ترحيلٍ إجباري، والتزامٌ
-- بلا حساب له مسارٌ منصوصٌ عليه في صافي الثروة (يُحتسب ملكاً، ويُحذَّر).
alter table public.obligations
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

alter table public.fund_deposits
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

alter table public.obligation_payments
  add column if not exists paid_from_account_id uuid
    references public.accounts (id) on delete set null;

alter table public.fixed_commitments
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

alter table public.expenses
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

comment on column public.obligations.account_id is
  'الحساب الذي يحتفظ بصندوق هذا الالتزام — فارغ يعني صندوقاً غير مربوط';
comment on column public.fund_deposits.account_id is
  'الحساب الذي دخله المبلغ فعلاً';
comment on column public.obligation_payments.paid_from_account_id is
  'الحساب الذي خرج منه الدفع — إن خالف حساب الصندوق تُنشأ تسوية معلّقة';
comment on column public.fixed_commitments.account_id is
  'حساب الدفع الافتراضي لهذا البند';
comment on column public.expenses.account_id is
  'الحساب الذي خرج منه المصروف';

create index if not exists obligations_account_idx
  on public.obligations (account_id)
  where account_id is not null;

/* ── RLS ───────────────────────────────────────────────────── */

alter table public.accounts enable row level security;
alter table public.account_transfers enable row level security;
alter table public.account_settlements enable row level security;

drop policy if exists "accounts_all_own" on public.accounts;
create policy "accounts_all_own" on public.accounts
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "account_transfers_all_own" on public.account_transfers;
create policy "account_transfers_all_own" on public.account_transfers
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "account_settlements_all_own" on public.account_settlements;
create policy "account_settlements_all_own" on public.account_settlements
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────
-- 0017_bank_inbox.sql
-- ─────────────────────────────────────────────
-- الربط الحي مع البنك — Financy (Open Finance).
--
-- في 0016 كُتب: «لا ربط API ولا استيراد حركات — قرارُ إبقائه خارج النطاق
-- محسوم». القرار انقلب بطلبٍ صريح من صاحب التطبيق بعد أن جرّب «سجّل من
-- البنك» اليدوي وأراد الخطوة التالية: الحركات تصل وحدها ويبقى هو الحكم.
--
-- الفلسفة لم تتغيّر قيد أنملة: **لا شيء يُسجَّل من تلقائه.** الحركة تصل من
-- Financy إلى «وارد» معلّق، وصاحبها يقرّر: مصروف، قبضة، قسط صندوق، أو
-- تجاهل. الوارد صندوق بريد لا دفتر حسابات.
--
-- و«القراءة فقط» محفوظة بطبقتين: Financy نفسها Open Banking تحت رقابة بنك
-- إسرائيل ولا تملك تحريك مال، ومفاتيحها هنا في جدولٍ لا يقرؤه أحد عبر
-- الواجهة — ولا صاحبه.

/* ── اعتمادات Financy ──────────────────────────────────────── */

-- سرٌّ في قاعدة البيانات لا في متغيّرات البيئة: التطبيق متعدّد المستخدمين
-- نظرياً ولكل مستخدمٍ مفاتيحه، ومتغيّر البيئة واحدٌ للجميع. والجدول أسلم
-- مكانٍ متاح: RLS مفعّل **بلا أي سياسة**، فلا صفَّ يخرج عبر PostgREST لأي
-- دور — الكتابة عبر الدالة المعرَّفة أدناه وحدها، والقراءة لدالّة الحافة
-- بمفتاح الخدمة وحدها.
create table if not exists public.financy_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  client_id text not null,
  client_secret text not null,
  -- معرّف المستخدم عند Financy — يدخل في طلب التوكن مع المفتاحين.
  financy_user_id text not null,
  updated_at timestamptz not null default now()
);

comment on table public.financy_credentials is
  'مفاتيح Financy (Open Finance) — جدول أعمى: RLS بلا سياسات، الكتابة عبر save_financy_credentials والقراءة لدالّة الحافة وحدها';

alter table public.financy_credentials enable row level security;

-- الكتابة بلا قراءة: من يملك المفاتيح يستطيع استبدالها ومسحها، ولا يستطيع
-- هو ولا غيره استرجاعها من الواجهة — فتسريب جلسته لا يسرّب سرّ بنكه.
create or replace function public.save_financy_credentials(
  p_client_id text,
  p_client_secret text,
  p_financy_user_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(p_client_id), '') = ''
     or coalesce(trim(p_client_secret), '') = ''
     or coalesce(trim(p_financy_user_id), '') = '' then
    raise exception 'missing credentials';
  end if;

  insert into public.financy_credentials (user_id, client_id, client_secret, financy_user_id, updated_at)
  values ((select auth.uid()), trim(p_client_id), trim(p_client_secret), trim(p_financy_user_id), now())
  on conflict (user_id) do update
    set client_id = excluded.client_id,
        client_secret = excluded.client_secret,
        financy_user_id = excluded.financy_user_id,
        updated_at = now();
end;
$$;

-- الحالة بلا السرّ: الواجهة تحتاج «مربوط أم لا ومتى» لترسم شاشتها، ولا
-- تحتاج حرفاً واحداً من المفاتيح.
create or replace function public.financy_status()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('connected', true, 'updated_at', fc.updated_at)
     from public.financy_credentials fc
     where fc.user_id = (select auth.uid())),
    jsonb_build_object('connected', false)
  );
$$;

-- فكّ الربط — يمسح المفاتيح ولا يمسّ الوارد: ما وصل وصل.
create or replace function public.clear_financy_credentials()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.financy_credentials
  where user_id = (select auth.uid());
$$;

revoke execute on function public.save_financy_credentials(text, text, text) from public, anon;
revoke execute on function public.financy_status() from public, anon;
revoke execute on function public.clear_financy_credentials() from public, anon;
grant execute on function public.save_financy_credentials(text, text, text) to authenticated;
grant execute on function public.financy_status() to authenticated;
grant execute on function public.clear_financy_credentials() to authenticated;

/* ── وارد البنك ────────────────────────────────────────────── */

-- صندوق بريد الحركات: دالّة الحافة تكتب فيه ما جلبت، والمستخدم يعلّم كل
-- صفٍّ بقراره. لا سياسة إدراجٍ للمستخدم (الكتابة للخدمة وحدها كي لا يصير
-- باباً رابعاً للتسجيل اليدوي)، ولا سياسة حذفٍ لأحد: القرار يُعلَّم ولا
-- يُمحى — من تجاهل حركةً بالغلط يجدها في المتجاهَل لا في العدم.
create table if not exists public.bank_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- مفتاح Financy الفريد للحركة — به لا تُدرَج الحركة مرتين مهما تكرّر السحب.
  tx_sk text not null,
  provider_id text,
  account_external_id text,

  name text not null,
  -- موجب دائماً — الاتجاه في عموده لا في الإشارة، نفس قاعدة قارئ الكشف.
  amount numeric(14, 2) not null check (amount > 0),
  direction text not null check (direction in ('in', 'out')),
  tx_date date not null,

  -- تصنيف Financy كما وصل (تصنيفة MCC) — اقتراحٌ للشاشة لا قرار.
  category_main text,
  category_sub text,
  -- «قسط 3 من 12» على البطاقة — يُعرض ليعرف صاحبه أنها ليست شراءً جديداً.
  installment_number int,
  installment_total int,

  status text not null default 'pending' check (status in ('pending', 'recorded', 'dismissed')),
  -- بماذا سُجّلت حين سُجّلت — للأثر لا للمنطق.
  recorded_kind text check (recorded_kind in ('expense', 'income', 'deposit')),
  created_at timestamptz not null default now()
);

comment on table public.bank_inbox is
  'وارد البنك الحي (Financy) — حركات معلّقة بانتظار قرار صاحبها؛ لا شيء يُسجَّل من تلقائه';
comment on column public.bank_inbox.tx_sk is
  'مفتاح الحركة عند Financy — الفرادة به تمنع الإدراج المكرّر مهما تكرّر السحب';

create unique index if not exists bank_inbox_user_sk_idx
  on public.bank_inbox (user_id, tx_sk);

-- الشاشة تسأل دائماً: المعلّق لهذا المستخدم، الأحدث أولاً.
create index if not exists bank_inbox_user_status_date_idx
  on public.bank_inbox (user_id, status, tx_date desc);

alter table public.bank_inbox enable row level security;

drop policy if exists "bank_inbox_select_own" on public.bank_inbox;
create policy "bank_inbox_select_own" on public.bank_inbox
  for select using ((select auth.uid()) = user_id);

drop policy if exists "bank_inbox_update_own" on public.bank_inbox;
create policy "bank_inbox_update_own" on public.bank_inbox
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────
-- 0018_snapshot_accounts_total.sql
-- ─────────────────────────────────────────────
-- لقطة صافي الثروة تجمع على صافيها.
--
-- كانت اللقطة تحفظ `assets_total` و`restricted_total` و`debts_total` و
-- `net_worth`، وصافي الثروة يُحسب من **أربعة** مكوّنات لا ثلاثة: الأصول
-- وأرصدة الحسابات والصناديق غير المربوطة ناقص الديون. فأرصدة الحسابات —
-- وهي مصدر النقد الوحيد — لم تكن تُخزَّن أصلاً.
--
-- والأثر كامنٌ اليوم لأن الخط البياني يرسم `net_worth` وحده، لكنه لغمٌ لأي
-- قراءةٍ مستقبلية للمكوّنات: من جمعها وجدها لا تساوي الصافي المحفوظ بجانبها.
-- (تدقيق آب 2026: ث4)
--
-- الافتراضي صفر: اللقطات القديمة لا تعرف رصيد حساباتها يومَها، وصفرٌ فيها
-- يقول «غير مسجَّل» — وهو أصدق من رقمٍ يُشتقّ اليوم لماضٍ لم يُقَس.

alter table public.net_worth_snapshots
  add column if not exists accounts_total numeric(14, 2) not null default 0;

comment on column public.net_worth_snapshots.accounts_total is
  'مجموع أرصدة الحسابات وقت اللقطة — رابع مكوّنات الصافي، وبدونه لا تجتمع';

-- ─────────────────────────────────────────────
-- 0019_merge_cash_assets_into_accounts.sql
-- ─────────────────────────────────────────────
-- دمج أصول النقد والادخار في الحسابات — نهاية العدّ المزدوج من جذره.
--
-- كان في التطبيق مكانان لتسجيل المال نفسه: `accounts` (رصيد البنك) و
-- `assets` من نوع cash/savings. وصافي الثروة يجمع الاثنين، فمن سجّل رصيده
-- في المكانين رأى ضعف ثروته — دَينٌ موثَّق في README منذ 0016 وموصوف في
-- تدقيق آب 2026 (ث2)، وقرّر صاحب التطبيق دمجه لا التعايش معه.
--
-- **الاتجاه: الأصل النقدي يصير حساباً، لا العكس.** الحسابات هي الطرف الغنيّ:
-- الصناديق مظاريف فوقها، والتحويلات والتسويات ودفعات الالتزامات كلها تشير
-- إليها بمفاتيح أجنبية. ونقل تلك الآلة كلها إلى `assets` هجرةٌ خطرة بلا
-- مقابل، بينما «أصلٌ نقديّ» ورقةٌ بلا مفاتيح تشير إليها — فينتقل هو.
-- وهذا يوافق ما يقوله README أصلاً: **المال يعيش في الحسابات.**

/* ── 1. الحساب يرث ما كان يميّز الأصل ──────────────────────── */

-- صندوق الطوارئ يُعلَّم ولا يُشتقّ (نفس تعليل 0014): وديعتان بالمبلغ نفسه
-- إحداهما للطوارئ والأخرى لسفرة الصيف، ولا يفرّق بينهما إلا صاحبهما.
-- وبلا هذا العمود كانت وديعةُ الطوارئ تفقد علامتها بمجرّد أن تصير حساباً.
alter table public.accounts
  add column if not exists is_emergency_fund boolean not null default false;

-- والعائد كذلك: حساب ادخارٍ بفائدة 3٪ يدخل المتوسط المرجّح، وإسقاطه يجعل
-- «عائدك المرجّح» يقرأ صفراً لمن كل ماله في وديعةٍ مربحة.
alter table public.accounts
  add column if not exists annual_return_percent numeric(5, 2) not null default 0
    check (annual_return_percent >= -100 and annual_return_percent <= 100);

comment on column public.accounts.is_emergency_fund is
  'هل هذا الحساب هو صندوق الطوارئ — يُعلَّم ولا يُشتقّ من نوعه';
comment on column public.accounts.annual_return_percent is
  'العائد السنوي على رصيد هذا الحساب — يدخل المتوسط المرجّح';

/* ── 2. ترحيل الصفوف القائمة ───────────────────────────────── */

-- الاسم مفتاح المطابقة في أدوات كلود، وعليه فهرسٌ فريد للحسابات النشطة —
-- فأصلٌ اسمه اسمُ حسابٍ قائم يُلحق به «(أصل)» بدل أن تنفجر الهجرة كلها.
-- والمبلغ لا يُجمع على الحساب الموجود: قد يكونان مالين مختلفين، والدمج
-- الصامت يخترع رقماً لم يقله أحد.
insert into public.accounts (
  user_id, name, kind, balance, is_emergency_fund, annual_return_percent, created_at
)
select
  a.user_id,
  case
    when exists (
      select 1 from public.accounts c
      where c.user_id = a.user_id and c.name = a.name and c.archived_at is null
    ) then a.name || ' (أصل)'
    else a.name
  end,
  case when a.kind = 'savings' then 'savings' else 'checking' end,
  a.amount,
  a.is_emergency_fund,
  a.annual_return_percent,
  a.created_at
from public.assets a
where a.kind in ('cash', 'savings')
  and a.is_active
  -- الهجرة تُعاد تشغيلها بلا ضرر: صفٌّ رُحِّل مرّة لا يُرحَّل ثانيةً.
  and not exists (
    select 1 from public.accounts c
    where c.user_id = a.user_id
      and c.name in (a.name, a.name || ' (أصل)')
      and c.balance = a.amount
  );

-- الأصل المُرحَّل يُؤرشف ولا يُحذف: تاريخُ ما سجّله صاحبه لا يُمحى، وحذفُه
-- يجعل الهجرة بلا رجعة إن تبيّن خطأ.
update public.assets
set is_active = false,
    note = coalesce(note || ' · ', '') || 'رُحِّل إلى الحسابات (هجرة 0019)'
where kind in ('cash', 'savings') and is_active;

/* ── 3. الباب يُغلق: لا أصل نقديّ جديد ─────────────────────── */

-- القيد هو الفرق بين «أصلحنا البيانات» و«أصلحنا المشكلة»: بلا هذا السطر
-- يعود العدّ المزدوج مع أول أصلٍ يسجّله صاحبه غداً. والقديم المؤرشف يبقى
-- مقروءاً — القيد على النشط وحده.
alter table public.assets
  drop constraint if exists assets_kind_check;

alter table public.assets
  add constraint assets_kind_check check (
    kind in ('cash', 'savings', 'investment', 'property', 'receivable', 'other')
  );

alter table public.assets
  drop constraint if exists assets_no_active_cash_check;

alter table public.assets
  add constraint assets_no_active_cash_check check (
    not (is_active and kind in ('cash', 'savings'))
  );

comment on constraint assets_no_active_cash_check on public.assets is
  'النقد والادخار يعيشان في accounts — مكانان لمالٍ واحد يعنيان عدّاً مزدوجاً';

-- ─────────────────────────────────────────────
-- 0020_crypto_wallets.sql
-- ─────────────────────────────────────────────
-- محافظ العملات الرقمية — قيمةٌ حقيقية بدل رقمٍ يُدخَل بالإصبع.
--
-- القرار سبقه قرارٌ مثله في 0017 (وارد البنك): «لا ربط API» كان محسوماً حتى
-- طلبه صاحب التطبيق صراحةً. والفرق هنا أن الكريبتو **لا تُدخَل يدوياً أصلاً
-- بصدق**: قيمتها تتحرّك كل دقيقة، فالرقم الذي يُكتب بالإصبع يكذب بعد ساعة.
--
-- والفلسفة لم تتغيّر: **لا شيء يُسجَّل من تلقائه، ولا مفتاحَ يُقرأ من الواجهة.**
-- المحفظة تصير `asset` عادياً من نوع investment، والمزامنة تحدّث `amount` و
-- `updated_at` عليه — فصافي الثروة ورقم الحرية وحارس «قيمة قديمة» تعمل كما
-- هي بلا سطرٍ واحد جديد فيها.

/* ── 1. المحفظة: صفٌّ يقرؤه صاحبه ────────────────────────────── */

-- منفصلٌ عن الأصل عمداً: الأصل رقمٌ يُعرض، وهذا وصلةٌ لها حالةُ مزامنة
-- ورسالةُ فشلٍ أخيرة — وخلطهما يجعل عطلَ شبكةٍ يبدو تغيّراً في الثروة.
create table if not exists public.crypto_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- المنصّة تحدّد المُحوِّل (adapter) في دالّة الحافة: لكلٍّ توقيعُها ومساراتها.
  exchange text not null check (
    exchange in ('binance', 'bybit', 'okx', 'kraken', 'coinbase', 'pionex')
  ),

  -- اسمٌ يقرؤه صاحبه: «بايننس الأساسي» — فمن له حسابان يميّزهما.
  label text not null,

  -- الأصل الذي تُكتب فيه القيمة. الحذف يُفرغ الوصلة ولا يمحو المحفظة:
  -- المفاتيح تبقى صالحة، ويُربط أصلٌ جديد بضغطة.
  asset_id uuid references public.assets (id) on delete set null,

  -- آخر مزامنة ناجحة ورسالة آخر فشل — الحالة تُعرَض ولا تُخمَّن.
  -- والفشل لا يمحو القيمة السابقة: رقمٌ عمره ساعة خيرٌ من صفرٍ كاذب.
  last_synced_at timestamptz,
  last_error text,

  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.crypto_wallets is
  'محافظ العملات الرقمية — الوصلة وحالتها؛ المفاتيح في جدولٍ أعمى منفصل';
comment on column public.crypto_wallets.asset_id is
  'الأصل الذي تُكتب فيه القيمة — المحفظة تغذّي أصلاً عادياً لا نوعاً جديداً';

alter table public.crypto_wallets enable row level security;

drop policy if exists "crypto_wallets_own" on public.crypto_wallets;
create policy "crypto_wallets_own" on public.crypto_wallets
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists crypto_wallets_user_idx
  on public.crypto_wallets (user_id, is_active);

-- الاسم مفتاح المطابقة عند كلود، وتكراره يجعل الاختيار قرعةً.
create unique index if not exists crypto_wallets_user_label_idx
  on public.crypto_wallets (user_id, label)
  where is_active;

/* ── 2. المفاتيح: جدولٌ أعمى ─────────────────────────────────── */

-- نفس نمط `financy_credentials` حرفاً بحرف، ولسببٍ أثقل: مفتاح منصّة تداول
-- مسروقٌ قد يعني محفظةً مسروقة. فالجدول:
--   • RLS مفعّل **بلا أي سياسة** — لا صفَّ يخرج عبر PostgREST لأي دور،
--     ولا لصاحبه: تسريب جلسته لا يسرّب مفتاح منصّته.
--   • الكتابة عبر الدالّة أدناه وحدها، والقراءة لدالّة الحافة بمفتاح الخدمة.
--
-- **والمفتاح يجب أن يكون للقراءة فقط.** التطبيق لا يتداول ولا يسحب، ومفتاحٌ
-- بصلاحية سحبٍ يضع محفظةً كاملة خلف خطأٍ برمجيّ واحد. هذا مكتوبٌ في الواجهة
-- وفي هذا التعليق لأن قارئه بعد سنة لن يعرف السبب.
create table if not exists public.crypto_credentials (
  wallet_id uuid primary key references public.crypto_wallets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  api_key text not null,
  api_secret text not null,
  -- OKX وحدها تطلب ثالثاً؛ فارغٌ لغيرها.
  passphrase text,
  updated_at timestamptz not null default now()
);

comment on table public.crypto_credentials is
  'مفاتيح منصّات التداول — جدول أعمى: RLS بلا سياسات، والمفتاح للقراءة فقط';

alter table public.crypto_credentials enable row level security;

/* ── 3. الكتابة بلا قراءة ────────────────────────────────────── */

-- من يملك المفاتيح يستطيع استبدالها ومسحها، ولا يستطيع هو ولا غيره
-- استرجاعها من الواجهة — نفس عقد `save_financy_credentials`.
create or replace function public.save_crypto_credentials(
  p_wallet_id uuid,
  p_api_key text,
  p_api_secret text,
  p_passphrase text default null
) returns void
language plpgsql
security definer
-- مسارُ البحث مثبَّت: دالّةٌ بمسارٍ متغيّر تُنفَّذ بما يجده المستدعي.
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  -- الملكية تُتحقَّق هنا لا في الواجهة: الدالّة تعمل بصلاحية مالكها، فبلا
  -- هذا الشرط يكتب أيُّ مستخدمٍ مفاتيحه على محفظة غيره.
  if not exists (
    select 1 from public.crypto_wallets w
    where w.id = p_wallet_id and w.user_id = (select auth.uid())
  ) then
    raise exception 'wallet not found';
  end if;

  if length(trim(p_api_key)) = 0 or length(trim(p_api_secret)) = 0 then
    raise exception 'empty credentials';
  end if;

  insert into public.crypto_credentials (wallet_id, user_id, api_key, api_secret, passphrase, updated_at)
  values (
    p_wallet_id,
    (select auth.uid()),
    trim(p_api_key),
    trim(p_api_secret),
    nullif(trim(coalesce(p_passphrase, '')), ''),
    now()
  )
  on conflict (wallet_id) do update
    set api_key = excluded.api_key,
        api_secret = excluded.api_secret,
        passphrase = excluded.passphrase,
        updated_at = now();
end;
$$;

comment on function public.save_crypto_credentials is
  'كتابة مفاتيح منصّة بلا إمكان قراءتها — تسريب الجلسة لا يسرّب المفتاح';

-- هل للمحفظة مفاتيح؟ سؤالٌ تحتاجه الواجهة («اربطها» أم «بدّل المفاتيح»)
-- ولا يجوز أن يُجاب بقراءة الصفّ. الجواب boolean لا أكثر.
create or replace function public.crypto_wallet_has_credentials(p_wallet_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.crypto_credentials c
    where c.wallet_id = p_wallet_id
      and c.user_id = (select auth.uid())
  );
$$;

/* ── 4. الحجب عن الزائر ───────────────────────────────────────── */

-- `security definer` تعني أن الدالّة تعمل بصلاحية مالكها، فبقاؤها مفتوحةً
-- لدور `anon` يجعلها مساراً قابلاً للنداء بلا جلسة عبر `/rest/v1/rpc/…`.
-- الحارس داخلها يردّ (`auth.uid() is null`) — لكن الطبقتين خيرٌ من واحدة،
-- وهو نفس ما فُعل بدوالّ Financy في 0017، وفحصُ Supabase الأمني يطلبه.
revoke all on function public.save_crypto_credentials(uuid, text, text, text) from public, anon;
grant execute on function public.save_crypto_credentials(uuid, text, text, text) to authenticated;

revoke all on function public.crypto_wallet_has_credentials(uuid) from public, anon;
grant execute on function public.crypto_wallet_has_credentials(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 0021_bank_account_links.sql
-- ─────────────────────────────────────────────
-- ربط حساب البنك بحساب سنوي — الحلقة الناقصة في الربط الحي.
--
-- ‏0017 جلب الحركات وكتب في كل صفٍّ `account_external_id` — «من أيّ حسابٍ
-- بنكيّ جاءت هذه الحركة». والعمود يُكتب ولا يُقرأ في المشروع كلّه: الوارد
-- خليطٌ من حسابين لا يميّز بينهما، والحركة تُسجَّل مصروفاً بلا `account_id`
-- رغم أن العمود موجودٌ منذ 0016 وأداة كلود `sanawi_add_expense` تملؤه.
-- فالشاشة تكتب أنقص ممّا يكتبه كلود على نفس الجدول.
--
-- الربط هنا **على الحساب نفسه** لا في جدولٍ ثالث: العلاقة واحدٌ لواحد —
-- حساب بنكٍ واحد يقابل حساباً واحداً في سنوي — وجدولُ وصلٍ لعلاقةٍ أحاديّة
-- يضيف جدولاً وسياسات RLS ونداءً ثالثاً ولا يجيب سؤالاً جديداً.
--
-- ** ما لا يفعله هذا الترحيل عمداً: لا يمسّ `accounts.balance`. **
--
-- الرصيد هناك لقطةٌ من كشف البنك، والحركة الواصلة من Financy **داخلةٌ في تلك
-- اللقطة أصلاً** إن كانت أقدم منها. فخصمُها عند التسجيل يخصمها مرّتين — وهو
-- بالحرف القرار المكتوب في وصف `sanawi_add_expense`:
--
--     «تسجيل المصروف لا يُنقص رصيد الحساب. الرصيد يُدخَل يدوياً من كشف
--      البنك، والربط هنا يقول من أين خرج لا كم بقي.»
--
-- والقاعدة الواحدة تبقى واحدة: التسجيل من الوارد يقول «من أين خرج» فقط.
-- أمّا «كم بقي» فتجيبه الشاشة بسؤالٍ صريح — كم حركةً وصلت **بعد** تاريخ
-- لقطتك وبأيّ صافٍ — ويبقى الضغط على الزرّ قرار صاحبه، فلا رقمٌ يتحرّك من
-- تلقائه في تطبيقٍ ماليّ (نفس مبدأ التسويات في 0016).

/* ── أيّ حساب بنكٍ يخصّ أيّ حساب ────────────────────────────── */

alter table public.accounts
  add column if not exists bank_provider_id text,
  add column if not exists bank_external_id text;

comment on column public.accounts.bank_external_id is
  'معرّف الحساب عند Financy — به تعرف حركة الوارد حسابها؛ فارغ يعني حساباً غير مربوط بالبنك';
comment on column public.accounts.bank_provider_id is
  'مزوّد الحساب كما تسمّيه Financy — يرافق المعرّف لأنه وحده ليس فريداً بين المزوّدين';

-- حسابُ بنكٍ واحد لا يُربط بحسابين: ربطُه بحسابين يجعل «حركةٌ لأيّ حساب؟»
-- قرعةً، وصافي الحركات يُحسب مرّتين على رصيدين.
--
-- و`coalesce` على المزوّد لا العمود خاماً: ‏Postgres يعدّ ‏NULL مخالفاً لـNULL
-- في الفهارس الفريدة، فمزوّدان فارغان يمرّان من القيد وهما نفس الحساب.
create unique index if not exists accounts_bank_link_idx
  on public.accounts (user_id, coalesce(bank_provider_id, ''), bank_external_id)
  where bank_external_id is not null;

/* ── القبضة تعرف حسابها ────────────────────────────────────── */

-- ‏0016 أضاف `account_id` إلى المصاريف والإيداعات والدفعات وترك الدخل بلا
-- عمود — ولم يظهر النقص وقتها لأن لا مسار يملؤه. والآن للقبضة الواصلة من
-- البنك حسابٌ معلوم، فبقاء العمود غائباً يعني ضياع الوحيد الذي نعرفه يقيناً.
alter table public.income_entries
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

comment on column public.income_entries.account_id is
  'الحساب الذي دخلته القبضة — فارغ يعني قبضةً لا يُعرف حسابها';

-- ─────────────────────────────────────────────
-- 0022_income_sources_are_labels.sql
-- ─────────────────────────────────────────────
-- مصادر الدخل صارت أسماءً للتصنيف — قرار صاحب التطبيق 16/08/2026.
--
-- الدخل المتوقَّع كان يُحسب من `amount` و`frequency` هنا: مبلغٌ ووتيرة يكتبهما
-- المستخدم بيده، يُضربان في معامل 52/12. وثلاثة أعطال وُلدت من ذلك:
--
--   ١. ‏52/12 يصف سنةً لا شهراً. الأسبوعي × 4.333 يعطي رقماً لا يصل في أيّ
--      شهرٍ بعينه — الشهر إمّا أربع قبضات أو خمس — فتنتفخ الميزانية في كل
--      شهرٍ رباعيّ بانتظامٍ لا صدفة.
--   ٢. ‏`is_variable` يُخرج المصدر من الحسبة ولا شيء يعيده: من راتبه صغيرٌ
--      ثابت وشغله الجانبي كبير، لم يكن شغله يرفع ميزانيته أبداً مهما وصل.
--   ٣. الرقم لا يتعلّم: المصدر يقول 6,000 والواصل 5,000 منذ سنة، والتطبيق
--      مصرٌّ على 6,000.
--
-- فصارت أرقام الشهر تُحسب من `income_entries` وحدها — ما وصل فعلاً.
-- التفصيل في docs/income-actual-plan.md.
--
-- الأعمدة **تبقى** ولا تُحذف: صفوفٌ قديمة تحمل قيماً، وحذفُ عمودٍ قرارٌ لا
-- رجعة فيه بينما تركُه موثَّقاً مجاناً. والمطلوب هنا أمران فقط: ألّا يُجبَر
-- من يضيف مصدراً جديداً على اختراع رقم، وأن يقرأ من يفتح الجدول بعد سنة
-- لماذا هذه الأعمدة راكدة.

alter table public.income_sources
  alter column amount drop not null;

comment on table public.income_sources is
  'أسماء مصادر الدخل — تصنيفٌ تُنسَب إليه قبضات income_entries. لا أرقام تُحسب منه.';

comment on column public.income_sources.amount is
  'موروث ولا يقرؤه محرّك: كان مبلغ الدورة في الدخل المتوقَّع قبل إلغائه (docs/income-actual-plan.md). التطبيق يكتب 0 للصفوف الجديدة';

comment on column public.income_sources.frequency is
  'موروث ولا يقرؤه محرّك: كانت دورية الدخل المتوقَّع، وبها كان يُضرب المبلغ في 52/12';

comment on column public.income_sources.is_variable is
  'موروث ولا يقرؤه محرّك: كان يُخرج المصدر من الدخل المتوقَّع. لا معنى له بعد أن صار الأساس ما وصل فعلاً';
