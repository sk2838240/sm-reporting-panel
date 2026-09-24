-- Add annotations table for chart notes pinned to a period
create table if not exists public.annotations (
  id serial primary key,
  client_id integer not null references public.clients(id) on delete cascade,
  service text not null,
  period_start date not null,
  note text not null,
  created_by uuid,
  created_at timestamptz default now()
);
create index if not exists annotations_client_service_idx on public.annotations(client_id, service, period_start);
