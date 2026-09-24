# Agency Portal — Feature Inventory by Access Type

**Project:** `agency-portal-project` — branded "Search Modifiers — Client Reporting"
**Generated:** 2026-09-23

A complete inventory of what the panel does, bifurcated by access type. Role checks are enforced **server-side** in `api/*` (the authority) and **client-side** by `ProtectedRoute` and per-component conditionals (UX only).

---

## Roles

| Role | Scope | Summary |
|---|---|---|
| `super_admin` | Whole agency | Full control — clients, team, audit, DevOp portal |
| `team_admin` | Assigned clients only | Runs reporting for the clients they're assigned |
| `client` | Own company, read-only | Views published reports on a dashboard |
| *(unauthenticated)* | — | Sign-in, password reset, privacy notice |

Membership in every role is gated one level up:

| Role | Assigned by | How |
|---|---|---|
| `super_admin` | — | Seeded via `BOOTSTRAP_SUPER_ADMIN_EMAIL` on a fresh DB |
| `team_admin` | Super admin | "Invite team member" (`POST /api/invites`) |
| `client` | Super admin, or team admin for their own clients | "Invite client" (`POST /api/invites`) |

There is **no open signup**. Every account originates from an admin invite.

---

## Route Access

`src/App.js`

| Route | Access | Renders |
|---|---|---|
| `/login` | Public | Sign-in form |
| `/forgot-password` | Public | Self-service reset request |
| `/reset-password` | Public | Set new password (from reset email) |
| `/privacy` | Public | Privacy & data-handling notice |
| `/app` | Any authenticated | Role home — Console / My Clients / Dashboard |
| `/app/team` | `super_admin` | Admin console, Team tab |
| `/app/audit` | `super_admin` | Admin console, Audit Log tab |
| `/app/clients/:clientId` | `super_admin`, `team_admin` | Client detail + reports + targets |
| `/app/clients/:clientId/dashboard` | `super_admin`, `team_admin` | Dashboard preview |
| `/app/reports/:reportId/edit` | `super_admin`, `team_admin` | Report editor |
| `/devop` | `super_admin` | DevOp portal (source + DB browser) |

Any other path redirects to `/app`.

---

## Feature Matrix

`✅` full · `⚠️` limited (see notes) · `—` no access

### Client management

| Feature | super_admin | team_admin | client |
|---|:--:|:--:|:--:|
| View client list | ✅ all | ⚠️ assigned only | — |
| Search / filter clients (service, assignee) | ✅ | ⚠️ assigned only | — |
| View archived clients | ✅ | — | — |
| Create client | ✅ | — | — |
| Edit client details | ✅ | — | — |
| Upload client logo | ✅ | ⚠️ API only, no UI | — |
| Archive / unarchive client | ✅ | — | — |
| Edit client objectives | ✅ | ✅ assigned clients | — |
| Toggle targets visibility | ✅ | ✅ assigned clients | — |
| View own company record | ✅ | ✅ | ✅ |

### Team & access

| Feature | super_admin | team_admin | client |
|---|:--:|:--:|:--:|
| View team roster + client counts | ✅ | — | — |
| Invite team member | ✅ | — | — |
| Edit member name / login email | ✅ | — | — |
| Deactivate / reactivate member | ✅ | — | — |
| Offboard member (reassign clients) | ✅ | — | — |
| Reset any user's password | ✅ | — | — |
| Assign / unassign team to client | ✅ | — | — |
| Invite client login | ✅ any client | ⚠️ API only, no UI | — |
| View client login accounts | ✅ | ⚠️ API only, no UI | — |
| Send client a reset email | ✅ | — | — |
| Generate temp password for client | ✅ | — | — |

### Reporting

| Feature | super_admin | team_admin | client |
|---|:--:|:--:|:--:|
| View reports (incl. drafts) | ✅ | ✅ | ⚠️ **published only** |
| Create report (month or custom cycle) | ✅ | ✅ | — |
| Duplicate last period's data | ✅ | ✅ | — |
| Carry forward structure (metrics, categories, keywords) | ✅ | ✅ | — |
| Save draft | ✅ | ✅ | — |
| Publish (notifies client) | ✅ | ✅ | — |
| Publish revision (versioned, snapshotted) | ✅ | ✅ | — |
| Revert published → draft | ✅ | ✅ | — |
| Delete draft / report permanently | ✅ | ⚠️ request only — see below | — |
| Request report deletion | ✅ | ✅ (flagged for super admin) | — |
| Reorder dashboard sections (drag & drop) | ✅ | ✅ | — |
| Show/hide individual sections | ✅ | ✅ | — |
| View report revision history | ✅ | ✅ | ⚠️ API only, no UI |

