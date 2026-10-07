import supabase from './db-client.js';
import { withHandler, getProfile, audit } from './helpers.js';

// Counts only ACTIVE super admins. An inactive row must not block bootstrap:
// otherwise deactivating the last super admin made them un-recoverable, because
// getProfile() 401s for inactive users, so the admin could not reach the team
// screen to reactivate anyone, and this count kept refusing to re-bootstrap.
async function superAdminCount() {
  const { count } = await supabase.from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'super_admin').eq('status', 'active');
  return count || 0;
}

// Bootstrapping the first super admin is gated on an explicit operator opt-in:
// BOOTSTRAP_SUPER_ADMIN_EMAIL must be set AND match the signing-in user, AND no
// super admin may exist yet. Without it, unknown users are provisioned as
// ordinary clients — never as admins. This closes the window where whoever
// signed in first on a fresh deployment silently became super admin.
async function resolveBootstrapRole(user) {
  const allowEmail = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!allowEmail) return null;
  if ((user.email || '').trim().toLowerCase() !== allowEmail) return null;
  if (await superAdminCount() > 0) return null;
  return 'super_admin';
}

export default withHandler('me', async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { user, profile } = ctx;

  let prof = profile;
  if (!prof) {
    // First-time login with no profile row -> auto-provision as a client, or as
    // the bootstrap super admin when the operator has explicitly designated
    // this email for that role.
    const bootstrapRole = await resolveBootstrapRole(user);
    const { error: insErr } = await supabase.from('profiles').insert({
      id: user.id, email: user.email,
      full_name: user.user_metadata?.full_name || String(user.email || '').split('@')[0],
      role: bootstrapRole || 'client', status: 'active',
    });
    // profiles.id is the primary key, so two concurrent first loads (two tabs,
    // or the client's own retry pair) collided on 23505. The loser threw a 500
    // even though the row exists and everything is fine — re-read instead.
    if (insErr && insErr.code !== '23505') throw insErr;
    const { data: created, error: readErr } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (readErr) throw readErr;
    if (!created) throw new Error('Could not create or load your profile. Please try again.');
    prof = created;
    if (insErr) return res.status(200).json(await buildResponse(prof, user));
    await audit(prof, bootstrapRole ? 'profile.bootstrap_super_admin' : 'profile.autoprovision', 'profile', user.id, { role: prof.role });
  }

  return res.status(200).json(await buildResponse(prof, user));
});

async function buildResponse(prof, user) {
  const out = { profile: prof, user: { id: user.id, email: user.email } };
  if (prof.role === 'client') {
    const { data: client } = await supabase.from('clients').select('*').eq('id', prof.client_id).maybeSingle();
    out.client = client;
  } else if (prof.role === 'team_admin') {
    const { data: assigns } = await supabase.from('client_assignments').select('client_id').eq('team_member_id', prof.id);
    out.assignedClientIds = (assigns || []).map(a => a.client_id);
  }
  return out;
}
