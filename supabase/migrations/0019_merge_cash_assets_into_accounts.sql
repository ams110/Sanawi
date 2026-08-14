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
