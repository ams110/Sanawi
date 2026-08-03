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

create policy "income_entries_all_own" on public.income_entries
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
