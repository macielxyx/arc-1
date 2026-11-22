import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import SiteLock from './SiteLock.jsx';
import './styles.css';

const IDLE_MS = 5 * 60 * 1000;

function Root() {
  const [records, setRecords] = useState(null);
  const lastActive = useRef(Date.now());

  useEffect(() => {
    if (!records) return undefined;
    lastActive.current = Date.now();
    let throttle = false;
    const mark = () => {
      if (throttle) return;
      throttle = true;
      lastActive.current = Date.now();
      setTimeout(() => { throttle = false; }, 1000);
    };
    const lockIfIdle = () => {
      if (Date.now() - lastActive.current >= IDLE_MS) setRecords(null);
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'];
    events.forEach((name) => window.addEventListener(name, mark, { passive: true }));
    document.addEventListener('visibilitychange', lockIfIdle);
    const timer = setInterval(lockIfIdle, 1000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, mark));
      document.removeEventListener('visibilitychange', lockIfIdle);
      clearInterval(timer);
    };
  }, [records]);

  if (!records) return <SiteLock onUnlock={setRecords} />;
  return <App records={records} />;
}

createRoot(document.getElementById('root')).render(<Root />);
