// Copies the project source into dist/_source/ so the DevOp portal can browse
// and download it after deployment. Referenced by `npm run build`.
//
// Note: vercel.json is deliberately NOT copied — it must never be served.
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist', '_source');

// `public` is included so the DevOp portal's "public" category resolves — the
// file browser advertises it, and without it the download 404'd in production
// even though the category existed locally.
const DIRS = ['api', 'server', 'src', 'supabase', 'public'];
const FILES = [
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.js',
  'eslint.config.js',
  'package.json',
];

// Never copied, even if they appear inside a copied directory.
const EXCLUDE = new Set(['node_modules', '.git', '.vercel', 'dist', '.env', 'uploads']);

// Content of dist/_source is served by Vercel as STATIC FILES, so it is
// reachable at /_source/... with no authentication and without passing through
// the deny-list in server/devop-files.js. Anything sensitive written into src/
// or server/ would therefore ship publicly. The API's own rules are mirrored
// here as a hard build-time gate, so the copy cannot contain a credential.
const DENY_BASENAMES = ['vercel.json', '.env', '.git-credentials', '.npmrc', 'npmrc', 'netrc', 'id_rsa', 'id_ed25519'];
const DENY_PATTERN = /(^|[._-])(secret|credential|service[_-]?(role|account)|private[_-]?key)/i;
const DENY_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.crt'];

function isDenied(segments) {
  if (!segments.length) return true;
  if (segments.some((s) => EXCLUDE.has(s))) return true;
  // A deny-pattern hit anywhere in the path, not just the basename, so a
  // secret-named directory is skipped rather than descended into.
  if (segments.some((s) => DENY_BASENAMES.some((d) => s.startsWith(d)) || DENY_PATTERN.test(s))) return true;
  const base = segments[segments.length - 1];
  return DENY_EXTENSIONS.includes(path.extname(base).toLowerCase());
}

const skipped = [];

async function copyDir(src, dest, trail = []) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const segments = [...trail, entry.name];
    if (isDenied(segments)) { skipped.push(segments.join('/')); continue; }
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to, segments);
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  for (const dir of DIRS) {
    try { await copyDir(path.join(ROOT, dir), path.join(OUT, dir), [dir]); }
    catch (e) { console.warn(`[copy-source] skipped ${dir}: ${e.message}`); }
  }
  for (const file of FILES) {
    if (isDenied([file])) { skipped.push(file); continue; }
    try { await fs.copyFile(path.join(ROOT, file), path.join(OUT, file)); }
    catch (e) { console.warn(`[copy-source] skipped ${file}: ${e.message}`); }
  }

  // Count only, never the names. Vercel build logs are visible to anyone with
  // project access, and echoing "server/service-account.json" would confirm the
  // existence, location and naming convention of the very credential this gate
  // exists to hide. A non-zero count is enough to prompt a look.
  if (skipped.length) console.warn(`[copy-source] excluded ${skipped.length} sensitive path(s) by policy — see DENY_BASENAMES/DENY_PATTERN in this script`);
  console.log(`[copy-source] source copied to ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error('[copy-source] failed:', e); process.exit(1); });
