-- Жизненный цикл задач из /assign: статус, срок, напоминания.
-- Применять после 040_databot_assigned_tasks.sql.
begin;

alter table public.databot_assigned_tasks
  add column if not exists status text not null default 'open'
    check (status in ('open','taken','done','declined','cancelled')),
  add column if not exists status_at timestamptz not null default now(),
  add column if not exists due_at timestamptz,
  -- Отметки «уже напомнили» — дедуп тикера: он делает первый проход на каждом деплое.
  add column if not exists reminded_at timestamptz,
  add column if not exists overdue_notified_at timestamptz;

create index if not exists databot_assigned_tasks_due_idx
  on public.databot_assigned_tasks(due_at)
  where status in ('open','taken') and due_at is not null and overdue_notified_at is null;

-- Тот же импорт, что в 040, плюс необязательный due_at. Срок в сравнение
-- «то же ли это сообщение» не входит: относительный срок («до завтра») при
-- повторной обработке на следующий день дал бы другой момент.
create or replace function public.databot_assigned_import(p_owner bigint, p_message bigint, p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  recipient bigint;
  recipients bigint[] := array[]::bigint[];
  n integer := 0;
begin
  if not exists(select 1 from databot_members where chat_id=p_owner and is_active and is_owner) then
    raise exception 'assigned:owner';
  end if;
  if p_message <= 0 or jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) not between 1 and 50 then
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
    on conflict(source_chat_id, source_message_id, line) do nothing;
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
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.line), '[]'::jsonb)
    from databot_assigned_tasks t where t.source_chat_id=p_owner and t.source_message_id=p_message);
end;
$$;

-- Смена статуса. take/done/decline/reopen — только сам исполнитель,
-- cancel — любой действующий владелец. Повтор того же действия ничего не
-- меняет и возвращает previous = текущий статус: двойное нажатие не шлёт
-- владельцу второе уведомление.
create or replace function public.databot_assigned_status(p_id bigint, p_actor bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t databot_assigned_tasks%rowtype;
  target text;
  allowed text[];
begin
  select * into t from databot_assigned_tasks where id=p_id for update;
  if not found then raise exception 'assigned:missing'; end if;
  if p_action = 'cancel' then
    if not exists(select 1 from databot_members where chat_id=p_actor and is_active and is_owner) then
      raise exception 'assigned:actor';
    end if;
    target := 'cancelled'; allowed := array['open','taken','declined'];
  else
    if t.assignee_id <> p_actor
       or not exists(select 1 from databot_members where chat_id=p_actor and is_active) then
      raise exception 'assigned:actor';
    end if;
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

-- Правка владельцем: текст и/или срок. Смена срока сбрасывает отметки
-- напоминаний — о новом сроке надо напомнить заново.
create or replace function public.databot_assigned_edit(p_id bigint, p_owner bigint, p_what text,
  p_set_due boolean, p_due timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t databot_assigned_tasks%rowtype;
begin
  if not exists(select 1 from databot_members where chat_id=p_owner and is_active and is_owner) then
    raise exception 'assigned:actor';
  end if;
  select * into t from databot_assigned_tasks where id=p_id for update;
  if not found then raise exception 'assigned:missing'; end if;
  if t.status not in ('open','taken') then raise exception 'assigned:state'; end if;
  if p_what is not null and length(trim(p_what)) not between 1 and 3000 then
    raise exception 'assigned:format';
  end if;
  update databot_assigned_tasks set
    what = coalesce(p_what, what),
    due_at = case when p_set_due then p_due else due_at end,
    reminded_at = case when p_set_due then null else reminded_at end,
    overdue_notified_at = case when p_set_due then null else overdue_notified_at end
  where id=p_id;
  return (select to_jsonb(a) from databot_assigned_tasks a where id=p_id);
end;
$$;

-- Обзор для владельцев: всё незакрытое и то, что закрыли с p_since.
create or replace function public.databot_assigned_overview(p_since timestamptz)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.assignee_id, t.due_at nulls last, t.id), '[]'::jsonb)
  from databot_assigned_tasks t
  where t.status in ('open','taken') or t.status_at >= p_since;
$$;

-- Отметка «напомнили». true — отметку поставил именно этот вызов: только он
-- и шлёт сообщение. Лучше потерять напоминание при сбое Telegram, чем
-- прислать его дважды с двух процессов на релизе.
create or replace function public.databot_assigned_notice(p_id bigint, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_kind = 'reminder' then
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

revoke all on function public.databot_assigned_import(bigint,bigint,jsonb),
  public.databot_assigned_status(bigint,bigint,text),
  public.databot_assigned_edit(bigint,bigint,text,boolean,timestamptz),
  public.databot_assigned_overview(timestamptz),
  public.databot_assigned_notice(bigint,text)
  from public, anon, authenticated;
grant execute on function public.databot_assigned_import(bigint,bigint,jsonb),
  public.databot_assigned_status(bigint,bigint,text),
  public.databot_assigned_edit(bigint,bigint,text,boolean,timestamptz),
  public.databot_assigned_overview(timestamptz),
  public.databot_assigned_notice(bigint,text)
  to service_role;
commit;
