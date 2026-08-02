-- ============================================================
-- سنوي — سكيما قاعدة البيانات كاملة
-- الصق هذا الملف كله في Supabase → SQL Editor واضغط Run.
-- آمن للتكرار: تشغيله مرتين لا يفقد بياناتك.
-- لا يحتوي أي DELETE ولا TRUNCATE ولا DROP TABLE.
-- فيه drop واحد فقط: drop trigger if exists (سطر ~48) يُعاد إنشاؤه فوراً
-- بعده، وهو ضروري لتشغيل الملف أكثر من مرة. لا يمسّ أي صف بيانات.
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

create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check ((select auth.uid()) = id);

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

create policy "obligations_all_own" on public.obligations
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "partners_all_own" on public.obligation_partners
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "partner_shares_all_own" on public.obligation_partner_shares
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "fund_deposits_all_own" on public.fund_deposits
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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

create policy "income_sources_all_own" on public.income_sources
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "fixed_commitments_all_own" on public.fixed_commitments
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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
create policy "templates_read_all" on public.obligation_templates
  for select to authenticated using (true);

insert into public.obligation_templates
  (name_ar, name_he, name_en, category, icon, default_recurrence_months, suggested_min, suggested_max, country, sort_order)
values
  ('تأمين السيارة',      'ביטוח רכב',       'Car insurance',     'car',       '🚗', 12, 2500, 9000,  'IL', 10),
  ('טסט (فحص سنوي)',    'טסט שנתי',        'Annual test',       'car',       '🔧', 12,  400,  900,  'IL', 20),
  ('טיפול (صيانة)',      'טיפול תקופתי',    'Service',           'car',       '🛠️',  6,  600, 2500,  'IL', 30),
  ('إطارات',             'צמיגים',          'Tires',             'car',       '⚙️', 24, 1200, 3500,  'IL', 40),
  ('رسائل الترخيص',      'אגרת רישוי',      'Vehicle licence',   'car',       '📄', 12,  500, 1500,  'IL', 50),
  ('تأمين صحي مكمّل',     'ביטוח משלים',     'Health insurance',  'health',    '🏥', 12,  600, 2400,  'IL', 60),
  ('طبيب أسنان',         'טיפול שיניים',    'Dentist',           'health',    '🦷', 12,  500, 3000,  'IL', 70),
  ('نظارات',             'משקפיים',         'Glasses',           'health',    '👓', 24,  400, 2000,  'IL', 80),
  ('أعراس ومناسبات',     'חתונות ואירועים', 'Weddings & events', 'events',    '💍', 12, 1500, 8000,  'IL', 90),
  ('أعياد وهدايا',       'חגים ומתנות',     'Holidays & gifts',  'events',    '🎁', 12,  800, 4000,  'IL', 100),
  ('سفر وإجازة',         'טיול וחופשה',     'Travel',            'lifestyle', '✈️', 12, 2000, 12000, 'IL', 110),
  ('ضريبة الأرنونا',      'ארנונה',          'Municipal tax',     'home',      '🏠',  6,  800, 4000,  'IL', 120),
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
create policy "events_insert_own" on public.events
  for insert with check ((select auth.uid()) = user_id);
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

