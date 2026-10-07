import supabase from './db-client.js';
import { withHandler, getProfile } from './helpers.js';

export default withHandler('audit', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;
  if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Clamp both ends. `Number('-5') || 100` returned -5 (truthy), which
  // PostgREST rejected — a 500 from a crafted ?limit=-5 in the admin UI.
  const requested = Number.parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 100, 1), 500);
  const { data, error } = await supabase.from('audit_log')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return res.status(200).json(data || []);
});
