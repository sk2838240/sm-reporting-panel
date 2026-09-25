// The only Serverless Function in this project.
//
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and every
// file in the `api/` directory counts toward that — Vercel cannot tell a route
// from a shared module. This app has 16 routes plus 2 shared modules (18), so
// the handlers live in `server/` (outside `api/`) and this one function
// dispatches to them.
//
// Why a plain filename plus a rewrite, and not a dynamic route: a dynamic
// `api/[route].js` was tried first and did NOT match — every /api/* request
// fell through to the SPA rewrite and returned index.html with a 200, so the
// frontend got HTML where it expected JSON. Catch-all `[...route]` is worse
// still: that syntax is Next.js-only and yields a malformed key here. A static
// file plus an explicit rewrite in vercel.json depends on neither:
//
//   { "source": "/api/:route", "destination": "/api/router?route=:route" }
//
// The route name therefore arrives as the `route` query parameter. It is named
// `route` rather than `path` because /api/devop-files takes a real `?path=`
// argument (the file to read) that must not be clobbered.
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

// Resolve the requested route name. It arrives as ?route= from the rewrite in
// vercel.json; parsing the URL is a fallback so a direct hit on /api/router
// still resolves sensibly instead of dispatching on the literal word "router".
function routeName(req) {
  const param = req.query?.route;
  if (typeof param === 'string' && param) return param;

  const pathname = String(req.url || '').split('?')[0];
  const segment = pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  return segment === 'router' ? '' : segment;
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
