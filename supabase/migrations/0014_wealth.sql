-- الثروة: الطرف الآخر من المعادلة.
--
-- كل ما بناه التطبيق حتى الآن يجيب على سؤالٍ واحد: «كم يخرج من جيبي». وهو
-- نصف السؤال. النصف الثاني — «كم تراكم لي» — لم يكن له جدولٌ ولا عمود، فلا
-- يستطيع التطبيق أن يقول لصاحبه أين هو من الحرية المالية، وهي في جوهرها
-- معادلةٌ من طرفين:
--
--     دخلٌ من الأصول ≥ مصاريف الحياة
--
-- هذه الهجرة تضيف الطرف الغائب: الأصول، ولقطاتها الشهرية لتتبّع النمو،
-- ونسبة الفائدة على الديون (بدونها لا يمكن ترتيب سدادها)، وثوابت التخطيط
-- الشخصية في الملف.
--
-- ما لا تضيفه عمداً: لا عرض `net_worth` محسوب في SQL. صافي الثروة قرارُ
-- تعريفٍ لا جمعُ أعمدة — أيّ شيء يُعدّ أصلاً، وأيّ التزامٍ يُعدّ ديناً —
-- ومكان قرارات التعريف في هذا المشروع هو المحرّك النقي المُختبَر
-- (src/lib/wealth/networth.ts) لا تعريفُ عرضٍ لا اختبار له.

/* ── الأصول ────────────────────────────────────────────────── */

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,

  -- النوع يحدّد معنى الرقم لا شكله: النقد يُصرف اليوم، والعقار لا يُصرف
  -- إلا ببيعه، والدَّين لك عند غيرك قد لا يعود. جمعها في رقمٍ واحد بلا
  -- تمييز يعطي «ثروةً» لا يستطيع صاحبها أن يأكل منها.
  kind text not null default 'cash'
    check (kind in ('cash', 'savings', 'investment', 'property', 'receivable', 'other')),

  amount numeric(14, 2) not null default 0 check (amount >= 0),

  -- العائد السنوي المتوقّع لهذا الأصل — يدخل في الإسقاط وحده.
  -- النقد صفر، ومحفظة المؤشرات ٧، والعقار ما يقدّره صاحبه.
  annual_return_percent numeric(5, 2) not null default 0
    check (annual_return_percent >= -100 and annual_return_percent <= 100),

  -- السيولة: هل أستطيع الوصول إليه هذا الأسبوع؟ صندوق الطوارئ يُقاس بها،
  -- ولا معنى لصندوق طوارئ في شقّة.
  is_liquid boolean not null default true,

  -- صندوق الطوارئ يُعلَّم ولا يُشتقّ: أصلان نقديّان بالمبلغ نفسه أحدهما
  -- محجوزٌ للطوارئ والآخر مرصودٌ لسفرةٍ في الصيف، والتطبيق لا يفرّق بينهما
  -- إلا إن قال صاحبهما.
  is_emergency_fund boolean not null default false,

  icon text,
  note text,
  is_active boolean not null default true,

  -- تاريخ آخر تحديثٍ للقيمة — عمودٌ ضروريّ لا زينة.
  -- صافي ثروةٍ مبنيّ على قيمةٍ أُدخلت قبل سنتين رقمٌ يكذب بثقة، والتطبيق
  -- يحتاج أن يقول «هذا الأصل لم يُحدَّث منذ ١٤ شهراً» بدل أن يجمعه صامتاً.
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.assets is
  'الأصول — الطرف الآخر من صافي الثروة، مقابل الالتزامات والديون';
comment on column public.assets.is_liquid is
  'هل يُصرف هذا الأسبوع؟ صندوق الطوارئ لا يكون إلا سائلاً';
comment on column public.assets.updated_at is
  'آخر تحديث للقيمة — قيمةٌ قديمة تجعل صافي الثروة يكذب بثقة';

create index if not exists assets_user_idx
  on public.assets (user_id, is_active);

-- التحديث التلقائي للعمود: تركُه للعميل يعني أن أي مسارٍ ينسى ضبطه
-- (استيراد، خادم MCP، سكربت) يترك تاريخاً كاذباً — والكذب هنا أسوأ من
-- الغياب لأنه يُقرأ حقيقةً.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assets_touch_updated_at on public.assets;
create trigger assets_touch_updated_at
  before update on public.assets
  for each row execute function public.touch_updated_at();

/* ── لقطات صافي الثروة ─────────────────────────────────────── */

-- الرقم الحالي وحده لا يجيب على السؤال الحقيقي: «هل أنا أتقدّم؟».
-- لقطةٌ شهرية تحوّل رقماً إلى خطّ، والخطّ هو ما يُبقي الناس على الطريق.
--
-- لماذا تُخزَّن ولا تُشتقّ: قيمة الأصل يُكتب فوقها عند التحديث، فتاريخُها
-- يضيع. لا يمكن استرجاع صافي ثروة شهرٍ مضى من جدولٍ يحمل الحاضر وحده.
create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- أول يوم في الشهر — مفتاح الشهر لا تاريخ اللقطة، تماماً كـ bill_payments.
  snapshot_month date not null,

  assets_total numeric(14, 2) not null default 0,
  -- صناديق الالتزامات: مالٌ حقيقيّ جمعه صاحبه ولم يُنفقه بعد.
  restricted_total numeric(14, 2) not null default 0,
  debts_total numeric(14, 2) not null default 0,
  net_worth numeric(14, 2) not null default 0,

  created_at timestamptz not null default now(),

  -- لقطةٌ واحدة لكل شهر: الثانية تحديثٌ للأولى لا صفٌّ جديد، وإلا صار
  -- الخطُّ البيانيّ يقفز داخل الشهر الواحد بلا معنى.
  unique (user_id, snapshot_month)
);

