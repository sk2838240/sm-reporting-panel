-- Migration 0005 — per-client control over the dashboard's Compare section.
--
-- The comparison-mode selector (MoM / YoY / 3-mo / 6-mo average / vs Target /
-- custom range) is useful for the agency but can be noise for a client who
-- only wants the numbers for the period being reported.
--
-- When compare_visible is false the selector is removed from the client
-- dashboard and the view is pinned to MoM — the delta pills and comparison
-- bars stay, so the client still sees month-over-month movement. Only the
-- ability to switch modes goes away.
--
-- Follows the same pattern as clients.targets_visible (migration 0003):
-- a per-client boolean, defaulting to the existing behaviour.

alter table public.clients
  add column if not exists compare_visible boolean not null default true;
