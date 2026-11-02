import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AtSign, Lock, MailCheck, UserRound } from 'lucide-react';
import PasswordStrength from '../components/PasswordStrength';
import { useAuth } from '../context/useAuth';
import { validatePassword } from '../lib/password';
import './Auth.css';

type Mode = 'auth' | 'forgot' | 'check-email' | 'reset-sent';

function friendlyError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'Incorrect email or password. Try again or reset your password.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'Please verify your email first — check your inbox for the confirmation link.';
  }
  if (/already (been )?registered/i.test(message)) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (/rate limit/i.test(message)) {
    return 'Too many emails in a short time — wait a few minutes, then try again.';
  }
  if (/password/i.test(message)) {
    return 'That password does not meet the requirements: 8+ characters with uppercase, lowercase, number, and symbol.';
  }
  return message;
}

export default function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn, signUp, resetPassword, resendConfirmation, configured } = useAuth();
  const isSignup = location.pathname === '/signup';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('auth');
  const [busy, setBusy] = useState(false);
  const [resendCooling, setResendCooling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // The same component instance serves /login and /signup, so its state
  // survives tab switches — reset the sub-screen whenever the route changes.
  // (Adjusted during render, the documented pattern for syncing state to
  // props; your typed email is preserved.)
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMode('auth');
    setError('');
    setNotice('');
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (isSignup) {
      const check = validatePassword(password);
      if (!check.valid) {
        setError(
          `Choose a stronger password — still needs: ${check.failed.map((f) => f.label).join(', ')}.`,
        );
        return;
      }
    }
    setBusy(true);
    try {
      if (isSignup) {
        const { emailConfirmationRequired } = await signUp(email, password, name);
        if (emailConfirmationRequired) {
          setMode('check-email');
        } else {
          navigate('/onboarding', { replace: true });
        }
      } else {
        await signIn(email, password);
        navigate('/app', { replace: true });
      }
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await resetPassword(email);
      setMode('reset-sent');
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await resendConfirmation(email);
      setNotice('Confirmation email sent. Check your inbox.');
      // One email per minute: Supabase throttles auth emails, and hammering
      // resend is the fastest way to hit "email rate limit exceeded".
      setResendCooling(true);
      window.setTimeout(() => setResendCooling(false), 60000);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <h1>
          {mode === 'forgot' || mode === 'reset-sent'
            ? 'Reset your password'
            : mode === 'check-email'
              ? 'Check your inbox'
              : isSignup
                ? 'Create your account'
                : 'Welcome back'}
        </h1>
        <p>
          {mode === 'forgot'
            ? 'Enter your email and we’ll send you a reset link.'
            : mode === 'reset-sent'
              ? 'If an account exists for that email, a reset link is on its way.'
              : mode === 'check-email'
                ? 'Click the confirmation link we emailed you, then sign in.'
                : isSignup
                  ? 'Your memories are waiting. It takes less than a minute.'
                  : 'Your friends missed you. Pick up where you left off.'}
        </p>
        {!configured && (
          <p className="field-hint" role="note">
            Supabase isn’t configured yet — add VITE_SUPABASE_URL and
            VITE_SUPABASE_PUBLISHABLE_KEY to frontend/.env.local to enable sign-in.
          </p>
        )}
      </div>

      {mode === 'check-email' && (
        <div className="auth-verify">
          <MailCheck size={40} strokeWidth={1.5} aria-hidden="true" />
          <p>
            We sent a confirmation link to <strong>{email || 'your email'}</strong>.
            Open it, then come back and sign in.
          </p>
          <button
            type="button"
            className="btn btn-outline btn-block"
            onClick={handleResend}
            disabled={busy || !email || resendCooling}
          >
            {busy
              ? 'Sending…'
              : resendCooling
                ? 'Email sent — wait a minute to resend'
                : 'Resend confirmation email'}
          </button>
          <p className="auth-switch">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      )}

      {mode === 'reset-sent' && (
        <div className="auth-verify">
          <MailCheck size={40} strokeWidth={1.5} aria-hidden="true" />
          <p>
            Reset link sent to <strong>{email || 'your email'}</strong>. It expires
            in about an hour.
          </p>
          <p className="auth-switch">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      )}

      {mode === 'forgot' && (
        <form onSubmit={handleForgot} className="auth-form">
          <label className="field">
            <span className="field-label">
              <AtSign size={15} aria-hidden="true" />
              Email
            </span>
            <input
              className="input"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="auth-switch">
            Remembered it?{' '}
            <button type="button" className="link-btn" onClick={() => setMode('auth')}>
              Sign in
            </button>
          </p>
        </form>
      )}

      {mode === 'auth' && (
        <>
          <div className="auth-tabs" role="tablist" aria-label="Sign in or sign up">
            <Link
              to="/login"
              role="tab"
              aria-selected={!isSignup}
              className={`auth-tab${!isSignup ? ' is-active' : ''}`}
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              role="tab"
              aria-selected={isSignup}
              className={`auth-tab${isSignup ? ' is-active' : ''}`}
            >
              Sign up
            </Link>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {isSignup && (
              <label className="field">
                <span className="field-label">
                  <UserRound size={15} aria-hidden="true" />
                  Display name
                </span>
                <input
                  className="input"
                  type="text"
                  autoComplete="nickname"
                  placeholder="e.g. Amara"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label className="field">
              <span className="field-label">
                <AtSign size={15} aria-hidden="true" />
                Email
              </span>
              <input
                className="input"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">
                <Lock size={15} aria-hidden="true" />
                Password
              </span>
              <input
                className="input"
                type="password"
                required
                minLength={isSignup ? 8 : 6}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                placeholder={
                  isSignup ? '8+ characters, mixed case, number, symbol' : 'Your password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {isSignup && <PasswordStrength password={password} />}
              {!isSignup && (
                <span className="field-hint">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setMode('forgot');
                      setError('');
                    }}
                  >
                    Forgot your password?
                  </button>
                </span>
              )}
            </label>
            <button
              type="submit"
              className="btn btn-primary btn-block btn-lg"
              disabled={busy}
            >
              {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="auth-switch">
            {isSignup ? (
              <>
                Already have an account? <Link to="/login">Sign in</Link>
              </>
            ) : (
              <>
                New to ReConnect? <Link to="/signup">Create an account</Link>
              </>
            )}
          </p>
        </>
      )}

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
