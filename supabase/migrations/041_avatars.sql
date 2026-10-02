-- 041_avatars.sql
-- Аватар в профиле (правка 12 брифа 2026-10-02).
--
-- profiles.avatar_url:
--   'photo:<путь>?v=<версия>'  своё фото в Storage, бакет avatars, путь {user_id}/avatar.webp
--                               (или avatar.jpg, если браузер не умеет WebP);
--   'preset:<1..8>'             готовый аватар (кадр сцены приложения с первой буквой имени);
--   NULL                        нет фото: первая буква имени на терракоте.
--
-- Бакет приватный. Читать и писать свои файлы может только владелец (папка = его user_id).
-- Приложение получает картинку через GET /api/v2/avatar с сессией, публичных ссылок нет.
-- Идемпотентна.

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 204800, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 204800, allowed_mime_types = array['image/webp', 'image/jpeg'];

drop policy if exists "Avatars: owner can read" on storage.objects;
create policy "Avatars: owner can read" on storage.objects
  for select using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Avatars: owner can insert" on storage.objects;
create policy "Avatars: owner can insert" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Avatars: owner can update" on storage.objects;
create policy "Avatars: owner can update" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Avatars: owner can delete" on storage.objects;
create policy "Avatars: owner can delete" on storage.objects
  for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
