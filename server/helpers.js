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
      return res.status(500).json({ error: publicMessage(err) });
    }
  };
}

// PostgREST error text names the table, the column and the constraint
// ("new row for relation \"reports\" violates check constraint
// \"reports_service_check\""). Returning it verbatim to the caller is a schema
// leak, so surface a generic message for anything the client did not write.
// Full detail still goes to logError() and the console.
function publicMessage(err) {
  const msg = String(err?.message || '');
  const code = String(err?.code || '');
  // Postgres SQLSTATEs are 5 chars (23505, 22P02, 23514). PostgREST uses
  // PGRST-prefixed codes and messages, which the 5-char test alone misses.
  const isPostgres = /^[0-9A-Z]{5}$/.test(code);
  const isPostgrest = /^PGRST/.test(code) || /JSON object requested|Results contain 0 rows/i.test(msg);
  const isDatabaseError = isPostgres || isPostgrest
    || /check constraint|violates|relation "|column "|duplicate key|foreign key|invalid input syntax|pg_|postgrest/i.test(msg);
  if (isDatabaseError) return 'The server could not complete that request. Please check the values entered and try again.';
  return msg || 'Server error';
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

// @supabase/supabase-js RESOLVES with { data: null, error } on failure — it does
// not reject — so a try/catch around the insert never fired and every failed
// write vanished with no console line and no HTTP signal. The audit_log is the
// app's only forensic record (it is how password resets and delete-request
// dismissals are traced), so a silent hole there is not acceptable. Check
// `error` explicitly and log it.
export async function audit(profile, action, entityType, entityId, details) {
  try {
    const { error } = await supabase.from('audit_log').insert({
      actor_id: profile?.id || null,
      actor_email: profile?.email || 'system',
      action, entity_type: entityType, entity_id: String(entityId ?? ''),
      details: details || null,
    });
    if (error) {
      console.error(`[audit] insert failed for ${action} on ${entityType}:${entityId}`, error.message || error);
    }
  } catch (e) {
    console.error(`[audit] insert threw for ${action} on ${entityType}:${entityId}`, e?.message || e);
  }
}

export async function logError(route, method, err) {
  try {
    const { error } = await supabase.from('error_log').insert({
      route, method,
      message: String(err?.message || err).slice(0, 1000),
      stack: err?.stack ? String(err.stack).slice(0, 4000) : null,
    });
    // Never throw from the error logger, and never recurse into withHandler.
    if (error) console.error(`[error_log] insert failed for ${route} ${method}:`, error.message || error);
  } catch (e) {
    console.error(`[error_log] insert threw for ${route} ${method}:`, e?.message || e);
  }
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

// Origin for links in transactional email (password reset, invites).
//
// Not built from the Host header: a forged `Host: attacker.example` would place
// a valid reset link on the attacker's domain. Resolution order:
//   1. SITE_ORIGIN / PUBLIC_ORIGIN  — explicit override. Set this if you have one.
//   2. ALLOWED_ORIGINS[0]            — optional, and usually unset.
//   3. Vercel's own VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL. These are
//      injected by the platform into the function environment and cannot be set
//      by a caller, so they are safe and need no configuration — without this
//      step a stock deployment would have no origin at all and every invite and
//      password reset would fail.
//   4. Host header                   — only with ALLOW_HOST_ORIGIN=1.
export function siteOrigin(req) {
  const explicit = (process.env.SITE_ORIGIN || process.env.PUBLIC_ORIGIN || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length) return allowed[0].replace(/\/+$/, '');

  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '').trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  if (process.env.ALLOW_HOST_ORIGIN === '1') {
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers.host || '').split(',')[0].trim();
    if (host) return `${proto}://${host}`;
  }
  return '';
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
