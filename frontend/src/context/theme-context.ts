import { createContext } from 'react';

export type Theme = 'light' | 'dark';

/** Saved user preference. 'system' (default) follows the OS in real time. */
export type ThemePreference = 'light' | 'dark' | 'system';

export interface ThemeValue {
  /** The user's saved preference. */
  preference: ThemePreference;
  /** The effective theme actually applied (never 'system'). */
  resolved: Theme;
  setPreference: (p: ThemePreference) => void;
  /** Toggles between explicit light/dark (leaves System mode). */
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeValue | null>(null);

export const THEME_KEY = 'reconnect:theme';

export const SYSTEM_QUERY = '(prefers-color-scheme: dark)';

/** Pure preference → effective-theme mapping. Must stay in sync with the
    pre-paint inline script in index.html (covered by the parity check). */
export function resolveTheme(
  preference: ThemePreference,
  osDark: boolean,
): Theme {
  if (preference === 'system') return osDark ? 'dark' : 'light';
  return preference;
}
