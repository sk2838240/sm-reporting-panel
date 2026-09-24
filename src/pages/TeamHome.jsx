import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Building2, Users } from 'lucide-react';
import { get } from '../lib/api';
import { Input, Select, Badge, EmptyState, FullLoader, useToast } from '../components/ui';
import { SERVICE_META, SERVICE_ORDER } from '../lib/constants';

const SERVICE_BADGE = { seo: 'indigo', orm: 'emerald', social: 'amber' };

export default function TeamHome() {
  const nav = useNavigate();
  const { push } = useToast();
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fService, setFService] = useState('');
  const [loading, setLoading] = useState(true);

  // Debounce the search term, then let `load` depend on the debounced value.
  // Previously two effects both called load(), firing a duplicate request on
  // every mount and every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setClients(await get(`/api/clients?search=${encodeURIComponent(debouncedSearch)}&service=${fService}`) || []); }
    catch (e) { push(e.message, 'error'); }
    setLoading(false);
  }, [debouncedSearch, fService, push]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className='mb-6'>
        <h1 className='text-2xl font-bold text-slate-900 dark:text-slate-100'>My Clients</h1>
        <p className='text-sm text-slate-500 dark:text-slate-400'>The clients assigned to your account.</p>
      </div>
      <div className='flex flex-wrap items-center gap-2 mb-5'>
        <div className='relative flex-1 min-w-[200px]'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
          <Input placeholder='Search clients...' value={search} onChange={(e) => setSearch(e.target.value)} className='pl-10' />
        </div>
        <Select value={fService} onChange={(e) => setFService(e.target.value)} className='w-auto'><option value=''>All services</option>{SERVICE_ORDER.map((s) => <option key={s} value={s}>{SERVICE_META[s].label}</option>)}</Select>
      </div>
      {loading ? <FullLoader /> : clients.length === 0 ? (
        <EmptyState icon={Users} title='No clients yet' message='No clients are assigned to you yet. Ask an admin to assign one.' accent='#6366f1' />
      ) : (
        <div className='grid sm:grid-cols-2 lg:grid-cols-3 gap-4'>
          {clients.map((c) => (
            <button key={c.id} onClick={() => nav(`/app/clients/${c.id}`)} className='text-left rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 transition group flex flex-col'>
              <div className='flex items-start justify-between'>
                <div className='flex items-center gap-3'>
                  <div className='h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden text-slate-400'>{c.logo_url ? <img src={c.logo_url} alt='' className='h-full w-full object-cover' /> : <Building2 className='w-5 h-5' />}</div>
                  <div><div className='font-semibold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400'>{c.company_name}</div><div className='text-xs text-slate-400'>{c.contact_name || '—'}</div></div>
                </div>
                <ChevronRight className='w-5 h-5 text-slate-300 group-hover:text-indigo-500' />
              </div>
              <div className='flex gap-1.5 mt-3 flex-wrap'>{(c.services || []).map((s) => <Badge key={s} color={SERVICE_BADGE[s]}>{SERVICE_META[s]?.label}</Badge>)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
