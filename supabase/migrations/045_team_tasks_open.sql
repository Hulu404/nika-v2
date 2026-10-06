-- 045_team_tasks_open.sql
-- «Пятница» v2: задачи ставит любой участник, правит и отменяет только автор.
-- Применять после 044_databot_assigned_multi_recipient.sql.
--
-- Что меняется:
--   • databot_assigned_import: автор — любой действующий участник databot_members
--     (раньше только is_owner);
--   • databot_assigned_status: отменить задачу может только её автор
--     (assigned_by), статусы по-прежнему отмечает только исполнитель;
--   • databot_assigned_edit: текст и срок правит только автор; смена срока
--     сбрасывает все отметки напоминаний;
--   • отметки напоминаний за 24, 12 и 3 часа до срока; старый reminded_at
--     остаётся, но больше не используется;
--   • databot_assigned_mine: задачи, где человек автор или исполнитель. Других
--     задач не видит никто, в том числе фаундеры.
--
-- Идемпотентна: add column if not exists, create or replace function.
begin;

alter table public.databot_assigned_tasks
  add column if not exists reminded_24_at timestamptz,
  add column if not exists reminded_12_at timestamptz,
  add column if not exists reminded_3_at timestamptz;

create index if not exists databot_assigned_tasks_author_idx
  on public.databot_assigned_tasks(assigned_by, created_at desc);

create or replace function public.databot_assigned_import(p_owner bigint, p_message bigint, p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  recipient bigint;
  recipients bigint[] := array[]::bigint[];
  n integer := 0;
begin
  -- Автор — любой действующий участник. Имя параметра p_owner осталось от
  -- прежней схемы, чтобы не менять сигнатуру и гранты.
  if not exists(select 1 from databot_members where chat_id=p_owner and is_active) then
    raise exception 'assigned:owner';
  end if;
  if p_message <= 0 or jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) not between 1 and 50 then
    raise exception 'assigned:format';
  end if;
  if exists(select 1 from jsonb_array_elements(p_tasks) incoming
      group by incoming->>'line', incoming->>'username' having count(*) > 1) then
    raise exception 'assigned:format';
  end if;
  if (select count(*) from databot_assigned_tasks
      where source_chat_id=p_owner and source_message_id=p_message) not in (0, jsonb_array_length(p_tasks))
     or exists(select 1 from databot_assigned_tasks old
       where old.source_chat_id=p_owner and old.source_message_id=p_message
         and not exists(select 1 from jsonb_array_elements(p_tasks) incoming
           where (incoming->>'line')::integer=old.line and incoming->>'username'=old.username
             and incoming->>'what'=old.what)) then
    raise exception 'assigned:source_changed';
  end if;
  for item in select value from jsonb_array_elements(p_tasks) loop
    n := n + 1;
    if (item->>'line')::integer <= 0 or item->>'username' !~ '^[a-z0-9_]{1,32}$'
       or length(trim(item->>'what')) not between 1 and 3000 then
      raise exception 'assigned:format';
    end if;
    select min(chat_id) into recipient from databot_members
      where is_active and lower(regexp_replace(username, '^@', '')) = item->>'username'
      having count(*) = 1;
    if recipient is null then raise exception 'assigned:identity:%', item->>'line'; end if;
    recipients := array_append(recipients, recipient);
  end loop;
  n := 0;
  for item in select value from jsonb_array_elements(p_tasks) loop
    n := n + 1;
    insert into databot_assigned_tasks(source_chat_id, source_message_id, line, assigned_by,
      assignee_id, username, what, due_at)
    values(p_owner, p_message, (item->>'line')::integer, p_owner, recipients[n],
      item->>'username', item->>'what', nullif(item->>'due_at', '')::timestamptz)
    on conflict(source_chat_id, source_message_id, line, username) do nothing;
  end loop;
  if (select count(*) from databot_assigned_tasks
      where source_chat_id=p_owner and source_message_id=p_message) <> jsonb_array_length(p_tasks)
     or exists(select 1 from databot_assigned_tasks old
       where old.source_chat_id=p_owner and old.source_message_id=p_message
         and not exists(select 1 from jsonb_array_elements(p_tasks) incoming
           where (incoming->>'line')::integer=old.line and incoming->>'username'=old.username
             and incoming->>'what'=old.what)) then
    raise exception 'assigned:source_changed';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.line, t.id), '[]'::jsonb)
    from databot_assigned_tasks t where t.source_chat_id=p_owner and t.source_message_id=p_message);
end;
$$;

-- Смена статуса. take/done/decline/reopen — только сам исполнитель,
-- cancel — только автор задачи. Повтор того же действия ничего не меняет.
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
    if t.assigned_by <> p_actor then raise exception 'assigned:actor'; end if;
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

-- Правка автором: текст и/или срок. Смена срока сбрасывает все отметки
-- напоминаний и просрочки: о новом сроке надо напомнить заново.
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
  if t.assigned_by <> p_owner then raise exception 'assigned:actor'; end if;
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

-- Отметка «напомнили». r24 / r12 / r3 — пороги до срока, overdue — просрочка,
-- reminder — старая единственная отметка (для бота данных без «Пятницы»).
-- true — отметку поставил именно этот вызов: только он и шлёт сообщение.
create or replace function public.databot_assigned_notice(p_id bigint, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_kind = 'r24' then
    update databot_assigned_tasks set reminded_24_at=now()
      where id=p_id and reminded_24_at is null and status in ('open','taken');
  elsif p_kind = 'r12' then
    update databot_assigned_tasks set reminded_12_at=now()
      where id=p_id and reminded_12_at is null and status in ('open','taken');
  elsif p_kind = 'r3' then
    update databot_assigned_tasks set reminded_3_at=now()
      where id=p_id and reminded_3_at is null and status in ('open','taken');
  elsif p_kind = 'reminder' then
    update databot_assigned_tasks set reminded_at=now()
      where id=p_id and reminded_at is null and status in ('open','taken');
  elsif p_kind = 'overdue' then
    update databot_assigned_tasks set overdue_notified_at=now()
      where id=p_id and overdue_notified_at is null and status in ('open','taken');
  else raise exception 'assigned:format'; end if;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- Задачи человека: где он исполнитель или автор. Чужие задачи не видит никто.
create or replace function public.databot_assigned_mine(p_user bigint)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc), '[]'::jsonb)
  from databot_assigned_tasks t
  where t.assignee_id = p_user or t.assigned_by = p_user;
$$;

revoke all on function public.databot_assigned_import(bigint,bigint,jsonb),
  public.databot_assigned_status(bigint,bigint,text),
  public.databot_assigned_edit(bigint,bigint,text,boolean,timestamptz),
  public.databot_assigned_notice(bigint,text),
  public.databot_assigned_mine(bigint)
  from public, anon, authenticated;
grant execute on function public.databot_assigned_import(bigint,bigint,jsonb),
  public.databot_assigned_status(bigint,bigint,text),
  public.databot_assigned_edit(bigint,bigint,text,boolean,timestamptz),
  public.databot_assigned_notice(bigint,text),
  public.databot_assigned_mine(bigint)
  to service_role;
commit;
