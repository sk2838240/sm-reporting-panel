import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient, audit, sendEmail } from './helpers.js';

// Values the reports table CHECK-constraints allow. Validating in the handler
// turns a 23514 (whose message names the table and the constraint) into a 400
// the caller can act on.
const SERVICES = ['seo', 'orm', 'social'];
const PERIOD_TYPES = ['month', 'cycle'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(v) {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

async function loadReport(id) {
  const { data, error } = await supabase.from('reports').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function snapshotRevision(reportId, version, report, publishedBy, note) {
  // Errors are surfaced, not swallowed: a silent failure here left a published
  // report with no revision history at all.
  const { error } = await supabase.from('report_revisions').insert({
    report_id: reportId, version,
    snapshot: {
      metrics: report.metrics, breakdowns: report.breakdowns,
      lists: report.lists, achievements: report.achievements,
      period_label: report.period_label,
    },
    note: note || null, published_by: publishedBy,
    published_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// Best-effort notification. Publish/revise run AFTER the report row is already
// committed, so a failure here must not abort the handler: the caller would see
// a 500 for an action that succeeded, and (before the snapshot was moved ahead
// of this call) the only copy of that version would be lost. Failure is logged
// instead; the client can still see the report on their dashboard.
async function safeNotifyPublish(report, isRevise) {
  try {
    await notifyPublish(report, isRevise);
  } catch (e) {
    console.error(`[reports] notification failed for report ${report?.id}:`, e?.message || e);
    await audit(null, 'report.notify_failed', 'report', report?.id, { error: String(e?.message || e).slice(0, 300) });
  }
}

async function notifyPublish(report, isRevise) {
  const { data: client } = await supabase.from('clients').select('company_name,email').eq('id', report.client_id).maybeSingle();
  const title = isRevise
    ? `${report.period_label} report updated`
    : `New ${report.period_label} report is live`;
  const message = isRevise
    ? `Your ${report.service.toUpperCase()} report for ${report.period_label} has been revised (v${report.version}).`
    : `Your ${report.service.toUpperCase()} report for ${report.period_label} has been published.`;
  // supabase-js RESOLVES with { data: null, error } — it does not reject. A
  // bare `await` here discarded the result, so a failed notification insert
  // (FK violation, RLS, connection reset at the PostgREST layer) was silently
  // dropped and safeNotifyPublish's catch never ran. Throw explicitly so the
  // wrapper can log and record it.
  const { error: notifErr } = await supabase.from('notifications').insert({
    client_id: report.client_id, report_id: report.id,
    type: isRevise ? 'revision' : 'publish', title, message, read: false,
  });
  if (notifErr) throw new Error(`notification insert failed: ${notifErr.message}`);
  if (client?.email) {
    // sendEmail already degrades gracefully without a Resend key; an in-app
    // notification row is the fallback, which is why email failure is not fatal.
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
      // Revision history is internal editorial metadata: the free-text note
      // ("we pulled these numbers, client disputed the attribution") and the
      // publishing admin's id are not the client's business. Admin roles only.
      if (profile.role === 'client') return res.status(200).json(report);
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
    // service and period_type are CHECK-constrained. Validating here turns a
    // raw 23514 (which named the table and constraint) into a 400.
    if (!SERVICES.includes(service)) return res.status(400).json({ error: `service must be one of ${SERVICES.join(', ')}` });
    const ptype = period_type || 'month';
    if (!PERIOD_TYPES.includes(ptype)) return res.status(400).json({ error: `period_type must be one of ${PERIOD_TYPES.join(', ')}` });
    if (!isIsoDate(period_start) || !isIsoDate(period_end)) return res.status(400).json({ error: 'period_start and period_end must be YYYY-MM-DD' });
    if (period_end < period_start) return res.status(400).json({ error: 'period_end must not be before period_start' });

    // reports has unique (client_id, service, period_start). Pre-check it so a
    // duplicate is a clear 400 rather than a 23505 that publicMessage flattens
    // to a generic 500 — the NewReportModal defaults to the current month with
    // no pre-check, so a double-click was the natural route into this.
    // `.limit(1)`, not `.maybeSingle()`: maybeSingle ERRORS (PGRST116) when more
    // than one row matches, so a database without the unique constraint applied
    // would turn every new-report POST into a 500.
    const { data: clashes } = await supabase.from('reports')
      .select('id, period_label, status').eq('client_id', client_id)
      .eq('service', service).eq('period_start', period_start).limit(1);
    const clash = clashes?.[0];
    if (clash) {
      return res.status(400).json({ error: `A ${service.toUpperCase()} report for ${clash.period_label || period_start} already exists (${clash.status}). Open it instead of creating a new one.` });
    }

    const { data, error } = await supabase.from('reports').insert({
      client_id, service,
      period_type: ptype,
      period_label: period_label || '',
      period_start, period_end,
      status: 'draft', version: 1,
      metrics: {}, breakdowns: {}, lists: {}, achievements: [],
      created_by: profile.id,
    }).select().single();
    // The pre-check above and this insert are not one transaction, so a
    // concurrent duplicate still reaches here. Map 23505 to the same 400 rather
    // than letting publicMessage flatten it to a generic 500.
    if (error?.code === '23505') {
      return res.status(400).json({ error: `A ${service.toUpperCase()} report for ${period_start} already exists. Open it instead of creating a new one.` });
    }
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
    // The JSONB columns are read back as arrays/objects by the dashboard and the
    // editor. An `achievements` object made the dashboard call .some() on it and
    // throw into the ErrorBoundary — and the editor crashed the same way, so it
    // could not be repaired from the UI. Validate the shape, not just presence.
    if ('metrics' in patch && !isPlainObject(patch.metrics)) return res.status(400).json({ error: 'metrics must be an object' });
    if ('breakdowns' in patch && !isPlainObject(patch.breakdowns)) return res.status(400).json({ error: 'breakdowns must be an object' });
    if ('lists' in patch && !isPlainObject(patch.lists)) return res.status(400).json({ error: 'lists must be an object' });
    if ('achievements' in patch) {
      if (!Array.isArray(patch.achievements)) return res.status(400).json({ error: 'achievements must be an array' });
      if (!patch.achievements.every((a) => typeof a === 'string')) return res.status(400).json({ error: 'achievements must be an array of strings' });
      if (patch.achievements.length > 200) return res.status(400).json({ error: 'Too many achievements' });
    }
    if ('period_type' in patch && !PERIOD_TYPES.includes(patch.period_type)) {
      return res.status(400).json({ error: `period_type must be one of ${PERIOD_TYPES.join(', ')}` });
    }
    if ('period_start' in patch && !isIsoDate(patch.period_start)) return res.status(400).json({ error: 'period_start must be YYYY-MM-DD' });
    if ('period_end' in patch && !isIsoDate(patch.period_end)) return res.status(400).json({ error: 'period_end must be YYYY-MM-DD' });
    // Guard the resulting range, not just each field: POST checks this, and a
    // PUT could otherwise set period_end before period_start.
    const effStart = 'period_start' in patch ? patch.period_start : report.period_start;
    const effEnd = 'period_end' in patch ? patch.period_end : report.period_end;
    if (isIsoDate(effStart) && isIsoDate(effEnd) && effEnd < effStart) {
      return res.status(400).json({ error: 'period_end must not be before period_start' });
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
      // Snapshot FIRST. The update has already committed, so it is the only
      // record of this version — if a later step throws, that content is gone
      // with nothing to restore from. Notification is best-effort: the in-app
      // notifications row is itself a fallback, so a failure there must not
      // discard the snapshot or report the publish as failed when it succeeded.
      await snapshotRevision(id, data.version, data, profile.id, note || 'Initial publish');
      await safeNotifyPublish(data, false);
      await audit(profile, 'report.publish', 'report', id, { service: data.service, period_label: data.period_label });
      return res.status(200).json(data);
    }

    if (action === 'revise') {
      if (report.status !== 'published') return res.status(400).json({ error: 'Only published reports can be revised' });
      // Update first, then snapshot. The previous order wrote the revision row
      // before the update, so a failed update (e.g. a CHECK violation on
      // period_type) left a phantom "version N published" entry in the history
      // for a publication that never happened — and retrying added another.
      // `report` is the pre-update row, so the snapshot holds the version being
      // replaced, stamped with the version number it had.
      const now = new Date().toISOString();
      const nextVersion = report.version + 1;
      const { data, error } = await supabase.from('reports').update({ ...patch, version: nextVersion, published_at: now, updated_at: now }).eq('id', id).select().single();
      if (error) throw error;
      await snapshotRevision(id, report.version, report, profile.id, note || 'Correction');
      await safeNotifyPublish(data, true);
      await audit(profile, 'report.revise', 'report', id, { version: nextVersion, note });
      return res.status(200).json(data);
    }

    // A super admin can dismiss a pending delete request and hand the report
    // back to the team. The flag is otherwise write-once: nothing else ever
    // cleared it, so a request could not be resolved without deleting the row.
    if (action === 'cancel-delete-request') {
      if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });
      if (!report.delete_requested) return res.status(400).json({ error: 'No pending deletion request' });
      const { data, error } = await supabase.from('reports')
        .update({ delete_requested: false, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      await audit(profile, 'report.delete_request_cancel', 'report', id, { service: data.service, period_label: data.period_label });
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
