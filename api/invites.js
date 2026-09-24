import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient, audit, genPassword, sendEmail, siteOrigin } from './helpers.js';

// Admin-initiated invites. No open signup. Creates the auth user (service-role
// admin API), the profile row, and an invite record. Sends an invite email via
// Resend when RESEND_API_KEY is configured; otherwise returns a temp password
// the admin can share manually.
export default withHandler('invites', async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  const { email, role, fullName, clientId } = req.body || {};
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });
  if (!['client', 'team_admin'].includes(role)) return res.status(400).json({ error: 'invalid role' });

  if (role === 'team_admin' && profile.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can invite team members' });
  if (role === 'client') {
    if (!clientId) return res.status(400).json({ error: 'clientId required for client invites' });
    if (profile.role === 'team_admin' && !(await canAccessClient(profile, clientId))) return res.status(403).json({ error: 'Not assigned to this client' });
    if (profile.role !== 'super_admin' && profile.role !== 'team_admin') return res.status(403).json({ error: 'Forbidden' });
  }

  const tempPassword = genPassword();
  const { data: created, error } = await supabase.auth.admin.createUser({
    email, password: tempPassword, email_confirm: true,
    user_metadata: { full_name: fullName, role, client_id: clientId || null },
  });
  if (error) return res.status(400).json({ error: error.message });
  const uid = created.user.id;

  await supabase.from('profiles').insert({
    id: uid, email, full_name: fullName || email.split('@')[0],
    role, client_id: clientId || null, status: 'active',
  });

  // NOTE: an `invites` row used to be written here with a token, status and
  // expiry. Nothing ever read it — onboarding hands out a temp password — so it
  // was dead data implying a redemption flow that does not exist. The audit_log
  // entry below records the invite for real.
  const { data: client } = clientId ? await supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle() : { data: null };
  const origin = siteOrigin(req);
  const subject = role === 'client'
    ? `You're invited to ${client?.company_name || 'your'} reporting portal`
    : `You're invited to join the agency reporting portal`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#4f46e5">You're invited</h2>
    <p>Hi ${fullName || ''},</p>
    <p>You've been invited to ${role === 'client' ? (client?.company_name || 'your') + ' ' : ''}the agency reporting portal${role === 'team_admin' ? ' as a team admin' : ''}.</p>
    <p>Sign in with your email and this temporary password, then change it from your profile:</p>
    <p style="font-family:monospace;background:#f3f4f6;padding:10px;border-radius:8px">${tempPassword}</p>
    <p><a href="${origin}/login" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Sign in</a></p>
    <p style="color:#888;font-size:12px">If you didn't expect this invite, you can ignore this email.</p></div>`;
  const emailRes = await sendEmail({ to: email, subject, html });

  await audit(profile, 'invite.create', 'invite', uid, { email, role, clientId, emailSent: emailRes.sent });
  return res.status(201).json({
    ok: true, userId: uid, emailSent: emailRes.sent,
    tempPassword: emailRes.sent ? undefined : tempPassword,
  });
});
