import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient, audit } from './helpers.js';

export default withHandler('targets', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    const { clientId, service } = req.query;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!(await canAccessClient(profile, clientId))) return res.status(403).json({ error: 'Forbidden' });
    let q = supabase.from('targets').select('*').eq('client_id', clientId);
    if (service) q = q.eq('service', service);
    const { data, error } = await q.order('id', { ascending: true });
    if (error) throw error;
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const { client_id, service, metric_key, target_value, unit, platform } = req.body || {};
    if (!client_id || !service || !metric_key) return res.status(400).json({ error: 'client_id, service, metric_key required' });
    if (!(await canAccessClient(profile, client_id))) return res.status(403).json({ error: 'Forbidden' });
    if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot edit targets' });
    // upsert by (client_id, service, metric_key, platform)
    let delQ = supabase.from('targets').delete().eq('client_id', client_id).eq('service', service).eq('metric_key', metric_key);
    if (platform) delQ = delQ.eq('platform', platform); else delQ = delQ.is('platform', null);
    await delQ;
    const { data, error } = await supabase.from('targets').insert({
      client_id, service, metric_key, target_value, unit: unit || null, platform: platform || null,
    }).select().single();
    if (error) throw error;
    await audit(profile, 'target.set', 'target', data.id, { client_id, service, metric_key, target_value });
    return res.status(201).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: target } = await supabase.from('targets').select('client_id').eq('id', id).maybeSingle();
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (!(await canAccessClient(profile, target.client_id))) return res.status(403).json({ error: 'Forbidden' });
    if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot edit targets' });
    const { error } = await supabase.from('targets').delete().eq('id', id);
    if (error) throw error;
    await audit(profile, 'target.delete', 'target', id, { client_id: target.client_id });
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
