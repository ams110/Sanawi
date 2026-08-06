-- الحسابات: المال يعيش في مكان.
--
-- كل ما بناه التطبيق حتى الآن يعامل صندوق الالتزام كأنه **مال**، وهو ليس
-- مالاً — هو **تخصيص على مالٍ موجود في حساب**. والفرق ليس فلسفياً: من سجّل
-- رصيده البنكي أصلاً وسجّل صناديقه كان صافي ثروته يُحتسب مرّتين، لأن الألفين
-- التي في البنك هي نفسها الألفان التي في صندوق التأمين.
--
--     حساب الالتزامات        ₪2,000
--       ├─ مظروف: تأمين السيارة   ₪2,000
--       └─ غير مخصّص                  ₪0
--
-- المظروف يوضع **فوق** المال لا بجانبه. و«غير مخصّص» هو أهمّ رقم في الميزانية
-- كلها: موجباً أو صفراً فالوضع مضبوط، وسالباً فالتطبيق يَعِد بمالٍ ليس في
-- البنك. بدونه تبقى الصناديق دفتراً لا ميزانية.
--
-- ولماذا اليوم: كل الصناديق اليوم صفر، فلا رصيد يُرحَّل ولا رقم يُصحَّح.
-- أرخص لحظة ممكنة لهذا التغيير.
--
-- ما لا تضيفه عمداً: لا عرض `account_balances` يحسب `reserved` في SQL.
-- ‏`reserved` و`available` قرارُ تعريفٍ لا جمعُ أعمدة — أيُّ صندوقٍ يُنسب إلى
-- أيّ حساب — ومكان قرارات التعريف في هذا المشروع هو المحرّك النقي المُختبَر
-- (src/lib/accounts/calc.ts) لا تعريفُ عرضٍ لا اختبار له. نفس القرار المكتوب
-- في 0014 حين رُفض عرضُ `net_worth`.

/* ── الحسابات ──────────────────────────────────────────────── */

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,

  -- نوعان لا ستة: الجاري يُصرف منه، والادخار يُجمَّع فيه. وأيّ تصنيفٍ أدقّ
  -- من ذلك لا يغيّر رقماً واحداً في التطبيق، فيبقى حقلاً يُملأ بلا أثر.
  kind text not null default 'checking' check (kind in ('checking', 'savings')),

  -- الرصيد الفعلي كما في كشف البنك — يُدخَل يدوياً. لا ربط API ولا استيراد
  -- حركات: مشروعٌ مستقل يوقف كل شيء، وقرارُ إبقائه خارج النطاق محسوم.
  balance numeric(14, 2) not null default 0,

  -- متى قال صاحبه إن هذا هو الرصيد. رصيدٌ عمره شهر يجعل «غير مخصّص» رقماً
  -- يكذب بثقة، والتطبيق يحتاج أن يقول «حدّث رصيدك» بدل أن يحسب عليه صامتاً.
  balance_updated_at timestamptz not null default now(),

  -- لا حذف: الحساب يُؤرشف. التحويلات والدفعات تشير إليه، ومحوُه يقطع تاريخاً.
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.accounts is
  'حسابات البنك — المال يعيش هنا، وصناديق الالتزامات مظاريف فوقه لا بجانبه';
comment on column public.accounts.balance is
  'الرصيد الفعلي، يُدخَل يدوياً — لا ربط API ولا استيراد حركات';
comment on column public.accounts.balance_updated_at is
  'متى أُدخل الرصيد — رصيدٌ قديم يجعل «غير مخصّص» يكذب بثقة';

-- الاسم مفتاح المطابقة في أدوات MCP («حوّلت من حساب المصاريف»)، فتكراره يجعل
-- الاختيار قرعةً. والقيد على النشط وحده: المؤرشف يترك اسمه لمن بعده.
create unique index if not exists accounts_user_name_idx
  on public.accounts (user_id, name)
  where archived_at is null;

create index if not exists accounts_user_idx
  on public.accounts (user_id, archived_at);

-- تاريخ الرصيد يتبع الرصيد، ولا يُترك للعميل.
--
-- ثلاثة مسارات تغيّر الرصيد — الإدخال اليدوي، والتحويل، وتسجيل الدفع — ومَن
-- نسي منها ضبطَ العمود ترك تاريخاً كاذباً. والكذب هنا أسوأ من الغياب لأنه
-- يُقرأ حقيقةً. نفس المبدأ المطبَّق في `touch_updated_at` بـ 0014.
create or replace function public.touch_balance_updated_at()
returns trigger
language plpgsql
-- مسارُ البحث مثبَّت: دالّةٌ بمسارٍ متغيّر تُنفَّذ بما يجده المستدعي.
set search_path = public
as $$
begin
  if new.balance is distinct from old.balance then
    new.balance_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_touch_balance on public.accounts;
create trigger accounts_touch_balance
  before update on public.accounts
  for each row execute function public.touch_balance_updated_at();

/* ── التحويل بين الحسابات ──────────────────────────────────── */

