import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient } from './helpers.js';

// Returns the client login profile (if any) for a given client_id.
// Used by the admin console to show the client's login account + reset password.
export default withHandler('client-users', async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;
  if (profile.role !== 'super_admin' && profile.role !== 'team_admin') return res.status(403).json({ error: 'Admin only' });

  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  // Team admins can only see users for clients they're assigned to
  if (!(await canAccessClient(profile, clientId))) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabase.from('profiles')
    .select('id, email, full_name, role, status, created_at')
    .eq('role', 'client')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return res.status(200).json(data || []);
});
