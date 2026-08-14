-- محافظ العملات الرقمية — قيمةٌ حقيقية بدل رقمٍ يُدخَل بالإصبع.
--
-- القرار سبقه قرارٌ مثله في 0017 (وارد البنك): «لا ربط API» كان محسوماً حتى
-- طلبه صاحب التطبيق صراحةً. والفرق هنا أن الكريبتو **لا تُدخَل يدوياً أصلاً
-- بصدق**: قيمتها تتحرّك كل دقيقة، فالرقم الذي يُكتب بالإصبع يكذب بعد ساعة.
--
-- والفلسفة لم تتغيّر: **لا شيء يُسجَّل من تلقائه، ولا مفتاحَ يُقرأ من الواجهة.**
-- المحفظة تصير `asset` عادياً من نوع investment، والمزامنة تحدّث `amount` و
-- `updated_at` عليه — فصافي الثروة ورقم الحرية وحارس «قيمة قديمة» تعمل كما
-- هي بلا سطرٍ واحد جديد فيها.

/* ── 1. المحفظة: صفٌّ يقرؤه صاحبه ────────────────────────────── */

-- منفصلٌ عن الأصل عمداً: الأصل رقمٌ يُعرض، وهذا وصلةٌ لها حالةُ مزامنة
-- ورسالةُ فشلٍ أخيرة — وخلطهما يجعل عطلَ شبكةٍ يبدو تغيّراً في الثروة.
create table if not exists public.crypto_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- المنصّة تحدّد المُحوِّل (adapter) في دالّة الحافة: لكلٍّ توقيعُها ومساراتها.
  exchange text not null check (
    exchange in ('binance', 'bybit', 'okx', 'kraken', 'coinbase', 'pionex')
  ),

  -- اسمٌ يقرؤه صاحبه: «بايننس الأساسي» — فمن له حسابان يميّزهما.
  label text not null,

  -- الأصل الذي تُكتب فيه القيمة. الحذف يُفرغ الوصلة ولا يمحو المحفظة:
  -- المفاتيح تبقى صالحة، ويُربط أصلٌ جديد بضغطة.
  asset_id uuid references public.assets (id) on delete set null,

  -- آخر مزامنة ناجحة ورسالة آخر فشل — الحالة تُعرَض ولا تُخمَّن.
  -- والفشل لا يمحو القيمة السابقة: رقمٌ عمره ساعة خيرٌ من صفرٍ كاذب.
  last_synced_at timestamptz,
  last_error text,

  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.crypto_wallets is
  'محافظ العملات الرقمية — الوصلة وحالتها؛ المفاتيح في جدولٍ أعمى منفصل';
comment on column public.crypto_wallets.asset_id is
  'الأصل الذي تُكتب فيه القيمة — المحفظة تغذّي أصلاً عادياً لا نوعاً جديداً';

alter table public.crypto_wallets enable row level security;

drop policy if exists "crypto_wallets_own" on public.crypto_wallets;
create policy "crypto_wallets_own" on public.crypto_wallets
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists crypto_wallets_user_idx
  on public.crypto_wallets (user_id, is_active);

-- الاسم مفتاح المطابقة عند كلود، وتكراره يجعل الاختيار قرعةً.
create unique index if not exists crypto_wallets_user_label_idx
  on public.crypto_wallets (user_id, label)
  where is_active;

/* ── 2. المفاتيح: جدولٌ أعمى ─────────────────────────────────── */

-- نفس نمط `financy_credentials` حرفاً بحرف، ولسببٍ أثقل: مفتاح منصّة تداول
-- مسروقٌ قد يعني محفظةً مسروقة. فالجدول:
--   • RLS مفعّل **بلا أي سياسة** — لا صفَّ يخرج عبر PostgREST لأي دور،
--     ولا لصاحبه: تسريب جلسته لا يسرّب مفتاح منصّته.
--   • الكتابة عبر الدالّة أدناه وحدها، والقراءة لدالّة الحافة بمفتاح الخدمة.
--
-- **والمفتاح يجب أن يكون للقراءة فقط.** التطبيق لا يتداول ولا يسحب، ومفتاحٌ
-- بصلاحية سحبٍ يضع محفظةً كاملة خلف خطأٍ برمجيّ واحد. هذا مكتوبٌ في الواجهة
-- وفي هذا التعليق لأن قارئه بعد سنة لن يعرف السبب.
create table if not exists public.crypto_credentials (
  wallet_id uuid primary key references public.crypto_wallets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  api_key text not null,
  api_secret text not null,
  -- OKX وحدها تطلب ثالثاً؛ فارغٌ لغيرها.
  passphrase text,
  updated_at timestamptz not null default now()
);

