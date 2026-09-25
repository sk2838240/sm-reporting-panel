import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient, audit } from './helpers.js';

export default withHandler('clients', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    const { single, id, search, service, status, assignee } = req.query;

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
      return res.status(200).json({ ...(client || {}), team });
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
    if (status) q = q.eq('status', status); else q = q.neq('status', 'archived');
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    let rows = data || [];
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
    const { data, error } = await supabase.from('clients').insert({
      company_name, contact_name, email, phone,
      services: Array.isArray(services) ? services : ['seo', 'orm', 'social'],
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
