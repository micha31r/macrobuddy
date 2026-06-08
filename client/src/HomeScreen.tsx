import { CheckIcon, ClipboardIcon } from '@heroicons/react/24/solid';
import { useState } from 'react';
import type { Theme } from './App';
import { demoConfig } from './demoConfig';
import Logo from './Logo';
import Pad from './Pad';
import ThemeSwitch from './ThemeSwitch';

// One command sets up + starts the host. `uv` is a single static binary, and
// `uv run <url>` fetches and runs the setup script with no pre-install. The
// script is served from the app's own domain (the Worker serves /setup.py as a
// static asset, from client/public/setup.py).
const SETUP_CMD = 'uv run https://macrobuddy.dev/setup.py';
const UV_MAC = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
const UV_WIN = 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"';

/** Copy text to the clipboard, with a fallback for insecure (plain-HTTP) origins. */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}
function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* clipboard unavailable — nothing to do */
  }
  document.body.removeChild(ta);
}

/** A command block with a copy button. */
function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    copyText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="setup__cmd">
      <pre>
        <code>{children}</code>
      </pre>
      <button type="button" className="setup__copy" onClick={onCopy} aria-label={copied ? 'Copied' : 'Copy'}>
        {copied ? <CheckIcon aria-hidden /> : <ClipboardIcon aria-hidden />}
      </button>
    </div>
  );
}

export default function HomeScreen({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const toSetup = () => document.getElementById('setup')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="home">
      <header className="home-nav">
        <div className="home-nav__inner">
          <Logo />
          <div className="home-nav__right">
            <button type="button" className="home-cta" onClick={toSetup}>
              Host Setup
            </button>
            <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
          </div>
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1 className="home-hero__title">Turn your phone into a customisable macro pad.</h1>
          <p className="home-hero__sub">
            Tap a key here and your computer runs it — a keyboard shortcut, a script, anything. Over your Wi-Fi, or
            anywhere in the world.
          </p>
        </section>

        <section className="home-demo" aria-label="Try the pad">
          <Pad config={demoConfig} glow sizeMode="fixed" demo />
          <p className="home-demo__hint">Go ahead, press a few keys.</p>
        </section>

        <section className="home-steps" aria-label="How it works">
          <ol>
            <li>
              <span className="home-steps__n">1</span>
              <div>
                <h3>Set up the host</h3>
                <p>One command installs and starts a tiny server on your computer.</p>
              </div>
            </li>
            <li>
              <span className="home-steps__n">2</span>
              <div>
                <h3>Scan the code</h3>
                <p>Your terminal prints a QR. Scan it to open your pad with its key.</p>
              </div>
            </li>
            <li>
              <span className="home-steps__n">3</span>
              <div>
                <h3>Tap away</h3>
                <p>Every press runs your shortcut or script on your computer, instantly.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="setup" id="setup">
          <h2>Set up your computer</h2>

          <h3>
            1 · Install <a href="https://docs.astral.sh/uv/">uv</a>
          </h3>
          <CodeBlock>{UV_MAC}</CodeBlock>
          <p className="setup__os">
            On Windows, in PowerShell: <code>{UV_WIN}</code>
          </p>

          <h3>2 · Start MacroBuddy</h3>
          <CodeBlock>{SETUP_CMD}</CodeBlock>
          <p>Your terminal prints a QR code — scan it and your pad opens with its key.</p>
          <p className="setup__note">
            macOS asks for Accessibility permission the first time, so it can press keys for you — allow your terminal
            under System Settings → Privacy &amp; Security → Accessibility. Allow the firewall prompt too, so your phone
            can reach it on Wi-Fi.
          </p>
        </section>

        <footer className="home-foot">
          <Logo />
        </footer>
      </main>
    </div>
  );
}
