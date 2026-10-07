import supabase from './db-client.js';
import { withHandler, getProfile, audit } from './helpers.js';

// Logo upload to the public 'logos' storage bucket.
const MAX_BYTES = 2 * 1024 * 1024; // 2MB, matching what the admin UI advertises

// Per-account quota. The 2MB cap bounds a single file, but nothing bounded the
// total: a super admin could script uploads and fill the bucket indefinitely,
// and the path carries a random UUID so no filename ever overwrites another.
const MAX_FILES_PER_USER = 100;
const MAX_TOTAL_BYTES_PER_USER = 200 * 1024 * 1024; // 200MB

// Only these image types are accepted. SVG is deliberately excluded: it can
// carry script and is served from a public bucket.
const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// The stored key is `${Date.now()}-${uuid8}-${base}.${ext}`, so counting by
// scanning the prefix is not possible; instead the owning admin is recorded in
// audit_log at upload time, which is the only durable link from file to uploader.
// Counts the WHOLE bucket, not one uploader: the quota exists to bound the
// shared `logos` bucket, and keying it on actor_id let each admin get a fresh
// allowance, so N admins still filled the bucket N times over. Capped at a
// generous headroom so the count cannot blow past PostgREST's row limit and
// silently under-count.
async function usageFor() {
  const { data } = await supabase.from('audit_log')
    .select('details').eq('action', 'upload.logo').limit(5000);
  const rows = (data || []).map((r) => r?.details).filter(Boolean);
  return {
    files: rows.length,
    bytes: rows.reduce((sum, d) => sum + (Number(d.bytes) || 0), 0),
  };
}

export default withHandler('upload', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;
  // getProfile returns a null profile for a valid token with no profiles row.
  // Dereferencing it first threw a TypeError, surfacing "Cannot read
  // properties of null (reading 'role')" as a 500.
  if (!profile) return res.status(403).json({ error: 'No account profile for this user' });
  if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot upload' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fileName, fileBase64, contentType } = req.body || {};
  if (!fileName || !fileBase64) return res.status(400).json({ error: 'fileName and fileBase64 required' });

  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return res.status(400).json({ error: `Unsupported image type. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}` });
  }

  // Check the encoded length before decoding so an oversized body is rejected
  // without allocating the buffer (base64 is ~4/3 of the raw size).
  const approxBytes = Math.floor(String(fileBase64).length * 0.75);
  if (approxBytes > MAX_BYTES) {
    return res.status(413).json({ error: 'File too large — maximum size is 2MB' });
  }

  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length > MAX_BYTES) {
    return res.status(413).json({ error: 'File too large — maximum size is 2MB' });
  }
  if (buffer.length === 0) return res.status(400).json({ error: 'Empty file' });

  // Quota check happens BEFORE the write, so a rejected upload leaves nothing
  // behind. Counting from audit_log rather than the bucket listing: it avoids a
  // full storage scan on every request.
  //
  // There is NO delete path for stored logos anywhere in the app — "Remove" on
  // the client form only clears the logo_url column — so the message must not
  // tell the admin to remove one. It says who to contact instead.
  const used = await usageFor();
  if (used.files >= MAX_FILES_PER_USER) {
    return res.status(413).json({ error: `Logo storage limit reached (${MAX_FILES_PER_USER} files). Contact your account manager to have unused logos removed.` });
  }
  if (used.bytes + buffer.length > MAX_TOTAL_BYTES_PER_USER) {
    return res.status(413).json({ error: 'Logo storage quota reached. Contact your account manager to have unused logos removed.' });
  }

  // Extension comes from the validated MIME type, never from the supplied name.
  const base = fileName.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 64) || 'logo';
  // crypto.randomUUID avoids colliding on same-millisecond uploads.
  const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${base}.${ext}`;

  const { error } = await supabase.storage.from('logos').upload(path, buffer, { contentType, upsert: false });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path);
  await audit(profile, 'upload.logo', 'storage', path, { fileName, bytes: buffer.length });
  return res.status(200).json({ url: urlData.publicUrl });
});
