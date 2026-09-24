-- Migration 0003 — replace JSONB/column-overloading workarounds with real columns.
--
-- Two features were previously implemented by smuggling data into columns that
-- belong to something else. Both caused real data problems:
--
--   1. reports.lists._delete_requested held a team admin's delete request, but
--      the report editor rebuilds `lists` from scratch on every save, so the
--      flag was silently erased.
--   2. clients.phone held the client's objectives as a JSON string, which
--      overwrote the real phone number.
--
-- This migration adds proper columns, migrates any existing data across, and
-- removes the workarounds.

-- ---------------------------------------------------------------------------
-- 1. reports.delete_requested
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists delete_requested boolean not null default false;

-- Backfill rows carrying the old JSONB flag.
update public.reports
   set delete_requested = true
 where (lists -> '_delete_requested') = 'true'::jsonb;

-- Drop the old flag so it can never be misread again.
update public.reports
   set lists = lists - '_delete_requested'
 where lists ? '_delete_requested';

create index if not exists reports_delete_requested_idx
  on public.reports (delete_requested)
  where delete_requested;

-- ---------------------------------------------------------------------------
-- 2. clients.objectives
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists objectives jsonb not null default '[]'::jsonb;

-- Move JSON-array objectives out of `phone` and clear the phone field.
-- Rows whose `phone` merely starts with '[' but is not valid JSON are left
-- untouched, so the migration cannot abort on bad data.
do $$
declare
  r record;
begin
  for r in
    select id, phone
      from public.clients
     where phone is not null
       and phone like '[%'
  loop
    begin
      update public.clients
         set objectives = (r.phone)::jsonb,
             phone = null
       where id = r.id;
    exception when others then
      -- Not valid JSON — leave this row exactly as it was.
      null;
    end;
  end loop;
end $$;

-- Guard against a future write putting a JSON blob back into `phone`.
alter table public.clients
  drop constraint if exists clients_phone_not_json;
alter table public.clients
  add constraint clients_phone_not_json
  check (phone is null or phone not like '[%');

-- ---------------------------------------------------------------------------
-- 3. clients.targets_visible
-- ---------------------------------------------------------------------------
-- The "Targets visible to client" toggle in the admin console previously only
-- changed local React state and was never persisted, so it silently reset.
alter table public.clients
  add column if not exists targets_visible boolean not null default true;