comment on table public.crypto_credentials is
  'مفاتيح منصّات التداول — جدول أعمى: RLS بلا سياسات، والمفتاح للقراءة فقط';

alter table public.crypto_credentials enable row level security;

/* ── 3. الكتابة بلا قراءة ────────────────────────────────────── */

-- من يملك المفاتيح يستطيع استبدالها ومسحها، ولا يستطيع هو ولا غيره
-- استرجاعها من الواجهة — نفس عقد `save_financy_credentials`.
create or replace function public.save_crypto_credentials(
  p_wallet_id uuid,
  p_api_key text,
  p_api_secret text,
  p_passphrase text default null
) returns void
language plpgsql
security definer
-- مسارُ البحث مثبَّت: دالّةٌ بمسارٍ متغيّر تُنفَّذ بما يجده المستدعي.
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  -- الملكية تُتحقَّق هنا لا في الواجهة: الدالّة تعمل بصلاحية مالكها، فبلا
  -- هذا الشرط يكتب أيُّ مستخدمٍ مفاتيحه على محفظة غيره.
  if not exists (
    select 1 from public.crypto_wallets w
    where w.id = p_wallet_id and w.user_id = (select auth.uid())
  ) then
    raise exception 'wallet not found';
  end if;

  if length(trim(p_api_key)) = 0 or length(trim(p_api_secret)) = 0 then
    raise exception 'empty credentials';
  end if;

  insert into public.crypto_credentials (wallet_id, user_id, api_key, api_secret, passphrase, updated_at)
  values (
    p_wallet_id,
    (select auth.uid()),
    trim(p_api_key),
    trim(p_api_secret),
    nullif(trim(coalesce(p_passphrase, '')), ''),
    now()
  )
  on conflict (wallet_id) do update
    set api_key = excluded.api_key,
        api_secret = excluded.api_secret,
        passphrase = excluded.passphrase,
        updated_at = now();
end;
$$;

comment on function public.save_crypto_credentials is
  'كتابة مفاتيح منصّة بلا إمكان قراءتها — تسريب الجلسة لا يسرّب المفتاح';

-- هل للمحفظة مفاتيح؟ سؤالٌ تحتاجه الواجهة («اربطها» أم «بدّل المفاتيح»)
-- ولا يجوز أن يُجاب بقراءة الصفّ. الجواب boolean لا أكثر.
create or replace function public.crypto_wallet_has_credentials(p_wallet_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.crypto_credentials c
    where c.wallet_id = p_wallet_id
      and c.user_id = (select auth.uid())
  );
$$;

/* ── 4. الحجب عن الزائر ───────────────────────────────────────── */

-- `security definer` تعني أن الدالّة تعمل بصلاحية مالكها، فبقاؤها مفتوحةً
-- لدور `anon` يجعلها مساراً قابلاً للنداء بلا جلسة عبر `/rest/v1/rpc/…`.
-- الحارس داخلها يردّ (`auth.uid() is null`) — لكن الطبقتين خيرٌ من واحدة،
-- وهو نفس ما فُعل بدوالّ Financy في 0017، وفحصُ Supabase الأمني يطلبه.
revoke all on function public.save_crypto_credentials(uuid, text, text, text) from public, anon;
grant execute on function public.save_crypto_credentials(uuid, text, text, text) to authenticated;

revoke all on function public.crypto_wallet_has_credentials(uuid) from public, anon;
grant execute on function public.crypto_wallet_has_credentials(uuid) to authenticated;
