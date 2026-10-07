import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import ErrorBoundary, { RouteErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, FullLoader, Button } from './components/ui';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Privacy from './pages/Privacy';
import DevOpPage from './pages/DevOpPage';
import AdminConsole from './pages/AdminConsole';
import TeamHome from './pages/TeamHome';
// Code-split the heaviest pages into separate chunks.
// The report editor (~120KB of form logic) only loads when an admin opens it.
const ClientDetail = lazy(() => import('./pages/ClientDetail'));
const ClientDashboard = lazy(() => import('./pages/ClientDashboard'));
const ReportEditor = lazy(() => import('./pages/ReportEditor'));
function SuspenseFallback() {
    return (<div className='flex items-center justify-center py-20'>
      <FullLoader label='Loading...'/>
    </div>);
}
function RoleHome() {
    const { profile, loading, signOut } = useAuth();
    if (loading)
        return <FullLoader />;
    if (profile?.role === 'super_admin')
        return <AdminConsole />;
    if (profile?.role === 'team_admin')
        return <TeamHome />;
    if (profile?.role === 'client')
        return (<Suspense fallback={<SuspenseFallback />}>
      <ClientDashboard />
    </Suspense>);
    // Authenticated but the profile carries no role we recognise. Redirecting to
    // /login here bounced the user straight back to /app — Login signs them in
    // again and navigates to /app — an endless loop with no message. Say what is
    // wrong and let them sign out instead.
    return (<div className='min-h-[60vh] flex items-center justify-center px-6'>
      <div className='text-center max-w-sm'>
        <h2 className='text-lg font-bold text-slate-900 dark:text-slate-100'>No dashboard available</h2>
        <p className='text-sm text-slate-500 dark:text-slate-400 mt-2 mb-5'>
          Your account is signed in but has no role assigned{profile?.email ? ` (${profile.email})` : ''}.
          {' '}Ask your agency administrator to set your access level.
        </p>
        <Button variant='outline' onClick={signOut}>Sign out</Button>
      </div>
    </div>);
}
// A data router (createBrowserRouter) rather than <BrowserRouter> + <Routes>.
// Both render the same tree, but useBlocker — which is the only thing that
// intercepts the BROWSER Back button — throws without a data router. The report
// editor needs it so unsaved work cannot be discarded by a stray Back press.
// Every route needs its own errorElement. With a data router, React Router
// installs an internal RenderErrorBoundary for the active match and catches
// anything thrown while rendering it — so an ErrorBoundary wrapped only
// AROUND <RouterProvider> never fires for page content, and a crash renders
// React Router's bare "Unexpected Application Error!" with a raw stack instead
// of the themed fallback with its "Reload dashboard" button.
// RouteErrorBoundary, not <ErrorBoundary /> directly: React Router renders an
// errorElement as a child of a context provider and never passes the error as a
// prop, so the class boundary alone had nothing to render against and a crashing
// route produced a blank page. The wrapper reads it via useRouteError().
const routeError = <RouteErrorBoundary />;

const router = createBrowserRouter([
    { path: '/login', element: <Login />, errorElement: routeError },
    { path: '/forgot-password', element: <ForgotPassword />, errorElement: routeError },
    { path: '/reset-password', element: <ResetPassword />, errorElement: routeError },
    { path: '/privacy', element: <Privacy />, errorElement: routeError },
    { path: '/devop', element: <ProtectedRoute roles={['super_admin']}><DevOpPage /></ProtectedRoute>, errorElement: routeError },
    { path: '/app', element: <ProtectedRoute><Layout><RoleHome /></Layout></ProtectedRoute>, errorElement: routeError },
    { path: '/app/team', element: <ProtectedRoute roles={['super_admin']}><Layout><AdminConsole /></Layout></ProtectedRoute>, errorElement: routeError },
    { path: '/app/audit', element: <ProtectedRoute roles={['super_admin']}><Layout><AdminConsole /></Layout></ProtectedRoute>, errorElement: routeError },
    { path: '/app/definitions', element: <ProtectedRoute roles={['super_admin']}><Layout><AdminConsole /></Layout></ProtectedRoute>, errorElement: routeError },
    { path: '/app/clients/:clientId', element: <ProtectedRoute roles={['super_admin', 'team_admin']}><Layout><Suspense fallback={<SuspenseFallback />}><ClientDetail /></Suspense></Layout></ProtectedRoute>, errorElement: routeError },
    { path: '/app/clients/:clientId/dashboard', element: <ProtectedRoute roles={['super_admin', 'team_admin']}><Layout><Suspense fallback={<SuspenseFallback />}><ClientDashboard /></Suspense></Layout></ProtectedRoute>, errorElement: routeError },
    { path: '/app/reports/:reportId/edit', element: <ProtectedRoute roles={['super_admin', 'team_admin']}><Layout><Suspense fallback={<SuspenseFallback />}><ReportEditor /></Suspense></Layout></ProtectedRoute>, errorElement: routeError },
    { path: '*', element: <Navigate to='/app' replace />, errorElement: routeError },
]);

export default function App() {
    return (<ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <ErrorBoundary>
            {/* onError restores the console/error_log reporting the route-level
                boundaries bypass — RenderErrorBoundary swallows the throw. */}
            <RouterProvider router={router} onError={(err) => { console.error('Router error:', err); }} />
          </ErrorBoundary>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>);
}
