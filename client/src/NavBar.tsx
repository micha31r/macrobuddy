import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  SparklesIcon,
  ViewfinderCircleIcon,
} from '@heroicons/react/24/solid';
import { useEffect, useRef, useState } from 'react';
import type { SizeMode, Theme } from './App';
import ThemeSwitch from './ThemeSwitch';

// iOS Safari exposes the Fullscreen API with a webkit prefix — support both.
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};

const doc = document as FsDocument;
const root = document.documentElement as FsElement;

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function supportsFullscreen(): boolean {
  return typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function';
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

/** Toggle in/out like a video player's fullscreen button. */
function toggleFullscreen(): void {
  if (fullscreenElement()) {
    if (typeof document.exitFullscreen === 'function') void document.exitFullscreen().catch(() => {});
    else doc.webkitExitFullscreen?.();
  } else {
    if (typeof root.requestFullscreen === 'function') void root.requestFullscreen().catch(() => {});
    else root.webkitRequestFullscreen?.();
  }
}

interface NavBarProps {
  theme: Theme;
  onToggleTheme: () => void;
  glow: boolean;
  onToggleGlow: () => void;
  sizeMode: SizeMode;
  onToggleSizeMode: () => void;
  hidden: boolean;
}

export default function NavBar({
  theme,
  onToggleTheme,
  glow,
  onToggleGlow,
  sizeMode,
  onToggleSizeMode,
  hidden,
}: NavBarProps) {
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(fullscreenElement()));
  const [showHint, setShowHint] = useState(false);
  const hintTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(fullscreenElement()));
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
      window.clearTimeout(hintTimer.current);
    };
  }, []);

  // The button is always visible: an invisible control reads as a bug. On
  // devices with no fullscreen API (iPhone Safari) it explains the iOS path.
  const onFullscreenClick = () => {
    if (supportsFullscreen()) {
      toggleFullscreen();
      return;
    }
    setShowHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setShowHint(false), 4000);
  };

  return (
    <nav className={`nav${hidden ? ' nav--hidden' : ''}`}>
      <span className="nav__brand">MacroBuddy</span>
      <div className="nav__controls">
        <button
          type="button"
          className={`nav__btn${sizeMode === 'fixed' ? '' : ' nav__btn--off'}`}
          aria-pressed={sizeMode === 'fixed'}
          aria-label="Cap pad size"
          onClick={onToggleSizeMode}
        >
          <ViewfinderCircleIcon aria-hidden />
        </button>
        <button
          type="button"
          className={`nav__btn${glow ? '' : ' nav__btn--off'}`}
          aria-pressed={glow}
          aria-label="Toggle underglow"
          onClick={onToggleGlow}
        >
          <SparklesIcon aria-hidden />
        </button>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
        {!isStandalone() && (
          <button
            type="button"
            className="nav__btn"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={onFullscreenClick}
          >
            {isFullscreen ? <ArrowsPointingInIcon aria-hidden /> : <ArrowsPointingOutIcon aria-hidden />}
          </button>
        )}
      </div>
      {showHint && (
        <div className="nav__hint" role="status">
          Fullscreen isn&apos;t supported in iPhone Safari — use Share → Add to Home Screen for a fullscreen pad.
        </div>
      )}
    </nav>
  );
}
