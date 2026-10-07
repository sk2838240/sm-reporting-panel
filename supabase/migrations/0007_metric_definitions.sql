-- Migration 0007 — metric definitions for the ⓘ buttons.
--
-- The plain-language explanation behind a metric's info button: what "Organic
-- Clicks" means, what a bounce rate is, and so on.
--
-- Global reference data, NOT per-report and NOT per-client. The wording for
-- "Organic Clicks" should read identically on every client's dashboard and in
-- every month's report, and editing it once should update everywhere. Keyed by
-- (service, metric_key) so a built-in ('organic_clicks') and a client-specific
-- custom metric ("Local citations") are documented the same way.
--
-- Deliberately NOT seeded. src/lib/constants.js carries a default for every
-- built-in metric, and a row here OVERRIDES it. Two consequences:
--   * the ⓘ buttons work before this migration is applied,
--   * only edited definitions need a row, so there is nothing to keep in sync
--     when a new core metric is added to the app later.

create table if not exists public.metric_definitions (
  id serial primary key,
  service text not null,
  metric_key text not null,
  definition text not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (service, metric_key)
);

create index if not exists metric_definitions_lookup_idx
  on public.metric_definitions (service, metric_key);

-- RLS enabled with NO policies: the anon/authenticated roles Supabase grants by
-- default get nothing, and the API reaches it with the service-role key, which
-- bypasses RLS. Without this the public anon key (which ships in the browser
-- bundle) could read and rewrite every definition through PostgREST.
alter table public.metric_definitions enable row level security;
