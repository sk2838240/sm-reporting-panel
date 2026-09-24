-- Agency Portal — initial schema (single-tenant: one agency, many clients)
-- This file is the authoritative schema, checked into git and applied via Supabase CLI.
-- The service-role key is used ONLY in /api routes; the anon key (client bundle) never
-- has direct table access beyond these RLS policies.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'client' check (role in ('super_admin','team_admin','client')),
  client_id integer,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.clients (
  id serial primary key,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  logo_url text,
  services jsonb default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','paused','archived')),
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.client_assignments (
  id serial primary key,
  client_id integer not null references public.clients(id) on delete cascade,
  team_member_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (client_id, team_member_id)
);

create table if not exists public.invites (
  id serial primary key,
  email text not null,
  role text check (role in ('client','team_admin')),
  client_id integer references public.clients(id) on delete set null,
  token text not null unique,
  status text default 'pending' check (status in ('pending','accepted','expired')),
  created_by uuid,
  created_at timestamptz default now(),
  accepted_at timestamptz,
  expires_at timestamptz
);

create table if not exists public.reports (
  id serial primary key,
  client_id integer not null references public.clients(id) on delete cascade,
  service text not null check (service in ('seo','orm','social')),
  period_type text not null default 'month' check (period_type in ('month','cycle')),
  period_label text,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','published')),
  version integer not null default 1,
  metrics jsonb default '{}'::jsonb,
  breakdowns jsonb default '{}'::jsonb,
  lists jsonb default '{}'::jsonb,
  achievements jsonb default '[]'::jsonb,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (client_id, service, period_start)
);
create index if not exists reports_client_service_idx on public.reports(client_id, service, period_start);

create table if not exists public.report_revisions (
  id serial primary key,
  report_id integer not null references public.reports(id) on delete cascade,
  version integer not null,
  snapshot jsonb,
  note text,
  published_by uuid,
  published_at timestamptz default now()
);

create table if not exists public.targets (
  id serial primary key,
  client_id integer not null references public.clients(id) on delete cascade,
  service text not null,
  metric_key text not null,
  platform text,
  target_value numeric,
  unit text,
  created_at timestamptz default now(),
  unique (client_id, service, metric_key, platform)
);

create table if not exists public.notifications (
  id serial primary key,
  client_id integer not null references public.clients(id) on delete cascade,
  report_id integer references public.reports(id) on delete cascade,
  type text,
  title text,
  message text,
  read boolean default false,
  created_at timestamptz default now()
);
create index if not exists notifications_client_idx on public.notifications(client_id, created_at desc);

create table if not exists public.audit_log (
  id serial primary key,
  actor_id uuid,
  actor_email text,
  action text,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz default now()
);
create index if not exists audit_created_idx on public.audit_log(created_at desc);

create table if not exists public.error_log (
  id serial primary key,
  route text,
  method text,
  message text,
  stack text,
  created_at timestamptz default now()
);

-- Row Level Security (defense-in-depth). The service-role API routes bypass RLS;
-- these policies protect against direct anon-key access from the client bundle.
alter table public.clients enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.targets enable row level security;

create policy "clients_read_access" on public.clients for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  or auth.uid() in (select team_member_id from public.client_assignments where client_id = clients.id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client' and p.client_id = clients.id)
);
create policy "reports_read_access" on public.reports for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  or auth.uid() in (select team_member_id from public.client_assignments where client_id = reports.client_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client' and p.client_id = reports.client_id)
);
create policy "notifications_read_access" on public.notifications for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  or auth.uid() in (select team_member_id from public.client_assignments where client_id = notifications.client_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client' and p.client_id = notifications.client_id)
);
create policy "targets_read_access" on public.targets for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  or auth.uid() in (select team_member_id from public.client_assignments where client_id = targets.client_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client' and p.client_id = targets.client_id)
);
