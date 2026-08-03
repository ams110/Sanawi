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

create policy "payment_methods_read" on public.payment_methods
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

create policy "payment_methods_insert_own" on public.payment_methods
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "payment_methods_update_own" on public.payment_methods
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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
