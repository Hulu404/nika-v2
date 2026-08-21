-- 026_qr_direct_code.sql
-- Код DIRECT для прямых заходов на /activate (без ?c= и без cookie nika_src).
-- Фронт в этом случае шлёт code="direct" (ActivateClient.tsx), бэкенд апперкейсит
-- его в DIRECT; без этой строки /api/promo/issue отдавал 410 "Promo closed"
-- и страница показывала «раздача закрыта».
-- Идемпотентна.

insert into public.qr_codes (code, label, quota, grant_days, is_active) values
  ('DIRECT', 'Прямой заход на /activate', 500, 21, true)
on conflict (code) do update set is_active = true;
