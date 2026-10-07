import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';
import supabase from '../lib/supabase';
import { Button, Input, useToast } from '../components/ui';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  // The recovery token arrives in the URL fragment and is parsed by the auth
  // client. Awaiting getSession() means the form cannot be submitted before that
  // has happened, so a fast user cannot trigger updateUser() against a session
  // that is not established yet and get a spurious "Auth session missing".
  const [ready, setReady] = useState(false);
  const nav = useNavigate();
  const { push } = useToast();

  useEffect(() => {
    let mounted = true;
    // .catch() before .finally(): a rejected promise returned by .finally()
    // re-rejects, and nothing here handles it.
    supabase.auth.getSession().catch(() => {}).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    // The button is disabled until ready, but pressing Enter in a field submits
    // the form regardless — which is the exact race `ready` exists to prevent.
    if (!ready) return;
    if (password.length < 6) { push('Password must be at least 6 characters', 'error'); return; }
    if (password !== confirm) { push('Passwords do not match', 'error'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { push(error.message, 'error'); return; }
      push('Password updated', 'success');
      nav('/app');
    } catch (e) {
      // Without this the button stays disabled reading "Updating…" forever.
      push(e?.message || 'Could not update your password. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='min-h-screen flex items-center justify-center bg-slate-50 p-6'>
      <div className='w-full max-w-sm'>
        {/* A plain link, not history-back: this page is normally reached from an
            email, where going back would leave the app entirely. */}
        <Link to='/login' className='inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 mb-6'><ArrowLeft className='w-4 h-4' /> Back to sign in</Link>
        <h2 className='text-2xl font-bold text-slate-900'>Set a new password</h2>
        <form onSubmit={submit} className='mt-5 space-y-4'>
          <div className='relative'>
            <Lock className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
            <Input type='password' placeholder='New password' value={password} onChange={(e) => setPassword(e.target.value)} className='pl-10' />
          </div>
          <div className='relative'>
            <Lock className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
            <Input type='password' placeholder='Confirm password' value={confirm} onChange={(e) => setConfirm(e.target.value)} className='pl-10' />
          </div>
          <Button type='submit' disabled={loading || !ready} className='w-full'>{loading ? 'Updating...' : 'Update password'}</Button>
        </form>
      </div>
    </div>
  );
}
