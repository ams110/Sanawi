-- الفواتير الشهرية: أيقونة، ونهاية للأقساط، وحصص شركاء.
--
-- ثلاث حاجاتٍ يجمعها أن fixed_commitments كان اسماً ومبلغاً فحسب:
--   1) الفاتورة بلا أيقونة تُقرأ بالنص وحده، وشاشةٌ من عشرة أسطر نصّية
--      تُمسح بالعين ولا تُقرأ.
--   2) قرض السيارة فاتورةٌ شهرية بكل شيء إلا أنه ينتهي. جدولٌ مستقلّ له
--      يكرّر تتبّع الدفع والشركاء واللوحة؛ عمودُ نهايةٍ يكفي.
--   3) فاتورة البيت تُقسَم مع شريك تماماً كما يُقسَم التأمين، والقسمة
--      موجودة للالتزامات وحدها.

alter table public.fixed_commitments
  add column if not exists icon text;

-- تاريخ آخر دفعة. فارغ = متكرّر بلا نهاية (كهرباء، إنترنت).
-- غير فارغ = قسط أو دين ينتهي، فيُعرض معه "بقي كذا دفعة".
alter table public.fixed_commitments
  add column if not exists ends_on date;

-- المبلغ الكلّي للقرض — للعرض والسياق لا للحساب: القسط الشهري هو amount،
-- وعدد الدفعات يُشتقّ من ends_on. تخزينُ الثلاثة يفتح باب تناقضها.
alter table public.fixed_commitments
  add column if not exists total_amount numeric(12, 2)
    check (total_amount is null or total_amount >= 0);

-- حصّتي من الفاتورة. الباقي على الشركاء في commitment_partner_shares،
-- مطابقةً لما في obligations حرفاً بحرف حتى يبقى المفهوم واحداً.
alter table public.fixed_commitments
  add column if not exists my_share_percent numeric(5, 2) not null default 100
    check (my_share_percent > 0 and my_share_percent <= 100);

comment on column public.fixed_commitments.ends_on is
  'آخر دفعة — فارغ يعني متكرّر بلا نهاية';
comment on column public.fixed_commitments.total_amount is
  'أصل الدين للعرض؛ الحساب يقوم على amount و ends_on';

-- الشريك نفسه المستعمل في الالتزامات: obligation_partners. لا جدول شركاء
-- ثانٍ — الشريك شخصٌ واحد سواء قاسمك التأمين أو فاتورة الكهرباء.
create table if not exists public.commitment_partner_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  commitment_id uuid not null references public.fixed_commitments (id) on delete cascade,
  partner_id uuid not null references public.obligation_partners (id) on delete cascade,
  share_percent numeric(5, 2) not null
    check (share_percent > 0 and share_percent <= 100),
  unique (commitment_id, partner_id)
);

comment on table public.commitment_partner_shares is
  'حصص الشركاء في فاتورة شهرية — نظيرة obligation_partner_shares';

create index if not exists commitment_shares_commitment_idx
  on public.commitment_partner_shares (commitment_id);

alter table public.commitment_partner_shares enable row level security;

drop policy if exists "commitment_partner_shares_all_own" on public.commitment_partner_shares;
create policy "commitment_partner_shares_all_own" on public.commitment_partner_shares
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- قوالب البنود الشهرية. جدولٌ مستقلّ عن obligation_templates لا عمودُ نوعٍ
-- فيه: الأعمدة تختلف فعلاً — القالب السنوي يحمل دورةً ومبلغاً مقترحاً
-- للسنة، والشهريّ يحمل مبلغاً مقترحاً للشهر وصفةَ "هل ينتهي".
create table if not exists public.commitment_templates (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_he text,
  name_en text,
  category text not null,
  icon text not null,
  suggested_min numeric(12, 2),
  suggested_max numeric(12, 2),
  -- قالبُ قرضٍ يفتح حقل تاريخ النهاية عند الاختيار.
  is_installment boolean not null default false,
  country text not null default 'IL',
  sort_order int not null default 100
);

create index if not exists commitment_templates_country_idx
  on public.commitment_templates (country, sort_order);

alter table public.commitment_templates enable row level security;

drop policy if exists "commitment_templates_read_all" on public.commitment_templates;
create policy "commitment_templates_read_all" on public.commitment_templates
  for select to authenticated using (true);

insert into public.commitment_templates
  (name_ar, name_he, name_en, category, icon, suggested_min, suggested_max, is_installment, country, sort_order)
values
  ('كهرباء',          'חשמל',          'Electricity',   'home',    '💡',  150, 900, false, 'IL', 10),
  ('مي',              'מים',           'Water',         'home',    '💧',   80, 400, false, 'IL', 20),
  ('غاز',             'גז',            'Gas',           'home',    '🔥',   50, 300, false, 'IL', 30),
  ('إنترنت',          'אינטרנט',       'Internet',      'home',    '🌐',   80, 250, false, 'IL', 40),
  ('تلفون',           'סלולר',         'Mobile',        'home',    '📱',   30, 200, false, 'IL', 50),
  ('أرنونا',          'ארנונה',        'Municipal tax', 'home',    '🏛️',  200, 900, false, 'IL', 60),
  ('إيجار',           'שכר דירה',      'Rent',          'home',    '🏠', 2000, 8000, false, 'IL', 70),
  ('واد بيت',         'ועד בית',       'Building fee',  'home',    '🏢',   50, 400, false, 'IL', 80),
  ('اشتراكات رقمية',  'מנויים דיגיטליים', 'Subscriptions', 'other', '📺',  20, 200, false, 'IL', 90),
  ('نادي رياضي',      'חדר כושר',      'Gym',           'other',   '🏋️',  100, 400, false, 'IL', 100),
  ('مساعدة الأهل',    'עזרה למשפחה',   'Family support','other',   '👨‍👩‍👦', 200, 3000, false, 'IL', 110),
  ('قرض سيارة',       'הלוואת רכב',    'Car loan',      'debt',    '🚗',  500, 4000, true,  'IL', 120),
  ('قرض شخصي',        'הלוואה אישית',  'Personal loan', 'debt',    '🏦',  300, 5000, true,  'IL', 130),
  ('تقسيط جهاز',      'תשלומים למכשיר','Device instalment','debt', '📦',  100, 1500, true,  'IL', 140),
  ('دين لحدا',        'חוב לחבר',      'Debt to a friend','debt',  '🤝',  100, 3000, true,  'IL', 150)
on conflict do nothing;

-- حصّتي بالشيكل من كل بند نشط، وكم دفعة بقيت إن كان له نهاية.
-- الحساب في العرض لا في الواجهة: سطرٌ واحد يخدم كل شاشة تسأل السؤال نفسه.
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
  end as payments_left
from public.fixed_commitments c
where c.is_active;

comment on view public.commitment_details is
  'حصّتي بالشيكل وعدد الدفعات المتبقية لكل بند شهري نشط';
