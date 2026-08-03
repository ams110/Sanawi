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
create policy "expense_categories_read" on public.expense_categories
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

create policy "expense_categories_write_own" on public.expense_categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "expense_categories_update_own" on public.expense_categories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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
