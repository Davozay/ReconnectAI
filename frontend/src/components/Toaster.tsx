import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { useToast } from '../context/useToast';
import './Toaster.css';

export default function Toaster() {
  const { toasts } = useToast();
  return (
    <div className="toaster" aria-live="polite" aria-atomic="false">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <CheckCircle2 size={17} aria-hidden="true" />
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
