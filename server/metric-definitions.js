import supabase from './db-client.js';
import { withHandler, getProfile, audit } from './helpers.js';
// Plain data, no JSX and no browser APIs, so the server can read the same
// catalogue the UI does. Importing it keeps the core-metric list in one place
// rather than echoing it here.
import { SERVICE_META, SERVICE_ORDER } from '../src/lib/constants.js';

// Metric definitions for the ⓘ buttons — global reference data, not per-report.
//
// Two shapes, chosen by the query:
//
//   ?service=seo&metricKey=organic_clicks
//       -> { definition: "text" | null }        one metric (the ⓘ popover)
//
//   (no params)
//       -> { definitions: { seo: {…}, … }, custom: { seo: [key, …], … } }
//                                                 the whole catalogue (admin tab)
//
// Every definition has a built-in default in src/lib/constants.js; a row here
// overrides it. So an empty override set is the normal state, not an error.
//
// Migration 0007 creates the table. Until it has been applied these routes
// degrade instead of failing: reads return no overrides and the UI keeps its
// defaults, writes return a 503 naming the migration.
const MISSING_TABLE = /does not exist|schema cache|relation .* does not exist/i;

// Metric keys used in real reports that are not core metrics for that service.
// A custom metric has no entry in code, so this is the only way it can surface
// in the catalogue and become documentable.
async function customMetricKeys(service) {
  const meta = SERVICE_META[service];
  const { data, error } = await supabase.from('reports').select('metrics').eq('service', service);
  if (error) return [];

  const core = new Set((meta?.coreMetrics || []).map((m) => m.key));
  const found = new Set();
  for (const row of data || []) {
    const metrics = row.metrics || {};
    const bags = meta?.hasPlatforms
      ? Object.values(metrics).filter((b) => b && typeof b === 'object' && !Array.isArray(b))
      : [metrics];
    for (const bag of bags) {
      for (const k of Object.keys(bag)) if (k && !core.has(k)) found.add(k);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export default withHandler('metric-definitions', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;

  if (req.method === 'GET') {
    const { service, metricKey } = req.query;

    // Single-metric mode, used by the ⓘ popover.
    if (service && metricKey) {
      const { data, error } = await supabase.from('metric_definitions')
        .select('definition').eq('service', service).eq('metric_key', metricKey).maybeSingle();
      if (error) {
        if (MISSING_TABLE.test(error.message || '')) return res.status(200).json({ definition: null });
        throw error;
      }
      return res.status(200).json({ definition: data?.definition || null });
    }

    // Catalogue mode, used by the admin tab: every override at once.
    const { data, error } = await supabase.from('metric_definitions').select('service, metric_key, definition');
    if (error && !MISSING_TABLE.test(error.message || '')) throw error;

    const definitions = Object.fromEntries(SERVICE_ORDER.map((s) => [s, {}]));
    for (const row of data || []) {
      if (!definitions[row.service]) definitions[row.service] = {};
      definitions[row.service][row.metric_key] = row.definition;
    }

    // Scanning reports is only worth doing for the catalogue, never per-popover.
    const custom = {};
    for (const s of SERVICE_ORDER) custom[s] = await customMetricKeys(s);

    return res.status(200).json({
      definitions,
      custom,
      migrationMissing: Boolean(error),
    });
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
