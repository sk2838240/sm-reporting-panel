import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// These were previously hardcoded in vercel.json, where the service-role key
// was readable by anyone via the file-serving endpoint. They now must come from
// the deployment environment (Vercel → Settings → Environment Variables).
// Fail loudly and specifically — supabase-js would otherwise throw a bare
// "supabaseKey is required." that gives no hint about what to fix.
if (!url || !serviceKey) {
  const missing = [!url && 'NEXT_PUBLIC_SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  throw new Error(
    `Supabase server credentials missing: ${missing.join(', ')}. ` +
    'Set them in the deployment environment (Vercel → Settings → Environment Variables).'
  );
}

// Service-role client. Used only by the /api routes — the anon key in the
// client bundle never reaches these tables beyond what RLS allows.
const supabase = createClient(url, serviceKey);

export default supabase;
