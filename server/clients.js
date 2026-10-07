import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient, audit } from './helpers.js';

// Mirrors the services CHECK constraint in supabase/migrations/0001_init.sql.
const SERVICE_KEYS = ['seo', 'orm', 'social'];

// Every consumer treats `services` as an array of service keys, and the column
// is jsonb, so an unvalidated value is stored and then throws in every
// client-facing component — bricking the admin console for all super admins,
// with no in-app repair path because the Edit modal lives behind the page that
// crashed. Normalise on the way in; return null when nothing valid remains.
function normaliseServices(value) {
  const list = Array.isArray(value)
    ? value
    // A bare string is the most likely hand-crafted/legacy shape; wrap it
    // rather than rejecting a value that is clearly recoverable.
    : (typeof value === 'string' ? [value] : null);
  if (!list) return null;
  const cleaned = [...new Set(list
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => SERVICE_KEYS.includes(s)))];
  return cleaned.length ? cleaned : null;
}

// Every client-facing component indexes SERVICE_META by a value from this list
// and then reads `.accent`, so an unrecognised key ("pr", "SEO") throws into the
// ErrorBoundary and blanks the page. Normalise on read as well as on write, so a
// row stored before the PUT validation — or edited directly in the database —
// degrades to its valid services instead of bricking the account.
function sanitiseClient(row) {
  if (!row) return row;
  return { ...row, services: normaliseServices(row.services) || [] };
}