### Dashboard & content

| Feature | super_admin | team_admin | client |
|---|:--:|:--:|:--:|
| View client dashboard | ✅ all clients | ⚠️ assigned | ⚠️ own, published only |
| Switch report period | ✅ | ✅ | ✅ |
| Comparison modes (MoM / YoY / 3-mo / 6-mo / vs Target / custom range) | ✅ | ✅ | ✅ |
| Trend charts + annotation markers | ✅ | ✅ | ✅ |
| Keyed metrics, breakdown tables, lists, achievements | ✅ | ✅ | ✅ |
| "vs Target" mode & target overlays | ✅ | ✅ | ⚠️ only if enabled |
| Download / print PDF | ✅ | ✅ | ✅ |
| Create / delete chart annotations | ✅ | ✅ | — |
| In-app notification bell | ⚠️ API only, no UI | ⚠️ API only, no UI | ✅ |
| Mark notifications read | ⚠️ API only | ⚠️ API only | ✅ |

### System & admin

| Feature | super_admin | team_admin | client |
|---|:--:|:--:|:--:|
| View audit log | ✅ | — | — |
| Browse project source files | ✅ | — | — |
| Download project ZIP | ✅ | — | — |
| Inspect DB schema + sample rows | ✅ | — | — |
| Download DB snapshot / table JSON | ✅ | — | — |
| Privacy notice | ✅ | ✅ | ✅ |

---

## Per-Role Detail

### `super_admin` — Agency Console

Landing at `/app` opens the **Console** (`src/pages/AdminConsole.jsx`) with three tabs.

**Clients tab**
- Sortable client table: logo, company, contact, email, services, assigned-team count, status
- Filters: free-text search (debounced), service, assignee, archived toggle
- **New client** modal — company name, contact name, contact email, phone, logo upload, service selection (SEO / ORM / Social)
- **Edit client** — same fields
- **Manage access** modal:
  - Assigned team members list, add / remove
  - Client login account display
  - *Send reset email* — Supabase recovery link
  - *Generate temp password* — admin API + email via Resend, falls back to on-screen display
  - Invite a new client login
  - Danger zone — archive client
- **Archive / Restore** client (soft delete; reports and history retained)

**Team tab**
- Roster with role, client count, status
- Invite team member (emailed temp password or shown on screen)
- Edit member (name, login email — both kept in sync atomically)
- Reset password (reset link or temp password)
- Deactivate / Reactivate
- Offboard — deactivates and reassigns all clients to another member

**Audit Log tab**
- Reverse-chronological log of every mutating action: actor email, action key, entity, details

**DevOp portal** (`/devop`, unlinked from the UI)
- File tree of the deployed source, file viewer with copy, project ZIP download
- Per-table schema, row counts, sample rows, JSON export

### `team_admin` — My Clients

Landing at `/app` opens **My Clients** (`src/pages/TeamHome.jsx`).

- Card grid of clients they are assigned to — logo, company, contact, service badges
- Search and service filter (debounced)
- Full client detail page for assigned clients only: objectives, per-service reports, targets, dashboard preview
- Complete reporting lifecycle: create → edit → publish → revise → revert
- Delete requests: cannot delete permanently; flags the report so a super admin reviews it
- Can invite client logins and edit objectives / targets for their clients

**Not available:** client creation or editing, team management, password resets, audit log, DevOp portal, permanent deletion.

### `client` — Reporting Dashboard

Landing at `/app` opens **ClientDashboard** (`src/pages/ClientDashboard.jsx`), entirely read-only.

- Service tabs for every service enabled on their account
- **Report period picker** — switch between published months
- **Comparison modes** — MoM, YoY, 3-month average, 6-month average, vs Target (only when the agency has targets visible), custom date range
- Objectives panel
- Core metric cards with trend charts, delta pills, and comparison bars
- Additional Metrics (custom fields), Google Analytics metrics
- Breakdown tables (month-by-month by category)
- Keyword Ranking Tracker, Keyword Status Tracker
- Detail lists — backlinks, published pages, brand keywords, reviews, top posts
- Additional Inputs (agency annotations pinned to the period)
- Monthly achievements
- **Download PDF** via the browser print stylesheet
- **Notification bell** — publish/revision alerts, mark all read
- Privacy notice
- **Sees published reports only.** Drafts return `404` even if the ID is guessed.

---

## Report Content Model

The same editor drives three service types, each with its own schema (`src/lib/constants.js`).

