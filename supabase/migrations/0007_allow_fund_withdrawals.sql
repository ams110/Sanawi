-- السماح بالسحب من الصندوق عند الدفع.
--
-- عند دفع الالتزام يُفرَّغ الصندوق. الطريقة المختارة قيدٌ سالب في fund_deposits
-- لا حذفُ الإيداعات: الحذف يمحو تاريخ من دفع ماذا، وهو بالضبط ما بُني تتبّع
-- الشركاء لأجله. القيد القديم (amount > 0) كان يرفض ذلك.
--
-- هذا يغيّر قيداً ولا يمسّ صفاً واحداً من البيانات: لا حذف ولا تعديل قيم.

alter table public.fund_deposits
  drop constraint if exists fund_deposits_amount_check;

alter table public.fund_deposits
  add constraint fund_deposits_amount_check check (amount <> 0);

comment on column public.fund_deposits.amount is
  'موجب = إيداع، سالب = سحب عند دفع الالتزام. الصفر مرفوض لأنه لا يعني شيئاً.';
