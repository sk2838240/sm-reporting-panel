# Agency Portal — Bug & Security Audit

**Project:** `agency-portal-project` (branded "Search Modifiers — Client Reporting")
**Stack:** React 19 + Vite 7 + Tailwind 4 + Supabase (Postgres) + Vercel serverless functions
**Audited:** 2026-09-23
**Scope:** all of `api/`, `src/`, `supabase/migrations/`, root config — ~6,100 lines

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| 🔴 Critical | 6 | C-1 … C-6 |
| 🟠 High | 7 | H-1 … H-7 |
| 🟡 Medium | 16 | M-1 … M-16 |
| 🔵 Low | 12 | L-1 … L-13 (L-5 retracted) |

Section **"Broken & non-functional features"** at the end pulls every user-visible breakage into one list.

> **Status: all findings below have been fixed in code**, except the operator actions listed in
> *Remediation status* at the end of this document. Two further **build-breaking** defects were
> found while applying the fixes and are recorded there as N-1 and N-2. Two more (M-15, M-16)
> were found while writing `FEATURES.md` and are fixed as well.

The two headline problems are:

1. **Two API endpoints (`/api/devop-db`, `/api/devop-files`) have no authentication at all** and are reachable from an unprotected `/devop` page. Together they dump every database table and serve the entire project source as a ZIP.
2. **The Supabase service-role key is stored in `vercel.json`** — a file that the app itself will happily serve to anyone via the endpoint above.

---

## 🔴 Critical

### C-1 — `/api/devop-db` exposes the entire database with no authentication

**File:** `api/devop-db.js:4-54`

The handler never calls `getProfile()` or performs any auth or role check. It runs with the **service-role key** (via `db-client.js`), so Supabase RLS is bypassed entirely. It returns, for all 11 tables (`profiles`, `clients`, `client_assignments`, `invites`, `reports`, `report_revisions`, `targets`, `notifications`, `audit_log`, `error_log`, `annotations`):

- the full column list,
- **the 5 most recent rows of each**, and
- an exact row count.

Real exposure includes every user's email address and role (`profiles`), every client company and contact (`clients`), and full stack traces (`error_log`).

**Reproduce:** `curl https://<deployment>/api/devop-db`

**Fix:** delete the endpoint, or gate it behind `getProfile()` + `profile.role === 'super_admin'`. Given it is debug tooling, deletion is the safer option.

---

### C-2 — `/api/devop-files` serves arbitrary files and the whole source tree with no authentication

**File:** `api/devop-files.js:124-197`

Same missing auth. Three modes, all unauthenticated:

| Query | Effect |
|---|---|
| `?action=list` | full file tree of the project |
| `?action=read&path=<file>` | returns the contents of any file under the project root |
| `?download=project` | streams a ZIP of every source file |

The only guard on `read` is `filePath.includes('..')` (`api/devop-files.js:155`), which blocks traversal out of the root but does **nothing** about sensitive files *inside* it. The `EXCLUDE_FILES` list (`.env`, `package-lock.json`, …) at `api/devop-files.js:97` is applied only to the directory walk — it is **not** consulted by the `read` action.

So `GET /api/devop-files?action=read&path=vercel.json` returns the deployment config, including the service-role key (see C-3). The `download=project` ZIP also contains `vercel.json`.

**Fix:** remove the endpoint from production. If it must stay, require `super_admin` and hard-block a deny-list (`.env*`, `vercel.json`, anything matching `secret|key|credential`) on *both* the walk and the read path.

---

### C-3 — Supabase service-role key and other secrets hardcoded in `vercel.json`

**File:** `vercel.json:1`

