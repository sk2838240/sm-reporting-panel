import supabase from './db-client.js';
import { withHandler, getProfile, canAccessClient } from './helpers.js';

// Returns the carry-forward "structure" template for a client+service:
// the union of every metric key, breakdown category and (ORM) brand keyword
// ever used across that client's reports, so a new month's form pre-fills them
// without re-typing. Empty values; the editor merges with the core schema.
export default withHandler('reports-structure', async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;
  const { clientId, service } = req.query;
  if (!clientId || !service) return res.status(400).json({ error: 'clientId and service required' });
  if (!(await canAccessClient(profile, clientId))) return res.status(403).json({ error: 'Forbidden' });
  if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot fetch structure' });

  const { data: reports } = await supabase.from('reports')
    .select('metrics,breakdowns,lists').eq('client_id', clientId).eq('service', service)
    .order('period_start', { ascending: false });
  const rows = reports || [];

  if (service === 'social') {
    const platforms = new Set();
    const platformMetricKeys = {};
    const platformBreakdownCategories = {};
    for (const r of rows) {
      const m = r.metrics || {};
      for (const p of Object.keys(m)) {
        platforms.add(p);
        platformMetricKeys[p] = platformMetricKeys[p] || new Set();
        for (const k of Object.keys(m[p] || {})) platformMetricKeys[p].add(k);
      }
      const b = r.breakdowns || {};
      for (const p of Object.keys(b)) {
        platformBreakdownCategories[p] = platformBreakdownCategories[p] || new Set();
        for (const k of Object.keys(b[p] || {})) platformBreakdownCategories[p].add(k);
      }
    }
    return res.status(200).json({
      platforms: [...platforms],
      platformMetricKeys: Object.fromEntries(Object.entries(platformMetricKeys).map(([k, v]) => [k, [...v]])),
      platformBreakdownCategories: Object.fromEntries(Object.entries(platformBreakdownCategories).map(([k, v]) => [k, [...v]])),
    });
  }

  const metricKeys = new Set();
  const breakdownCategories = new Set();
  const brandKeywords = new Set();
  const rankingKeywords = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r.metrics || {})) metricKeys.add(k);
    for (const k of Object.keys(r.breakdowns || {})) breakdownCategories.add(k);
    for (const kw of (r.lists?.brand_keywords || [])) if (kw?.keyword) brandKeywords.add(kw.keyword);
    for (const kw of (r.lists?.keyword_rankings || [])) if (kw?.keyword) rankingKeywords.add(kw.keyword);
  }
  return res.status(200).json({
    metricKeys: [...metricKeys],
    breakdownCategories: [...breakdownCategories],
    brandKeywords: [...brandKeywords].map(k => ({ keyword: k, position: '', asset: '' })),
    rankingKeywords: [...rankingKeywords].map(k => ({ keyword: k, position: '' })),
  });
});
