import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button, FullLoader } from './ui';
import { AlertCircle } from 'lucide-react';

export default function ProtectedRoute({ children, roles }) {
  const { profile, session, loading, profileError, retrying, refreshProfile } = useAuth();

  // Only show the full-screen loader during the INITIAL load (before the
  // profile has ever been fetched). Once we have a profile, never unmount
  // the children — token refreshes and background re-renders should not
  // cause the dashboard to disappear and reload.
  if ((loading || retrying) && !profile) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900'>
        <FullLoader label={retrying ? 'Retrying...' : undefined} />
      </div>
    );
  }

  // Profile failed to load after retries — show an error with a retry button.
  // The `!retrying` guard matters: during a retry the error is already cleared,
  // so without it this branch disappears and line 37's `!profile` redirect fires
  // — the button bounced the user to /login instead of retrying.
  if (!profile && profileError && !retrying) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-6'>
        <div className='text-center max-w-sm'>
          <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 mx-auto mb-4'>
            <AlertCircle className='w-7 h-7' />
          </div>
          <h2 className='text-lg font-bold text-slate-900 dark:text-slate-100'>Couldn't load your account</h2>
          <p className='text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5'>{profileError}</p>
          <Button onClick={refreshProfile} disabled={retrying} variant='primary'>{retrying ? 'Retrying...' : 'Try again'}</Button>
        </div>
      </div>
    );
  }

  // Only bounce to /login when there is genuinely no session. Redirecting while
  // a session exists but the profile is still unresolved created a two-node
  // cycle with Login's own "already signed in, go to /app" redirect: /app bounced
  // to /login, which bounced straight back. This state is transient whenever a
  // load is in flight, and can persist when /api/me 200s with a body that has no
  // `profile` key — so hold a loader instead of looping.
  if (!profile && session) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900'>
        <FullLoader label='Loading your account...' />
      </div>
    );
  }

  if (!profile) return <Navigate to='/login' replace />;
  if (roles && !roles.includes(profile.role)) return <Navigate to='/app' replace />;
  return children;
}
