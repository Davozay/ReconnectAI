import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import PasswordStrength from '../components/PasswordStrength';
import { useAuth } from '../context/useAuth';
import { validatePassword } from '../lib/password';
import './Auth.css';

/* Handles Supabase recovery links (?code=...): the client exchanges the code
   for a session on load (detectSessionInUrl), then the user sets a new
   password with that session. */
export default function ResetPassword() {
  const navigate = useNavigate();
  const { session, updatePassword, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Supabase exchanges ?code= for a session on load; failures redirect back
  // with ?error=. No timer needed: still verifying only while a code is
  // present, no session has arrived yet, and no error was reported.
  const params = new URLSearchParams(window.location.search);
  const linkError = params.get('error_description') || params.get('error');
  const verifying = loading || (params.has('code') && !session && !linkError);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    const check = validatePassword(password);
    if (!check.valid) {
      setError(
        `Choose a stronger password — still needs: ${check.failed.map((f) => f.label).join(', ')}.`,
      );
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <h1>Choose a new password</h1>
        <p>Make it at least 6 characters — and unique to ReConnect.</p>
      </div>

      {verifying ? (
        <p className="auth-switch">Verifying your reset link…</p>
      ) : !session ? (
        <>
          <p className="auth-error" role="alert">
            {linkError || 'This reset link is invalid or expired. Request a fresh one.'}
          </p>
          <p className="auth-switch">
            <Link to="/login">Back to sign in</Link>
          </p>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field">
            <span className="field-label">
              <Lock size={15} aria-hidden="true" />
              New password
            </span>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="8+ characters, mixed case, number, symbol"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordStrength password={password} />
          </label>
          <label className="field">
            <span className="field-label">
              <Lock size={15} aria-hidden="true" />
              Confirm password
            </span>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Repeat your new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
