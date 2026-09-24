import { createClient } from '@supabase/supabase-js';

// Frontend uses the ANON key only. The service-role key never reaches the client bundle.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Vite inlines VITE_* variables at BUILD time. If they are missing from the
// build environment, createClient() throws during module evaluation and the
// app renders a blank white page with nothing but a cryptic console error.
// Render an explanation instead, so a misconfigured deploy is diagnosable.
if (!url || !anonKey) {
  const missing = [
    !url && 'VITE_SUPABASE_URL',
    !anonKey && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean);

  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,sans-serif;background:#f8fafc">
        <div style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px">
          <div style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#e11d48;margin-bottom:10px">Configuration error</div>
          <h1 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 10px">This build is missing required environment variables</h1>
          <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 14px">
            The bundle was built without the Supabase settings it needs, so the app cannot start.
            Vite inlines <code style="background:#f1f5f9;padding:1px 5px;border-radius:5px">VITE_*</code>
            variables at <b>build time</b> &mdash; adding them later has no effect until the project is rebuilt.
          </p>
          <p style="font-size:12px;font-weight:600;color:#0f172a;margin:0 0 6px">Missing:</p>
          <ul style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#0f172a;background:#f1f5f9;border-radius:10px;padding:12px 12px 12px 28px;margin:0 0 16px">
            ${missing.map((m) => `<li>${m}</li>`).join('')}
          </ul>
          <p style="font-size:13px;color:#475569;line-height:1.6;margin:0">
            Set them under <b>Vercel &rarr; Project &rarr; Settings &rarr; Environment Variables</b>,
            then <b>redeploy</b> so a new build picks them up. The names must match exactly.
          </p>
        </div>
      </div>`;
  }

  throw new Error(
    `Missing build-time environment variable(s): ${missing.join(', ')}. ` +
    'Set them in Vercel -> Project -> Settings -> Environment Variables and redeploy.'
  );
}

const supabase = createClient(url, anonKey);

export default supabase;
