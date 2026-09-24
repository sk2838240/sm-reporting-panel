import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Users, UserPlus, Search, Pencil, Archive, ArchiveRestore, ScrollText, Mail, UserCog, ChevronRight, Building2, KeyRound } from 'lucide-react';
import { get, post, put, del } from '../lib/api';
import { Button, Input, Select, Field, Badge, Modal, ConfirmDialog, DataTable, EmptyState, useToast, FullLoader, BackButton } from '../components/ui';
import { SERVICE_META, SERVICE_ORDER } from '../lib/constants';
import { formatDate } from '../lib/format';

const SERVICE_BADGE = { seo: 'indigo', orm: 'emerald', social: 'amber' };

export default function AdminConsole() {
  const navigate = useNavigate();
  const location = useLocation();
  const tab = location.pathname.endsWith('/team') ? 'team' : location.pathname.endsWith('/audit') ? 'audit' : 'clients';
  const tabBtn = (k, label, Icon) => (
    <button key={k} onClick={() => navigate(k === 'clients' ? '/app' : `/app/${k}`)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className='w-4 h-4' />{label}</button>
  );
  return (
    <div>
      {/* Team and Audit are sub-views of the Console — Clients is its home. */}
      {tab !== 'clients' && <BackButton to='/app' label='Back to clients' className='mb-4' />}
      <div className='flex items-center justify-between flex-wrap gap-3 mb-6'>
        <div>
          <h1 className='text-2xl font-bold text-slate-900 dark:text-slate-100'>Console</h1>
          <p className='text-sm text-slate-500 dark:text-slate-400'>Manage clients, team members, assignments and audit history.</p>
        </div>
        <div className='flex gap-1 bg-white border border-slate-200 dark:border-slate-700 rounded-xl p-1 bg-white dark:bg-slate-800'>
          {tabBtn('clients', 'Clients', Users)}
          {tabBtn('team', 'Team', UserCog)}
          {tabBtn('audit', 'Audit Log', ScrollText)}
        </div>
      </div>
      {tab === 'clients' && <ClientsTab />}
      {tab === 'team' && <TeamTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

/* ---------------- Clients tab ---------------- */
function ClientsTab() {
  const nav = useNavigate();
  const { push } = useToast();
  const [clients, setClients] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fService, setFService] = useState('');
  const [fAssignee, setFAssignee] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null); // client or null for create
  const [access, setAccess] = useState(null); // client for manage-access modal
  const [confirm, setConfirm] = useState(null);

  // Debounce the search term; `load` depends on the debounced value so a
  // keystroke doesn't fire a request, and mount doesn't fire two.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, t] = await Promise.all([
        get(`/api/clients?status=${showArchived ? 'archived' : ''}&search=${encodeURIComponent(debouncedSearch)}&service=${fService}&assignee=${fAssignee}`),
        get('/api/team'),
      ]);
      setClients(c || []);
      setTeam((t || []).filter((x) => x.role === 'team_admin' && x.status === 'active'));
    } catch (e) { push(e.message, 'error'); }
    setLoading(false);
  }, [debouncedSearch, fService, fAssignee, showArchived, push]);

  useEffect(() => { load(); }, [load]);

  const archive = async (c) => { await put('/api/clients', { id: c.id, action: 'archive' }); push('Client archived', 'success'); load(); };
  const unarchive = async (c) => { await put('/api/clients', { id: c.id, action: 'unarchive' }); push('Client restored', 'success'); load(); };

  const columns = [
    { key: 'company_name', label: 'Client', render: (c) => (
      <button onClick={() => nav(`/app/clients/${c.id}`)} className='flex items-center gap-2.5 text-left group'>
        <div className='h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 overflow-hidden'>{c.logo_url ? <img src={c.logo_url} alt='' className='h-full w-full object-cover' /> : <Building2 className='w-4 h-4' />}</div>
        <div>
          <span className='font-semibold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 block'>{c.company_name}</span>
          {c.contact_name && <span className='text-xs text-slate-400 dark:text-slate-500'>{c.contact_name}</span>}
        </div>
        <ChevronRight className='w-4 h-4 text-slate-300 group-hover:text-indigo-400' />
      </button>
    ) },
    { key: 'contact_email', label: 'Email', render: (c) => <span className='text-xs text-slate-500 dark:text-slate-400'>{c.email || '—'}</span> },
    { key: 'services', label: 'Services', render: (c) => <div className='flex gap-1'>{(c.services || []).map((s) => <Badge key={s} color={SERVICE_BADGE[s]}>{SERVICE_META[s]?.label || s}</Badge>)}</div> },
    { key: 'assignees', label: 'Team', render: (c) => <span className='text-slate-500 dark:text-slate-400'>{c._assignees?.length ? `${c._assignees.length} assigned` : '—'}</span> },
    { key: 'status', label: 'Status', render: (c) => <Badge color={c.status === 'active' ? 'emerald' : 'slate'}>{c.status}</Badge> },
    { key: 'actions', label: '', render: (c) => (
      <div className='flex gap-1 justify-end'>
        <button onClick={() => setAccess(c)} className='p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300' title='Manage access'><UserCog className='w-4 h-4' /></button>
        <button onClick={() => setEditing(c)} className='p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300' title='Edit'><Pencil className='w-4 h-4' /></button>
        {c.status === 'archived'
          ? <button onClick={() => unarchive(c)} className='p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-emerald-600' title='Restore'><ArchiveRestore className='w-4 h-4' /></button>
          : <button onClick={() => setConfirm(c)} className='p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-rose-600' title='Archive'><Archive className='w-4 h-4' /></button>}
      </div>
    ) },
  ];

  return (
    <div>
      <div className='flex flex-wrap items-center gap-2 mb-4'>
        <div className='relative flex-1 min-w-[200px]'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
          <Input placeholder='Search clients...' value={search} onChange={(e) => setSearch(e.target.value)} className='pl-10' />
        </div>
        <Select value={fService} onChange={(e) => setFService(e.target.value)} className='w-auto'><option value=''>All services</option>{SERVICE_ORDER.map((s) => <option key={s} value={s}>{SERVICE_META[s].label}</option>)}</Select>
        <Select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className='w-auto'><option value=''>All assignees</option>{team.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</Select>
        <label className='inline-flex items-center gap-2 text-sm text-slate-600 px-3'><input type='checkbox' checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived</label>
        <Button onClick={() => setEditing({})} accent='#4f46e5' variant='accent'><UserPlus className='w-4 h-4' /> New client</Button>
      </div>

      {loading ? <FullLoader /> : clients.length === 0 ? (
        <EmptyState icon={Users} title='No clients found' message='Create your first client to start reporting.' accent='#6366f1' action={<Button accent='#4f46e5' variant='accent' onClick={() => setEditing({})}><UserPlus className='w-4 h-4' /> New client</Button>} />
      ) : (
        <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden'>
          <DataTable columns={columns} rows={clients} empty='No clients.' />
        </div>
      )}

      {editing && <ClientModal client={editing} team={team} onClose={() => setEditing(null)} onSaved={load} />}
      {access && <AccessModal client={access} team={team} onClose={() => setAccess(null)} onChanged={load} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title='Archive client?' message={`Archive ${confirm?.company_name}? Their reports are kept; the client will no longer see an active dashboard.`} confirmText='Archive' danger onConfirm={() => { archive(confirm); setConfirm(null); }} />
    </div>
  );
}

function ClientModal({ client, onClose, onSaved }) {
  const isCreate = !client.id;
  const { push } = useToast();
  const [form, setForm] = useState({ company_name: client.company_name || '', contact_name: client.contact_name || '', email: client.email || '', phone: client.phone || '', services: client.services || ['seo', 'orm', 'social'], logo_url: client.logo_url || '' });
  const [saving, setSaving] = useState(false);
  const toggleService = (s) => setForm((f) => ({ ...f, services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s] }));
  const onLogo = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { push('Logo must be 2MB or smaller', 'error'); e.target.value = ''; return; }
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { push('Logo must be a PNG, JPG, WebP or GIF', 'error'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try { const res = await post('/api/upload', { fileName: file.name, fileBase64: reader.result.split(',')[1], contentType: file.type }); setForm((f) => ({ ...f, logo_url: res.url })); push('Logo uploaded', 'success'); }
      catch (err) { push(err.message, 'error'); }
    };
    reader.readAsDataURL(file);
  };
  const save = async () => {
    if (!form.company_name) { push('Company name required', 'error'); return; }
    setSaving(true);
    try {
      if (isCreate) { await post('/api/clients', form); push('Client created', 'success'); }
      else { await put('/api/clients', { id: client.id, ...form }); push('Client updated', 'success'); }
      onSaved(); onClose();
    } catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} title={isCreate ? 'New client' : 'Edit client'} wide
      footer={<><Button variant='outline' onClick={onClose}>Cancel</Button><Button accent='#4f46e5' variant='accent' disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</Button></>}>
      <div className='grid sm:grid-cols-2 gap-4'>
        <Field label='Company name' className='sm:col-span-2'><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder='Acme Inc.' /></Field>
        <Field label='Contact name'><Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></Field>
        <Field label='Contact email'><Input type='email' value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label='Phone'><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label='Client logo' className='sm:col-span-2'>
          <div className='flex items-center gap-4'>
            <div className='h-16 w-16 rounded-2xl bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center overflow-hidden shrink-0'>
              {form.logo_url ? <img src={form.logo_url} alt='Logo preview' className='h-full w-full object-cover' /> : <Building2 className='w-7 h-7 text-slate-400' />}
            </div>
            <div className='flex-1'>
              <input type='file' accept='image/png,image/jpeg,image/webp,image/gif' onChange={onLogo} className='text-sm text-slate-500 dark:text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 dark:file:bg-indigo-900/30 file:text-indigo-600 dark:file:text-indigo-400 file:px-4 file:py-2 file:font-semibold file:cursor-pointer' />
              {form.logo_url && <button onClick={() => setForm({ ...form, logo_url: '' })} className='ml-2 text-xs text-rose-600 font-semibold hover:underline'>Remove</button>}
              <p className='text-xs text-slate-400 mt-1'>PNG, JPG, WebP or GIF. Max 2MB.</p>
            </div>
          </div>
        </Field>
        <Field label='Services' className='sm:col-span-2'>
          <div className='flex flex-wrap gap-2'>
            {SERVICE_ORDER.map((s) => (
              <button key={s} type='button' onClick={() => toggleService(s)} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${form.services.includes(s) ? 'text-white' : 'text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`} style={form.services.includes(s) ? { backgroundColor: SERVICE_META[s].accent, borderColor: SERVICE_META[s].accent } : undefined}>
                <span className='w-2 h-2 rounded-full' style={{ background: form.services.includes(s) ? '#fff' : SERVICE_META[s].accent }} /> {SERVICE_META[s].label}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function AccessModal({ client, team, onClose, onChanged }) {
  const { push } = useToast();
  const [assigned, setAssigned] = useState(client.team || []);
  const [addId, setAddId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteResult, setInviteResult] = useState(null);
  const [clientUser, setClientUser] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [showArchive, setShowArchive] = useState(false);

  // Fetch the client's login profile
  useEffect(() => {
    (async () => {
      try {
        const users = await get(`/api/client-users?clientId=${client.id}`);
        if (users && users.length) {
          setClientUser({ email: users[0].email, userId: users[0].id, fullName: users[0].full_name });
        }
      } catch {}
    })();
  }, [client.id]);

  // Load current assignments on open. The `client` row comes from the list
  // endpoint, which does not carry the `team` array — without this the modal
  // always claimed no team members were assigned.
  useEffect(() => {
    (async () => {
      try {
        const c = await get(`/api/clients?single=1&id=${client.id}`);
        setAssigned(c.team || []);
      } catch {}
    })();
  }, [client.id]);

  const refresh = async () => {
    const c = await get(`/api/clients?single=1&id=${client.id}`);
    setAssigned(c.team || []);
    onChanged();
  };
  const assign = async () => { if (!addId) return; await post('/api/assignments', { clientId: client.id, teamMemberId: addId }); setAddId(''); push('Team member assigned', 'success'); refresh(); };
  const unassign = async (m) => { await del('/api/assignments', { clientId: client.id, teamMemberId: m.id }); push('Unassigned', 'success'); refresh(); };
  const inviteClient = async () => {
    if (!inviteEmail) { push('Enter an email', 'error'); return; }
    try {
      const res = await post('/api/invites', { email: inviteEmail, role: 'client', fullName: inviteName, clientId: client.id });
      setInviteResult(res);
      setClientUser({ email: inviteEmail, userId: res.userId });
      push(res.emailSent ? 'Invite email sent' : 'Client user created', 'success');
      setInviteEmail(''); setInviteName('');
    } catch (e) { push(e.message, 'error'); }
  };

  const resetPassword = async (action) => {
    if (!clientUser?.userId) {
      push('No client login account found. Invite a client first.', 'error');
      return;
    }
    setResetting(true);
    setResetResult(null);
    try {
      const res = await post('/api/reset-password', { userId: clientUser.userId, action: action || 'temp_password' });
      setResetResult(res);
      if (action === 'send_link') {
        push(res.emailSent ? 'Reset email sent to client' : 'Could not send email — try temp password instead', res.emailSent ? 'success' : 'error');
      } else {
        push(res.emailSent ? 'Password reset — email sent to client' : 'Password reset — share temp password manually', 'success');
      }
    } catch (e) { push(e.message, 'error'); }
    setResetting(false);
  };

  const archiveClient = async () => {
    try {
      await put('/api/clients', { id: client.id, action: 'archive' });
      push('Client archived', 'success');
      onChanged();
      onClose();
    } catch (e) { push(e.message, 'error'); }
  };

  const available = team.filter((m) => !assigned.some((a) => a.id === m.id));

  return (
    <Modal open onClose={onClose} title={`Manage access — ${client.company_name}`} wide
      footer={<Button variant='outline' onClick={onClose}>Done</Button>}>
      <div className='space-y-6'>
        {/* Assigned team members */}
        <div>
          <h4 className='text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2'>Assigned team members</h4>
          {assigned.length === 0 ? <p className='text-sm text-slate-400 dark:text-slate-500'>No team members assigned.</p> : (
            <div className='space-y-1.5'>
              {assigned.map((m) => (
                <div key={m.id} className='flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2'>
                  <div><div className='text-sm font-semibold text-slate-800 dark:text-slate-200'>{m.full_name}</div><div className='text-xs text-slate-400 dark:text-slate-500'>{m.email}</div></div>
                  <button onClick={() => unassign(m)} className='text-xs text-rose-600 font-semibold hover:underline'>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div className='flex gap-2 mt-2'>
            <Select value={addId} onChange={(e) => setAddId(e.target.value)} className='flex-1'><option value=''>Add team member...</option>{available.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</Select>
            <Button variant='outline' onClick={assign}>Add</Button>
          </div>
        </div>

        {/* Client login account + password reset */}
        <div className='border-t border-slate-100 dark:border-slate-700 pt-4'>
          <h4 className='text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2'>Client login account</h4>
          {(clientUser || inviteResult) ? (
            <div className='space-y-3'>
              <div className='flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2'>
                <div>
                  <div className='text-sm font-semibold text-slate-800 dark:text-slate-200'>{clientUser?.email || inviteEmail}</div>
                  <div className='text-xs text-slate-400 dark:text-slate-500'>Client login · read-only dashboard access</div>
                </div>
              </div>

              {/* Reset password buttons */}
              <div className='flex flex-wrap gap-2'>
                <Button size='sm' accent='#4f46e5' variant='accent' disabled={resetting} onClick={() => resetPassword('send_link')}>
                  <Mail className='w-3.5 h-3.5' /> {resetting ? 'Sending...' : 'Send reset email'}
                </Button>
                <Button size='sm' variant='outline' disabled={resetting} onClick={() => resetPassword('temp_password')}>
                  <KeyRound className='w-3.5 h-3.5' /> {resetting ? 'Generating...' : 'Generate temp password'}
                </Button>
              </div>

              {/* Reset results */}
              {resetResult && resetResult.method === 'send_link' && resetResult.emailSent && (
                <div className='rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400'>
                  ✅ A password reset link has been emailed to {resetResult.email}. The client can click the link to set a new password.
                </div>
              )}
              {resetResult && resetResult.method === 'send_link' && !resetResult.emailSent && (
                <div className='rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-400'>
                  ⚠️ Could not send a reset link via email. Try "Generate temp password" instead, or check your email configuration.
                </div>
              )}
              {resetResult && resetResult.method === 'temp_password' && resetResult.emailSent && (
                <div className='rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400'>
                  ✅ A new temporary password has been emailed to {resetResult.email}.
                </div>
              )}
              {resetResult && resetResult.method === 'temp_password' && !resetResult.emailSent && (
                <div className='rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-400'>
                  ⚠️ Email not sent (no Resend key configured). Share this temp password manually with the client: <code className='font-mono font-bold text-sm'>{resetResult.tempPassword}</code>
                </div>
              )}
            </div>
          ) : (
            <p className='text-xs text-slate-400 dark:text-slate-500 mb-2'>No client login account yet. Create one below:</p>
          )}
        </div>

        {/* Invite client login */}
        {!clientUser && !inviteResult && (
          <div className='border-t border-slate-100 dark:border-slate-700 pt-4'>
            <h4 className='text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2'>Invite client login</h4>
            <p className='text-xs text-slate-400 dark:text-slate-500 mb-2'>Creates a read-only client account for this client.</p>
            <div className='grid sm:grid-cols-2 gap-2'>
              <Input placeholder='Client name' value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
              <Input placeholder='Client email' value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <Button accent='#4f46e5' variant='accent' className='mt-2' onClick={inviteClient}><Mail className='w-4 h-4' /> Invite client</Button>
          </div>
        )}

        {inviteResult && !inviteResult.emailSent && !clientUser && (
          <div className='rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-400'>
            Email not sent (no Resend key). Share these credentials: <b>{inviteEmail}</b> · temp password: <code className='font-mono'>{inviteResult.tempPassword}</code>
          </div>
        )}

        {/* Danger zone — Archive/Remove client */}
        <div className='border-t border-slate-100 dark:border-slate-700 pt-4'>
          <h4 className='text-sm font-semibold text-rose-600 dark:text-rose-400 mb-2'>Danger zone</h4>
          {showArchive ? (
            <div className='rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/10 px-3 py-3'>
              <p className='text-xs text-slate-600 dark:text-slate-400 mb-3'>
                Archiving <b>{client.company_name}</b> will hide it from the active client list. Their reports, targets, and history are kept.
                The client will no longer be able to access their dashboard.
              </p>
              <div className='flex gap-2'>
                <Button variant='danger' size='sm' onClick={archiveClient}><Archive className='w-3.5 h-3.5' /> Archive this client</Button>
                <Button variant='outline' size='sm' onClick={() => setShowArchive(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowArchive(true)} className='inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline'>
              <Archive className='w-3.5 h-3.5' /> Archive / remove client
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Team tab ---------------- */
function TeamTab() {
  const { push } = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(false);
  const [offboard, setOffboard] = useState(null);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setMembers(await get('/api/team')); } catch (e) { push(e.message, 'error'); }
    setLoading(false);
  }, [push]);
  useEffect(() => { load(); }, [load]);
  const act = async (m, action, extra) => {
    try { await put('/api/team', { id: m.id, action, ...extra }); push('Updated', 'success'); load(); }
    catch (e) { push(e.message, 'error'); }
  };
  const cols = [
    { key: 'full_name', label: 'Member', render: (m) => <div><div className='font-semibold text-slate-800 dark:text-slate-200'>{m.full_name}</div><div className='text-xs text-slate-400 dark:text-slate-500'>{m.email}</div></div> },
    { key: 'role', label: 'Role', render: (m) => <Badge color={m.role === 'super_admin' ? 'indigo' : 'sky'}>{m.role === 'super_admin' ? 'Super Admin' : 'Team Admin'}</Badge> },
    { key: 'clientCount', label: 'Clients', render: (m) => <span className='text-slate-500 dark:text-slate-400'>{m.clientCount}</span> },
    { key: 'status', label: 'Status', render: (m) => <Badge color={m.status === 'active' ? 'emerald' : 'slate'}>{m.status}</Badge> },
    { key: 'actions', label: '', render: (m) => (
      <div className='flex gap-1 justify-end'>
        <button onClick={() => setEditing(m)} className='p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300' title='Edit member'><Pencil className='w-4 h-4' /></button>
        <button onClick={() => setResetting(m)} className='p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400' title='Reset password'><KeyRound className='w-4 h-4' /></button>
        {m.role !== 'super_admin' && (m.status === 'active'
          ? <><button onClick={() => setOffboard(m)} className='px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'>Offboard</button>
            <button onClick={() => act(m, 'deactivate')} className='px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'>Deactivate</button></>
          : <button onClick={() => act(m, 'reactivate')} className='px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'>Reactivate</button>)}
      </div>
    ) },
  ];
  return (
    <div>
      <div className='flex justify-end mb-4'>
        <Button accent='#4f46e5' variant='accent' onClick={() => setInvite(true)}><UserPlus className='w-4 h-4' /> Invite team member</Button>
      </div>
      {loading ? <FullLoader /> : <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden'><DataTable columns={cols} rows={members} /></div>}
      {invite && <InviteTeamModal onClose={() => setInvite(false)} onDone={load} />}
      {offboard && <OffboardModal member={offboard} members={members} onClose={() => setOffboard(null)} onDone={load} />}
      {editing && <EditTeamModal member={editing} onClose={() => setEditing(null)} onDone={load} />}
      {resetting && <ResetTeamPasswordModal member={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function InviteTeamModal({ onClose, onDone }) {
  const { push } = useToast();
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [saving, setSaving] = useState(false); const [res, setRes] = useState(null);
  const submit = async () => {
    if (!email) { push('Email required', 'error'); return; }
    setSaving(true);
    try { const r = await post('/api/invites', { email, role: 'team_admin', fullName: name }); setRes(r); push(r.emailSent ? 'Invite sent' : 'Team member created', 'success'); onDone(); }
    catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} title='Invite team member'
      footer={<><Button variant='outline' onClick={onClose}>{res ? 'Close' : 'Cancel'}</Button>{!res && <Button accent='#4f46e5' variant='accent' disabled={saving} onClick={submit}>{saving ? 'Sending...' : 'Send invite'}</Button>}</>}>
      {!res ? (
        <div className='space-y-3'>
          <Field label='Full name'><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label='Email'><Input type='email' value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
      ) : (
        <div className='space-y-3'>
          <div className='rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700'>{res.emailSent ? `Invite email sent to ${email}.` : 'Team member created.'}</div>
          {!res.emailSent && <div className='rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800'>No Resend key configured. Share temp password: <code className='font-mono'>{res.tempPassword}</code></div>}
        </div>
      )}
    </Modal>
  );
}

function OffboardModal({ member, members, onClose, onDone }) {
  const { push } = useToast();
  const [reassignTo, setReassignTo] = useState('');
  const others = members.filter((m) => m.id !== member.id && m.status === 'active' && m.role === 'team_admin');
  const submit = async () => {
    if (!reassignTo) { push('Pick a team member to reassign clients to', 'error'); return; }
    await put('/api/team', { id: member.id, action: 'offboard', reassignTo });
    push('Team member offboarded & clients reassigned', 'success');
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Offboard ${member.full_name}?`}
      footer={<><Button variant='outline' onClick={onClose}>Cancel</Button><Button variant='danger' onClick={submit}>Offboard & reassign</Button></>}>
      <p className='text-sm text-slate-600 mb-3'>This deactivates the account and reassigns all their clients to another team member.</p>
      <Field label='Reassign clients to'><Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}><option value=''>Select...</option>{others.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</Select></Field>
    </Modal>
  );
}

function EditTeamModal({ member, onClose, onDone }) {
  const { push } = useToast();
  const [name, setName] = useState(member.full_name || '');
  const [email, setEmail] = useState(member.email || '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) { push('Name is required', 'error'); return; }
    if (!email.trim()) { push('Email is required', 'error'); return; }
    setSaving(true);
    try {
      await put('/api/team', { id: member.id, action: 'edit', full_name: name.trim(), email: email.trim() });
      push('Team member updated', 'success');
      onDone(); onClose();
    } catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} title={`Edit — ${member.full_name}`}
      footer={<><Button variant='outline' onClick={onClose}>Cancel</Button><Button accent='#4f46e5' variant='accent' disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save changes'}</Button></>}>
      <div className='space-y-4'>
        <Field label='Full name'><Input value={name} onChange={(e) => setName(e.target.value)} placeholder='Full name' /></Field>
        <Field label='Email' hint='Changing the email also updates their login email.'><Input type='email' value={email} onChange={(e) => setEmail(e.target.value)} placeholder='Email address' /></Field>
        <div className='rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400'>
          <div className='flex items-center gap-2 mb-1'><Badge color={member.role === 'super_admin' ? 'indigo' : 'sky'}>{member.role === 'super_admin' ? 'Super Admin' : 'Team Admin'}</Badge> <span>·</span> <Badge color={member.status === 'active' ? 'emerald' : 'slate'}>{member.status}</Badge></div>
          <p>Role and status cannot be changed from here. Use the Offboard/Deactivate buttons to change status.</p>
        </div>
      </div>
    </Modal>
  );
}

function ResetTeamPasswordModal({ member, onClose }) {
  const { push } = useToast();
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState(null);
  const doReset = async (action) => {
    setResetting(true); setResult(null);
    try {
      const res = await post('/api/reset-password', { userId: member.id, action });
      setResult(res);
      push(res.emailSent ? 'Reset email sent' : 'Password reset', 'success');
    } catch (e) { push(e.message, 'error'); }
    setResetting(false);
  };
  return (
    <Modal open onClose={onClose} title={`Reset password — ${member.full_name}`}
      footer={<Button variant='outline' onClick={onClose}>Done</Button>}>
      <div className='space-y-4'>
        <div className='flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5'>
          <div><div className='text-sm font-semibold text-slate-800 dark:text-slate-200'>{member.email}</div><div className='text-xs text-slate-400 dark:text-slate-500'>{member.role === 'super_admin' ? 'Super Admin' : 'Team Admin'}</div></div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button accent='#4f46e5' variant='accent' disabled={resetting} onClick={() => doReset('send_link')}><Mail className='w-3.5 h-3.5' /> {resetting ? 'Sending...' : 'Send reset email'}</Button>
          <Button variant='outline' disabled={resetting} onClick={() => doReset('temp_password')}><KeyRound className='w-3.5 h-3.5' /> {resetting ? 'Generating...' : 'Generate temp password'}</Button>
        </div>
        {result && result.method === 'send_link' && result.emailSent && (
          <div className='rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400'>✅ A password reset link has been emailed to {result.email}.</div>
        )}
        {result && result.method === 'send_link' && !result.emailSent && (
          <div className='rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-400'>⚠️ Could not send reset link. Try "Generate temp password" instead.</div>
        )}
        {result && result.method === 'temp_password' && result.emailSent && (
          <div className='rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400'>✅ A new temporary password has been emailed to {result.email}.</div>
        )}
        {result && result.method === 'temp_password' && !result.emailSent && (
          <div className='rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-400'>⚠️ Email not sent. Share this temp password manually: <code className='font-mono font-bold text-sm'>{result.tempPassword}</code></div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- Audit tab ---------------- */
function AuditTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { get('/api/audit?limit=200').then(setRows).catch(() => {}).finally(() => setLoading(false)); }, []);
  const cols = [
    { key: 'created_at', label: 'When', render: (r) => <span className='text-slate-500'>{formatDate(r.created_at)}</span> },
    { key: 'actor_email', label: 'Actor', render: (r) => <span className='font-medium text-slate-700'>{r.actor_email}</span> },
    { key: 'action', label: 'Action', render: (r) => <Badge color='indigo'>{r.action}</Badge> },
    { key: 'entity_type', label: 'Entity', render: (r) => <span className='text-slate-500'>{r.entity_type}{r.entity_id ? ` #${String(r.entity_id).slice(0, 6)}` : ''}</span> },
    { key: 'details', label: 'Details', render: (r) => <span className='text-xs text-slate-400 font-mono'>{r.details ? JSON.stringify(r.details).slice(0, 60) : ''}</span> },
  ];
  return <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden'>{loading ? <FullLoader /> : <DataTable columns={cols} rows={rows} empty='No audit entries yet.' />}</div>;
}
