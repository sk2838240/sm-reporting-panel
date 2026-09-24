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
      if (full_name !== undefined) updates.full_name = full_name;
      if (email !== undefined) updates.email = email;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

      // Update the auth identity FIRST. If this fails (most often because the
      // address is already taken), abort without touching profiles — otherwise
      // the two desync and the member cannot sign in with the displayed email.
      if (email !== undefined && email) {
        const { error: authErr } = await supabase.auth.admin.updateUserById(id, { email });
        if (authErr) return res.status(400).json({ error: `Could not update login email: ${authErr.message}` });
      }

      const { data, error } = await supabase.from('profiles').update(updates).eq('id', id).select().single();
      if (error) throw error;
      await audit(profile, 'team.edit', 'profile', id, updates);
      return res.status(200).json(data);
    }

    if (action === 'deactivate') {
      const { data, error } = await supabase.from('profiles').update({ status: 'inactive' }).eq('id', id).select().single();
      if (error) throw error;
      await audit(profile, 'team.deactivate', 'profile', id, {});
      return res.status(200).json(data);
    }

    if (action === 'reactivate') {
      const { data, error } = await supabase.from('profiles').update({ status: 'active' }).eq('id', id).select().single();
      if (error) throw error;
      await audit(profile, 'team.reactivate', 'profile', id, {});
      return res.status(200).json(data);
    }

    if (action === 'offboard') {
      if (!reassignTo) return res.status(400).json({ error: 'reassignTo required' });
      const { data: assigns } = await supabase.from('client_assignments').select('client_id').eq('team_member_id', id);
      for (const a of assigns || []) {
        await supabase.from('client_assignments').delete().eq('client_id', a.client_id).eq('team_member_id', id);
        const { data: dup } = await supabase.from('client_assignments').select('id').eq('client_id', a.client_id).eq('team_member_id', reassignTo).maybeSingle();
        if (!dup) await supabase.from('client_assignments').insert({ client_id: a.client_id, team_member_id: reassignTo });
      }
      await supabase.from('profiles').update({ status: 'inactive' }).eq('id', id);
      await audit(profile, 'team.offboard', 'profile', id, { reassignTo, reassignedCount: (assigns || []).length });
      return res.status(200).json({ ok: true, reassigned: (assigns || []).length });
    }
    return res.status(400).json({ error: 'unknown action' });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
