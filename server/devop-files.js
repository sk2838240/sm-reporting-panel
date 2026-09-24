import { promises as fs } from 'fs';
import path from 'path';
import zlib from 'zlib';
import { withHandler, getProfile } from './helpers.js';

// ---------------------------------------------------------------------------
// Minimal ZIP builder — no external dependencies, uses only Node's zlib.
// Implements the standard ZIP format: local file headers + central directory
// + end-of-central-directory record, with deflate compression.
// ---------------------------------------------------------------------------

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xFFFF, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const crc = crc32(raw);
    let compressed, method;
    try {
      compressed = zlib.deflateRawSync(raw, { level: 9 });
      method = 8;
    } catch {
      compressed = raw;
      method = 0;
    }
    if (compressed.length >= raw.length) { compressed = raw; method = 0; }

    const localHeader = Buffer.concat([
      u32(0x04034b50),      u16(20),
      u16(0),                u16(method),
      u16(0), u16(0),
      u32(crc),
      u32(compressed.length),
      u32(raw.length),
      u16(nameBuf.length),
      u16(0),
    ]);
    const localBlock = Buffer.concat([localHeader, nameBuf, compressed]);
    localParts.push(localBlock);

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20),
      u16(0), u16(method),
      u16(0), u16(0),
      u32(crc),
      u32(compressed.length),
      u32(raw.length),
      u16(nameBuf.length),
      u16(0), u16(0),
      u16(0), u16(0),
      u32(0),
      u32(offset),
    ]);
    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localBlock.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const endRecord = Buffer.concat([
    u32(0x06054b50),
    u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...localParts, centralBuf, endRecord]);
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

const EXCLUDE_DIRS = ['node_modules', 'dist', '.git', '.vercel', 'public/uploads'];
const EXCLUDE_FILES = ['.env', 'package-lock.json', '.vite-source-tags.js', 'pnpm-lock.yaml'];

// Files that must never be served, listed or zipped — they hold deployment
// credentials. Matched against the basename, so nested paths are covered too.
const DENY_BASENAMES = new Set(['vercel.json', '.env', '.env.local', '.env.production', '.git-credentials', '.npmrc']);
const DENY_PATTERN = /(^|[._-])(secret|credential|service[_-]?role|private[_-]?key)/i;

function isSensitivePath(relOrBase) {
  const base = String(relOrBase).split('/').pop();
  return DENY_BASENAMES.has(base) || DENY_PATTERN.test(base);
}

async function readAllFiles(dir, base = dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.includes(entry.name)) continue;
      const sub = await readAllFiles(full, base);
      for (const f of sub) out.push(f);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.includes(entry.name)) continue;
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (isSensitivePath(rel)) continue;
      out.push({ path: rel, abs: full });
    }
  }
  return out;
}

export default withHandler('devop-files', async (req, res) => {
  const ctx = await getProfile(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  if (ctx.profile?.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });

  // On Vercel, source files are copied to dist/_source/ during build.
  // In local dev, they're in the project root.
  const distSource = path.join(process.cwd(), 'dist', '_source');
  let root = process.cwd();
  try {
    await fs.access(distSource);
    // dist/_source exists — use it (production on Vercel)
    root = distSource;
  } catch {
    // Fall back to project root (local dev)
  }

  if (req.method === 'GET' && req.query.action === 'list') {
    const files = await readAllFiles(root);
    const categories = {
      'api': files.filter(f => f.path.startsWith('api/') || f.path.startsWith('server/')),
      'src': files.filter(f => f.path.startsWith('src/')),
      'supabase': files.filter(f => f.path.startsWith('supabase/')),
      'public': files.filter(f => f.path.startsWith('public/')),
      'root': files.filter(f => !f.path.includes('/')),
      'config': files.filter(f => ['tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.js','eslint.config.js','package.json'].includes(f.path)),
    };
    const tree = files.map(f => ({ path: f.path, size: 0 }));
    return res.status(200).json({ files: tree, categories, total: files.length });
  }

  if (req.method === 'GET' && req.query.action === 'read') {
    const filePath = req.query.path;
    if (!filePath || filePath.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    if (isSensitivePath(filePath) || EXCLUDE_FILES.includes(String(filePath).split('/').pop())) {
      return res.status(403).json({ error: 'File is not readable' });
    }
    const full = path.join(root, filePath);
    // Confirm the resolved path is still inside the source root.
    const resolvedRoot = path.resolve(root);
    if (!path.resolve(full).startsWith(resolvedRoot + path.sep)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    try {
      const data = await fs.readFile(full, 'utf8');
      return res.status(200).json({ path: filePath, content: data });
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }
  }

  // Download a category as ZIP
  if (req.method === 'GET' && req.query.download) {
    const category = req.query.download;
    let filesToZip = [];
    const all = await readAllFiles(root);

    if (category === 'project') {
      filesToZip = all;
    } else if (category === 'api') {
      filesToZip = all.filter(f => f.path.startsWith('api/') || f.path.startsWith('server/'));
    } else if (category === 'src') {
      filesToZip = all.filter(f => f.path.startsWith('src/'));
    } else if (category === 'supabase') {
      filesToZip = all.filter(f => f.path.startsWith('supabase/'));
    } else if (category === 'config') {
      filesToZip = all.filter(f => ['tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.js','eslint.config.js','package.json'].includes(f.path));
    }

    const zipFiles = [];
    for (const f of filesToZip) {
      try { const data = await fs.readFile(f.abs); zipFiles.push({ name: f.path, data }); }
      catch {}
    }
    if (!zipFiles.length) return res.status(404).json({ error: 'No files found' });

    const zip = makeZip(zipFiles);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="agency-portal-${category}.zip"`);
    return res.status(200).send(zip);
  }

  res.status(405).json({ error: 'Method not allowed' });
});
