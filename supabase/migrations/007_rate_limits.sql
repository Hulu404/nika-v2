-- 007_rate_limits.sql
-- Серверный rate limiting на счётчиках в Postgres (без внешней инфры).
-- Таблицу трогает только service-role клиент через функцию check_rate_limit;
-- публичных политик нет, поэтому anon/authenticated к ней доступа не имеют.

-- ── Таблица счётчиков ────────────────────────────────────────────────────────
-- key — произвольный идентификатор лимита, например "chat:<user_id>".
-- Реализуем фиксированное окно: count сбрасывается, когда окно истекло.
create table public.rate_limits (
  key          text        primary key,
  window_start timestamptz not null default now(),
  count        int         not null default 0
);

-- RLS включаем, но политик не создаём: доступ только у service-role,
-- который RLS обходит. Любой клиент с anon/authenticated ключом не увидит строк.
alter table public.rate_limits enable row level security;

-- ── Атомарная проверка и инкремент ───────────────────────────────────────────
-- Возвращает true, если запрос в пределах лимита (его можно пропустить),
-- false — если лимит исчерпан. Всё происходит одним UPSERT, поэтому гонок нет.
create or replace function public.check_rate_limit(
  p_key            text,
  p_limit          int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := now();
  v_count  int;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set
      -- Окно истекло → начинаем новое (count = 1, window_start = now).
      -- Окно активно → инкремент в рамках текущего окна.
      count = case
        when rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
          then 1
        else rate_limits.count + 1
      end,
      window_start = case
        when rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
          then v_now
        else rate_limits.window_start
      end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Доступ к функции — только service-role. Закрываем для всех остальных,
-- чтобы залогиненный пользователь не мог дёргать её с чужим ключом.
revoke all on function public.check_rate_limit(text, int, int) from public;
revoke all on function public.check_rate_limit(text, int, int) from anon;
revoke all on function public.check_rate_limit(text, int, int) from authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
