import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthContext } from './auth-context';
import type { SessionUser } from './auth-context';
import { SUPABASE_CONFIGURED, requireSupabase, supabase } from '../lib/supabase';

function toUser(session: Session | null): SessionUser | null {
  const authUser = session?.user;
  if (!authUser) return null;
  const email = authUser.email ?? '';
  const metaName =
    typeof authUser.user_metadata?.display_name === 'string'
      ? authUser.user_metadata.display_name.trim()
      : '';
  return {
    id: authUser.id,
    email,
    name: metaName || email.split('@')[0] || 'Friend',
    emailConfirmed: Boolean(authUser.email_confirmed_at),
  };
}

/** Canonical email form so "User@X.com" and "user@x.com" are one account. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Unconfigured (no Supabase client) means there is no session to restore.
  const [loading, setLoading] = useState<boolean>(supabase !== null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        if (active) setSession(next);
      },
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    const { data, error } = await requireSupabase().auth.signUp({
      email: normalizeEmail(email),
      password,
      options: {
        data: { display_name: name?.trim() || email.split('@')[0] || 'Friend' },
      },
    });
    if (error) throw error;
    // When email confirmation is on, there is no session yet.
    return { emailConfirmationRequired: !data.session };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireSupabase().auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) {
      setSession(null);
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(
      normalizeEmail(email),
      { redirectTo: `${window.location.origin}/reset-password` },
    );
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await requireSupabase().auth.resend({
      type: 'signup',
      email: normalizeEmail(email),
    });
    if (error) throw error;
  }, []);

  const value = useMemo(
    () => ({
      user: toUser(session),
      session,
      loading,
      configured: SUPABASE_CONFIGURED,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
      resendConfirmation,
    }),
    [session, loading, signUp, signIn, signOut, resetPassword, updatePassword, resendConfirmation],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
