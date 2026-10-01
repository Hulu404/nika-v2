-- 042_account_deletion.sql
-- Самостоятельное удаление аккаунта (DELETE /api/v2/account → auth.admin.deleteUser).
-- Удаление auth.users каскадом уносит public.users и все данные пользователя.
-- Две связи мешали этому или противоречили Политике:
--
-- 1. promo_tokens.redeemed_by ссылалась на auth.users без правила удаления:
--    пользователя, погасившего промокод, удалить было нельзя. Теперь set null.
-- 2. robokassa_payments удалялись каскадом, а Политика обещает хранить
--    платёжные записи 5 лет после года операции (54-ФЗ, НК РФ). Теперь user_id
--    обнуляется: сумма, дата, тариф и номер заказа остаются без привязки к человеку.
-- 3. link_codes.owner_user_id: тоже set null, чтобы не блокировать удаление.
--
-- Идемпотентна: связь пересоздаётся при каждом прогоне.

create or replace function pg_temp.drop_fk(tbl regclass, col text) returns void
language plpgsql as $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = tbl and contype = 'f'
    and conkey = array[(select attnum from pg_attribute where attrelid = tbl and attname = col)];
  if c is not null then
    execute format('alter table %s drop constraint %I', tbl, c);
  end if;
end $$;

select pg_temp.drop_fk('public.promo_tokens', 'redeemed_by');
alter table public.promo_tokens
  add constraint promo_tokens_redeemed_by_fkey
  foreign key (redeemed_by) references auth.users (id) on delete set null;

alter table public.robokassa_payments alter column user_id drop not null;
select pg_temp.drop_fk('public.robokassa_payments', 'user_id');
alter table public.robokassa_payments
  add constraint robokassa_payments_user_id_fkey
  foreign key (user_id) references public.users (id) on delete set null;

select pg_temp.drop_fk('public.link_codes', 'owner_user_id');
alter table public.link_codes
  add constraint link_codes_owner_user_id_fkey
  foreign key (owner_user_id) references public.users (id) on delete set null;
