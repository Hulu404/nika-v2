-- 025_qr_promo.sql
-- QR-промо со стаканов Surf Coffee.
-- Три новые таблицы + расширение subscriptions + RPC + вью аналитики.
-- Идемпотентна: create if not exists, add column if not exists, drop/create policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. qr_codes — справочник наклеек
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.qr_codes (
  code        text        primary key,
  label       text        not null,
  quota       int         not null default 300,
  grant_days  int         not null default 21,
  is_active   bool        not null default true,
  created_at  timestamptz not null default now()
);

alter table public.qr_codes enable row level security;

-- Никаких политик: только service_role через бэкенд
insert into public.qr_codes (code, label, quota, grant_days, is_active) values
  ('SC1',    'Кофе-ран 22 августа',      300,  21, true),
  ('SC2',    'Постоянные стаканы кофейни', 1000, 21, true),
  ('SURF21', 'Аварийный офлайн-код',       200,  21, true)
on conflict (code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. qr_scans — каждое открытие ссылки с наклейки
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.qr_scans (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null references public.qr_codes (code),
  scanned_at  timestamptz not null default now(),
  user_agent  text,
  ip_hash     text,
  referer     text
);

create index if not exists qr_scans_code_idx on public.qr_scans (code);
create index if not exists qr_scans_ip_hash_idx on public.qr_scans (ip_hash);
create index if not exists qr_scans_scanned_at_idx on public.qr_scans (scanned_at);

alter table public.qr_scans enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. promo_tokens — выданные промокоды
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.promo_tokens (
  token             text        primary key,
  code              text        not null references public.qr_codes (code),
  scan_id           uuid        references public.qr_scans (id),
  status            text        not null default 'issued'
                                check (status in ('issued', 'clicked', 'redeemed', 'expired')),
  grant_days        int         not null default 21,
  issued_at         timestamptz not null default now(),
  clicked_at        timestamptz,
  redeemed_at       timestamptz,
  redeemed_by       uuid        references auth.users (id),
  token_valid_until timestamptz not null
);

-- Один скан → один токен (идемпотентность выдачи)
create unique index if not exists promo_tokens_scan_id_uniq
  on public.promo_tokens (scan_id)
  where scan_id is not null;

create index if not exists promo_tokens_code_idx        on public.promo_tokens (code);
create index if not exists promo_tokens_status_idx      on public.promo_tokens (status);
create index if not exists promo_tokens_redeemed_by_idx on public.promo_tokens (redeemed_by);

alter table public.promo_tokens enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Расширяем subscriptions: источник и ссылка на промокод
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.subscriptions
  add column if not exists source       text,   -- 'payment' | 'promo' | null
  add column if not exists promo_token  text references public.promo_tokens (token);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: атомарное погашение промокода
-- ─────────────────────────────────────────────────────────────────────────────
-- Возвращает jsonb { status: 'ok'|'not_found'|'already_redeemed'|'expired'|'already_activated', ... }
-- Никогда не бросает исключение на бизнес-кейсах — только на системных ошибках.
create or replace function public.redeem_promo_token(
  p_token   text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tok     promo_tokens%rowtype;
  v_now     timestamptz := now();
  v_end     timestamptz;
  v_sub_id  uuid;
begin
  -- Блокируем строку токена, чтобы параллельный запрос не погасил его дважды
  select * into v_tok from promo_tokens where token = p_token for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_tok.status = 'redeemed' then
    return jsonb_build_object('status', 'already_redeemed');
  end if;

  if v_tok.token_valid_until < v_now then
    -- Помечаем просроченный токен, чтобы в аналитике видеть expired
    update promo_tokens set status = 'expired' where token = p_token;
    return jsonb_build_object('status', 'expired');
  end if;

  -- Один аккаунт — одна промо-активация
  if exists (
    select 1 from subscriptions
    where user_id = p_user_id and source = 'promo'
  ) then
    return jsonb_build_object('status', 'already_activated');
  end if;

  -- Помечаем токен погашённым
  update promo_tokens set
    status      = 'redeemed',
    redeemed_at = v_now,
    redeemed_by = p_user_id
  where token = p_token;

  -- Выдаём Pro — тем же механизмом, что и Robokassa:
  -- 1) флаг на users
  -- 2) upsert subscriptions
  v_end := v_now + make_interval(days => v_tok.grant_days);

  update users set is_pro = true where id = p_user_id;

  select id into v_sub_id from subscriptions where user_id = p_user_id;

  if v_sub_id is not null then
    update subscriptions set
      plan               = 'monthly',
      status             = 'active',
      current_period_end = v_end,
      source             = 'promo',
      promo_token        = p_token,
      updated_at         = v_now
    where id = v_sub_id;
  else
    insert into subscriptions (user_id, plan, status, current_period_end, source, promo_token)
    values (p_user_id, 'monthly', 'active', v_end, 'promo', p_token);
  end if;

  return jsonb_build_object(
    'status',      'ok',
    'grant_days',  v_tok.grant_days,
    'period_end',  v_end
  );
