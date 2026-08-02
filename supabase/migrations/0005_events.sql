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
