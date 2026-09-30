-- Team task pool. Apply after 037_databot.sql. All mutations are service-only RPCs.
begin;
create table if not exists public.databot_tasks (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  message_id bigint not null check (message_id > 0),
  message_thread_id bigint not null check (message_thread_id > 0),
  source_text text not null,
  source_version bigint not null,
  what text not null check (length(trim(what)) > 0),
  assignee_username text not null check (assignee_username ~ '^[a-z0-9_]{1,32}$'),
  assignee_id bigint references public.databot_members(chat_id),
  bound_username text,
  bound_by bigint references public.databot_members(chat_id),
  bound_at timestamptz,
  due_at timestamptz not null,
  requires_result boolean not null default false,
  source_was_pinned boolean not null default false,
  status text not null default 'available' check (status in ('available','invalid','active','completing','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completion_requested_at timestamptz,
  result_url text check (result_url ~ '^https?://[^[:space:]/]+'),
  unique(chat_id, message_id),
  check ((assignee_id is null and bound_username is null and bound_by is null and bound_at is null)
    or (assignee_id is not null and bound_username ~ '^[a-z0-9_]{1,32}$' and bound_by is not null and bound_at is not null)),
  check ((status = 'done') = (completed_at is not null)),
  check (status not in ('completing','done') or not requires_result or result_url is not null)
);
create table if not exists public.databot_task_claims (
  task_id bigint primary key references public.databot_tasks(id),
  taken_by bigint not null references public.databot_members(chat_id),
  taken_at timestamptz not null default now(),
  -- Unique occupied slots enforce <=4 even beyond the RPC count check.
  active_slot smallint check (active_slot between 1 and 4),
  work_chat_id bigint not null,
  work_thread_id bigint not null check (work_thread_id > 0),
  work_message_id bigint check (work_message_id > 0),
  send_state text not null default 'pending' check (send_state in ('pending','sending','sent','uncertain','rejected')),
  pin_state text not null default 'pending' check (pin_state in ('pending','pinned','failed')),
  work_unpin_state text not null default 'pending' check (work_unpin_state in ('pending','done','failed')),
  source_unpin_state text not null default 'pending' check (source_unpin_state in ('pending','done','failed')),
  edit_state text not null default 'pending' check (edit_state in ('pending','done','failed')),
  unique(taken_by, active_slot),
  unique(work_chat_id, work_message_id),
  check ((send_state = 'sent') = (work_message_id is not null)),
  check (pin_state <> 'pinned' or work_message_id is not null)
);
create index if not exists databot_tasks_pool on public.databot_tasks(chat_id, status, due_at);
alter table public.databot_tasks enable row level security;
alter table public.databot_task_claims enable row level security;
revoke all on public.databot_tasks, public.databot_task_claims from public, anon, authenticated;
grant select on public.databot_tasks, public.databot_task_claims to service_role;

create or replace function public.databot_task_json(p_id bigint) returns jsonb
language sql volatile security definer set search_path = public as $$
  select to_jsonb(t) || jsonb_build_object('claim',
    (select to_jsonb(c) - 'task_id' - 'active_slot' from databot_task_claims c where c.task_id=t.id))
  from databot_tasks t where t.id=p_id;
$$;

create or replace function public.databot_task_list(p_chat bigint, p_user bigint default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_user is not null and not exists(select 1 from databot_members where chat_id=p_user and is_active) then
    raise exception 'task:member';
  end if;
  return coalesce((select jsonb_agg(databot_task_json(t.id) order by t.due_at,t.id)
    from databot_tasks t where t.chat_id=p_chat and
      ((p_user is null and t.status='available') or
       (p_user is not null and t.status in ('active','completing') and t.assignee_id=p_user))), '[]'::jsonb);
end;
$$;

create or replace function public.databot_task_cleanup_list(p_chat bigint, p_user bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists(select 1 from databot_members where chat_id=p_user and is_active) then raise exception 'task:member'; end if;
  return coalesce((select jsonb_agg(databot_task_json(t.id) order by t.id) from databot_tasks t
    join databot_task_claims c on c.task_id=t.id where t.chat_id=p_chat and t.status='completing' and c.taken_by=p_user
    and (c.work_unpin_state<>'done' or c.edit_state<>'done' or (t.source_was_pinned and c.source_unpin_state<>'done'))), '[]'::jsonb);
end;
$$;

create or replace function public.databot_task_action(p_action text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t databot_tasks%rowtype;
  c databot_task_claims%rowtype;
  uid bigint := (p_args->>'user_id')::bigint;
  tid bigint := (p_args->>'id')::bigint;
  uname text := p_args->>'username';
  slot smallint;
begin
  if p_action='get' then return databot_task_json(tid); end if;
  if p_action='source' then
    return (select databot_task_json(id) from databot_tasks where chat_id=(p_args->>'chat_id')::bigint and message_id=(p_args->>'message_id')::bigint);
  end if;
  if p_action='invalidate' then
    update databot_tasks set status='invalid', source_text=p_args->>'source_text', source_version=(p_args->>'version')::bigint,
      assignee_id=null,bound_username=null,bound_by=null,bound_at=null,updated_at=now()
      where chat_id=(p_args->>'chat_id')::bigint and message_id=(p_args->>'message_id')::bigint
        and status in ('available','invalid') and source_version<(p_args->>'version')::bigint;
    return null;
  end if;
  if p_action='import' then
    if not coalesce((p_args->>'existing_only')::boolean,false) then
      insert into databot_tasks(chat_id,message_id,message_thread_id,source_text,source_version,what,assignee_username,due_at,requires_result,source_was_pinned)
      values ((p_args->>'chat_id')::bigint,(p_args->>'message_id')::bigint,(p_args->>'message_thread_id')::bigint,
        p_args->>'source_text',(p_args->>'source_version')::bigint,p_args->>'what',p_args->>'assignee_username',
        (p_args->>'due_at')::timestamptz,(p_args->>'requires_result')::boolean,coalesce((p_args->>'source_was_pinned')::boolean,false))
      on conflict(chat_id,message_id) do nothing;
    end if;
    select * into t from databot_tasks where chat_id=(p_args->>'chat_id')::bigint and message_id=(p_args->>'message_id')::bigint for update;
    if not found then return null; end if;
    if t.status in ('available','invalid') and (p_args->>'source_version')::bigint > t.source_version then
      update databot_tasks set status='available',source_text=p_args->>'source_text', source_version=(p_args->>'source_version')::bigint,
        what=p_args->>'what', due_at=(p_args->>'due_at')::timestamptz, requires_result=(p_args->>'requires_result')::boolean,
        source_was_pinned=source_was_pinned or coalesce((p_args->>'source_was_pinned')::boolean,false),
        assignee_username=p_args->>'assignee_username',
        assignee_id=case when assignee_username=p_args->>'assignee_username' then assignee_id end,
        bound_username=case when assignee_username=p_args->>'assignee_username' then bound_username end,
        bound_by=case when assignee_username=p_args->>'assignee_username' then bound_by end,
        bound_at=case when assignee_username=p_args->>'assignee_username' then bound_at end,
        updated_at=now() where id=t.id;
    end if;
    if coalesce((p_args->>'source_was_pinned')::boolean,false) then
      update databot_tasks set source_was_pinned=true where id=t.id;
    end if;
    return databot_task_json(t.id);
  end if;

  -- One lock per member serializes competing claims and membership revocation.
  -- Always member before task, including completion/binding, to avoid deadlocks.
  if p_action in ('bind','take','complete') then
    perform 1 from databot_members where chat_id=uid and is_active for update;
    if not found then raise exception 'task:member'; end if;
    if uname is null or uname !~ '^[a-z0-9_]{1,32}$' then raise exception 'task:identity'; end if;
  end if;
  select * into t from databot_tasks where id=tid for update;
  if not found then raise exception 'task:missing'; end if;
  select * into c from databot_task_claims where task_id=tid;

  if p_action in ('take','complete') then
    if t.assignee_id is distinct from uid or t.bound_username is distinct from uname then raise exception 'task:identity'; end if;
    if (select count(*) from databot_members where is_active and lower(regexp_replace(username,'^@',''))=uname) <> 1
      or not exists(select 1 from databot_members where chat_id=uid and lower(regexp_replace(username,'^@',''))=uname)
      then raise exception 'task:identity'; end if;
  end if;
  if p_action='bind' then
    if t.status in ('done','completing') or (c.taken_by is not null and c.taken_by<>uid) then raise exception 'task:state'; end if;
    if not exists(select 1 from databot_members where chat_id=(p_args->>'admin_id')::bigint and is_active) then raise exception 'task:member'; end if;
    update databot_tasks set assignee_id=uid,bound_username=uname,bound_by=(p_args->>'admin_id')::bigint,bound_at=now() where id=tid;
  elsif p_action='take' then
    if t.status<>'available' or t.chat_id<>(p_args->>'chat_id')::bigint then raise exception 'task:state'; end if;
    select s::smallint into slot from generate_series(1,4) s where not exists
      (select 1 from databot_task_claims where taken_by=uid and active_slot=s) order by s limit 1;
    if slot is null then raise exception 'task:limit'; end if;
    insert into databot_task_claims(task_id,taken_by,active_slot,work_chat_id,work_thread_id)
      values(tid,uid,slot,(p_args->>'chat_id')::bigint,(p_args->>'work_thread_id')::bigint);
    update databot_tasks set status='active' where id=tid;
  elsif p_action='complete' then
    if t.status in ('completing','done') and c.taken_by=uid then return databot_task_json(tid); end if;
    if t.status<>'active' or c.taken_by is distinct from uid then raise exception 'task:state'; end if;
    if (t.requires_result and nullif(p_args->>'result_url','') is null)
       or (p_args->>'result_url' is not null and p_args->>'result_url' !~ '^https?://[^[:space:]/]+') then raise exception 'task:result'; end if;
    update databot_tasks set status='completing',completion_requested_at=now(),result_url=p_args->>'result_url' where id=tid;
  else
    if c.task_id is null then raise exception 'task:state'; end if;
    if p_action='lock' then
      if c.send_state not in ('pending','rejected') then return null; end if;
      update databot_task_claims set send_state='sending' where task_id=tid;
    elsif p_action in ('sent','recover') then
      if (p_args->>'message_id')::bigint is null or (p_args->>'message_id')::bigint<=0 then raise exception 'task:state'; end if;
      if c.work_message_id is not null and c.work_message_id<>(p_args->>'message_id')::bigint then raise exception 'task:state'; end if;
      update databot_task_claims set send_state='sent',work_message_id=(p_args->>'message_id')::bigint where task_id=tid;
    elsif p_action='uncertain' then
      update databot_task_claims set send_state='uncertain' where task_id=tid and send_state='sending';
    elsif p_action='rejected' then
      update databot_task_claims set send_state='rejected' where task_id=tid and send_state='sending';
    elsif p_action='reset_send' then
      if c.send_state not in ('sending','uncertain') or c.work_message_id is not null or t.updated_at > now() - interval '1 minute' then
        raise exception 'task:state';
      end if;
      update databot_task_claims set send_state='pending' where task_id=tid;
    elsif p_action in ('pinned','failed') then
      if c.work_message_id is null then raise exception 'task:state'; end if;
      update databot_task_claims set pin_state=p_action where task_id=tid;
    elsif p_action in ('work_unpinned','work_unpin_failed') then
      update databot_task_claims set work_unpin_state=case when p_action='work_unpinned' then 'done' else 'failed' end where task_id=tid;
    elsif p_action in ('source_unpinned','source_unpin_failed') then
      update databot_task_claims set source_unpin_state=case when p_action='source_unpinned' then 'done' else 'failed' end where task_id=tid;
    elsif p_action in ('edited','edit_failed') then
      update databot_task_claims set edit_state=case when p_action='edited' then 'done' else 'failed' end where task_id=tid;
    elsif p_action='finish' then
      if t.status<>'completing' or c.work_unpin_state<>'done' or c.edit_state<>'done'
        or (t.source_was_pinned and c.source_unpin_state<>'done') then raise exception 'task:state'; end if;
      update databot_tasks set status='done',completed_at=now() where id=tid;
      update databot_task_claims set active_slot=null where task_id=tid;
    else raise exception 'task:state'; end if;
  end if;
  update databot_tasks set updated_at=now() where id=tid;
  return databot_task_json(tid);
end;
$$;
revoke all on function public.databot_task_json(bigint), public.databot_task_list(bigint,bigint), public.databot_task_cleanup_list(bigint,bigint), public.databot_task_action(text,jsonb) from public, anon, authenticated;
grant execute on function public.databot_task_json(bigint), public.databot_task_list(bigint,bigint), public.databot_task_cleanup_list(bigint,bigint), public.databot_task_action(text,jsonb) to service_role;
commit;
