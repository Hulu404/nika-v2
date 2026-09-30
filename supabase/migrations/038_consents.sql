-- 038_consents.sql
-- Журнал согласий и их отзывов (152-ФЗ ст. 9: оператор должен уметь доказать
-- факт, время и текст согласия). Строки только добавляются: отзыв это новая
-- строка granted = false, а не правка старой. Актуальное состояние по типу
-- это последняя по created_at строка.
--
-- type:
--   offer              принятие Публичной оферты (/legal/oferta)
--   pd                 согласие на обработку персональных данных (/legal/consent)
--   health             отдельное согласие на сведения о здоровье (раздел 4 /legal/consent)
--   cookies_analytics  согласие на аналитические cookie (Метрика, Amplitude)
-- version: редакция документа на момент согласия (см. lib/legal.ts, LEGAL_VERSION).
-- ip, user_agent: заполняет сервер из заголовков запроса, клиент их не присылает.
-- source: где дано согласие (signup, signup_confirm, health_gate, profile, cookie_banner).
--
-- ДОСТУП: пишет только service_role (через POST /api/consents), чтобы пользователь
-- не мог задним числом вставить себе строку с чужим IP. Читать свои строки можно
-- (RLS select). Политик на insert/update/delete нет намеренно.
--
-- user_id ссылается на auth.users с каскадом: при удалении аккаунта журнал
-- уничтожается вместе с остальными данными, как обещано в Политике.
--
-- Идемпотентна: повторный прогон проходит без ошибок.

create table if not exists public.consents (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('offer', 'pd', 'health', 'cookies_analytics')),
  version     text not null,
  granted     boolean not null,
  created_at  timestamptz not null default now(),
  ip          text,
  user_agent  text,
  source      text
);

create index if not exists consents_user_type_created_idx
  on public.consents (user_id, type, created_at desc);

alter table public.consents enable row level security;

drop policy if exists "Users can read own consents" on public.consents;
create policy "Users can read own consents" on public.consents
  for select using (auth.uid() = user_id);

revoke all on public.consents from anon;
revoke insert, update, delete on public.consents from authenticated;
grant select on public.consents to authenticated;
