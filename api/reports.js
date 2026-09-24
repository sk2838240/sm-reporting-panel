import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient, audit, sendEmail } from './helpers.js';

async function loadReport(id) {
  const { data, error } = await supabase.from('reports').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function snapshotRevision(reportId, version, report, publishedBy, note) {
  await supabase.from('report_revisions').insert({
    report_id: reportId, version,
    snapshot: {
      metrics: report.metrics, breakdowns: report.breakdowns,
      lists: report.lists, achievements: report.achievements,
      period_label: report.period_label,
    },
    note: note || null, published_by: publishedBy,
    published_at: new Date().toISOString(),
  });
}

async function notifyPublish(report, isRevise) {
  const { data: client } = await supabase.from('clients').select('company_name,email').eq('id', report.client_id).maybeSingle();
  const title = isRevise
    ? `${report.period_label} report updated`
    : `New ${report.period_label} report is live`;
  const message = isRevise
    ? `Your ${report.service.toUpperCase()} report for ${report.period_label} has been revised (v${report.version}).`
    : `Your ${report.service.toUpperCase()} report for ${report.period_label} has been published.`;
  await supabase.from('notifications').insert({
    client_id: report.client_id, report_id: report.id,
    type: isRevise ? 'revision' : 'publish', title, message, read: false,
  });
  if (client?.email) {
    await sendEmail({
      to: client.email,
      subject: title,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto">
        <h2 style="color:#4f46e5">${title}</h2>
        <p>Hi ${client.company_name},</p>
        <p>${message} View it in your client portal.</p>
        <p style="color:#888;font-size:12px">This is an automated message from your agency reporting portal.</p></div>`,
    });
  }
}

export default withHandler('reports', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    const { single, id } = req.query;
    if (single === '1' && id) {
      const report = await loadReport(id);
      if (!report) return res.status(404).json({ error: 'Not found' });
      if (!(await canAccessClient(profile, report.client_id))) return res.status(403).json({ error: 'Forbidden' });
      // Clients must never see unpublished drafts, including by guessing an id.
      // 404 (not 403) so the response doesn't confirm the report exists.
      if (profile.role === 'client' && report.status !== 'published') {
        return res.status(404).json({ error: 'Not found' });
      }
      const { data: revisions } = await supabase.from('report_revisions').select('id, version, note, published_by, published_at').eq('report_id', id).order('version', { ascending: false });
      return res.status(200).json({ ...report, revisions: revisions || [] });
    }
    const { clientId, service, status } = req.query;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!(await canAccessClient(profile, clientId))) return res.status(403).json({ error: 'Forbidden' });
    let q = supabase.from('reports').select('*').eq('client_id', clientId);
    if (service) q = q.eq('service', service);
    // Clients only ever see published reports. The status filter is admin-only —
    // combining the two previously produced a contradictory `published AND draft`.
    if (profile.role === 'client') {
      q = q.eq('status', 'published');
    } else if (status) {
      q = q.eq('status', status);
    }
    const { data, error } = await q.order('period_start', { ascending: true });
    if (error) throw error;
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { client_id, service, period_type, period_label, period_start, period_end } = body;
    if (!client_id || !service || !period_start || !period_end) return res.status(400).json({ error: 'client_id, service, period_start, period_end required' });
    if (!(await canAccessClient(profile, client_id))) return res.status(403).json({ error: 'Forbidden' });
    if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot create reports' });
    const { data, error } = await supabase.from('reports').insert({
      client_id, service,
      period_type: period_type || 'month',
      period_label: period_label || '',
      period_start, period_end,
      status: 'draft', version: 1,
      metrics: {}, breakdowns: {}, lists: {}, achievements: [],
      created_by: profile.id,
    }).select().single();
    if (error) throw error;

    // "Duplicate last month": copy metrics, breakdowns, lists from source
    // report so the team only edits what changed. Achievements stay fresh.
    await audit(profile, 'report.create', 'report', data.id, { client_id, service, period_label });

    if (body.duplicateFromId) {
      // Scope the source to the SAME client (and service) — otherwise a team
      // admin assigned to one client could copy another client's report data
      // by passing an arbitrary id.
      const { data: src } = await supabase.from('reports').select('metrics,breakdowns,lists')
        .eq('id', body.duplicateFromId).eq('client_id', client_id).eq('service', service).maybeSingle();
      if (src) {
        const { data: updated } = await supabase.from('reports').update({
          metrics: src.metrics || {}, breakdowns: src.breakdowns || {}, lists: src.lists || {},
        }).eq('id', data.id).select().single();
        if (updated) return res.status(201).json(updated);
      }
    }
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, action, note, ...fields } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: 'id and action required' });
    const report = await loadReport(id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    if (!(await canAccessClient(profile, report.client_id))) return res.status(403).json({ error: 'Forbidden' });
    if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot edit reports' });

    const patch = {};
    for (const k of ['period_type', 'period_label', 'period_start', 'period_end', 'metrics', 'breakdowns', 'lists', 'achievements']) {
      if (k in fields) patch[k] = fields[k];
    }

    if (action === 'save') {
      if (report.status !== 'draft') return res.status(400).json({ error: 'Only drafts can be saved. Use revise for published reports.' });
      const { data, error } = await supabase.from('reports').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (action === 'publish') {
      if (report.status === 'published') return res.status(400).json({ error: 'Already published. Use revise to update.' });
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('reports').update({ ...patch, status: 'published', published_at: now, updated_at: now }).eq('id', id).select().single();
      if (error) throw error;
      await snapshotRevision(id, data.version, data, profile.id, note || 'Initial publish');
      await notifyPublish(data, false);
      await audit(profile, 'report.publish', 'report', id, { service: data.service, period_label: data.period_label });
      return res.status(200).json(data);
    }

    if (action === 'revise') {
      if (report.status !== 'published') return res.status(400).json({ error: 'Only published reports can be revised' });
      await snapshotRevision(id, report.version, report, profile.id, note || 'Correction');
      const now = new Date().toISOString();
      const nextVersion = report.version + 1;
      const { data, error } = await supabase.from('reports').update({ ...patch, version: nextVersion, published_at: now, updated_at: now }).eq('id', id).select().single();
      if (error) throw error;
      await notifyPublish(data, true);
      await audit(profile, 'report.revise', 'report', id, { version: nextVersion, note });
      return res.status(200).json(data);
    }

    if (action === 'revert-to-draft') {
      if (report.status !== 'published') return res.status(400).json({ error: 'Only published reports can be reverted' });
      // Persist any edits sent along with the revert — the editor sends the full
      // payload, and silently dropping it lost the user's work.
      const { data, error } = await supabase.from('reports').update({
        ...patch, status: 'draft', updated_at: new Date().toISOString(),
      }).eq('id', id).select().single();
      if (error) throw error;
      await audit(profile, 'report.unpublish', 'report', id, { note });
      return res.status(200).json(data);
    }
    return res.status(400).json({ error: 'unknown action' });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const report = await loadReport(id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    if (!(await canAccessClient(profile, report.client_id))) return res.status(403).json({ error: 'Forbidden' });
    // Super admins can delete any report. Team admins can mark for deletion.
    if (profile.role === 'super_admin') {
      const { error } = await supabase.from('reports').delete().eq('id', id);
      if (error) throw error;
      await audit(profile, 'report.delete', 'report', id, { service: report.service, period_label: report.period_label });
      return res.status(200).json({ ok: true });
    }
    // Team admin: mark as delete-requested. Stored in a real column so the
    // report editor's lists rewrite can no longer wipe the request.
    if (profile.role === 'team_admin') {
      const { error } = await supabase.from('reports')
        .update({ delete_requested: true, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await audit(profile, 'report.delete_request', 'report', id, { service: report.service, period_label: report.period_label });
      return res.status(200).json({ ok: true, deleteRequested: true });
    }
    return res.status(403).json({ error: 'Not authorized to delete' });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
