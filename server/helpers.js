import supabase from './db-client.js';

// CORS. The SPA is served from the same origin as these functions, so in the
// normal case no CORS header is needed at all. Cross-origin callers are only
// allowed if their origin is explicitly listed in ALLOWED_ORIGINS.
const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'];

function allowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...configured, ...LOCAL_ORIGINS]);
}

export function setCors(req, res) {
  const origin = req?.headers?.origin;
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
}

export function withHandler(routeName, handler) {
  return async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
      return await handler(req, res);
    } catch (err) {
      console.error(`[${routeName}]`, err);
      await logError(routeName, req.method, err);
      await captureError(err);
      return res.status(500).json({ error: err?.message || 'Server error' });
    }
  };
}

// Resolve the caller's profile from the Bearer token. Returns null when
// unauthenticated / inactive. { user, profile } where profile may be null
// (first login, before a profile row exists).
export async function getProfile(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile) return { user, profile: null };
  if (profile.status === 'inactive') return null;
  return { user, profile };
}

export function requireRole(profile, roles) {
  return !!profile && roles.includes(profile.role);
}

export async function canAccessClient(profile, clientId) {
  if (!profile) return false;
  const cid = Number(clientId);
  if (profile.role === 'super_admin') return true;
  if (profile.role === 'client') return profile.client_id === cid;
  if (profile.role === 'team_admin') {
    const { data } = await supabase
      .from('client_assignments').select('id')
      .eq('client_id', cid).eq('team_member_id', profile.id).maybeSingle();
    return !!data;
  }
  return false;
}

export async function audit(profile, action, entityType, entityId, details) {
  try {
    await supabase.from('audit_log').insert({
      actor_id: profile?.id || null,
      actor_email: profile?.email || 'system',
      action, entity_type: entityType, entity_id: String(entityId ?? ''),
      details: details || null,
    });
  } catch (e) { console.error('audit insert failed', e.message); }
}

export async function logError(route, method, err) {
  try {
    await supabase.from('error_log').insert({
      route, method,
      message: String(err?.message || err).slice(0, 1000),
      stack: err?.stack ? String(err.stack).slice(0, 4000) : null,
    });
  } catch {}
}

// Sentry integration is optional — requires SENTRY_DSN env var AND the
// @sentry/node package to be installed. Errors are always logged to the
// error_log table via logError() regardless, so this is a no-op by default.
export async function captureError() {
  // Intentionally empty — add SENTRY_DSN + install @sentry/node to enable.
}

// Generates a password with at least one lowercase, uppercase, digit and
// symbol, all drawn from the random stream (no fixed, guessable suffix).
export function genPassword(len = 14) {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = lower + upper + digits + symbols;

  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  const out = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (out.length < len) out.push(pick(all));

  // Shuffle so the guaranteed characters aren't always in the same positions.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

export function siteOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}

// Transactional email via Resend. Requires RESEND_API_KEY (server-side secret).
// Returns { sent } so callers can fall back to in-app notifications.
export async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'no-key' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Agency Portal <onboarding@resend.dev>',
        to: Array.isArray(to) ? to : [to], subject, html,
      }),
    });
    if (!r.ok) { const t = await r.text(); return { sent: false, reason: t }; }
    return { sent: true };
  } catch (e) { return { sent: false, reason: e.message }; }
}
