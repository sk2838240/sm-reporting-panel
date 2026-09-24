// Copies the project source into dist/_source/ so the DevOp portal can browse
// and download it after deployment. Referenced by `npm run build`.
//
// Note: vercel.json is deliberately NOT copied — it must never be served.
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist', '_source');

const DIRS = ['api', 'src', 'supabase'];
const FILES = [
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.js',
  'eslint.config.js',
  'package.json',
];

// Never copied, even if they appear inside a copied directory.
const EXCLUDE = new Set(['node_modules', '.git', '.vercel', 'dist', '.env']);

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  for (const dir of DIRS) {
    try { await copyDir(path.join(ROOT, dir), path.join(OUT, dir)); }
    catch (e) { console.warn(`[copy-source] skipped ${dir}: ${e.message}`); }
  }
  for (const file of FILES) {
    try { await fs.copyFile(path.join(ROOT, file), path.join(OUT, file)); }
    catch (e) { console.warn(`[copy-source] skipped ${file}: ${e.message}`); }
  }

  console.log(`[copy-source] source copied to ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error('[copy-source] failed:', e); process.exit(1); });
