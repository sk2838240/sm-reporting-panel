import supabase from './db-client.js';
import { withHandler, getProfile, audit } from './helpers.js';

export default withHandler('assignments', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;
  if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });

  if (req.method === 'GET') {
    const { clientId } = req.query;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    const { data, error } = await supabase.from('client_assignments').select('team_member_id, client_id').eq('client_id', clientId);
    if (error) throw error;
    let rows = data || [];
    if (rows.length) {
      const ids = rows.map(r => r.team_member_id);
      const { data: profs } = await supabase.from('profiles').select('id, email, full_name, status').in('id', ids);
      const map = Object.fromEntries((profs || []).map(p => [p.id, p]));
      rows = rows.map(r => ({ ...r, member: map[r.team_member_id] || null }));
    }
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { clientId, teamMemberId } = req.body || {};
    if (!clientId || !teamMemberId) return res.status(400).json({ error: 'clientId and teamMemberId required' });
    const { data: exist } = await supabase.from('client_assignments').select('id').eq('client_id', clientId).eq('team_member_id', teamMemberId).maybeSingle();
    if (exist) return res.status(200).json({ ok: true, exists: true });
    const { data, error } = await supabase.from('client_assignments').insert({ client_id: clientId, team_member_id: teamMemberId }).select().single();
    if (error) throw error;
    await audit(profile, 'team.assign', 'client', clientId, { teamMemberId });
    return res.status(201).json(data);
  }

  if (req.method === 'DELETE') {
    const { clientId, teamMemberId } = req.body || {};
    if (!clientId || !teamMemberId) return res.status(400).json({ error: 'clientId and teamMemberId required' });
    const { error } = await supabase.from('client_assignments').delete().eq('client_id', clientId).eq('team_member_id', teamMemberId);
    if (error) throw error;
    await audit(profile, 'team.unassign', 'client', clientId, { teamMemberId });
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
