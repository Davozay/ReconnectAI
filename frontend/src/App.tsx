import { useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import SplashScreen from './components/SplashScreen';
import { useAuth } from './context/useAuth';
import { useIsModerator } from './context/useIsModerator';
import type { ReactNode } from 'react';
import MarketingLayout from './layouts/MarketingLayout';
import AuthLayout from './layouts/AuthLayout';
import DashboardLayout from './layouts/DashboardLayout';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import ResetPassword from './pages/ResetPassword';
import Onboarding from './pages/Onboarding';
import Feed from './pages/Feed';
import Detective from './pages/Detective';
import Discover from './pages/Discover';
import Memories from './pages/Memories';
import Messages from './pages/Messages';
import Profile from './pages/Profile';
import Connections from './pages/Connections';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import Moderation from './pages/Moderation';

/* Real route guard: waits for the Supabase session to restore, then
   requires a signed-in user. Sessions persist across refreshes. */
function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="page-loading" role="status" aria-label="Loading">
        <p>Loading…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/* Moderator-only guard. Non-moderators never reach the queue UI, and
   RLS denies their report reads even if they call the API directly. */
function ModeratorOnly({ children }: { children: ReactNode }) {
  const { moderator, loading } = useIsModerator();
  if (loading) {
    return (
      <div className="page-loading" role="status" aria-label="Loading">
        <p>Loading…</p>
      </div>
    );
  }
  if (!moderator) {
    return (
      <div className="card card-pad">
        <p className="empty-note">
          <ShieldAlert
            size={15}
            aria-hidden="true"
            style={{ verticalAlign: '-2px', marginRight: '0.4rem' }}
          />
          This area is for ReConnect moderators.{' '}
          <Link to="/app/settings">Back to Settings</Link>
        </p>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { loading } = useAuth();
  const [splashOn, setSplashOn] = useState(true);
  return (
    <>
      {splashOn && <SplashScreen ready={!loading} onExited={() => setSplashOn(false)} />}
      <Routes>
      <Route element={<MarketingLayout />}>
        <Route index element={<Landing />} />
      </Route>

      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Auth />} />
        <Route path="/signup" element={<Auth />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      <Route
        path="/onboarding"
        element={
          <Protected>
            <Onboarding />
          </Protected>
        }
      />

      {/* Detective is public so visitors can try it; the rest needs sign-in. */}
      <Route path="/app" element={<DashboardLayout />}>
        <Route
          index
          element={
            <Protected>
              <Feed />
            </Protected>
          }
        />
        <Route path="detective" element={<Detective />} />
        <Route
          path="discover"
          element={
            <Protected>
              <Discover />
            </Protected>
          }
        />
        <Route
          path="memories"
          element={
            <Protected>
              <Memories />
            </Protected>
          }
        />
        <Route
          path="connections"
          element={
            <Protected>
              <Connections />
            </Protected>
          }
        />
        <Route
          path="messages"
          element={
            <Protected>
              <Messages />
            </Protected>
          }
        />
        <Route
          path="notifications"
          element={
            <Protected>
              <Notifications />
            </Protected>
          }
        />
        <Route
          path="profile"
          element={
            <Protected>
              <Profile />
            </Protected>
          }
        />
        <Route
          path="settings"
          element={
            <Protected>
              <Settings />
            </Protected>
          }
        />
        <Route
          path="moderation"
          element={
            <Protected>
              <ModeratorOnly>
                <Moderation />
              </ModeratorOnly>
            </Protected>
          }
        />
        <Route path="requests" element={<Navigate to="/app/connections" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
