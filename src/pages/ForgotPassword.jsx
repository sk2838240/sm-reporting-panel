import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Mail, CheckCircle2 } from 'lucide-react';
import supabase from '../lib/supabase';
import { Button, Input } from '../components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!email.trim()) { setErr('Enter your email address.'); return; }
    setLoading(true);
    // Supabase sends the recovery email; the link lands on /reset-password,
    // which calls updateUser() with the new password.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  };

  return (
    <div className='min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6'>
      <div className='w-full max-w-sm'>
        <Link to='/login' className='inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 mb-6'><ArrowLeft className='w-4 h-4' /> Back to sign in</Link>
        <h2 className='text-2xl font-bold text-slate-900 dark:text-white'>Reset your password</h2>

        {sent ? (
          <div className='mt-5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-4'>
            <div className='flex items-start gap-3'>
              <CheckCircle2 className='w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5' />
              <div>
                <p className='text-sm font-semibold text-slate-800 dark:text-slate-200'>Check your inbox</p>
                <p className='text-xs text-slate-500 dark:text-slate-400 mt-1'>
                  If <b>{email}</b> matches an account, we've sent a link to set a new password. The link expires shortly, so use it soon.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className='text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5'>
              Enter your email and we'll send you a link to set a new password.
            </p>
            <form onSubmit={submit} className='space-y-4'>
              <div className='relative'>
                <Mail className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
                <Input type='email' placeholder='Your email address' value={email} onChange={(e) => setEmail(e.target.value)} className='pl-10' autoComplete='email' />
              </div>
              {err && <div className='text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2'>{err}</div>}
              <Button type='submit' disabled={loading} className='w-full'>{loading ? 'Sending...' : 'Send reset link'}</Button>
            </form>
            <p className='mt-4 text-xs text-slate-400 dark:text-slate-500 text-center'>
              No email arriving? Contact your agency admin and they can issue a temporary password.
            </p>
          </>
        )}

        <div className='mt-6 flex items-center justify-center'>
          <div className='flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500'>
            <ShieldCheck className='w-4 h-4' /> Search Modifiers — Client Reporting
          </div>
        </div>
      </div>
    </div>
  );
}
