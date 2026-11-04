import { createContext } from 'react';
import type { Session } from '@supabase/supabase-js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailConfirmed: boolean;
}

export interface AuthValue {
  user: SessionUser | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  signUp: (email: string, password: string, name?: string) => Promise<{ emailConfirmationRequired: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);
