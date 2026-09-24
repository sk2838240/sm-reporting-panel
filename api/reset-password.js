import supabase from './db-client.js';
import { withHandler, getProfile, audit, genPassword, sendEmail, siteOrigin } from './helpers.js';

// Super admin can reset a client or team member's password.
// Two modes:
//   1. action='send_link' — sends a Supabase password reset email to the user (no temp password needed)
//   2. action='temp_password' (default) — generates a new temp password, updates via admin API,
//      and tries to email it via Resend (falls back to returning it for manual sharing)
export default withHandler('reset-password', async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;
  if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });

  const { userId, action } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  // Look up the target user's profile + email
  const { data: targetProfile, error: profErr } = await supabase.from('profiles').select('id, email, full_name, role, client_id').eq('id', userId).maybeSingle();
  if (profErr || !targetProfile) return res.status(404).json({ error: 'User not found' });

  const origin = siteOrigin(req);

  // Mode 1: Send a password reset link email (uses Supabase's built-in email service)
  if (action === 'send_link') {
    // We need to use the anon-key client for resetPasswordForEmail so the email
    // is sent through Supabase's auth email service (not Resend).
    const { createClient } = await import('@supabase/supabase-js');
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { error: resetErr } = await anonClient.auth.resetPasswordForEmail(targetProfile.email, {
      redirectTo: `${origin}/reset-password`,
    });

    if (resetErr) {
      // Fallback: if Supabase email fails, generate a temp password and send via Resend
      const tempPassword = genPassword();
      const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, { password: tempPassword });
      if (updateErr) return res.status(400).json({ error: updateErr.message });

      const emailRes = await sendEmail({
        to: targetProfile.email,
        subject: 'Your dashboard password has been reset',
        html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto">
          <h2 style="color:#4f46e5">Password reset</h2>
          <p>Hi ${targetProfile.full_name || ''},</p>
          <p>Your dashboard password has been reset by an administrator. Sign in with your email and this new temporary password:</p>
          <p style="font-family:monospace;background:#f3f4f6;padding:10px;border-radius:8px">${tempPassword}</p>
          <p><a href="${origin}/login" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Sign in</a></p></div>`,
      });

      await audit(profile, 'user.password_reset', 'profile', userId, { targetEmail: targetProfile.email, method: 'temp_password_fallback', emailSent: emailRes.sent });

      return res.status(200).json({
        ok: true,
        method: 'temp_password',
        email: targetProfile.email,
        tempPassword: emailRes.sent ? undefined : tempPassword,
        emailSent: emailRes.sent,
        fallback: true,
      });
    }

    await audit(profile, 'user.password_reset', 'profile', userId, { targetEmail: targetProfile.email, method: 'send_link' });

    return res.status(200).json({
      ok: true,
      method: 'send_link',
      email: targetProfile.email,
      emailSent: true,
    });
  }

  // Mode 2: Generate a temp password (default)
  const tempPassword = genPassword();
  const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, { password: tempPassword });
  if (updateErr) return res.status(400).json({ error: updateErr.message });

  const emailRes = await sendEmail({
    to: targetProfile.email,
    subject: 'Your dashboard password has been reset',
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#4f46e5">Password reset</h2>
      <p>Hi ${targetProfile.full_name || ''},</p>
      <p>Your dashboard password has been reset by an administrator. Sign in with your email and this new temporary password:</p>
      <p style="font-family:monospace;background:#f3f4f6;padding:10px;border-radius:8px">${tempPassword}</p>
      <p><a href="${origin}/login" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Sign in</a></p>
      <p style="color:#888;font-size:12px">If you didn't expect this reset, please contact your account manager.</p></div>`,
  });

  await audit(profile, 'user.password_reset', 'profile', userId, { targetEmail: targetProfile.email, method: 'temp_password', emailSent: emailRes.sent });

  return res.status(200).json({
    ok: true,
    method: 'temp_password',
    email: targetProfile.email,
    fullName: targetProfile.full_name,
    tempPassword: emailRes.sent ? undefined : tempPassword,
    emailSent: emailRes.sent,
  });
});
