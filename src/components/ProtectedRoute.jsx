import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button, FullLoader } from './ui';
import { AlertCircle } from 'lucide-react';

export default function ProtectedRoute({ children, roles }) {
  const { profile, loading, profileError, refreshProfile } = useAuth();

  // Only show the full-screen loader during the INITIAL load (before the
  // profile has ever been fetched). Once we have a profile, never unmount
  // the children — token refreshes and background re-renders should not
  // cause the dashboard to disappear and reload.
  if (loading && !profile) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900'>
        <FullLoader />
      </div>
    );
  }

  // Profile failed to load after retries — show an error with a retry button
  if (!profile && profileError) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-6'>
        <div className='text-center max-w-sm'>
          <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 mx-auto mb-4'>
            <AlertCircle className='w-7 h-7' />
          </div>
          <h2 className='text-lg font-bold text-slate-900 dark:text-slate-100'>Couldn't load your account</h2>
          <p className='text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5'>{profileError}</p>
          <Button onClick={() => { refreshProfile(); }} variant='primary'>Try again</Button>
        </div>
      </div>
    );
  }

  if (!profile) return <Navigate to='/login' replace />;
  if (roles && !roles.includes(profile.role)) return <Navigate to='/app' replace />;
  return children;
}
