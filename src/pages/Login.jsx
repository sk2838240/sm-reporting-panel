import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, User, Lock, ArrowRight } from 'lucide-react';
import supabase from '../lib/supabase';
import { Button, Input, useToast } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const nav = useNavigate();
  const { push } = useToast();

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!email || !password) { setErr('Enter your username and password.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    push('Welcome back!', 'success');
    nav('/app');
  };

  return (
    <div className='min-h-screen grid lg:grid-cols-2'>
      <div className='hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 text-white relative overflow-hidden'>
        <div className='absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-2xl' />
        <div className='absolute bottom-0 left-0 w-full h-64 bg-black/10' />
        <div className='relative'>
          <div className='flex items-center gap-3'>
            <div className='flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur'><ShieldCheck className='w-6 h-6' /></div>
            <div><div className='text-lg font-bold'>Search Modifiers</div><div className='text-xs text-white/70'>Client Reporting Suite</div></div>
          </div>
        </div>
        <div className='relative space-y-4 max-w-md'>
          <h1 className='text-4xl font-bold leading-tight'>Check SEO, ORM, PR, & Social Media reports from one place.</h1>
          <p className='text-white/80 text-lg'>Manage your reports with ease, check the latest updates, track progress, compare results, and download detailed reports anytime, all from one convenient client portal.</p>
        </div>
      </div>

      <div className='flex items-center justify-center p-6 sm:p-10 bg-slate-50 dark:bg-slate-900'>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className='w-full max-w-sm'>
          <div className='lg:hidden flex items-center gap-2.5 mb-8'>
            <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white'><ShieldCheck className='w-5 h-5' /></div>
            <div className='text-lg font-bold dark:text-white'>Search Modifiers</div>
          </div>
          <h2 className='text-2xl font-bold text-slate-900 dark:text-white'>Sign in</h2>
          <p className='text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6'>Access your reporting dashboard.</p>

          <form onSubmit={submit} className='space-y-4'>
            <div className='relative'>
              <User className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
              <Input type='email' placeholder='Username' value={email} onChange={(e) => setEmail(e.target.value)} className='pl-10' autoComplete='email' />
            </div>
            <div className='relative'>
              <Lock className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
              <Input type='password' placeholder='Password' value={password} onChange={(e) => setPassword(e.target.value)} className='pl-10' autoComplete='current-password' />
            </div>
            {err && <div className='text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2'>{err}</div>}
            <Button type='submit' disabled={loading} className='w-full'>{loading ? 'Signing in...' : <>Sign in <ArrowRight className='w-4 h-4' /></>}</Button>
          </form>

          <div className='mt-6 text-sm text-slate-500 dark:text-slate-400 text-center'>
            <Link to='/forgot-password' className='text-indigo-600 dark:text-indigo-400 font-semibold hover:underline'>Forgot password?</Link>
          </div>
          <p className='mt-4 text-xs text-slate-400 dark:text-slate-500 text-center'>No open signup. Accounts are created by your agency admin.</p>
        </motion.div>
      </div>
    </div>
  );
}
