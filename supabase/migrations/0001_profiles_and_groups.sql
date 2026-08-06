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
