import { Check } from 'lucide-react';
import { useTheme } from '../context/useTheme';
import { THEME_OPTIONS } from './theme-options';
import './ThemeSelector.css';

export default function ThemeSelector() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <div>
      <div className="theme-grid" role="radiogroup" aria-label="Appearance">
        {THEME_OPTIONS.map(({ id, label, hint, icon: Icon }) => {
          const selected = preference === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(id)}
              className={`theme-option${selected ? ' is-selected' : ''}`}
            >
              <span className="theme-option-icon">
                <Icon size={20} aria-hidden="true" />
              </span>
              <span className="theme-option-label">{label}</span>
              <span className="theme-option-hint">{hint}</span>
              {selected && (
                <span className="theme-option-check" aria-hidden="true">
                  <Check size={14} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {preference === 'system' && (
        <p className="theme-note">
          Following your device — currently showing{' '}
          <strong>{resolved === 'dark' ? 'Dark' : 'Light'}</strong>. It updates
          automatically when your system changes.
        </p>
      )}
    </div>
  );
}
