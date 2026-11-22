import { useState } from 'react';
import { openMailbox } from './api.js';
import { useTheme } from './theme.js';

const PIN_GATE = '5f30abb952c3f44ab13f342638f873830664ab2340678ce847f379552f7e935f';

async function hashText(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function SiteLock({ onUnlock }) {
  const [theme, toggleTheme] = useTheme();
  const [step, setStep] = useState('password');
  const [pending, setPending] = useState(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const codeStep = step === 'code';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      if (!codeStep) {
        const records = await openMailbox(value);
        if (!records) {
          setError(true);
          return;
        }
        setPending(records);
        setValue('');
        setStep('code');
        return;
      }
      const hash = await hashText(value);
      if (hash === PIN_GATE) onUnlock(pending);
      else setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-lock">
      <button type="button" className="lock-theme" onClick={toggleTheme}>
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
      <form className="gate-card" onSubmit={submit}>
        <h1>CCS Billing</h1>
        <p>{codeStep ? 'Enter the 6-digit code.' : 'Enter the password to open this dashboard.'}</p>
        <input
          key={step}
          type="password"
          inputMode={codeStep ? 'numeric' : 'text'}
          value={value}
          autoFocus
          autoComplete={codeStep ? 'one-time-code' : 'current-password'}
          maxLength={codeStep ? 6 : undefined}
          aria-label={codeStep ? '6-digit code' : 'Password'}
          aria-invalid={error}
          onChange={(e) => {
            const next = codeStep ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value;
            setValue(next);
            setError(false);
          }}
        />
        {error && <p className="gate-error">{codeStep ? 'Wrong code.' : 'Wrong password.'}</p>}
        <div className="gate-actions">
          <button type="submit" disabled={busy || (codeStep ? value.length !== 6 : !value)}>
            {busy ? 'Checking…' : codeStep ? 'Unlock' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
