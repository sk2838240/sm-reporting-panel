import supabase from './db-client.js';
import { withHandler, getProfile } from './helpers.js';

export default withHandler('audit', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;
  if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { data, error } = await supabase.from('audit_log')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return res.status(200).json(data || []);
});
