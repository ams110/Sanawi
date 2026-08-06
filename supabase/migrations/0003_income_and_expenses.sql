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
