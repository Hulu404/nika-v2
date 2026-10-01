-- Owner-supplied lists in a private chat; independent of topic/pin-based tasks.
begin;

create table if not exists public.databot_assigned_tasks (
  id bigint generated always as identity primary key,
  source_chat_id bigint not null,
  source_message_id bigint not null check (source_message_id > 0),
  line integer not null check (line > 0),
  assigned_by bigint not null references public.databot_members(chat_id),
  assignee_id bigint not null references public.databot_members(chat_id),
  username text not null check (username ~ '^[a-z0-9_]{1,32}$'),
  what text not null check (length(trim(what)) between 1 and 3000),
  created_at timestamptz not null default now(),
  delivery_state text not null default 'pending'
    check (delivery_state in ('pending','sending','sent','failed','uncertain')),
  delivered_message_id bigint check (delivered_message_id > 0),
  unique(source_chat_id, source_message_id, line),
  check ((delivery_state = 'sent') = (delivered_message_id is not null))
);
create index if not exists databot_assigned_tasks_recipient_idx
  on public.databot_assigned_tasks(assignee_id, created_at desc);
alter table public.databot_assigned_tasks enable row level security;
revoke all on public.databot_assigned_tasks from public, anon, authenticated;
grant select on public.databot_assigned_tasks to service_role;

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
  -- Validate the entire batch before any row is inserted.
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
      assignee_id, username, what)
    values(p_owner, p_message, (item->>'line')::integer, p_owner, recipients[n],
      item->>'username', item->>'what')
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

create or replace function public.databot_assigned_list(p_user bigint)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc), '[]'::jsonb)
  from databot_assigned_tasks t join databot_members m on m.chat_id=t.assignee_id
  where t.assignee_id=p_user and m.is_active
    and lower(regexp_replace(m.username, '^@', ''))=t.username;
$$;

create or replace function public.databot_assigned_delivery(p_id bigint, p_action text, p_message bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t databot_assigned_tasks%rowtype;
begin
  select * into t from databot_assigned_tasks where id=p_id for update;
  if not found then return null; end if;
  if p_action='lock' then
    if t.delivery_state not in ('pending','failed') then return null; end if;
    update databot_assigned_tasks set delivery_state='sending' where id=p_id;
  elsif p_action='sent' then
    if t.delivery_state<>'sending' or p_message is null or p_message<=0 then raise exception 'assigned:state'; end if;
    update databot_assigned_tasks set delivery_state='sent', delivered_message_id=p_message where id=p_id;
  elsif p_action in ('failed','uncertain') then
    if t.delivery_state='sending' then
      update databot_assigned_tasks set delivery_state=p_action where id=p_id;
    end if;
  else raise exception 'assigned:state'; end if;
  return (select to_jsonb(a) from databot_assigned_tasks a where id=p_id);
end;
$$;

revoke all on function public.databot_assigned_import(bigint,bigint,jsonb),
  public.databot_assigned_list(bigint), public.databot_assigned_delivery(bigint,text,bigint)
  from public, anon, authenticated;
grant execute on function public.databot_assigned_import(bigint,bigint,jsonb),
  public.databot_assigned_list(bigint), public.databot_assigned_delivery(bigint,text,bigint)
  to service_role;
commit;
