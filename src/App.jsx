import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider, FullLoader } from './components/ui';
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
    const { profile, loading } = useAuth();
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
    return <Navigate to='/login' replace/>;
}
export default function App() {
    return (<ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <ErrorBoundary>
            <Routes>
              <Route path='/login' element={<Login />}/>
              <Route path='/forgot-password' element={<ForgotPassword />}/>
              <Route path='/reset-password' element={<ResetPassword />}/>
              <Route path='/privacy' element={<Privacy />}/>
              <Route path='/devop' element={<ProtectedRoute roles={['super_admin']}><DevOpPage /></ProtectedRoute>}/>
              <Route path='/app' element={<ProtectedRoute><Layout><RoleHome /></Layout></ProtectedRoute>}/>
              <Route path='/app/team' element={<ProtectedRoute roles={['super_admin']}><Layout><AdminConsole /></Layout></ProtectedRoute>}/>
              <Route path='/app/audit' element={<ProtectedRoute roles={['super_admin']}><Layout><AdminConsole /></Layout></ProtectedRoute>}/>
              <Route path='/app/clients/:clientId' element={<ProtectedRoute roles={['super_admin', 'team_admin']}><Layout><Suspense fallback={<SuspenseFallback />}><ClientDetail /></Suspense></Layout></ProtectedRoute>}/>
              <Route path='/app/clients/:clientId/dashboard' element={<ProtectedRoute roles={['super_admin', 'team_admin']}><Layout><Suspense fallback={<SuspenseFallback />}><ClientDashboard /></Suspense></Layout></ProtectedRoute>}/>
              <Route path='/app/reports/:reportId/edit' element={<ProtectedRoute roles={['super_admin', 'team_admin']}><Layout><Suspense fallback={<SuspenseFallback />}><ReportEditor /></Suspense></Layout></ProtectedRoute>}/>
              <Route path='*' element={<Navigate to='/app' replace/>}/>
            </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>);
}
