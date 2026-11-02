import { useContext } from 'react';
import { ToastContext } from './toast-context';
import type { ToastValue } from './toast-context';

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
