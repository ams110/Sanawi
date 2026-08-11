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

create policy "bank_inbox_select_own" on public.bank_inbox
  for select using ((select auth.uid()) = user_id);

create policy "bank_inbox_update_own" on public.bank_inbox
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
