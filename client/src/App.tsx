import { useCallback, useEffect, useRef, useState } from 'react';
import { parseHashSecret, resolveEntry } from './api';
import HomeScreen from './HomeScreen';
import NavBar from './NavBar';
import Pad from './Pad';
import type { PublicConfig } from './types';
import { kickViewport, onViewportChange } from './viewport';

export type Theme = 'dark' | 'light';
export type SizeMode = 'fit' | 'fixed';
type View = 'loading' | 'app' | 'home' | 'error';

const THEME_COLORS: Record<Theme, string> = { dark: '#403b37', light: '#c9cfd5' };

/** Shown when a keyed URL fails to validate (wrong/expired key, host unreachable). */
function ErrorScreen() {
  return (
    <div className="error-screen">
      <h1 className="error-screen__title">Wrong connection URL</h1>
      <p className="error-screen__sub">
        This link's key isn't valid. Open the QR code your computer printed, or head back to the home page.
      </p>
      <button type="button" className="home-cta" onClick={() => (window.location.href = '/')}>
        Go to home
      </button>
    </div>
  );
}

export default function App() {
  // No key in the URL hash → the home page, immediately (no flash). A key → the
  // app (after resolveEntry probes for the transport).
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' && parseHashSecret(window.location.hash) ? 'loading' : 'home',
  );
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [relayMode, setRelayMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') === 'light' ? 'light' : 'dark'));
  const [glow, setGlow] = useState(() => localStorage.getItem('glow') !== '0');
  // 'fixed' (default) caps the pad at a natural CSS-px size so giant monitors
  // don't get a giant pad (browser zoom still scales it); 'fit' fills the
  // available space.
  const [sizeMode, setSizeMode] = useState<SizeMode>(() =>
    localStorage.getItem('sizeMode') === 'fit' ? 'fit' : 'fixed',
  );

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  }, [theme]);

  // Full-bleed app vs. normal scrolling document (home) is toggled by data-view.
  useEffect(() => {
    document.documentElement.dataset.view = view === 'home' ? 'home' : 'app';
  }, [view]);

  useEffect(() => {
    localStorage.setItem('glow', glow ? '1' : '0');
  }, [glow]);

  useEffect(() => {
    localStorage.setItem('sizeMode', sizeMode);
  }, [sizeMode]);

  // app-only: keep --vvh equal to the *visual* viewport height (iOS Safari
  // sizes the fixed body to the toolbar-hidden height otherwise).
  useEffect(() => {
    if (view !== 'app') return;
    return onViewportChange(() => {
      const vvh = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--vvh', `${Math.round(vvh)}px`);
    });
  }, [view]);

  // app-only: on touch devices, fade the nav chrome out after 5s so the pad
  // gets the screen. Tapping the background brings it back.
  const [chromeHidden, setChromeHidden] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const armHideTimer = useCallback(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return; // mobile only
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChromeHidden(true), 5000);
  }, []);

  useEffect(() => {
    if (view !== 'app') return;
    armHideTimer();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.case')) return; // key presses don't re-show chrome
      if (target?.closest('.nav')) {
        armHideTimer(); // actively using the controls — keep them around
        return;
      }
      setChromeHidden(false); // background tap: bring the chrome back
      kickViewport(); // and re-measure, in case iOS swallowed a rotation
      armHideTimer();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.clearTimeout(hideTimer.current);
    };
  }, [armHideTimer, view]);

  const load = useCallback(() => {
    const secret = parseHashSecret(window.location.hash);
    if (!secret) {
      setView('home'); // no key → the home/landing page, on any origin
      return;
    }
    resolveEntry(secret)
      .then(({ config: next, kind }) => {
        setConfig(next);
        setRelayMode(kind === 'relay');
        setError(null);
        setView('app');
      })
      .catch((err: Error) => {
        setError(err.message); // "wrong key" / "server unreachable"
        setView('error');
      });
  }, []);

  useEffect(() => {
    load();
    // Re-fetch when the phone returns to the page so config hot-reloads show up.
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Changing the key in the URL must re-run the gate (re-validate). A full
    // reload is the clean reset — it drops the cached transport + config. The app
    // never mutates its own hash, so this only fires on user edits.
    const onHashChange = () => window.location.reload();
    window.addEventListener('hashchange', onHashChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [load]);

  if (view === 'loading') {
    return <div className="status">Loading…</div>;
  }

  if (view === 'error') {
    return <ErrorScreen />;
  }

  if (view === 'home') {
    return <HomeScreen theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <>
      <NavBar
        theme={theme}
        onToggleTheme={toggleTheme}
        glow={glow}
        onToggleGlow={() => setGlow(!glow)}
        sizeMode={sizeMode}
        onToggleSizeMode={() => setSizeMode(sizeMode === 'fit' ? 'fixed' : 'fit')}
        hidden={chromeHidden}
      />
      {config ? (
        <Pad config={config} glow={glow} sizeMode={sizeMode} relay={relayMode} />
      ) : (
        <div className="status">{error ?? 'Loading…'}</div>
      )}
    </>
  );
}
