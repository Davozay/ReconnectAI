import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ThemeContext,
  THEME_KEY,
  SYSTEM_QUERY,
  resolveTheme,
} from './theme-context';
import type { ThemePreference } from './theme-context';

function loadPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    /* storage unavailable — fall through to default */
  }
  return 'system';
}

function systemIsDark(): boolean {
  try {
    return window.matchMedia(SYSTEM_QUERY).matches;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(loadPreference);
  const [osDark, setOsDark] = useState<boolean>(systemIsDark);

  // Track OS appearance in real time (only affects System mode).
  useEffect(() => {
    const mq = window.matchMedia(SYSTEM_QUERY);
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, osDark);

  // Apply the effective theme globally; persist the preference untouched.
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      /* storage unavailable — theme still applies */
    }
  }, [resolved, preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
  }, []);

  const toggle = useCallback(() => {
    setPreferenceState((prev) => {
      const current = resolveTheme(prev, systemIsDark());
      return current === 'light' ? 'dark' : 'light';
    });
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