comment on table public.net_worth_snapshots is
  'لقطة شهرية لصافي الثروة — لأن الاتجاه يهمّ أكثر من الرقم';

create index if not exists net_worth_snapshots_user_month_idx
  on public.net_worth_snapshots (user_id, snapshot_month desc);

/* ── الفائدة على الديون ────────────────────────────────────── */

-- بدون هذا العمود يعرف التطبيق متى ينتهي الدَّين ولا يعرف كم يكلّف.
-- والفرق عمليّ لا نظريّ: من عنده دينان ودفعةٌ زائدة، ترتيبُ سدادهما
-- بالفائدة الأعلى أولاً يوفّر عليه مبلغاً حقيقياً — ولا يمكن ترتيبهما
-- بلا الرقم.
alter table public.fixed_commitments
  add column if not exists annual_interest_percent numeric(5, 2) not null default 0
    check (annual_interest_percent >= 0 and annual_interest_percent <= 100);

comment on column public.fixed_commitments.annual_interest_percent is
  'الفائدة السنوية — صفر للفاتورة، وغير صفر للقرض؛ عليها يُرتَّب السداد';

-- العرض يُعاد إنشاؤه ليحمل العمود الجديد.
--
-- والعمود الجديد في آخر القائمة لا في موضعه «المنطقي» بجانب my_share_percent:
-- ‏`create or replace view` في Postgres لا يعيد تعريف الأعمدة القائمة، إنما
-- يسمح بإلحاق أعمدةٍ بعدها فقط. إقحامُ عمودٍ في الوسط يجعل الأمر يحاول إعادة
-- تسمية `my_amount` إلى `annual_interest_percent` فيُجهض بـ
-- «cannot change name of view column» — والهجرة كلها معه، على كل قاعدةٍ
-- فيها العرض القديم.
create or replace view public.commitment_details
with (security_invoker = on) as
select
  c.id as commitment_id,
  c.user_id,
  c.name,
  c.icon,
  c.amount,
  c.ends_on,
  c.total_amount,
  c.my_share_percent,
  round(c.amount * c.my_share_percent / 100, 2) as my_amount,
  case
    when c.ends_on is null then null
    -- الدفعات المتبقية تشمل شهر الاستحقاق نفسه: قسطٌ ينتهي هذا الشهر
    -- بقيت له دفعةٌ واحدة لا صفر.
    else greatest(
      0,
      (date_part('year', c.ends_on) - date_part('year', current_date)) * 12
        + (date_part('month', c.ends_on) - date_part('month', current_date)) + 1
    )::int
  end as payments_left,
  c.annual_interest_percent
from public.fixed_commitments c
where c.is_active;

comment on view public.commitment_details is
  'حصّتي بالشيكل وعدد الدفعات المتبقية لكل بند شهري نشط';

/* ── ثوابت التخطيط ─────────────────────────────────────────── */

-- ثلاثة أرقام تحوّل «ادّخر» إلى «متى تصل»، وهي شخصيّةٌ بطبعها:
-- من يعيش على ٤٪ ليس كمن يحتاط بـ ٣٪، ومن يقرأ التضخّم عنده ٢ ليس كمن
-- يقرأه ٥. تثبيتها في الكود يجعل الرقم النهائي رأياً لا حساباً.
alter table public.profiles
  add column if not exists emergency_months int not null default 3
    check (emergency_months between 1 and 24);

alter table public.profiles
  add column if not exists withdrawal_rate_percent numeric(4, 2) not null default 4
    check (withdrawal_rate_percent > 0 and withdrawal_rate_percent <= 20);

alter table public.profiles
  add column if not exists inflation_percent numeric(4, 2) not null default 3
    check (inflation_percent >= 0 and inflation_percent <= 50);

comment on column public.profiles.emergency_months is
  'كم شهراً يجب أن يغطّيه صندوق الطوارئ من المصروف الأساسي';
comment on column public.profiles.withdrawal_rate_percent is
  'معدّل السحب الآمن — ٤٪ يعني أن رقم الحرية = المصروف السنوي × ٢٥';
comment on column public.profiles.inflation_percent is
  'التضخّم المفترض — بدونه يعِد الإسقاط بثروةٍ اسمية لا تشتري ما تعِد به';

/* ── RLS ───────────────────────────────────────────────────── */

alter table public.assets enable row level security;
alter table public.net_worth_snapshots enable row level security;

create policy "assets_all_own" on public.assets
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "net_worth_snapshots_all_own" on public.net_worth_snapshots
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
