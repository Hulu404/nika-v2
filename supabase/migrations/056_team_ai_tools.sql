-- «Пятница»: ассистент отмечает задачи за других.
-- Фаундер может отметить выполненной задачу другого исполнителя; кто отметил —
-- status_by (null — сам исполнитель или старые строки). Пишет lib/team/ai/assistant.ts.

alter table public.databot_assigned_tasks add column if not exists status_by bigint;

comment on column public.databot_assigned_tasks.status_by is
  'Кто сменил статус, если не сам исполнитель (фаундер через ассистента «Пятницы»)';
