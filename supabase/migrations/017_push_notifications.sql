-- 017_push_notifications.sql
-- Поля расписания уведомлений в profiles + таблица web-push подписок.

-- notif_time: время суток для плановых пушей (например '08:00').
alter table public.profiles
  add column if not exists notif_time  time    default '08:00',
  add column if not exists notif_frequency text  default 'daily'
    check (notif_frequency in ('daily','every_other_day','weekdays','weekly','biweekly','monthly'));

-- Web Push-подписки: одна строка на устройство.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "Users can manage own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Сервисный роль нужен для отправки: читает все подписки.
create policy "Service role can read all push subscriptions"
  on public.push_subscriptions
  for select
  using (true);
