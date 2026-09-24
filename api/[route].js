// Single dynamic API route — the only Serverless Function in this project.
//
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and every
// file in the `api/` directory counts toward that — Vercel cannot tell a route
// from a shared module. This app has 16 routes plus 2 shared modules (18), so
// the handlers live in `server/` (outside `api/`) and this one function
// dispatches to them.
//
// Why `[route]` and not `[...route]`: catch-all syntax is a Next.js-only
// feature. In a plain Vercel `api/` directory (this is a Vite project) a
// catch-all returns a malformed key like `"...route"` and 404s on deeper
// paths. Single dynamic segments ARE supported, and every route here is a
// single segment, so `[route]` is both correct and natively matched — no
// rewrite rule needed, and the original query string is preserved.
//
// Public URLs are unchanged: /api/clients, /api/reports?single=1, and so on.
// Each handler still wraps itself in withHandler(), so CORS, OPTIONS and error
// logging behave exactly as before.
import annotations from '../server/annotations.js';
import assignments from '../server/assignments.js';
import audit from '../server/audit.js';
import clientUsers from '../server/client-users.js';
import clients from '../server/clients.js';
import devopDb from '../server/devop-db.js';
import devopFiles from '../server/devop-files.js';
import invites from '../server/invites.js';
import me from '../server/me.js';
import notifications from '../server/notifications.js';
import reportsStructure from '../server/reports-structure.js';
import reports from '../server/reports.js';
import resetPassword from '../server/reset-password.js';
import targets from '../server/targets.js';
import team from '../server/team.js';
import upload from '../server/upload.js';

const ROUTES = {
  annotations,
  assignments,
  audit,
  'client-users': clientUsers,
  clients,
  'devop-db': devopDb,
  'devop-files': devopFiles,
  invites,
  me,
  notifications,
  'reports-structure': reportsStructure,
  reports,
  'reset-password': resetPassword,
  targets,
  team,
  upload,
};

// Resolve the requested route name. Prefers the dynamic segment Vercel matches
// from `[route]`, and falls back to parsing the URL — so the dispatcher still
// works if the platform populates `req.query` differently than expected.
function routeName(req) {
  const segment = req.query?.route;
  if (typeof segment === 'string' && segment) return segment;

  const pathname = String(req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
}

export default async function handler(req, res) {
  // The param is named `route`, not `path`: /api/devop-files takes a real
  // `?path=` query argument (the file to read) and a catch-all called `path`
  // would clobber it.
  const name = routeName(req);
  const route = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : undefined;

  if (!route) {
    return res.status(404).json({ error: `Unknown API route: /api/${name}` });
  }
  return route(req, res);
}
