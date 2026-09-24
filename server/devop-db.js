import supabase from './db-client.js';
import { withHandler, getProfile } from './helpers.js';

// Infer a column type from the sampled values. Only claims a specific type when
// every non-null sample agrees — a text column that happens to hold numeric
// strings must not be reported as integer.
function inferType(values) {
  const present = values.filter(v => v !== null && v !== undefined);
  if (!present.length) return 'unknown';

  const kindOf = (v) => {
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'numeric';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'object') return 'jsonb';
    if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? 'timestamptz' : 'text';
    return 'text';
  };

  const kinds = new Set(present.map(kindOf));
  if (kinds.size === 1) return [...kinds][0];
  return 'mixed';
}

export default withHandler('devop-db', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  if (ctx.profile?.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tables = [
    'profiles', 'clients', 'client_assignments', 'invites',
    'reports', 'report_revisions', 'targets', 'notifications',
    'audit_log', 'error_log', 'annotations',
  ];

  const schema = {};
  const data = {};
  const rowCounts = {};

  for (const table of tables) {
    try {
      // Sample rows once, then derive both the schema and the preview from them.
      const { data: rows, error: rowErr, count } = await supabase
        .from(table).select('*', { count: 'exact' }).order('id', { ascending: false }).range(0, 4);

      if (rowErr) {
        schema[table] = [];
        data[table] = [];
        rowCounts[table] = 0;
        continue;
      }

      const sample = rows || [];
      data[table] = sample;
      rowCounts[table] = count || 0;

      // Union of keys across the sample, so a column that is null in the newest
      // row is still listed.
      const columns = [...new Set(sample.flatMap(r => Object.keys(r || {})))];
      schema[table] = columns.map(name => ({
        name,
        type: inferType(sample.map(r => r?.[name])),
      }));
    } catch {
      schema[table] = [];
      data[table] = [];
      rowCounts[table] = 0;
    }
  }

  return res.status(200).json({ tables, schema, data, rowCounts });
});
