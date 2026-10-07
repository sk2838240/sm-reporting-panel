import supabase from './db-client.js';
import { withHandler, getProfile, audit } from './helpers.js';

// Metric definitions for the ⓘ buttons — global reference data, not per-report.
//
// Every definition has a built-in default in src/lib/constants.js; a row here
// overrides it. So a GET is only ever asked for the overrides, and an empty
// result is a perfectly normal state (nothing has been reworded yet), not an
// error to report.
//
// Migration 0007 creates the table. Until it has been applied these routes
// degrade instead of failing: GET returns no overrides and the frontend keeps
// its defaults, PUT returns a 503 naming the migration.
const MISSING_TABLE = /does not exist|schema cache|relation .* does not exist/i;

export default withHandler('metric-definitions', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    const { service, metricKey } = req.query;
    if (!service) return res.status(400).json({ error: 'service required' });

    let q = supabase.from('metric_definitions').select('metric_key, definition').eq('service', service);
    if (metricKey) q = q.eq('metric_key', metricKey);
    const { data, error } = await q;

    if (error) {
      if (MISSING_TABLE.test(error.message || '')) {
        return res.status(200).json({ definitions: {}, migrationMissing: true });
      }
      throw error;
    }
    const definitions = Object.fromEntries((data || []).map((r) => [r.metric_key, r.definition]));
    return res.status(200).json({ definitions });
  }

  if (req.method === 'PUT') {
    // Definitions are agency-wide wording, so they are not a team admin's to
    // change — one edit is visible to every client of every team.
    if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });

    const { service, metric_key, definition } = req.body || {};
    if (!service || !metric_key) return res.status(400).json({ error: 'service and metric_key required' });
    if (typeof definition !== 'string') return res.status(400).json({ error: 'definition must be a string' });

    const text = definition.trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: 'Definition cannot be empty' });

    const { data, error } = await supabase.from('metric_definitions')
      .upsert(
        { service, metric_key, definition: text, updated_by: profile.id, updated_at: new Date().toISOString() },
        { onConflict: 'service,metric_key' },
      )
      .select()
      .single();

    if (error) {
      if (MISSING_TABLE.test(error.message || '')) {
        return res.status(503).json({ error: 'Saving a definition needs migration 0007_metric_definitions.sql to be run on this database.' });
      }
      throw error;
    }

    await audit(profile, 'metric_definition.update', 'metric_definition', `${service}:${metric_key}`, { definition: text });
    return res.status(200).json(data);
  }

  res.status(405).json({ error: 'Method not allowed' });
});
