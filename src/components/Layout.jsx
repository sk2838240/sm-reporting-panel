import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard, Users, ScrollText, Bell, LogOut, Menu, X, ShieldCheck, ChevronDown, Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { get, put } from '../lib/api';
import { Badge } from './ui';
import { relativeTime } from '../lib/format';

const ROLE_LABEL = { super_admin: 'Super Admin', team_admin: 'Team Admin', client: 'Client' };
const ROLE_COLOR = { super_admin: 'indigo', team_admin: 'sky', client: 'emerald' };

function NavLinks({ onNavigate }) {
  const { profile } = useAuth();
  let links = [];
  if (profile?.role === 'super_admin') {
    links = [
      { to: '/app', label: 'Console', icon: Users, end: true },
      { to: '/app/audit', label: 'Audit Log', icon: ScrollText },
    ];
  } else if (profile?.role === 'team_admin') {
    links = [{ to: '/app', label: 'My Clients', icon: Users, end: true }];
  } else {
    links = [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }];
  }
  return (
    <>
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.end} onClick={onNavigate}
          className={({ isActive }) => `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${isActive ? 'bg-slate-900 text-white dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
          <l.icon className='w-4 h-4' /> {l.label}
        </NavLink>
      ))}
    </>
  );
}

function NotificationBell() {
  const { profile } = useAuth();
  const clientId = profile?.client_id;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const data = await get(`/api/notifications?clientId=${clientId}`);
      setItems(data.items || []);
      setUnread(data.unread || 0);
    } catch {}
  }, [clientId]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick); return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const markAll = async () => { await put('/api/notifications', { all: true, clientId: profile.client_id }); load(); };

  return (
    <div className='relative' ref={ref}>
      {/* Opening the dropdown must not clear the unread state — the user has
          not read anything yet. "Mark all read" is explicit in the header. */}
      <button onClick={() => setOpen(o => !o)} className='relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'>
        <Bell className='w-5 h-5' />
        {unread > 0 && <span className='absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center'>{unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className='absolute right-0 mt-2 w-80 rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden'>
            <div className='px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between'>
              <span className='text-sm font-semibold text-slate-800 dark:text-slate-200'>Notifications</span>
              <button onClick={markAll} className='text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline'>Mark all read</button>
            </div>
            <div className='max-h-80 overflow-y-auto'>
              {items.length === 0 ? <div className='text-center text-sm text-slate-400 dark:text-slate-500 py-8'>No notifications yet.</div> :
                items.map(n => (
                  <div key={n.id} className={`px-4 py-3 border-b border-slate-50 dark:border-slate-700 ${n.read ? '' : 'bg-indigo-50/40 dark:bg-indigo-900/20'}`}>
                    <div className='text-sm font-semibold text-slate-800 dark:text-slate-200'>{n.title}</div>
                    <div className='text-xs text-slate-500 dark:text-slate-400 mt-0.5'>{n.message}</div>
                    <div className='text-[11px] text-slate-400 dark:text-slate-500 mt-1'>{relativeTime(n.created_at)}</div>
                  </div>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button onClick={toggle} className='inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition' title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <AnimatePresence mode='wait'>
        {dark ? (
          <motion.div key='sun' initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 90 }}>
            <Sun className='w-5 h-5' />
          </motion.div>
        ) : (
          <motion.div key='moon' initial={{ opacity: 0, rotate: 90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: -90 }}>
            <Moon className='w-5 h-5' />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

export default function Layout({ children }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const loc = useLocation();
  useEffect(() => { setMobileOpen(false); setMenuOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const onClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onClick); return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const initials = (profile?.full_name || profile?.email || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className='min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100'>
      <header className='sticky top-0 z-40 bg-white/85 dark:bg-slate-800/85 backdrop-blur border-b border-slate-200 dark:border-slate-700 no-print'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4'>
          <NavLink to='/app' className='flex items-center gap-2.5 shrink-0'>
            <div className='flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm'><ShieldCheck className='w-5 h-5' /></div>
            <div className='leading-tight hidden sm:block'>
              <div className='text-[15px] font-bold tracking-tight dark:text-white'>Search Modifiers</div>
              <div className='text-[10px] text-slate-400 dark:text-slate-500 font-medium -mt-0.5'>Client Reporting</div>
            </div>
          </NavLink>

          <nav className='hidden md:flex items-center gap-1 ml-2'><NavLinks /></nav>

          <div className='flex items-center gap-1.5 ml-auto'>
            <ThemeToggle />
            {profile?.role === 'client' && <NotificationBell />}
            <div className='relative' ref={menuRef}>
              <button onClick={() => setMenuOpen(o => !o)} className='flex items-center gap-2 rounded-xl pl-1.5 pr-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800'>
                <div className='h-8 w-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white text-xs font-bold flex items-center justify-center'>{initials}</div>
                <div className='hidden sm:block text-left leading-tight'>
                  <div className='text-xs font-semibold text-slate-800 dark:text-slate-200 max-w-[120px] truncate'>{profile?.full_name || profile?.email}</div>
                  <div className='text-[10px] text-slate-400 dark:text-slate-500'>{ROLE_LABEL[profile?.role]}</div>
                </div>
                <ChevronDown className='w-4 h-4 text-slate-400' />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                    className='absolute right-0 mt-2 w-52 rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden py-1.5'>
                    <div className='px-3 py-2 border-b border-slate-100 dark:border-slate-700 mb-1'>
                      <Badge color={ROLE_COLOR[profile?.role]}>{ROLE_LABEL[profile?.role]}</Badge>
                    </div>
                    <button onClick={() => navigate('/privacy')} className='w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'>Privacy notice</button>
                    <button onClick={async () => { await signOut(); navigate('/login'); }} className='w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-2'><LogOut className='w-4 h-4' /> Sign out</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button onClick={() => setMobileOpen(o => !o)} className='md:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'>
              {mobileOpen ? <X className='w-5 h-5' /> : <Menu className='w-5 h-5' />}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {mobileOpen && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className='md:hidden overflow-hidden border-t border-slate-100 dark:border-slate-700'>
              <div className='px-4 py-3 flex flex-col gap-1'><NavLinks onNavigate={() => setMobileOpen(false)} /></div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className='max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8'>{children}</main>

      <footer className='max-w-7xl mx-auto px-4 sm:px-6 py-8 text-center text-xs text-slate-400 dark:text-slate-500 no-print'>
        Search Modifiers · Manual reporting & client dashboard · <button onClick={() => navigate('/privacy')} className='hover:text-slate-600 dark:hover:text-slate-300 underline'>Privacy</button>
      </footer>
    </div>
  );
}