| Section | SEO | ORM | Social |
|---|:--:|:--:|:--:|
| Core metrics | Clicks, Impressions, Avg. ranking | Avg. rating, Total reviews | Followers, Reach, Engagement rate, Impressions (per platform) |
| Work Done checklist | ✅ | — | — |
| GA metrics (editable name/value) | ✅ | — | — |
| Custom metrics | ✅ | ✅ | ✅ |
| Breakdown | Backlink activity | Reviews submitted + Backlink activity | Posts by type (per platform) |
| Keyword Ranking Tracker | ✅ | — | — |
| Keyword Status Tracker (Page 1/2/3) | — | ✅ | — |
| Detail lists | Backlinks, Published pages | Brand keywords, Reviews, Backlinks | Top posts |
| Achievements | ✅ | ✅ | ✅ |
| Additional Inputs (annotations) | ✅ | ✅ | ✅ |

**Per-platform reporting** for Social — different values per Instagram / Facebook / LinkedIn.

### Carry-forward & duplication
- New drafts inherit the union of every metric key, breakdown category, and keyword ever used for that client+service — no re-typing
- **"Duplicate last period"** copies metrics, breakdowns and lists from the previous published report
- Keyword trackers have a **"copy from previous month"** action that merges (keeps keywords unique to the current month)

---

## Account & Authentication

| Feature | Who | Notes |
|---|---|---|
| Email + password sign-in | All | Supabase Auth |
| Self-service password reset | All | `/forgot-password` → emailed link → `/reset-password` |
| Admin-issued reset link | Super admin | Via Manage access / Team tab |
| Admin-issued temp password | Super admin | Emailed via Resend; shown on screen if email unavailable |
| Sign out | All | — |
| Deactivation | Super admin | Inactive users are rejected at the API on every request |
| Session handling | All | JWT via Supabase; token refresh does not remount the UI |

There is **no** open registration, and **no** self-service account deletion.

---

## Cross-Cutting Behaviour

- **Audit trail** — every mutating API action writes to `audit_log` (actor, action, entity, details), viewable by super admins
- **Error logging** — unhandled route errors are captured to `error_log` with stack traces
- **Notifications** — publishing or revising a report creates an in-app notification and sends an email to the client's contact address
- **Revision history** — publishing a revision snapshots the prior version into `report_revisions`
- **Soft delete** — clients are archived, never hard-deleted; reports cascade on client deletion
- **Row Level Security** — defence-in-depth policies on all tables (migration `0004`); the API uses the service role and bypasses RLS

---

## Fixed During This Review

Writing the access matrices above surfaced two permission bugs — the act of documenting what each role can do is what exposed the gap between the UI and the API. Both are fixed and recorded in `BUGS.md` as M-15 and M-16.

### Team admins were shown two controls they could not use (M-15)

`ClientDetail` is open to both admin roles, but **Save objectives** and the **targets visibility** toggle both write through `PUT /api/clients`, which was gated to `super_admin` — so every interaction returned `403 Super admin only` for team admins.

**Fixed by splitting `PUT /api/clients` into two field classes:**

| Class | Fields | Who |
|---|---|---|
| Account management | `company_name`, `contact_name`, `email`, `phone`, `services`, `logo_url`, archive/unarchive | `super_admin` only |
| Reporting settings | `objectives`, `targets_visible` | Either admin role — team admins must also pass `canAccessClient()`, so only for assigned clients |

The `client` role is rejected outright from both. This was chosen over simply hiding the controls because writing objectives is work the team admin running the account actually does; hiding would have pushed it back to super admins.

### Team admins were told a draft was deleted when it was not (M-16)

`ReportEditor` had no role awareness and always reported *"Draft deleted"* — but `DELETE /api/reports` only deletes for a super admin. For a team admin it flags the report, leaving it in place.

**Fixed:** the editor is now role-aware. Super admins see *Delete draft* with permanent-removal wording; team admins see *Request deletion* explaining the draft stays until a super admin reviews it. If a request is already pending, the control is replaced by an "awaiting super admin review" indicator.

---

## Dependencies on Pending Migrations

Three features write to columns added in migration `0003_real_columns.sql` and will return an error until it has been run:

| Feature | Column |
|---|---|
| Save client objectives | `clients.objectives` |
| Toggle targets visibility | `clients.targets_visible` |
| Team admin delete-request | `reports.delete_requested` |

Reads degrade gracefully — the dashboard and client pages load normally regardless.

Migration `0004_rls_coverage.sql` closes the RLS gap on the seven previously unprotected tables.
