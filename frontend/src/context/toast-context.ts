import { createContext } from 'react';

export interface ToastItem {
  id: number;
  message: string;
}

export interface ToastValue {
  toasts: ToastItem[];
  toast: (message: string) => void;
}

export const ToastContext = createContext<ToastValue | null>(null);
