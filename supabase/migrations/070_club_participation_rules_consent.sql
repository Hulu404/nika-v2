-- Record acceptance of the participation rules on the stretch signup.
alter table public.club_signups
  add column if not exists participation_rules_accepted_at timestamptz,
  add column if not exists participation_rules_version text;

comment on column public.club_signups.participation_rules_accepted_at is
  'When the signup owner accepted the NIKA PILATES participation rules';
comment on column public.club_signups.participation_rules_version is
  'Version of the NIKA PILATES participation rules accepted at signup';
