-- قوالب الالتزامات — جدول عام بلا user_id، قراءة فقط.
--
-- مستخدم جديد لا يكتب "تأمين السيارة" من الصفر: يختار من قائمة فتصله
-- لحظة "آها" في أقل من دقيقتين. العمود country يجعل التوسّع لدول أخرى
-- إضافةَ صفوف لا تعديلَ سكيما.

create table if not exists public.obligation_templates (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_he text,
  name_en text,
  category text not null,
  icon text,
  default_recurrence_months int not null default 12,
  suggested_min numeric(12, 2),
  suggested_max numeric(12, 2),
  country text not null default 'IL',
  sort_order int not null default 100
);

create index if not exists obligation_templates_country_idx
  on public.obligation_templates (country, sort_order);

alter table public.obligation_templates enable row level security;

-- قراءة فقط ولكل المستخدمين المسجّلين. لا سياسة كتابة: الصفوف تُدار بالهجرات.
create policy "templates_read_all" on public.obligation_templates
  for select to authenticated using (true);

insert into public.obligation_templates
  (name_ar, name_he, name_en, category, icon, default_recurrence_months, suggested_min, suggested_max, country, sort_order)
values
  ('تأمين السيارة',      'ביטוח רכב',       'Car insurance',     'car',       '🚗', 12, 2500, 9000,  'IL', 10),
  ('טסט (فحص سنوي)',    'טסט שנתי',        'Annual test',       'car',       '🔧', 12,  400,  900,  'IL', 20),
  ('טיפול (صيانة)',      'טיפול תקופתי',    'Service',           'car',       '🛠️',  6,  600, 2500,  'IL', 30),
  ('إطارات',             'צמיגים',          'Tires',             'car',       '⚙️', 24, 1200, 3500,  'IL', 40),
  ('رسائل الترخيص',      'אגרת רישוי',      'Vehicle licence',   'car',       '📄', 12,  500, 1500,  'IL', 50),
  ('تأمين صحي مكمّل',     'ביטוח משלים',     'Health insurance',  'health',    '🏥', 12,  600, 2400,  'IL', 60),
  ('طبيب أسنان',         'טיפול שיניים',    'Dentist',           'health',    '🦷', 12,  500, 3000,  'IL', 70),
  ('نظارات',             'משקפיים',         'Glasses',           'health',    '👓', 24,  400, 2000,  'IL', 80),
  ('أعراس ومناسبات',     'חתונות ואירועים', 'Weddings & events', 'events',    '💍', 12, 1500, 8000,  'IL', 90),
  ('أعياد وهدايا',       'חגים ומתנות',     'Holidays & gifts',  'events',    '🎁', 12,  800, 4000,  'IL', 100),
  ('سفر وإجازة',         'טיול וחופשה',     'Travel',            'lifestyle', '✈️', 12, 2000, 12000, 'IL', 110),
  ('ضريبة الأرنونا',      'ארנונה',          'Municipal tax',     'home',      '🏠',  6,  800, 4000,  'IL', 120),
  ('صيانة البيت',        'תחזוקת בית',      'Home maintenance',  'home',      '🔨', 12,  500, 5000,  'IL', 130),
  ('اشتراكات سنوية',     'מנויים שנתיים',   'Annual subscriptions', 'other',  '💳', 12,  200, 2000,  'IL', 140),
  ('طوارئ وأعطال',       'תקלות ובלת"מ',    'Emergencies',       'other',     '🚨', 12, 1000, 6000,  'IL', 150)
on conflict do nothing;
