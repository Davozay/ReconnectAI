import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastContext } from './toast-context';
import type { ToastItem } from './toast-context';

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => ({ toasts, toast }), [toasts, toast]);
  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}
