# قاعدة البيانات

## التطبيق

افتح [Supabase Dashboard](https://supabase.com/dashboard) → مشروعك → **SQL Editor** →
والصق محتوى كل ملف بالترتيب واضغط Run:

```
0001_profiles_and_groups.sql
0002_obligations.sql
0003_income_and_expenses.sql
0004_templates.sql
0005_events.sql
0006_balances_view.sql
```

كل الملفات آمنة للتكرار (`if not exists` / `create or replace`)، ولا يوجد فيها
أي `drop` أو `delete` أو `truncate` — تشغيلها مرتين لا يفقد بيانات.

## بعد التطبيق

من **Settings → API** انسخ:

| القيمة | إلى |
|---|---|
| Project URL | `VITE_SUPABASE_URL` |
| anon / publishable key | `VITE_SUPABASE_ANON_KEY` |

وضعهما في ملف `.env` في جذر المشروع (متجاهَل من git). المفتاح العام مصمَّم
للواجهة ولا يمنح صلاحية تجاوز RLS؛ الحماية كلها في سياسات RLS لا في إخفائه.

## القرارات

**كل جدول عليه `user_id` و RLS** — حتى والمستخدم واحد. إضافته لاحقاً على
بيانات قائمة أصعب بكثير من كتابته اليوم.

**لا عمود `fund_balance` مخزّن.** الرصيد يُحسب من `fund_deposits` عبر
`obligation_balances`. العمود المخزّن يجرف عن الحقيقة مع أول تعديل أو حذف
أو مزامنة من جهاز ثانٍ، وتطبيق يكذب في رصيده لا قيمة له.

**العملة واللغة والدولة أعمدة لا ثوابت.** التوسّع لدولة أخرى إضافةُ صفوف في
`obligation_templates` لا تعديلُ سكيما.

**الشركاء أسماء يملكها المستخدم لا حسابات مستقلة.** هذا يكفي لتتبّع من دفع
ماذا (`fund_deposits.partner_id`) ومن باقٍ عليه (`partner_settlements`) دون
بناء نظام صلاحيات متعدد المستخدمين.

**`my_share_percent + مجموع حصص الشركاء = 100`** يتحقق منه التطبيق عند الحفظ
لا قيدٌ في القاعدة: القيد سيفشل في منتصف تعديل متعدد الصفوف.
