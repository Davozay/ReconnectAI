/* Password policy for ReConnect AI accounts.
   Supabase Auth owns email uniqueness and credential verification; this
   module enforces OUR password strength rules before anything is sent:
   minimum 8 characters with uppercase, lowercase, digit, and symbol. */

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'lower', label: 'One lowercase letter (a–z)', test: (v) => /[a-z]/.test(v) },
  { id: 'upper', label: 'One uppercase letter (A–Z)', test: (v) => /[A-Z]/.test(v) },
  { id: 'digit', label: 'One number (0–9)', test: (v) => /[0-9]/.test(v) },
  { id: 'symbol', label: 'One symbol (e.g. !@#$%)', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function validatePassword(value: string): {
  valid: boolean;
  failed: PasswordRule[];
} {
  const failed = PASSWORD_RULES.filter((r) => !r.test(value));
  return { valid: failed.length === 0, failed };
}

export type PasswordStrengthLabel = 'Weak' | 'Fair' | 'Good' | 'Strong';

export function passwordStrength(value: string): {
  level: 0 | 1 | 2 | 3;
  label: PasswordStrengthLabel;
} {
  const passed = PASSWORD_RULES.filter((r) => r.test(value)).length;
  if (passed >= 5) return { level: 3, label: 'Strong' };
  if (passed === 4) return { level: 2, label: 'Good' };
  if (passed === 3) return { level: 1, label: 'Fair' };
  return { level: 0, label: 'Weak' };
}
