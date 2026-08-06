-- تتبّع الفواتير الشهرية.
--
-- fixed_commitments كان رقماً للميزانية فقط: كم أتوقّع أن أدفع للكهرباء شهرياً.
-- لكن الفاتورة الحقيقية تتغيّر كل شهر، والسؤال العملي "هل دفعتُها؟ وبكم؟"
-- لم يكن له جواب. هذا الجدول يحفظ الواقع بجانب التوقّع.

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  commitment_id uuid not null references public.fixed_commitments (id) on delete cascade,
  -- أول يوم في الشهر يمثّل الشهر كله: تاريخ كامل يقبل المقارنة والترتيب
  -- بلا حيل نصّية، وسطر واحد لكل شهر يمنع التكرار من الأساس.
  billing_month date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_at date,
  note text,
  created_at timestamptz not null default now(),
  unique (commitment_id, billing_month)
);

comment on table public.bill_payments is
  'فاتورة شهر واحد لبند ثابت: المبلغ الفعلي، وهل دُفع';
comment on column public.bill_payments.billing_month is
  'أول يوم في الشهر — مفتاح الشهر لا تاريخ الفاتورة';
comment on column public.bill_payments.paid_at is
  'فارغ = مسجّلة ولم تُدفع بعد';

create index if not exists bill_payments_user_month_idx
  on public.bill_payments (user_id, billing_month desc);
create index if not exists bill_payments_commitment_idx
  on public.bill_payments (commitment_id, billing_month desc);

alter table public.bill_payments enable row level security;

drop policy if exists "bill_payments_all_own" on public.bill_payments;
create policy "bill_payments_all_own" on public.bill_payments
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- متوسط ما دُفع فعلاً لكل بند خلال آخر 12 شهراً.
-- يكشف الفجوة بين المبلغ المقدَّر في الميزانية والواقع، وهي الفجوة التي
-- تجعل المستخدم يظن نفسه مرتاحاً وهو ليس كذلك.
create or replace view public.bill_averages
with (security_invoker = on) as
select
  c.id as commitment_id,
  c.user_id,
  c.name,
  c.amount as budgeted_amount,
  count(b.id) filter (where b.paid_at is not null) as paid_count,
  coalesce(round(avg(b.amount) filter (where b.billing_month >= (current_date - interval '12 months')), 2), 0)
    as average_amount
from public.fixed_commitments c
left join public.bill_payments b on b.commitment_id = c.id
where c.is_active
group by c.id, c.user_id, c.name, c.amount;

comment on view public.bill_averages is
  'المبلغ المقدَّر مقابل المتوسط الفعلي لآخر 12 شهراً';
