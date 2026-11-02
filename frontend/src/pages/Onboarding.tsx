import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import Logo from '../components/Logo';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { addSchool, upsertMyProfile, DbError } from '../lib/db';
import './Onboarding.css';

const STEPS = ['About you', 'Your schools', 'Discovery'];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [hometown, setHometown] = useState('');
  const [nickname, setNickname] = useState('');
  const [school, setSchool] = useState('');
  const [years, setYears] = useState('');
  const [discoverable, setDiscoverable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const finish = async () => {
    setError('');
    setSaving(true);
    try {
      await upsertMyProfile({
        display_name: user?.name || 'Friend',
        hometown: hometown.trim(),
        nickname: nickname.trim(),
        discoverable,
      });
      if (school.trim()) {
        await addSchool({ school_name: school.trim(), years_label: years.trim() });
      }
      toast('Welcome to ReConnect — your profile is saved');
      navigate('/app', { replace: true });
    } catch (err) {
      setError(
        err instanceof DbError || err instanceof Error
          ? err.message
          : 'Could not save your profile. Try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-inner">
        <div className="onboard-top">
          <Logo to="/" />
        </div>

        <ol className="onboard-progress" aria-label="Onboarding progress">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`onboard-dot${i === step ? ' is-current' : ''}${i < step ? ' is-done' : ''}`}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className="onboard-dot-marker">
                {i < step ? <Check size={13} aria-hidden="true" /> : i + 1}
              </span>
              <span className="onboard-dot-label">{label}</span>
            </li>
          ))}
        </ol>

        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="card card-pad onboard-card"
        >
          {step === 0 && (
            <>
              <h1>Where did you grow up?</h1>
              <p>
                Your hometown and childhood nickname are the strongest threads
                for finding old friends.
              </p>
              <label className="field">
                <span className="field-label">Hometown</span>
                <input
                  className="input"
                  placeholder="e.g. Riverside"
                  value={hometown}
                  onChange={(e) => setHometown(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Childhood nickname (optional)</span>
                <input
                  className="input"
                  placeholder="e.g. Jo-Jo"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <h1>Where did you go to school?</h1>
              <p>
                Add one school to start — you can add more from your profile
                later.
              </p>
              <label className="field">
                <span className="field-label">School name</span>
                <input
                  className="input"
                  placeholder="e.g. Maplewood Elementary"
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Years attended</span>
                <input
                  className="input"
                  placeholder="e.g. 1996 – 2001"
                  value={years}
                  onChange={(e) => setYears(e.target.value)}
                />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <h1>Who can discover you?</h1>
              <p>
                Discovery is off until you say otherwise. You can change this
                any time.
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={discoverable}
                onClick={() => setDiscoverable((v) => !v)}
                className={`switch-row${discoverable ? ' is-on' : ''}`}
              >
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
                <span>
                  <strong>Let old friends find me</strong>
                  <small>
                    People with overlapping schools and years can see your
                    display name and request to connect.
                  </small>
                </span>
              </button>
            </>
          )}

          {error && (
            <p className="onboard-error" role="alert">
              {error}
            </p>
          )}

          <div className="onboard-actions">
            {step > 0 ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft size={17} aria-hidden="true" />
                Back
              </button>
            ) : (
              <span />
            )}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep((s) => s + 1)}
              >
                Continue
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-amber"
                onClick={finish}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Enter ReConnect'}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
