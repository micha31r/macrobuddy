import { MoonIcon, SunIcon } from '@heroicons/react/24/solid';
import type { Theme } from './App';

/** The Apple-style dark/light toggle, shared by the app nav and the home page. */
export default function ThemeSwitch({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark';
  return (
    <button type="button" className="switch" role="switch" aria-checked={dark} aria-label="Dark mode" onClick={onToggle}>
      <span className="switch__knob">{dark ? <MoonIcon aria-hidden /> : <SunIcon aria-hidden />}</span>
    </button>
  );
}
