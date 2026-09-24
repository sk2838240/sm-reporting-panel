import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient, audit } from './helpers.js';

// Annotations pinned to a specific period on a client's service charts.
// Admins create them in the report editor; clients see them as markers on trend charts.
export default withHandler('annotations', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    const { clientId, service } = req.query;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!(await canAccessClient(profile, clientId))) return res.status(403).json({ error: 'Forbidden' });
    let q = supabase.from('annotations').select('*').eq('client_id', clientId);
    if (service) q = q.eq('service', service);
    const { data, error } = await q.order('period_start', { ascending: true });
    if (error) throw error;
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const { client_id, service, period_start, note } = req.body || {};
    if (!client_id || !service || !period_start || !note) return res.status(400).json({ error: 'client_id, service, period_start, note required' });
    if (!(await canAccessClient(profile, client_id))) return res.status(403).json({ error: 'Forbidden' });
    if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot create annotations' });
    const { data, error } = await supabase.from('annotations').insert({
      client_id, service, period_start, note: String(note).slice(0, 500),
      created_by: profile.id,
    }).select().single();
    if (error) throw error;
    await audit(profile, 'annotation.create', 'annotation', data.id, { service, period_start });
    return res.status(201).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: ann } = await supabase.from('annotations').select('client_id').eq('id', id).maybeSingle();
    if (ann && !(await canAccessClient(profile, ann.client_id))) return res.status(403).json({ error: 'Forbidden' });
    if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot delete annotations' });
    const { error } = await supabase.from('annotations').delete().eq('id', id);
    if (error) throw error;
    await audit(profile, 'annotation.delete', 'annotation', id, {});
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
