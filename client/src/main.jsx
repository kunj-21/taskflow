import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, roleAtLeast, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import AuthCallback from './pages/AuthCallback.jsx';
import Onboarding from './pages/Onboarding.jsx';
import InviteAccept from './pages/InviteAccept.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Calendar from './pages/Calendar.jsx';
import Analytics from './pages/Analytics.jsx';
import Projects from './pages/Projects.jsx';
import Team from './pages/Team.jsx';
import Audit from './pages/Audit.jsx';
import Settings from './pages/Settings.jsx';
import Layout from './components/Layout.jsx';
import { Spinner, ToastProvider } from './components/ui.jsx';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

const Loading = () => <div className="center" role="status"><Spinner /><span className="sr-only">Loading</span></div>;

// Signed in + belongs to an org (+ optional minimum role in that org).
function Protected({ children, minRole }) {
  const { user, org, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!org) return <Navigate to="/onboarding" replace />;
  if (minRole && !roleAtLeast(org.role, minRole)) return <Navigate to="/" replace />;
  return children;
}

function WhenReady({ children }) {
  const { loading } = useAuth();
  return loading ? <Loading /> : children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/invite/:token" element={<WhenReady><InviteAccept /></WhenReady>} />
              <Route path="/onboarding" element={<WhenReady><Onboarding /></WhenReady>} />
              <Route element={<Protected><Layout /></Protected>}>
                <Route index element={<Dashboard />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="projects" element={<Projects />} />
                <Route path="team" element={<Team />} />
                <Route path="settings" element={<Settings />} />
                <Route path="audit" element={<Protected minRole="ADMIN"><Audit /></Protected>} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
