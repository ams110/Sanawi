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
