-- Migration 0004 — close the Row Level Security gap.
--
-- 0001 enabled RLS on only 4 of the 11 tables (clients, reports, notifications,
-- targets), and 0002 added `annotations` with none. The Supabase anon key is
-- public by design — it ships in the client bundle and in vercel.json — so any
-- table without RLS is readable by anyone who extracts that key and calls
-- PostgREST directly:
--
--     GET https://<ref>.supabase.co/rest/v1/profiles?select=*
--
-- That exposed every user's email and role (profiles), every invite token
-- (invites), the full audit trail (audit_log) and stack traces (error_log).
--
-- This migration enables RLS on the remaining tables. All application access
-- goes through /api/*, which uses the service-role key and therefore bypasses
-- RLS entirely — so locking these tables down does not affect the app.
--
-- IMPORTANT: the existing policies in 0001 read from `profiles` and
-- `client_assignments` in subqueries. RLS applies to those subqueries too, so
-- both tables need a read policy that preserves them — otherwise every
-- client/team_admin read of clients, reports, notifications and targets would
-- silently start returning nothing.

-- ---------------------------------------------------------------------------
-- profiles — readable only by its own row.
-- This is what keeps the `exists (select 1 from public.profiles ...)` checks in
-- the 0001 policies working, while never exposing other users' emails.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_read_self" on public.profiles;
create policy "profiles_read_self" on public.profiles for select using (
  id = auth.uid()
);

-- ---------------------------------------------------------------------------
-- client_assignments — a member may read their own assignments; super admins
-- may read all (needed by the `auth.uid() in (select team_member_id ...)`
-- checks in the 0001 policies).
-- ---------------------------------------------------------------------------
alter table public.client_assignments enable row level security;

drop policy if exists "client_assignments_read_access" on public.client_assignments;
create policy "client_assignments_read_access" on public.client_assignments for select using (
  team_member_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
);

-- ---------------------------------------------------------------------------
-- report_revisions — reachable only through a report the caller can already
-- read. `reports` has its own policy, so this subquery is already filtered.
-- ---------------------------------------------------------------------------
alter table public.report_revisions enable row level security;

drop policy if exists "report_revisions_read_access" on public.report_revisions;
create policy "report_revisions_read_access" on public.report_revisions for select using (
  exists (select 1 from public.reports r where r.id = report_revisions.report_id)
);

-- ---------------------------------------------------------------------------
-- annotations — scoped to a client the caller can read.
-- ---------------------------------------------------------------------------
alter table public.annotations enable row level security;

drop policy if exists "annotations_read_access" on public.annotations;
create policy "annotations_read_access" on public.annotations for select using (
  exists (select 1 from public.clients c where c.id = annotations.client_id)
);

-- ---------------------------------------------------------------------------
-- Deny-all. RLS enabled with no policies means no anon/authenticated access at
-- all; the service-role API is unaffected.
--
--   invites          — holds invite tokens
--   audit_log        — actor emails and action history
--   error_log        — internal stack traces
-- ---------------------------------------------------------------------------
alter table public.invites enable row level security;
alter table public.audit_log enable row level security;
alter table public.error_log enable row level security;
