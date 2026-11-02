import { Check, X } from 'lucide-react';
import { PASSWORD_RULES, passwordStrength } from '../lib/password';

export default function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const { level, label } = passwordStrength(password);
  return (
    <div className="pw-strength">
      <div className="pw-meter-row">
        <div className="pw-meter" role="img" aria-label={`Password strength: ${label}`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`pw-seg${i <= level ? ' is-on' : ''} pw-l${level}`}
            />
          ))}
        </div>
        <span className={`pw-label pw-l${level}`}>{label}</span>
      </div>
      <ul className="pw-rules">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(password);
          return (
            <li key={rule.id} className={ok ? 'is-ok' : ''}>
              {ok ? (
                <Check size={13} aria-hidden="true" />
              ) : (
                <X size={13} aria-hidden="true" />
              )}
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