end;
$$;

-- Доступ только service_role
revoke all on function public.redeem_promo_token(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_promo_token(text, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Крон: истечение Pro (применяется и к платным, и к промо)
-- Вызывается эндпоинтом /api/cron/expire-subscriptions раз в сутки.
-- ─────────────────────────────────────────────────────────────────────────────
-- Вью для крона — не нужна, логику пишем прямо в роуте через service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Аналитика: воронка по QR-кодам
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_qr_funnel as
select
  s.code,
  qc.label,
  date_trunc('day', s.scanned_at at time zone 'Europe/Moscow') as day,
  count(*)                                                       as scans,
  count(distinct s.ip_hash)                                      as unique_ips,
  count(pt.token)                                                as tokens_issued,
  count(pt.token) filter (where pt.status in ('clicked','redeemed','expired')) as clicks,
  count(pt.token) filter (where pt.status = 'redeemed')         as redeemed,
  count(sub.id)   filter (where sub.status = 'active'
                             and sub.current_period_end > now()) as promo_active,
  count(pt.token) filter (where pt.status = 'expired'
                            or (pt.status = 'redeemed'
                                and sub.current_period_end < now())) as promo_expired,
  -- купили платный Pro после окончания промо
  count(sub2.id)                                                 as converted_to_paid
from public.qr_scans s
join public.qr_codes  qc on qc.code = s.code
left join public.promo_tokens pt  on pt.scan_id = s.id
left join public.subscriptions sub on sub.promo_token = pt.token
-- конверсия: есть платная оплата созданная позже промо
left join public.robokassa_payments sub2
       on sub2.user_id = pt.redeemed_by
      and sub2.status  = 'paid'
      and sub2.paid_at > pt.redeemed_at
group by s.code, qc.label, date_trunc('day', s.scanned_at at time zone 'Europe/Moscow');

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Аналитика: сверка с регистрациями на кофе-ран
-- ─────────────────────────────────────────────────────────────────────────────
-- coffee_run_signups.email (varchar) ↔ auth.users.email (через public.users)
create or replace view public.v_coffeerun_promo as
select
  cr.email                                               as signup_email,
  cr.name                                                as signup_name,
  cr.contact                                             as signup_contact,
  cr.source                                              as signup_source,
  cr.created_at                                          as signup_at,
  pt.token                                               as promo_token,
  pt.status                                              as token_status,
  pt.issued_at,
  pt.redeemed_at,
  case when cr.email is not null and pt.token is not null
       then 'участник_забега'
       else 'гость_кофейни'
  end                                                    as segment
from public.promo_tokens pt
join public.users u         on u.id = pt.redeemed_by
left join public.coffee_run_signups cr
       on lower(trim(cr.email)) = lower(trim(u.email));
