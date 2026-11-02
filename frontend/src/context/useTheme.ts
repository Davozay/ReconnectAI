import { useContext } from 'react';
import { ThemeContext } from './theme-context';
import type { ThemeValue } from './theme-context';

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
