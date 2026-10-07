-- 048_team_founders_tasks.sql
-- «Пятница» v2, дополнение: фаундеры видят и меняют все задачи команды.
-- Применять после 045_team_tasks_open.sql.
--
-- Фаундер — databot_members.is_owner: «Пятница» пишет туда признак фаундера
-- (TEAM_FOUNDER_IDS, без неё DATABOT_OWNER_IDS) при каждой синхронизации.
-- Отменить и поменять срок теперь может автор задачи или фаундер; статус
-- по-прежнему отмечает только исполнитель. Видимость задач для фаундеров
-- решает бот (databot_assigned_overview уже есть с 043).
--
-- Идемпотентна: create or replace function.
begin;

create or replace function public.databot_assigned_status(p_id bigint, p_actor bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t databot_assigned_tasks%rowtype;
  target text;
  allowed text[];
begin
  select * into t from databot_assigned_tasks where id=p_id for update;
  if not found then raise exception 'assigned:missing'; end if;
  if not exists(select 1 from databot_members where chat_id=p_actor and is_active) then
    raise exception 'assigned:actor';
  end if;
  if p_action = 'cancel' then
    if t.assigned_by <> p_actor
       and not exists(select 1 from databot_members where chat_id=p_actor and is_active and is_owner) then
      raise exception 'assigned:actor';
    end if;
    target := 'cancelled'; allowed := array['open','taken','declined'];
  else
    if t.assignee_id <> p_actor then raise exception 'assigned:actor'; end if;
    if p_action = 'take' then target := 'taken'; allowed := array['open'];
    elsif p_action = 'done' then target := 'done'; allowed := array['open','taken'];
    elsif p_action = 'decline' then target := 'declined'; allowed := array['open','taken'];
    elsif p_action = 'reopen' then target := 'taken'; allowed := array['done','declined'];
    else raise exception 'assigned:format'; end if;
  end if;
  if t.status = target then
    return jsonb_build_object('task', to_jsonb(t), 'previous', t.status);
  end if;
  if not (t.status = any(allowed)) then raise exception 'assigned:state'; end if;
  update databot_assigned_tasks set status=target, status_at=now() where id=p_id;
  return jsonb_build_object('task', (select to_jsonb(a) from databot_assigned_tasks a where id=p_id),
    'previous', t.status);
end;
$$;

-- Правка автором или фаундером. Смена срока сбрасывает все отметки напоминаний.
create or replace function public.databot_assigned_edit(p_id bigint, p_owner bigint, p_what text,
  p_set_due boolean, p_due timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t databot_assigned_tasks%rowtype;
begin
  if not exists(select 1 from databot_members where chat_id=p_owner and is_active) then
    raise exception 'assigned:actor';
  end if;
  select * into t from databot_assigned_tasks where id=p_id for update;
  if not found then raise exception 'assigned:missing'; end if;
  if t.assigned_by <> p_owner
     and not exists(select 1 from databot_members where chat_id=p_owner and is_active and is_owner) then
    raise exception 'assigned:actor';
  end if;
  if t.status not in ('open','taken') then raise exception 'assigned:state'; end if;
  if p_what is not null and length(trim(p_what)) not between 1 and 3000 then
    raise exception 'assigned:format';
  end if;
  update databot_assigned_tasks set
    what = coalesce(p_what, what),
    due_at = case when p_set_due then p_due else due_at end,
    reminded_at = case when p_set_due then null else reminded_at end,
    reminded_24_at = case when p_set_due then null else reminded_24_at end,
    reminded_12_at = case when p_set_due then null else reminded_12_at end,
    reminded_3_at = case when p_set_due then null else reminded_3_at end,
    overdue_notified_at = case when p_set_due then null else overdue_notified_at end
  where id=p_id;
  return (select to_jsonb(a) from databot_assigned_tasks a where id=p_id);
end;
$$;

revoke all on function public.databot_assigned_status(bigint,bigint,text),
  public.databot_assigned_edit(bigint,bigint,text,boolean,timestamptz)
  from public, anon, authenticated;
grant execute on function public.databot_assigned_status(bigint,bigint,text),
  public.databot_assigned_edit(bigint,bigint,text,boolean,timestamptz)
  to service_role;
commit;
