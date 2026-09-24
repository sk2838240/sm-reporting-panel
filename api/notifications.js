import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient } from './helpers.js';

export default withHandler('notifications', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    let clientId = req.query.clientId;
    if (profile.role === 'client') clientId = profile.client_id;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!(await canAccessClient(profile, clientId))) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabase.from('notifications').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    const unread = (data || []).filter(n => !n.read).length;
    return res.status(200).json({ items: data || [], unread });
  }

  if (req.method === 'PUT') {
    const { id, all, clientId } = req.body || {};
    if (all && clientId) {
      if (!(await canAccessClient(profile, clientId))) return res.status(403).json({ error: 'Forbidden' });
      const { error } = await supabase.from('notifications').update({ read: true }).eq('client_id', clientId).eq('read', false);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: n } = await supabase.from('notifications').select('client_id').eq('id', id).maybeSingle();
    if (n && !(await canAccessClient(profile, n.client_id))) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabase.from('notifications').update({ read: true }).eq('id', id).select().single();
    if (error) throw error;
    return res.status(200).json(data);
  }

  res.status(405).json({ error: 'Method not allowed' });
});
