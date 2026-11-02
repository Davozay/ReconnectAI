import { Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ThemePreference } from '../context/theme-context';

export interface ThemeOption {
  id: ThemePreference;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'light', label: 'Light', hint: 'Bright and clean', icon: Sun },
  { id: 'dark', label: 'Dark', hint: 'Easy on the eyes', icon: Moon },
  { id: 'system', label: 'System', hint: 'Follows your device', icon: Monitor },
];