```json
"env": {
  "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_••••••••  (live key — redacted from this document)",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY": "sb_publishable_••••••••  (public by design, but redacted)",
  ...
}
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses all Row Level Security. It is used by every file in `api/` (`api/db-client.js:6`), so any leak is equivalent to full read/write access to the production database.

It is currently leaked two ways: this file is served verbatim by C-2, and it is bundled into the `download=project` ZIP.

**Fix:**
1. **Rotate the service-role key immediately** — assume it is compromised.
2. Move all secrets to Vercel Project → Settings → Environment Variables.
3. Remove the `env` block from `vercel.json` entirely.

Note this project is *not* its own git repository (it sits inside the `C:/Users/gkuma` repo), but the file is on disk and deployed, so the leak is live regardless of VCS state.

---

### C-4 — `/devop` route is completely unprotected

**File:** `src/App.js:51`

```jsx
<Route path='/devop' element={<DevOpPage />} />
```

Every other authenticated route is wrapped in `<ProtectedRoute>`. `/devop` is not, so `DevOpPage` renders for anonymous visitors — and it immediately calls the two unauthenticated endpoints above on mount (`src/pages/DevOpPage.jsx:39`). The page provides a "Download Complete Project (.zip)" button, a file browser, and a "Database Snapshot (.json)" export.

**Fix:** remove the route, or wrap it in `<ProtectedRoute roles={['super_admin']}>` — and only after C-1/C-2 are fixed server-side. A client-side guard alone is not sufficient here.

---

### C-5 — `targets` DELETE has no authorization check (IDOR)

**File:** `api/targets.js:37-44`

```js
if (req.method === 'DELETE') {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const { error } = await supabase.from('targets').delete().eq('id', id);
```

Every other branch of this file calls `canAccessClient(profile, client_id)` and rejects `client`-role users. This branch does neither. Any authenticated user — including a **client** login, which is meant to be read-only — can delete any target belonging to any client by passing an arbitrary `id`.

**Fix:**

```js
const { data: t } = await supabase.from('targets').select('client_id').eq('id', id).maybeSingle();
if (!t) return res.status(404).json({ error: 'Not found' });
if (!(await canAccessClient(profile, t.client_id))) return res.status(403).json({ error: 'Forbidden' });
if (profile.role === 'client') return res.status(403).json({ error: 'Clients cannot edit targets' });
```

---

### C-6 — RLS was enabled on only 4 of 11 tables; the anon key is public

**Files:** `supabase/migrations/0001_init.sql:133-136`, `supabase/migrations/0002_annotations.sql`

> **This finding was missed in the original audit** and surfaced only when reviewing the remediation. It is arguably the most serious item in this document.

`0001_init.sql` enables RLS on four tables:

```sql
alter table public.clients enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.targets enable row level security;
```

The schema creates **eleven**. These seven were left with RLS **disabled**: `profiles`, `client_assignments`, `invites`, `report_revisions`, `audit_log`, `error_log`, and (`0002`) `annotations`.

The comment above those four lines states the intent plainly — *"these policies protect against direct anon-key access from the client bundle"* — but the protection was never extended to the rest of the schema.

**Why this is exploitable.** The Supabase anon key is public by design: it is inlined into the client bundle via `VITE_SUPABASE_ANON_KEY` and is also stored in `vercel.json`. In Postgres, a table with RLS *disabled* is fully readable by any role holding a table grant — and Supabase's default `anon`/`authenticated` roles hold those grants on `public`. So anyone who loads the site can extract the key and query PostgREST directly:

```
GET https://<project-ref>.supabase.co/rest/v1/profiles?select=*
GET https://<project-ref>.supabase.co/rest/v1/audit_log?select=*
GET https://<project-ref>.supabase.co/rest/v1/error_log?select=*
```

That returns every user's email address and role, every invite token, the complete audit trail with actor emails, and internal stack traces — with no authentication at all. The app's careful per-route authorization in `api/` is entirely bypassed, because it isn't in the path.

**Fix:** migration `0004_rls_coverage.sql` enables RLS on all seven. Two subtleties had to be handled:

1. The `0001` policies read `profiles` and `client_assignments` in **subqueries**, and RLS applies inside those subqueries. Locking either table down without a read policy would have silently broken every existing policy — clients and team admins would have lost access to their own reports. So `profiles` gets `id = auth.uid()` (own row only, never other users' emails) and `client_assignments` gets a member-or-super-admin read policy.
2. `invites`, `audit_log` and `error_log` get RLS with **no policies at all** — deny-everything. The API uses the service-role key, which bypasses RLS, so the app is unaffected.

**Note for future tables:** any new table in `public` must have RLS enabled in the same migration that creates it.

---

## 🟠 High

### H-1 — Bootstrap logic lets any authenticated user become super admin

**File:** `api/me.js:4-27`

```js
async function needsBootstrap() {
  const { count } = await supabase.from('profiles')
    .select('id', { count: 'exact', head: true }).eq('role', 'super_admin');
  return !count || count === 0;
}
// ...
const role = (await needsBootstrap()) ? 'super_admin' : 'client';
```

If no `super_admin` profile row exists at the moment any user first hits `/api/me`, that user is auto-provisioned as super admin. Two problems:

- **Race window on fresh deployments.** Until the intended admin logs in, the first person to authenticate wins full control.
- **Patient zero is self-service.** Anyone who can obtain a Supabase auth account (self-signup, or an invite meant to be a `client`) can claim super admin if the bootstrap hasn't run yet.

**Fix:** seed the first super admin out-of-band (SQL migration or a CLI script), and make `me.js` refuse to auto-provision an admin role — default unknown users to `client` or reject them outright.

---

### H-2 — `duplicateFromId` allows cross-tenant report data copying

**File:** `api/reports.js:96-105`

```js
if (body.duplicateFromId) {
  const { data: src } = await supabase.from('reports').select('metrics,breakdowns,lists')
    .eq('id', body.duplicateFromId).maybeSingle();
  if (src) { /* copies src metrics/breakdowns/lists into the new report */ }
}
```

The caller's access is verified for `client_id` (the *destination*), but `duplicateFromId` is fetched with no check that it belongs to the same client. A team admin assigned to Client A can pass a report ID from Client B, copy B's full metrics, breakdowns and lists into a report they do own, and then read the result.

**Fix:** fetch the source with `.eq('client_id', client_id)` (and `.eq('service', service)`), so a mismatch yields no rows.

---

### H-3 — Google sign-in `postMessage` handler does not verify `event.origin`

**File:** `src/lib/googleAuth.js:19-31`

```js
const handler = async (event) => {
  if (event.data?.type === 'google-auth-denied') { ...; return; }
  if (event.data?.type !== 'google-auth-success') return;
  window.removeEventListener('message', handler);
  if (event.data.access_token && event.data.refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token: ..., refresh_token: ... });
```

No `event.origin` check. Any window holding a reference to this page (an opener, an embedder, a popup the user was tricked into opening) can post a `google-auth-success` message carrying attacker-supplied tokens and silently replace the user's session via `setSession`. That is session fixation: subsequent actions run as the attacker's account, and any data the user enters lands in it.

**Fix:** capture `window.location.origin` at `signInWithGoogle()` time and reject any message where `event.origin !== expectedOrigin`. Validate `event.source === popupRef` as a second check.

---

### H-4 — Client objectives are stored in the `phone` column and destroy the phone number

**Files:** `src/pages/ClientDetail.jsx:31-35, 118-124`, `src/pages/ClientDashboard.jsx:98-100`

There is no `objectives` column, so the code smuggles the list into `clients.phone` as a JSON string:

```js
// ClientDetail.jsx
// Objectives stored inside the client's 'phone' field as JSON (workaround for missing DB column)
await put('/api/clients', { id: clientId, phone: JSON.stringify(objectives) });
```

The UI hides the damage by checking `!client.phone.startsWith('[')` before displaying a phone number — but the original value is **already overwritten** and unrecoverable. Saving objectives permanently destroys the client's real phone number.

Secondary effects: any client whose legitimate phone number happens to start with `[` will have it parsed as objectives; and `phone` is a `text` column being used as a JSON store, so it is invisible to querying and reporting.

**Fix:** add a proper `objectives jsonb default '[]'` column via a migration, migrate any existing `[...`-shaped `phone` values back out, then drop the workaround from both pages.

---

### H-5 — `revert-to-draft` silently discards unsaved editor changes

**Files:** `api/reports.js:152-157`, `src/pages/ReportEditor.jsx:436`

`ReportEditor` always sends the full payload (`buildPayload()`), but the `revert-to-draft` branch ignores `patch` entirely:

```js
if (action === 'revert-to-draft') {
  const { data, error } = await supabase.from('reports')
    .update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', id)...
```

An admin who edits fields and then clicks **Revert to draft** gets a success toast and loses every edit with no warning.

Related: the branch has no status precondition (unlike `save`/`publish`/`revise`), so it can be called repeatedly on an already-draft report.

**Fix:** either persist `patch` alongside the status change, or prompt before discarding. Add `if (report.status !== 'published') return res.status(400)...`.

---

### H-6 — `/api/upload` accepts unbounded, unvalidated file uploads

**File:** `api/upload.js:12-21`

```js
const { fileName, fileBase64, contentType } = req.body || {};
const buffer = Buffer.from(fileBase64, 'base64');
const path = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
await supabase.storage.from('logos').upload(path, buffer, { contentType: contentType || 'image/png', upsert: true });
```

No size limit and no MIME/extension validation. The UI advertises "PNG, JPG, WebP or SVG. Max 2MB" (`src/pages/AdminConsole.jsx:168`) but nothing enforces it. A caller can POST an arbitrarily large base64 blob (blowing the serverless request limit) or upload arbitrary `contentType` — including `image/svg+xml`, which executes script when served from the public `logos` bucket and navigated to directly.

`upsert: true` combined with the `Date.now()` prefix makes the "upsert" meaningless; a predictable timestamp filename is also guessable.

**Fix:** reject bodies over ~2 MB before decoding, allow-list `contentType` to a fixed image set, derive the extension from the validated type rather than the user-supplied filename, and set `upsert: false`.

---

### H-7 — Clients can read unpublished draft reports by ID

**File:** `api/reports.js:53-61`

The list branch filters drafts out for clients, and says so explicitly:

```js
// Clients only see published reports; admins see drafts too.
if (profile.role === 'client') q = q.eq('status', 'published');   // line 68
```

The `single=1` branch, which returns a complete report, has no such filter:

```js
if (single === '1' && id) {
  const report = await loadReport(id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessClient(profile, report.client_id))) return res.status(403).json({ error: 'Forbidden' });
  return res.status(200).json({ ...report, revisions: revisions || [] });   // draft returned as-is
}
```

`canAccessClient` only checks *which* client the report belongs to — it never inspects status. `reports.id` is a `serial`, so IDs are sequential and trivially enumerable.

**Impact:** a client login can read their own draft reports — including partially written metrics, internal notes and work-in-progress figures — before the agency publishes them. The whole draft→publish review workflow, which the product is built around, can be bypassed. A client who guesses the next ID sees next month's report early.

**Reproduce:** as a `client` user, `GET /api/reports?single=1&id=<n>` for successive `n`.

**Fix:**

```js
if (profile.role === 'client' && report.status !== 'published') {
  return res.status(404).json({ error: 'Not found' });   // 404, not 403 — don't confirm existence
}
```

---

## 🟡 Medium

### M-1 — `npm run build` fails: `scripts/copy-source.js` does not exist

**Files:** `package.json:8`, `vercel.json:1`

```json
"build": "vite build && node scripts/copy-source.js"
```

There is no `scripts/` directory anywhere in the project. Vercel runs `npm run build`, so the second stage fails with `Cannot find module` and the deployment breaks.

This also has a functional consequence: `api/devop-files.js:127-137` reads source from `dist/_source`, which is exactly what the missing script was supposed to produce. That fallback path can therefore never populate.

> *Verification note:* I confirmed the file is absent and that `npm run build` cannot proceed. A full end-to-end build could not be run here because `node_modules/` is not installed in this copy.

**Fix:** restore `scripts/copy-source.js`, or drop it from the build command and delete the `dist/_source` branch in `devop-files.js`.

---

### M-2 — Dashboard comparison cards ignore the selected month

**File:** `src/pages/ClientDashboard.jsx:338-350`

```js
function MetricCard({ meta, metric, platform, series, latest, prev, mode, ... }) {
  const idx = series.length - 1;   // <-- always the LAST report
  const cur = getValue(latest, metric.key, pkey);   // <-- the SELECTED report
  ...
  if (mode === 'mom') { const d = momDelta(series, idx, metric.key, pkey, metric.lowerBetter); ... }
```

`cur` is read from the selected report, but every delta is computed at `idx = series.length - 1`. When a client picks an earlier month from the "Report period" dropdown, the big number changes to that month while the badge, the comparison bars, and the 3/6-month trailing averages still describe the latest month. The result is a card that contradicts itself — and a client could reasonably read the delta as belonging to the month they selected.

**Fix:** derive the index from the selected report:

```js
const idx = selectedIndex;   // passed down as a prop
```

`ClientDashboard` already computes `selectedIndex` at line 78; it just needs to be threaded into `MetricCard`.

---

### M-3 — "Targets visible to client" toggle is fake

**File:** `src/pages/ClientDetail.jsx:239, 298`

```js
const [visible, setVisible] = useState(true);
...
<SectionToggle visible={visible} onChange={(v) => { setVisible(v); push(v ? 'Targets visible to client' : 'Targets hidden from client', 'success'); }} ... />
```

The state is local and never persisted to the database, and nothing on the client dashboard reads any such flag. Clicking it shows a success toast claiming the change was applied, then silently resets on the next page load. Every other `SectionToggle` in `ReportEditor` writes into `lists._section_visibility`; this one was never wired up.

**Fix:** persist into the report's `_section_visibility` (as the editor does) and have `ClientDashboard` honour the flag, or remove the control.

---

### M-4 — Admin console "Team" column is always empty

**File:** `src/pages/AdminConsole.jsx:86`

```jsx
{ key: 'assignees', label: 'Team', render: (c) => <span ...>{c._assignees?.length ? `${c._assignees.length} assigned` : '—'}</span> }
```

No code path ever populates `_assignees`. The list endpoint `GET /api/clients` (`api/clients.js:26-52`) returns bare client rows, and only the `single=1` branch attaches a `team` array (under a different key). The column therefore renders `—` for every client.

**Fix:** either have `GET /api/clients` attach assignment counts (the `assignee` filter at `api/clients.js:47-51` already queries `client_assignments`, so the data is one join away), or drop the column.

---

### M-5 — Injected session-recording and element-picker scripts ship in production HTML

**File:** `index.html:11` and a second inline `<script>` before `</body>`

Two third-party scripts are embedded directly in the app shell:

1. A `data-arena-recording="true"` script that loads **rrweb** from `cdn.jsdelivr.net`, records full DOM session replay, and captures every click, scroll, mouse-move and keydown (`sessionStorage` key `__arena_rec`, ~5 KB flushed every 5 s).
2. An "element-picker" script exposing `inspect:mode` / `arena:edit-mode` via `postMessage`, plus `Alt+Shift+I` / `Alt+Shift+E` hotkeys.

The recording block explicitly skips keystrokes targeted at `INPUT`/`TEXTAREA` — but rrweb's DOM capture is not filtered, and this is an application that handles client contact details, login flows and password fields. The app also ships a privacy notice (`src/pages/Privacy.jsx`) promising "Only you and your assigned agency team can view your data."

This appears to be leftover instrumentation from an AI build harness (corroborated by `VITE_GOOGLE_AUTH_PROXY=https://designarena.ai/...` and `FULLSTACK_RESTORE_API_URL` in `vercel.json`).

**Fix:** delete both inline scripts from `index.html`. Verify no other harness artifacts remain (`designarena.ai` references in `vercel.json` and `api/db-wake.js`).

---

### M-6 — `_delete_requested` flag is silently erased on the next save

**Files:** `api/reports.js:174-182`, `src/pages/ReportEditor.jsx:189`

A team admin's delete request is stored by mutating the report's `lists` JSONB:

```js
const lists = report.lists || {};
lists._delete_requested = true;
await supabase.from('reports').update({ lists, ... })
```

But `ReportEditor.buildPayload()` rebuilds `lists` from scratch, spreading only the keys it knows about:

```js
lists: { ...lists, keyword_rankings: ..., _section_visibility: ..., _section_order: ... }
```

`lists` here is the editor's local state, populated from `meta.lists` keys plus the explicitly-listed keys — `_delete_requested` is not among them. So any subsequent save by any admin wipes the flag and the pending delete request vanishes without a trace (the audit log entry remains, but the UI indicator and the actual request are gone).

**Fix:** move delete-request state to a real column (`reports.delete_requested boolean`) rather than overloading JSONB that the editor owns and rewrites.

---

### M-7 — `eslint` config matches no files in this project

**File:** `eslint.config.js:12`

```js
files: ['**/*.{ts,tsx}'],
```

Every source file in this project is `.js` or `.jsx`. `npm run lint` therefore lints zero files and always passes. The `react-hooks` and `react-refresh` rule sets that are configured never run.

**Fix:** `files: ['**/*.{js,jsx,ts,tsx}']` — or drop the lint script and the ESLint dependencies.

---

### M-8 — CORS policy is wildcard across an authenticated API

**File:** `api/helpers.js:4`

```js
res.setHeader('Access-Control-Allow-Origin', '*');
```

Applied to every route, including those that mutate data. Because auth is Bearer-token based (not cookies), this is not instantly catastrophic — an attacker page cannot read a victim's token from a cookie. But it does mean any origin can call the API with a token it has obtained, and it removes the browser as a defence-in-depth layer. It also compounds C-1/C-2, which need no token at all.

**Fix:** reflect an allow-list of known origins instead of `*`.

---

### M-9 — Invite tokens are generated and stored but never used

**File:** `api/invites.js:38-42`

```js
const token = genPassword(32);
await supabase.from('invites').insert({
  email, role, client_id: clientId || null, token, status: 'pending', ...
});
```

The `invites` table has `token`, `status`, `expires_at` columns and a `pending` default, but no code path ever reads a token, validates an invite, or transitions `status` to `accepted`. The actual onboarding flow hands out a temp password instead. The result is a table of dead rows plus a `pending`/`expired` lifecycle that never runs — misleading to anyone reading the schema, and `expires_at` implies an expiry enforcement that does not exist.

**Fix:** either implement token-based redemption (email a link, validate token + expiry on accept) or drop the `invites` table and its insert.

---

### M-10 — `devop-db` schema inference is unreliable and misreports types

**File:** `api/devop-db.js:20-34`

Column "types" are guessed from the JavaScript type of the first row's values:

```js
if (typeof v === 'number') type = Number.isInteger(v) ? 'integer' : 'numeric';
else if (v && typeof v === 'object') type = 'jsonb';
else if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}T/.test(v)) type = 'timestamptz';
```

A `text` column that happens to hold a numeric-looking string renders as `integer`; an empty table yields no schema at all (`schema[table] = []`); a JSONB value that is `null` reports `text`. Since the same loop doubles as the auth-less data dump described in C-1, removing that endpoint (or gating it) resolves this too. If the feature is kept, read real types from `information_schema.columns`.

---

### M-11 — Duplicate and redundant data fetches on mount

**Files:** `src/pages/TeamHome.jsx:24-25`, `src/components/KeywordStatus.jsx:25-85`

`TeamHome` registers two effects:

```js
useEffect(() => { load(); }, [load]);
useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search]);
```

Since `load` is a `useCallback` with `search` in its dependency array, every search change already re-fires the first effect — the debounce effect is redundant and each mount issues two requests. The same pattern appears in `AdminConsole.jsx:67-68`.

Separately, `KeywordStatusTracker` fetches the ORM report list twice: once inside the first effect (`KeywordStatus.jsx:58`) and again in a second effect (`KeywordStatus.jsx:73-85`) whose only job is to populate `ormReports`. These can be merged into one request.

---

### M-12 — "Manage access" modal always shows no assigned team members

**File:** `src/pages/AdminConsole.jsx:121, 188`

```js
const [assigned, setAssigned] = useState(client.team || []);
```

`client` here is the row passed from the client **list**, and `GET /api/clients` (list branch, `api/clients.js:26-52`) returns bare client rows — the `team` array is attached only by the `single=1` branch (`api/clients.js:16-23`). So `client.team` is always `undefined` and `assigned` initialises to `[]`.

Nothing on mount calls `refresh()` — the only `useEffect` (line 199) fetches the client's *login* account, not its assignments. `refresh()` is wired solely to the add/remove buttons.

**Impact:** opening "Manage access" on a client that already has three team members reports **"No team members assigned."** The "Add team member" dropdown then offers people who are already assigned (because `available` filters against the same empty list), so an admin can "add" someone who is already there — the API returns `{ ok: true, exists: true }`, silently does nothing, and only then does `refresh()` correct the display.

**Fix:** call `refresh()` on mount, or seed from the single-client fetch:

```js
useEffect(() => { refresh(); }, [client.id]);
```

---

### M-13 — Achievements month/year selector goes stale on service switch

**File:** `src/pages/ClientDashboard.jsx:499-508`

```js
const [selYear, setSelYear] = useState(lastDate.getFullYear());
const [selMonth, setSelMonth] = useState(lastDate.getMonth() + 1);
const years = [...new Set(series.map(r => new Date(r.period_start).getFullYear()))].sort();
```

The state initialisers run once per mount, but `AchievementsSection` is not keyed by service and `series` is replaced wholesale when the user switches tabs (`SEO` → `ORM`). The selected year/month persist while `years` is rebuilt from the new service's data.

**Impact:** after switching services, the `<select value={selYear}>` frequently has no matching `<option>`. React renders the select with nothing selected, and the panel reads "No achievements recorded for October 2025" with a month/year combination that isn't in the dropdown and may not exist for that service at all. The user has to guess that they should re-pick a month.

**Fix:** add `key={service}` on `<AchievementsSection>` to remount it per service, or reset `selYear`/`selMonth` in an effect when `series` changes.

---

### M-14 — "Copy from previous month" silently deletes keywords unique to the current month

**Files:** `src/components/KeywordRanking.jsx:77-84`, `src/components/KeywordStatus.jsx:128-132`

Both copy actions **replace** the entire current-month set rather than merging:

```js
// KeywordRankingEditor.doCopy
const sourceRankings = source.lists?.keyword_rankings || [];
onChange(sourceRankings.map(k => ({ keyword: k.keyword, position: k.position || '' })));

// KeywordStatusTracker.copyFromLeft
onChange(leftStatus.map(s => ({ keyword: s.keyword, page1: [...], ... })));
```

Any keyword that exists in the current month but not in the source month is dropped from state — and since that state is what `buildPayload()` writes back (`ReportEditor.jsx:189`), the loss is persisted on save.

**Impact:** an admin who adds three new keywords, then clicks "Copy rankings from last month" to fill in the rest, silently loses the three new keywords. The toast ("Copied rankings from …") and the helper text ("Then just update the keywords that changed") both imply a merge, not a replace.

**Fix:** merge by keyword — carry current-month entries forward and only overwrite positions that the source month supplies.

---

### M-15 — Team admins were shown two client controls they could not use

**Files:** `api/clients.js:77`, `src/pages/ClientDetail.jsx:120, 302`

**Found while writing `FEATURES.md`** — documenting the access matrix is what surfaced it.

`ClientDetail` is reachable by both admin roles (`src/App.jsx:55`), but two of its controls write through `PUT /api/clients`, whose first line was:

```js
if (profile.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });
```

| Control | Call | Result for `team_admin` |
|---|---|---|
| **Save objectives** | `put('/api/clients', { id, objectives })` | `403 Super admin only` |
| **Targets visible to client** toggle | `put('/api/clients', { id, targets_visible })` | `403 Super admin only` |

A team admin — the role that actually runs the account and writes the reporting content — was shown both controls, and every interaction failed with an error toast. No data corruption (the request was cleanly rejected), but both features were dead for that role.

The objectives half was **pre-existing** (it also routed through `PUT /api/clients` before objectives moved off the `phone` column). The targets-visibility toggle was added under M-3 and inherited the same mistake.

**Fix:** `PUT /api/clients` now separates two field classes:

- **Account management** — `company_name`, `contact_name`, `email`, `phone`, `services`, `logo_url`, and the `archive`/`unarchive` actions — remains super-admin-only.
- **Reporting settings** — `objectives`, `targets_visible` — are writable by either admin role, with team admins additionally required to pass `canAccessClient()` so they can only touch clients assigned to them. The `client` role is rejected outright.

---

### M-16 — Team admins were told a draft was deleted when it was not

**Files:** `src/pages/ReportEditor.jsx:441, 451`, `api/reports.js:174-182`

**Also found while writing `FEATURES.md`.**

`ReportEditor` had no role awareness at all — it never imported `useAuth` — so the delete control rendered identically for every role:

```jsx
{isDraft && <button onClick={() => setConfirmDelete(true)} …>Delete draft</button>}
// confirm dialog: 'The draft and all entered data will be permanently removed.'
// on success:     push('Draft deleted', 'success')
```

But `DELETE /api/reports` deliberately behaves differently per role: `super_admin` deletes the row, while `team_admin` only sets `delete_requested = true`. So a team admin was told the draft was permanently deleted, navigated away, and the draft was still there — now flagged for a super admin to action.

Compounding risk: believing the period was clear, the team admin could create a report for the same month, colliding with `unique (client_id, service, period_start)` (`0001_init.sql:72`) and surfacing a raw database error.

The same action was already handled correctly in `ClientDetail.jsx:79-80`, which role-gates it — only the editor's copy was wrong.

**Fix:** `ReportEditor` now reads the role via `useAuth`. A super admin still sees *Delete draft* with the permanent-removal wording; a team admin sees *Request deletion* with a message explaining the draft stays in place until a super admin reviews it, and the correct confirmation toast. When `delete_requested` is already set, the control is replaced by an "awaiting super admin review" indicator rather than offering the action again.

---

## 🔵 Low

### L-1 — Client role can pass `status=draft` to `/api/reports` and silently get nothing

**File:** `api/reports.js:68-69`

```js
if (profile.role === 'client') q = q.eq('status', 'published');
if (status) q = q.eq('status', status);
```

A client requesting `?status=draft` produces `status=published AND status=draft`, which returns an empty list rather than an error. Not a leak — drafts stay hidden — but the contradictory filters are confusing and would mask a bug if the first line were ever reordered.

### L-2 — Empty `PUT /api/clients` body produces a 500

**File:** `api/clients.js:85-88`

If a caller sends only `{ id }`, `allowed` is `{}` and the update runs with no fields. PostgREST rejects that, and `withHandler` converts it into a generic 500. A 400 with a clear message ("No fields to update") would be correct. (`api/team.js:35` already does this properly.)

### L-3 — Duplicate SVG gradient IDs across charts

**File:** `src/components/charts.jsx:68`

```js
const gid = 'grad-' + color.replace('#', '');
```

Two charts on the same page sharing a colour emit identical `id` attributes, so `url(#grad-6366f1)` resolves to whichever appears first in the DOM. Visually harmless here (the gradients are identical), but it is invalid HTML and would break the moment the fill depended on anything but the colour.

### L-4 — `vsTarget` ignores `lowerBetter`

**File:** `src/lib/comparisons.js:56-61`, used at `src/pages/ClientDashboard.jsx:349`

`vsTarget` computes `pct = cur / target * 100` with no notion of direction, and the card renders "`X% of goal · N to go`". For the one metric flagged `lowerBetter: true` (`avg_ranking`, `src/lib/constants.js:10`) this reads backwards — being *below* an average-ranking target is good, but the card shows it as unmet.

### L-5 — *(retracted — not a bug)*

This entry originally claimed `.no-print` was referenced but never defined. **That was wrong.** The rule exists at `src/index.css:17-24`:

```css
@media print {
  .no-print { display: none !important; }
  ...
}
```

The print stylesheet is complete, so `window.print()` behaves correctly. The finding was made without reading `index.css` and is withdrawn. The ID is left in place so the other cross-references stay valid.

### L-6 — Dead code and unused variables

- `src/pages/ReportEditor.jsx:120-122` — an `if` block containing only a comment:
  ```js
  if (l.key === 'brand_keywords' && rep.status === 'draft' && isEmpty) {
    // brand keyword carry-forward handled below via structure
  }
  ```
- `src/pages/ReportEditor.jsx:17` — `out[k] = Array.isArray(v) ? v : cleanObj(v)` inside a branch already guarded by `!Array.isArray(v)`; the condition is unreachable.
- `src/pages/AdminConsole.jsx:47, 65` — `fStatus` state is declared and listed as a `load` dependency but never set or read.
- `src/contexts/AuthContext.jsx:23` — `catch (e)` binds an unused variable.
- `src/components/charts.jsx:180` — `export { fmtRaw }` re-export is never imported from this module.

### L-7 — Stale scaffolding and build artifacts

- `package.json:2` — `"name": "placeholder-model-2"`.
- `src/App.js`, `src/main.js`, `vite.config.js` are compiled output with `//# sourceMappingURL=` comments, and `App.js.map`, `main.js.map`, `vite.config.js.map` are present. The original `.tsx`/`.ts` sources are not in the tree, so these maps are the only copy — but shipping them also publishes the source.
- `public/vite.svg` and `src/assets/react.svg` are unused Vite/React defaults.
- `api/devop-files.js:147, 180` list `README.md` and `.gitignore` in the config category; neither file exists.
- There is no `.gitignore`, so `node_modules/` and `dist/` would be tracked if this directory were its own repo.

### L-8 — `genPassword` appends a fixed suffix

**File:** `api/helpers.js:84-89`

```js
return p + '1Aa!';
```

Every generated password and invite token ends in the literal `1Aa!`. The random prefix still carries ~87 bits at length 14, so this is not a practical weakness — but it does guarantee a common suffix across all credentials and would defeat any suffix-aware attack heuristic. Generate the special/uppercase/digit characters as part of the random loop instead.

### L-9 — `sendEmail` default sender is a Resend sandbox address

**File:** `api/helpers.js:106`

```js
from: process.env.RESEND_FROM || 'Agency Portal <onboarding@resend.dev>',
```

`onboarding@resend.dev` can only deliver to the account owner's own address, so without `RESEND_FROM` configured, invite and password-reset emails silently fail to reach clients while the code still reports `{ sent: true }` where the API accepts the send. Worth surfacing in the admin UI when the fallback sender is in use.

### L-10 — Self-service password reset is advertised but does not exist

**Files:** `src/pages/ForgotPassword.jsx:16`, `src/pages/Privacy.jsx:8`, `src/pages/Login.jsx:68`

`Privacy.jsx` tells the user: *"You can change your password anytime via the 'Forgot password?' link on the sign-in page."*

The link exists, but `/forgot-password` is not a form — it renders a static panel reading *"Please connect with the project 'SOP' to get your new dashboard password."* There is no input, no reset call, and no way forward. Meanwhile the authenticated user menu (`Layout.jsx:159-160`) offers only "Privacy notice" and "Sign out" — there is no change-password screen for a logged-in user either.

`/reset-password` works, but only as the landing page for a Supabase recovery email, which in this codebase is sent **only** by an admin via `send_link` (`api/reset-password.js:26-33`). Self-service reset is therefore impossible end to end.

**Fix:** wire `ForgotPassword` to `supabase.auth.resetPasswordForEmail()` (the helper already exists and is used server-side), or correct the wording in `Privacy.jsx`.

---

### L-11 — Duplicate toast branches in the report-delete handler

**File:** `src/pages/ClientDetail.jsx:55`

```js
const remove = async (rep) => { ...; push(rep.status === 'delete_requested' ? 'Report deleted' : 'Report deleted', 'success'); ... };
```

Both arms of the ternary are identical, so the condition is dead. It also reports "Report deleted" unconditionally — for a team admin (who only *requests* deletion) the wording would be wrong if this handler were ever wired to that path.

---

### L-12 — Notification bell marks everything read on open

**File:** `src/components/Layout.jsx:63`

```js
<button onClick={() => { setOpen(o => !o); if (!open && unread) markAll(); }} ...>
```

`markAll()` fires in the same click that opens the dropdown. The unread badge clears before the user has had a chance to read anything, so the "unread" state carries no signal — you cannot tell new notifications from old ones, and the per-item highlight is already gone by the time the list renders. Marking as read should happen on close, or per-item on view.

---

### L-13 — Editing a team member's email can silently desync login credentials

**File:** `api/team.js:38-41`

```js
if (email !== undefined && email) {
  try { await supabase.auth.admin.updateUserById(id, { email }); } catch {}
}
```

The `catch {}` discards the error. If the Supabase auth update fails — most commonly because the address is already taken by another account — the `profiles` row keeps the new email while the login identity keeps the old one. The admin console then displays an email the member cannot sign in with, and no error is surfaced to the admin or logged.

**Fix:** check the error and fail the whole operation (or at least return a warning), rather than updating `profiles.email` optimistically.

---

## Broken & non-functional features

A single index of everything above that a user would experience as a feature simply not working. Ordered by how likely someone is to hit it.

| # | Feature | What happens | Ref |
|---|---|---|---|
| 1 | **Dashboard month picker + Compare modes** | Big number follows the selected month; the delta badge, comparison bars and trailing averages still describe the *latest* month. The card contradicts itself. | M-2 |
| 2 | **Client draft privacy** | Clients can read unpublished drafts by enumerating report IDs — the draft→publish review workflow is bypassable. | H-7 |
| 3 | **"Revert to draft"** | Silently discards every unsaved edit, then reports success. | H-5 |
| 4 | **Client delete-request** | The `_delete_requested` flag is wiped by the next save by any admin; the request vanishes with no notice. | M-6 |
| 5 | **Manage access → assigned team** | Always opens showing "No team members assigned", even when members are assigned. | M-12 |
| 6 | **Admin console "Team" column** | Renders `—` for every client; `_assignees` is never populated. | M-4 |
| 7 | **"Targets visible to client" toggle** | Purely cosmetic — never persisted, nothing reads it, resets on reload. Shows a success toast. | M-3 |
| 8 | **Client objectives** | Saving overwrites the client's real phone number; deleting the last objective hides the Save button so the removal can never be persisted. | H-4 |
| 9 | **"Copy from previous month"** (both keyword trackers) | Replaces rather than merges — keywords unique to the current month are deleted on save. | M-14 |
| 10 | **Change / forgot password** | No self-service path exists, despite the privacy page describing one. | L-10 |
| 11 | **Achievements selector** | Month/year selection goes stale on service switch, often showing an empty month not present in the dropdown. | M-13 |
| 12 | **DevOp portal (production)** | The build that populates `dist/_source` fails, so the file browser and DB snapshot cannot load in production. | M-1 |
| 13 | **Invite emails / invite records** | Tokens, `status` and `expires_at` are written but never read — redemption is not implemented; temp passwords are used instead. | M-9 |
| 14 | **Notification bell** | Marks everything read the instant the dropdown opens, before the user has seen any of it. | L-12 |
| 15 | **Team member email edit** | `profiles.email` is updated and the Supabase auth email update is wrapped in a swallowing `try/catch` — on conflict the two desync and the member can no longer sign in with the address shown in the UI. | L-13 |

---

## Suggested remediation order

1. **Now** — rotate the Supabase service-role key (C-3); remove or gate `/api/devop-db` and `/api/devop-files` (C-1, C-2) and the `/devop` route (C-4).
2. **This week** — H-7 (clients reading drafts — it undermines the core publish workflow), the `targets` DELETE IDOR (C-5), the bootstrap privilege escalation (H-1), the cross-tenant `duplicateFromId` copy (H-2), and the `postMessage` origin check (H-3).
3. **Next** — the objectives/`phone` data-loss bug (H-4) and its migration, upload validation (H-6), the build break (M-1), and the injected scripts (M-5).
4. **Backlog** — remaining medium and low items.

---

## Newly found during remediation

Two defects discovered only after the audit, both of which made the application **impossible to build**. Neither was in the original report.

### N-1 — `index.html` pointed at a non-existent entry module

**File:** `index.html:37`

```html
<script type="module" src="/src/main.tsx"></script>
```

There is no `src/main.tsx`. The entry file is `src/main.js`. Vite resolves the `index.html` script tag at build time, so `npm run build` failed with `Could not resolve entry module` — the application could not be built or deployed at all.

**Fixed:** the tag now points at `/src/main.jsx` (see N-2).

### N-2 — JSX in files with a `.js` extension

**Files:** `src/main.js`, `src/App.js`

The tree was compiled from `.tsx` and kept the JSX, but the files carry `.js` extensions. Vite's esbuild transform does not apply the JSX loader to `.js`, and `@vitejs/plugin-react` handles JSX through Babel only for `.jsx`/`.tsx`. The build failed with:

```
[vite:build-html] src/main.js (5:51): Expression expected
5: createRoot(document.getElementById('root')).render(<StrictMode>
```

Setting `esbuild.loader: 'jsx'` in `vite.config.js` did **not** resolve it, because the JSX is handled by the React plugin's Babel pass rather than esbuild.

**Fixed:** renamed `src/main.js` → `src/main.jsx` and `src/App.js` → `src/App.jsx`, removed the stale `sourceMappingURL` comments and the orphaned `.js.map` files. Every other source file was already `.jsx`. `npm run build` now completes (2,225 modules).

---

## Remediation status

**Fixed in code (all of the following):**

| Area | Findings |
|---|---|
| DevOp endpoints + route | C-1, C-2, C-4 — now require `super_admin`; secret deny-list added to both the file walk and the read path; `/devop` wrapped in `ProtectedRoute`; `DevOpPage` now sends auth headers and downloads via blob (it used `window.open`, which cannot carry a bearer token) |
| Secrets | C-3 — service-role key, `FULLSTACK_*` and the harness OAuth proxy removed from `vercel.json` |
| API authorization | C-5, H-1, H-2, H-7 |
| Database RLS coverage | C-6 (migration `0004_rls_coverage.sql`) |
| Report workflow | H-5, M-6 (new `reports.delete_requested` column) |
| OAuth / upload / email | H-3, H-6, L-13, L-8 |
| Objectives | H-4 (new `clients.objectives` column + data migration) |
| Dashboard correctness | M-2, M-3, M-13, M-14, L-1, L-4 |
| Admin console | M-4, M-12, L-11, L-12 |
| Team-admin permissions | M-15, M-16 — found while writing `FEATURES.md`; `PUT /api/clients` split into account-management vs reporting fields, and `ReportEditor` now role-aware |
| Tooling | M-1, M-7, M-11, L-7 |
| Harness removal | M-5 — three injected scripts removed from `index.html` (696 → 16 lines) |
| Other | M-8, M-9, M-10, L-2, L-6, L-10, L-13 |
| Retracted | L-5 — was a false positive |

`npm run build` succeeds. `npm run lint` reports **0 errors** (13 warnings, see below).

**Remaining warnings (13, all advisory):** 10 × `react-hooks/set-state-in-effect` and 3 × `react-refresh/only-export-components`. The first flags the app's consistent fetch-inside-`useEffect` data-loading pattern — switching to a data-loading library is an architectural change, not a bug fix, so it is configured as a warning rather than an error. The second fires on modules that export both a component and a hook (`ui.jsx`, `AuthContext.jsx`, `ThemeContext.jsx`); splitting those files is churn with no behavioural benefit. All nine `exhaustive-deps` warnings were resolved during this pass — some were genuine stale-closure risks (a `useCallback` in `ClientDashboard` captured a stale `profile?.role`; several loaders were recreated every render), and two mount-only effects in `ReportEditor` and `KeywordStatus` now carry an explicit `eslint-disable` with a comment explaining why re-running them would destroy in-progress edits.

**Dead and harness code removed** (all verified unreferenced first):

| Removed | Why |
|---|---|
| `src/lib/googleAuth.js` | Never imported by any component — no sign-in button exists. Removing it also eliminates the latent session-fixation path in `handleGoogleRedirect`, which read a token from the query string with no `state` validation (H-3). |
| `api/db-wake.js` | Harness code that POSTed the project ref to a third-party endpoint on every 5xx. Inert since the `FULLSTACK_*` vars were removed; now gone, along with its `global.fetch` wrapper in `api/db-client.js`. |
| `src/App.css` | Empty (0 bytes) and never imported. |
| `public/vite.svg`, `src/assets/react.svg` | Unused Vite/React scaffolding. |
| `vite.config.js.map` | Stale source map for a TypeScript config that does not exist. |
| `src/main.js.map`, `src/App.js.map` | Removed earlier, when the two JSX-bearing files were renamed to `.jsx` (N-2). |

If you intended to keep Google sign-in, restore `src/lib/googleAuth.js` from the pre-audit copy and supply a real OAuth proxy via `VITE_GOOGLE_AUTH_PROXY` — the origin check added in H-3 is still in the version that was removed.

---

## Operator actions required

These cannot be done from the code and must be performed by whoever owns the deployment.

1. **Rotate the Supabase service-role key.** The old key was stored in `vercel.json` and served by an unauthenticated endpoint. Assume it is compromised. Supabase Dashboard → Project Settings → API → roll the service-role key.

2. **Set environment variables in Vercel** (Settings → Environment Variables). These were previously in `vercel.json` and have been removed:
   - `SUPABASE_SERVICE_ROLE_KEY` — **required**, the API is non-functional without it
   - `ALLOWED_ORIGINS` — optional, comma-separated list for cross-origin access (same-origin needs nothing)
   - `RESEND_API_KEY`, `RESEND_FROM` — optional, for transactional email
   - `BOOTSTRAP_SUPER_ADMIN_EMAIL` — **required once**, on a fresh database only; see below

   The public values (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_*`, `VITE_GOOGLE_CLIENT_ID`) remain in `vercel.json` because they are inlined into the client bundle by design. Move them to Vercel env vars too if you prefer.

3. **Run migrations `0003_real_columns.sql` and `0004_rls_coverage.sql`.** `0003` adds `reports.delete_requested`, `clients.objectives` and `clients.targets_visible`, migrates any objectives stored in `phone` across, and strips the old `_delete_requested` JSONB flag. `0004` enables RLS on the seven unprotected tables. Until they run, objectives and the targets-visibility toggle will error against the new code, and the database remains readable with the public anon key.

   > The migration sets `clients.phone` to `NULL` for any row whose phone held objectives. **Those phone numbers are not recoverable** — they were overwritten by the old code before this audit. The migration leaves genuinely-invalid JSON untouched.

4. **Bootstrap the first super admin.** H-1's fix removed the "first user becomes super admin" behaviour. On a fresh database, set `BOOTSTRAP_SUPER_ADMIN_EMAIL` to the intended admin's address, sign in once with that account (it will be provisioned as super admin and audited), then **remove the variable**. Without it, new users are provisioned as clients only.

5. **Verify sign-in after the env changes.** The `SUPABASE_*` variables are consumed server-side by `api/db-client.js`; if steps 1–2 are missed, every API route returns 401/500.

---

*Every finding above was read directly from the source at the paths and line numbers cited. Fixes were verified with `npm run build` (succeeds, 2,225 modules), `npm run lint` (0 errors) and `node --check` on every `api/*.js`. Deleted files were confirmed unreferenced by a repo-wide grep before removal.*

**Not verified:** the two SQL migrations (`0003`, `0004`) could not be executed — that needs a live Supabase connection this environment does not have. They are written by inspection of the existing schema. After running `0004` in particular, please confirm that a `client` and a `team_admin` can still load their dashboards: the RLS policies in `0001` read `profiles` and `client_assignments` in subqueries, and the new policies exist specifically to keep those working.