export default withHandler('clients', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    const { single, id, search, service, status, assignee, includeArchived } = req.query;

    if (single === '1' && id) {
      if (!(await canAccessClient(profile, id))) return res.status(403).json({ error: 'Forbidden' });
      const { data: client, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      const { data: assigns } = await supabase.from('client_assignments').select('team_member_id').eq('client_id', id);
      let team = [];
      if (assigns?.length) {
        const ids = assigns.map(a => a.team_member_id);
        const { data: profs } = await supabase.from('profiles').select('id, email, full_name').in('id', ids);
        team = profs || [];
      }
      // `team` is spread ALONGSIDE the sanitised row, never used as a fallback:
      // `sanitiseClient(client) || { team }` would run the fallback branch only
      // when the client row is missing, dropping `team` from every real
      // response — the "Manage access" modal would then show "No team members
      // assigned" permanently. Keep `{ ...(row || {}), team }` in that order.
      return res.status(200).json({ ...(sanitiseClient(client) || {}), team });
    }

    let q = supabase.from('clients').select('*');
    if (profile.role === 'client') {
      q = q.eq('id', profile.client_id);
    } else if (profile.role === 'team_admin') {
      const { data: assigns } = await supabase.from('client_assignments').select('client_id').eq('team_member_id', profile.id);
      const ids = (assigns || []).map(a => a.client_id);
      if (!ids.length) return res.status(200).json([]);
      q = q.in('id', ids);
    }
    // `includeArchived=1` ADDS archived clients to the list rather than
    // replacing it. The old behaviour meant the admin console's checkbox
    // labelled "Archived" showed archived ONLY — every active client vanished
    // when it was ticked, which reads as data loss.
    if (status) q = q.eq('status', status);
    // `status <> 'archived'` evaluates to NULL for a NULL status, so those rows
    // would silently vanish. `or()` keeps them. A pre-existing table may never
    // have received the NOT NULL from 0001_init.sql's `create table if not
    // exists`, so this is not hypothetical.
    else if (includeArchived !== '1') q = q.or('status.is.null,status.neq.archived');
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    let rows = (data || []).map(sanitiseClient);
    if (search) {
      const s = String(search).toLowerCase();
      rows = rows.filter(c =>
        (c.company_name || '').toLowerCase().includes(s) ||
        (c.contact_name || '').toLowerCase().includes(s) ||
        (c.email || '').toLowerCase().includes(s));
    }
    if (service) rows = rows.filter(c => Array.isArray(c.services) && c.services.includes(service));
    if (assignee) {
      const { data: a } = await supabase.from('client_assignments').select('client_id').eq('team_member_id', assignee);
      const set = new Set((a || []).map(x => x.client_id));
      rows = rows.filter(c => set.has(c.id));
    }
    // Attach assignee ids so the admin console can show a team count per row.
    if (rows.length) {
      const { data: allAssigns } = await supabase.from('client_assignments').select('client_id, team_member_id').in('client_id', rows.map(c => c.id));
      const byClient = {};
      (allAssigns || []).forEach(a => { (byClient[a.client_id] ||= []).push(a.team_member_id); });
      rows = rows.map(c => ({ ...c, _assignees: byClient[c.id] || [] }));
    }
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });
    const { company_name, contact_name, email, phone, services, logo_url } = req.body || {};
    if (!company_name) return res.status(400).json({ error: 'company_name required' });
    // Store the NORMALISED value, not the raw one. Validating and then inserting
    // the input verbatim made the check decorative: ["SEO", " orm "] passed and
    // was stored as-is, so `c.services.includes('seo')` never matched and
    // SERVICE_META['SEO'] was undefined in every client-facing component.
    const normalised = services === undefined ? [...SERVICE_KEYS] : normaliseServices(services);
    if (normalised === null) {
      return res.status(400).json({ error: `services must be an array containing at least one of: ${SERVICE_KEYS.join(', ')}` });
    }
    const { data, error } = await supabase.from('clients').insert({
      company_name, contact_name, email, phone,
      services: normalised,
      logo_url: logo_url || null, status: 'active',
    }).select().single();
    if (error) throw error;
    await audit(profile, 'client.create', 'client', data.id, { company_name });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, action, ...fields } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });

    const isSuperAdmin = profile.role === 'super_admin';

    // Archiving is account management — super admin only.
    if (action === 'archive' || action === 'unarchive') {
      if (!isSuperAdmin) return res.status(403).json({ error: 'Super admin only' });
      const archived = action === 'archive';
      const { data, error } = await supabase.from('clients')
        .update({ status: archived ? 'archived' : 'active', archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id).select().single();
      if (error) throw error;
      await audit(profile, archived ? 'client.archive' : 'client.unarchive', 'client', id, {});
      return res.status(200).json(data);
    }

    // Company details are account management — super admin only.
    const COMPANY_FIELDS = ['company_name', 'contact_name', 'email', 'phone', 'services', 'logo_url'];

    if (!isSuperAdmin) {
      if (profile.role !== 'team_admin') return res.status(403).json({ error: 'Forbidden' });
      if (COMPANY_FIELDS.some((k) => k in fields)) return res.status(403).json({ error: 'Super admin only' });
      if (!(await canAccessClient(profile, id))) return res.status(403).json({ error: 'Forbidden' });
    }

    const allowed = {};
    if (isSuperAdmin) {
      for (const k of COMPANY_FIELDS) if (k in fields) allowed[k] = fields[k];
    }
    // `services` is jsonb, so any JSON value would be stored. Every consumer
    // treats it as an array (`c.services.map(...)` in the client list, the
    // service tabs, the badge row), so a single bad value throws in every
    // client-facing component and bricks the admin console for all super admins
    // — with no in-app way to repair it, because the Edit modal lives behind the
    // page that crashed. POST already coerced; PUT must validate too.
    if ('services' in allowed) {
      const cleaned = normaliseServices(allowed.services);
      if (!cleaned) {
        return res.status(400).json({ error: `services must be an array containing at least one of: ${SERVICE_KEYS.join(', ')}` });
      }
      allowed.services = cleaned;
    }
    if ('company_name' in allowed && !String(allowed.company_name ?? '').trim()) {
      return res.status(400).json({ error: 'company_name cannot be empty' });
    }
    // Objectives and target visibility are reporting settings the team admin
    // running the account owns, so they are writable by either admin role for
    // an accessible client. ClientDetail exposes both to team admins, so if
    // this were super-admin-only those controls would be dead.
    if ('objectives' in fields) {
      if (!Array.isArray(fields.objectives)) return res.status(400).json({ error: 'objectives must be an array' });
      allowed.objectives = fields.objectives.map((o) => String(o ?? '').slice(0, 500)).filter(Boolean);
    }
    if ('targets_visible' in fields) allowed.targets_visible = !!fields.targets_visible;
    if ('compare_visible' in fields) allowed.compare_visible = !!fields.compare_visible;
    if (Object.keys(allowed).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const { data, error } = await supabase.from('clients').update(allowed).eq('id', id).select().single();
    if (error) throw error;
    await audit(profile, 'client.update', 'client', id, allowed);
    return res.status(200).json(data);
  }

  res.status(405).json({ error: 'Method not allowed (clients are soft-deleted via archive)' });
});
