import supabase from './db-client.js';
import { withHandler, getProfile, audit } from './helpers.js';

export default withHandler('team', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });
    const { data, error } = await supabase.from('profiles')
      .select('id, email, full_name, role, status, created_at')
      .in('role', ['team_admin', 'super_admin'])
      .order('created_at', { ascending: true });
    if (error) throw error;
    // attach assignment counts
    let rows = data || [];
    const { data: assigns } = await supabase.from('client_assignments').select('team_member_id');
    const counts = {};
    (assigns || []).forEach(a => { counts[a.team_member_id] = (counts[a.team_member_id] || 0) + 1; });
    rows = rows.map(r => ({ ...r, clientCount: counts[r.id] || 0 }));
    return res.status(200).json(rows);
  }

  if (req.method === 'PUT') {
    if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });
    const { id, action, reassignTo } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: 'id and action required' });

    if (action === 'edit') {
      const { full_name, email } = req.body || {};
      const updates = {};
      // Same rule as email: a blank name wiped the member's name in the team
      // table and in every audit entry, while the email branch rejected blank.
      if (full_name !== undefined) {
        if (typeof full_name !== 'string' || !full_name.trim()) {
          return res.status(400).json({ error: 'Name cannot be empty' });
        }
        updates.full_name = full_name.trim();
      }
      // Reject a blank/omitted email rather than storing ''. The auth update
      // below is guarded on truthiness, so an empty value would skip it and
      // blank the profile address while leaving the real login intact — exactly
      // the desync this block was written to prevent.
      if (email !== undefined) {
        if (typeof email !== 'string' || !email.trim()) {
          return res.status(400).json({ error: 'Email cannot be empty' });
        }
        updates.email = email.trim();
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

      // Update the auth identity FIRST. If this fails (most often because the
      // address is already taken), abort without touching profiles — otherwise
      // the two desync and the member cannot sign in with the displayed email.
      // Both calls get the TRIMMED value; passing the raw one to auth and the
      // trimmed one to profiles is the same desync by another route.
      if (updates.email !== undefined) {
        const { error: authErr } = await supabase.auth.admin.updateUserById(id, { email: updates.email });
        if (authErr) return res.status(400).json({ error: `Could not update login email: ${authErr.message}` });
      }

      const { data, error } = await supabase.from('profiles').update(updates).eq('id', id).select().single();
      if (error) throw error;
      await audit(profile, 'team.edit', 'profile', id, updates);
      return res.status(200).json(data);
    }

    // Refuses to let the deployment end up with zero active super admins, and
    // performs the deactivation. Check AND write in one statement, because a
    // read-then-write let two admins deactivating each other simultaneously
    // both observe a count of 2 and both succeed.
    //
    // Returns { blocked: true } when the guard refused; the caller decides what
    // to do about it. Performs no write when blocked.
    const guardAndDeactivate = async () => {
      const { data: result, error: rpcErr } = await supabase.rpc('deactivation_guard', { p_id: id });
      // Distinguish "function ran and said no" from "function is missing": the
      // latter is a 503, not a 400.
      if (rpcErr || !result || typeof result.ok !== 'boolean') {
        console.error('[team] deactivation_guard unavailable; refusing to risk a lockout', rpcErr?.message || rpcErr);
        return { unavailable: true };
      }
      return { blocked: !result.ok };
    };

    if (action === 'deactivate') {
      const { data: target } = await supabase.from('profiles')
        .select('id, role, status').eq('id', id).maybeSingle();
      if (!target) return res.status(404).json({ error: 'No such team member' });

      if (target.role === 'super_admin' && target.status === 'active') {
        const g = await guardAndDeactivate();
        if (g.unavailable) {
          return res.status(503).json({ error: 'This safety check is unavailable. Run migration 0006_deactivation_guard.sql, or ask an administrator to change the role directly.' });
        }
        if (g.blocked) {
          return res.status(400).json({ error: 'This is the only active super admin. Promote another member first, or you will lock everyone out of the portal.' });
        }
      } else {
        const { error } = await supabase.from('profiles').update({ status: 'inactive' }).eq('id', id);
        if (error) throw error;
      }
      await audit(profile, 'team.deactivate', 'profile', id, {});
      const { data: updated } = await supabase.from('profiles').select('id, full_name, email, role, status').eq('id', id).maybeSingle();
      return res.status(200).json(updated);
    }

    if (action === 'reactivate') {
      const { data, error } = await supabase.from('profiles').update({ status: 'active' }).eq('id', id).select().single();
      if (error) throw error;
      await audit(profile, 'team.reactivate', 'profile', id, {});
      return res.status(200).json(data);
    }

    if (action === 'offboard') {
      if (!reassignTo) return res.status(400).json({ error: 'reassignTo required' });
      if (reassignTo === id) return res.status(400).json({ error: 'Cannot reassign a member to themselves' });

      // Validate the successor BEFORE touching anything. The previous version
      // deleted each assignment first and discarded the insert's error, so a
      // successor who had just been deactivated (or a bad id) failed the FK
      // silently and left the client with nobody assigned — while the handler
      // still answered { ok: true, reassigned: N }.
      const { data: successor } = await supabase.from('profiles')
        .select('id, role, status').eq('id', reassignTo).maybeSingle();
      if (!successor) return res.status(400).json({ error: 'Reassignment target not found' });
      if (successor.role !== 'team_admin' && successor.role !== 'super_admin') {
        return res.status(400).json({ error: 'Clients can only be reassigned to a team member or super admin' });
      }
      if (successor.status === 'inactive') return res.status(400).json({ error: 'Reassignment target is deactivated' });

      const { data: assigns } = await supabase.from('client_assignments').select('client_id').eq('team_member_id', id);
      const rows = assigns || [];

      // Insert the successor's assignment first, then drop the outgoing one. If
      // the insert fails the client keeps its current assignee, rather than the
      // client being left unassigned. Error text is deliberately generic: these
      // are explicit 500 returns, so they bypass withHandler's masking and would
      // otherwise expose the table and constraint name.
      let reassigned = 0;
      for (const a of rows) {
        const { data: dup } = await supabase.from('client_assignments')
          .select('id').eq('client_id', a.client_id).eq('team_member_id', reassignTo).maybeSingle();
        if (!dup) {
          const { error: insErr } = await supabase.from('client_assignments')
            .insert({ client_id: a.client_id, team_member_id: reassignTo });
          if (insErr) {
            console.error('[team.offboard] reassign insert failed', insErr);
            // State the real scope: earlier clients in this loop already moved.
            return res.status(500).json({ error: `Could not reassign client ${a.client_id}. ${reassigned} client${reassigned === 1 ? '' : 's'} were reassigned before this failed — reassign those manually.` });
          }
        }
        const { error: delErr } = await supabase.from('client_assignments')
          .delete().eq('client_id', a.client_id).eq('team_member_id', id);
        if (delErr) {
          console.error('[team.offboard] outgoing delete failed', delErr);
          return res.status(500).json({ error: `Could not remove the outgoing assignment for client ${a.client_id}. Their clients may be assigned to both members — check the client record.` });
        }
        reassigned++;
      }

      // Deactivate LAST, after every client has moved. The member used to be
      // marked inactive up front, so a rejected successor (deactivated in
      // another tab, bad id, self-reassignment) left them deactivated but still
      // holding every client, with no audit row — an error the admin could not
      // reconcile. Now every early return above leaves the account untouched.
      const { data: member } = await supabase.from('profiles')
        .select('id, role, status').eq('id', id).maybeSingle();
      if (member?.role === 'super_admin' && member.status === 'active') {
        const g = await guardAndDeactivate();
        if (g.unavailable) {
          // The clients HAVE moved by this point, so the mutation needs an audit
          // row. Returning 4xx/5xx without one left unattributable changes to N
          // client_assignments rows — audit_log is the only forensic record here.
          await audit(profile, 'team.offboard_partial', 'profile', id, { reassignTo, reassignedCount: reassigned, reason: 'guard_unavailable' });
          return res.status(503).json({ error: `Clients were reassigned, but the safety check on deactivating this super admin is unavailable. Run migration 0006_deactivation_guard.sql. The member is still active and no client was lost.` });
        }
        if (g.blocked) {
          await audit(profile, 'team.offboard_partial', 'profile', id, { reassignTo, reassignedCount: reassigned, reason: 'last_active_super_admin' });
          return res.status(400).json({ error: `This is the only active super admin, so they cannot be offboarded. ${reassigned} client${reassigned === 1 ? '' : 's'} were reassigned — promote another super admin, then try again.` });
        }
      } else {
        const { error: offErr } = await supabase.from('profiles').update({ status: 'inactive' }).eq('id', id);
        if (offErr) {
          console.error('[team.offboard] deactivate failed', offErr);
          await audit(profile, 'team.offboard_partial', 'profile', id, { reassignTo, reassignedCount: reassigned, reason: 'deactivate_failed' });
          return res.status(500).json({ error: `Clients were reassigned but the member could not be deactivated. ${reassigned} client${reassigned === 1 ? '' : 's'} moved — try deactivating the account again.` });
        }
      }
      await audit(profile, 'team.offboard', 'profile', id, { reassignTo, reassignedCount: reassigned });
      return res.status(200).json({ ok: true, reassigned });
    }
    return res.status(400).json({ error: 'unknown action' });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
