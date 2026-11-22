import { useState } from 'react';
import { openMailbox } from './api.js';
import { useTheme } from './theme.js';

export default function SiteLock({ onUnlock }) {
  const [theme, toggleTheme] = useTheme();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const records = await openMailbox(value);
      if (records) onUnlock(records);
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
        <p>Enter the password to open this dashboard.</p>
        <input
          type="password"
          value={value}
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
          aria-invalid={error}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
        />
        {error && <p className="gate-error">Wrong password.</p>}
        <div className="gate-actions">
          <button type="submit" disabled={busy || !value}>{busy ? 'Checking…' : 'Unlock'}</button>
        </div>
      </form>
    </div>
  );
}
