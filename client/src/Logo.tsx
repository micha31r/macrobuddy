/** Flat wordmark: a 2×2 rounded-key mark (evoking the pad) + "MacroBuddy". */
export default function Logo() {
  return (
    <span className="logo">
      <svg className="logo__mark" viewBox="0 0 24 24" aria-hidden>
        <rect x="2.5" y="2.5" width="8.2" height="8.2" rx="2.4" />
        <rect x="13.3" y="2.5" width="8.2" height="8.2" rx="2.4" />
        <rect x="2.5" y="13.3" width="8.2" height="8.2" rx="2.4" />
        <rect x="13.3" y="13.3" width="8.2" height="8.2" rx="2.4" />
      </svg>
      <span className="logo__word">MacroBuddy</span>
    </span>
  );
}