-- التحويل والإيداع حدثان مختلفان يجب ألّا يختلطا:
--
--                    | التحويل | الإيداع في صندوق
--   ما هو            | نقل مالٍ حقيقي بين حسابين | تخصيص مالٍ موجود أصلاً
--   يغيّر الأرصدة    | نعم | لا
--   يغيّر `reserved` | لا  | نعم
--   يغيّر الثروة     | لا  | لا
--
-- وواقعياً المستخدم يفعلهما معاً («حوّلت ₪2,000 للتأمين»)، ولذلك تقبل
-- `sanawi_add_deposit` معامل `from_account` فتكتب الاثنين. لكنهما يبقيان
-- صفّين في جدولين: خلطهما في صفٍّ واحد يجعل «كم انتقل بين حساباتي» سؤالاً
-- بلا جواب.
create table if not exists public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid not null references public.accounts (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  transferred_at date not null default current_date,
  note text,
  created_at timestamptz not null default now(),

  -- تحويلٌ من الحساب إلى نفسه لا معنى له، ويترك رصيداً يبدو متغيّراً وهو ثابت.
  constraint account_transfers_distinct check (from_account_id <> to_account_id)
);

comment on table public.account_transfers is
  'نقل مالٍ حقيقي بين حسابين — لا يغيّر صافي الثروة ولا أرصدة الصناديق';

create index if not exists account_transfers_user_date_idx
  on public.account_transfers (user_id, transferred_at desc);

/* ── التسويات المعلّقة ─────────────────────────────────────── */

-- من دفع التأمين من «بنك B» وصندوقه في «بنك A» لم يخطئ: هذا ما يحدث فعلاً
-- حين تكون البطاقة في الجيب والصندوق في حسابٍ آخر. فلا نرفض الدفعة — نُعلّمها.
--
--   بنك B: الرصيد −5,000
--   بنك A: الرصيد بلا تغيير، و`reserved` −5,000 → صار عنده 5,000 غير مخصّصة
--   ⚠️ بنك A مدين لبنك B بـ 5,000 — حوِّل لتضبط الأرصدة
--
-- والسطر يُغلق حين يقع التحويل المقابل، لا قبله: التسوية التلقائية بلا موافقة
-- المستخدم خارج النطاق عمداً — رقمٌ يتحرّك من تلقائه في تطبيقٍ ماليّ يفقد
-- صاحبَه الثقةَ في كل رقمٍ آخر.
create table if not exists public.account_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- المدين: الحساب الذي تحرّر ماله (حساب الصندوق).
  debtor_account_id uuid not null references public.accounts (id) on delete restrict,
  -- الدائن: الحساب الذي خرج منه الدفع فعلاً.
  creditor_account_id uuid not null references public.accounts (id) on delete restrict,

  amount numeric(14, 2) not null check (amount > 0),
  -- من أين وُلدت التسوية — الالتزام الذي دُفع من حسابٍ غير حساب صندوقه.
  obligation_id uuid references public.obligations (id) on delete set null,
  note text,

  -- فارغ = معلّقة. والإغلاق يشير إلى التحويل الذي أغلقها، فيبقى «لماذا أُغلقت»
  -- مقروءاً بعد شهور.
  settled_at timestamptz,
  settled_by_transfer_id uuid references public.account_transfers (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint account_settlements_distinct check (debtor_account_id <> creditor_account_id)
);

comment on table public.account_settlements is
  'دفعةٌ خرجت من حسابٍ غير حساب صندوقها — تُعلَّم ولا تُرفض، وتُغلق بتحويلٍ مقابل';

create index if not exists account_settlements_open_idx
  on public.account_settlements (user_id, settled_at);

/* ── الربط: أيّ حسابٍ يخصّ أيّ بند ─────────────────────────── */

-- الربط **لكل التزام على حدة** لا دورٌ ثابت للحساب: من عنده حسابٌ واحد يربط
-- كل شيء به، ومن عنده حسابان يوزّع. وجعلُ الحساب «حساب الالتزامات» بعَلَمٍ
-- عليه يفرض ترتيباً على من لا يريده.
--
-- وكلها **nullable**: البيانات القائمة تبقى صالحة بلا ترحيلٍ إجباري، والتزامٌ
-- بلا حساب له مسارٌ منصوصٌ عليه في صافي الثروة (يُحتسب ملكاً، ويُحذَّر).
alter table public.obligations
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

alter table public.fund_deposits
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

alter table public.obligation_payments
  add column if not exists paid_from_account_id uuid
    references public.accounts (id) on delete set null;

alter table public.fixed_commitments
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

alter table public.expenses
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

comment on column public.obligations.account_id is
  'الحساب الذي يحتفظ بصندوق هذا الالتزام — فارغ يعني صندوقاً غير مربوط';
comment on column public.fund_deposits.account_id is
  'الحساب الذي دخله المبلغ فعلاً';
comment on column public.obligation_payments.paid_from_account_id is
  'الحساب الذي خرج منه الدفع — إن خالف حساب الصندوق تُنشأ تسوية معلّقة';
comment on column public.fixed_commitments.account_id is
  'حساب الدفع الافتراضي لهذا البند';
comment on column public.expenses.account_id is
  'الحساب الذي خرج منه المصروف';

create index if not exists obligations_account_idx
  on public.obligations (account_id)
  where account_id is not null;

/* ── RLS ───────────────────────────────────────────────────── */

alter table public.accounts enable row level security;
alter table public.account_transfers enable row level security;
alter table public.account_settlements enable row level security;

drop policy if exists "accounts_all_own" on public.accounts;
create policy "accounts_all_own" on public.accounts
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "account_transfers_all_own" on public.account_transfers;
create policy "account_transfers_all_own" on public.account_transfers
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "account_settlements_all_own" on public.account_settlements;
create policy "account_settlements_all_own" on public.account_settlements
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
