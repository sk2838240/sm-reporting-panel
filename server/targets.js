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
    // "Targets visible to client" was enforced only by the dashboard filtering
    // the response client-side, so GET /api/targets still returned the full set
    // to anyone who called it. Enforce it here: for a client-role caller, the
    // response is empty when the agency has switched targets off.
    if (profile.role === 'client') {
      const { data: client, error: cErr } = await supabase.from('clients')
        .select('targets_visible').eq('id', clientId).maybeSingle();
      if (cErr) throw cErr;
      if (client && client.targets_visible === false) return res.status(200).json([]);
    }
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
    // Coerce here rather than letting Postgres reject it. The column is numeric,
    // so a string like "10,000" or "50%" produced a 500 *after* the delete
    // below had already committed — destroying the target and reporting failure.
    // A missing value is also rejected: Number('') is 0, which silently stored a
    // zero target and rendered as a real goal on the client dashboard.
    if (target_value === '' || target_value === null || target_value === undefined) {
      return res.status(400).json({ error: 'target_value is required' });
    }
    const num = Number(target_value);
    if (!Number.isFinite(num)) {
      return res.status(400).json({ error: 'target_value must be a number' });
    }

    // Upsert via a real UPDATE so a failure leaves the existing row intact.
    // The previous delete-then-insert had no transaction: any insert error
    // destroyed the target and the caller was told the save failed.
    const filters = (q) => {
      q = q.eq('client_id', client_id).eq('service', service).eq('metric_key', metric_key);
      return platform ? q.eq('platform', platform) : q.is('platform', null);
    };
    // .maybeSingle() errors (PGRST116) when MORE THAN ONE row matches, and
    // returns null data — indistinguishable from "not found" if the error is
    // discarded, which made this fall through to INSERT and append a duplicate
    // row on every save. The unique index does not prevent it either: Postgres
    // treats NULLs as distinct, so platform IS NULL (every SEO/ORM target) was
    // never protected. Read the id, then update by that exact key.
    const { data: existing, error: lookupErr } = await filters(supabase.from('targets').select('id')).limit(1);
    if (lookupErr) throw lookupErr;
    if (existing?.length) {
      const { data, error } = await supabase.from('targets')
        .update({ target_value: num, unit: unit || null })
        .eq('id', existing[0].id).select().single();
      if (error) throw error;
      await audit(profile, 'target.set', 'target', existing[0].id, { client_id, service, metric_key, target_value: num });
      return res.status(200).json(data);
    }
    const { data, error } = await supabase.from('targets').insert({
      client_id, service, metric_key, target_value: num, unit: unit || null, platform: platform || null,
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
