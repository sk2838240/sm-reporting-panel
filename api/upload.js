import supabase from './db-client.js';
import { withHandler, getProfile, audit } from './helpers.js';

// Logo upload to the public 'logos' storage bucket.
const MAX_BYTES = 2 * 1024 * 1024; // 2MB, matching what the admin UI advertises

// Only these image types are accepted. SVG is deliberately excluded: it can
// carry script and is served from a public bucket.
const ALLOWED_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export default withHandler('upload', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const { profile } = ctx;
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
