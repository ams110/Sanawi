-- أرصدة الصناديق محسوبة من الإيداعات لا مخزّنة في عمود.
--
-- العمود المخزّن يجرف: أي إيداع يُحذف أو يُعدّل أو يُضاف من جهاز ثانٍ يترك
-- الرصيد كاذباً، وتطبيق يكذب في رصيده لا قيمة له. الحساب من المصدر أبطأ
-- نظرياً وصحيح دائماً، والأرقام هنا عشرات الصفوف لا ملايين.

create or replace view public.obligation_balances
with (security_invoker = on) as
select
  o.id as obligation_id,
  o.user_id,
  -- مجموع ما في الصندوق من الجميع — للعرض والتسوية مع الشركاء.
  coalesce(sum(d.amount), 0)::numeric(12, 2) as fund_balance,
  -- ما أودعتُه أنا وحدي — عليه يُحسب قسطي أنا.
  coalesce(sum(d.amount) filter (where d.partner_id is null), 0)::numeric(12, 2)
    as my_fund_balance,
  -- حصتي من المبلغ الكامل.
  round(o.total_amount * o.my_share_percent / 100, 2) as my_total,
  max(d.deposit_date) as last_deposit_date,
  count(d.id) as deposit_count
from public.obligations o
left join public.fund_deposits d on d.obligation_id = o.id
group by o.id, o.user_id, o.total_amount, o.my_share_percent;

comment on view public.obligation_balances is
  'أرصدة محسوبة من fund_deposits — لا عمود fund_balance مخزّن، فلا جرف';

-- تسوية الشركاء: كم يفترض أن يدفع كل شريك وكم دفع فعلاً.
create or replace view public.partner_settlements
with (security_invoker = on) as
select
  s.obligation_id,
  s.user_id,
  s.partner_id,
  p.name as partner_name,
  s.share_percent,
  round(o.total_amount * s.share_percent / 100, 2) as owed,
  coalesce(sum(d.amount), 0)::numeric(12, 2) as deposited,
  round(o.total_amount * s.share_percent / 100, 2) - coalesce(sum(d.amount), 0)
    as outstanding
from public.obligation_partner_shares s
join public.obligations o on o.id = s.obligation_id
join public.obligation_partners p on p.id = s.partner_id
left join public.fund_deposits d
  on d.obligation_id = s.obligation_id and d.partner_id = s.partner_id
group by s.obligation_id, s.user_id, s.partner_id, p.name, s.share_percent, o.total_amount;

comment on view public.partner_settlements is
  'من دفع كم ومن باقي عليه — لكل شريك في كل التزام';
