-- 0006_deactivation_guard.sql
--
-- Atomic "never leave the deployment with zero active super admins".
--
-- The API previously did this as a read-then-write: count active super admins,
-- and if more than one, set status='inactive'. Two super admins deactivating one
-- another at the same moment both read a count of 2 and both succeeded, leaving
-- nobody able to administer the portal. Nothing in the schema prevented that.
--
-- This function performs the count and the write inside a single statement while
-- holding a row-level lock on the target, so the second concurrent transaction
-- blocks and then re-evaluates the count after the first has committed.
--
-- SECURITY INVOKER (the default) is deliberate: the caller needs UPDATE on
-- profiles, which the service-role key used by the API already has. EXECUTE is
-- revoked from anon/authenticated below so a client cannot call it directly —
-- Supabase grants EXECUTE on new functions to PUBLIC by default, which would
-- leave that to project defaults rather than to this file.

create or replace function public.deactivation_guard(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_active_admins integer;
begin
  -- Lock EVERY active super admin, not just the target, and in id order.
  --
  -- A bare `select count(*)` takes NO row locks under READ COMMITTED, so two
  -- admins deactivating each other concurrently both counted 2 and both wrote —
  -- the exact outcome this migration exists to prevent. Locking the whole set
  -- serialises them: the second transaction blocks here, and once the first
  -- commits, the lock is re-evaluated (EvalPlanQual) and the count is redone.
  -- ORDER BY id is required for deadlock-freedom, since every caller locks the
  -- same rows in the same order.
  perform 1
  from profiles
  where role = 'super_admin' and status = 'active'
  order by id
  for update;

  select count(*) into v_active_admins
  from profiles
  where role = 'super_admin' and status = 'active';

  if v_active_admins <= 1 then
    -- No write. The caller is expected to report this rather than proceed.
    return jsonb_build_object('ok', false, 'reason', 'last_active_super_admin');
  end if;

  update profiles set status = 'inactive' where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.deactivation_guard(uuid) from public, anon, authenticated;
grant execute on function public.deactivation_guard(uuid) to service_role;

-- Belt and braces: even if the count logic were bypassed — a direct UPDATE, a
-- role demotion, a future code path that forgets the RPC — this makes it
-- impossible to remove the last active super admin.
create or replace function public.block_last_super_admin()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Two ways to remove the last active super admin, and BOTH have to be caught:
  --   1. deactivation: status -> 'inactive' while still role='super_admin'
  --   2. demotion:      role -> something else while still status='active'
  -- An earlier version gated everything on `new.status = 'inactive'`, which is
  -- false for a pure demotion — so `update profiles set role='team_admin'` on
  -- the sole super admin passed straight through and left nobody able to
  -- administer the portal, via the very path meant to make that impossible.
  if (select count(*) from profiles where role = 'super_admin' and status = 'active') > 1 then
    return new;  -- someone else can take over; nothing to block
  end if;

  if (old.role = 'super_admin' and old.status = 'active'
      and (new.role is distinct from 'super_admin' or new.status is distinct from 'active')) then
    raise exception 'Cannot deactivate or demote the only active super admin'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_last_super_admin on public.profiles;
create trigger trg_block_last_super_admin
  before update of status, role on public.profiles
  for each row
  execute function public.block_last_super_admin();
