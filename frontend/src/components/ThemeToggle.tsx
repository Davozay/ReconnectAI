import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/useTheme';
import './ThemeToggle.css';

/* Global quick theme toggle. Uses the shared ThemeProvider only —
   no local theme state. When the preference is System, toggle()
   explicitly selects the opposite of the currently resolved theme. */
export default function ThemeToggle({ size = 19 }: { size?: number }) {
  const { resolved, toggle } = useTheme();
  const toDark = resolved === 'light';
  const label = toDark ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      data-tooltip={label}
      data-tooltip-pos="bottom"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={resolved}
          className="theme-toggle-icon"
          initial={{ rotate: -70, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 70, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {toDark ? (
            <Moon size={size} aria-hidden="true" />
          ) : (
            <Sun size={size} aria-hidden="true" />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
