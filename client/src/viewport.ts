/**
 * Viewport-change plumbing.
 *
 * `onViewportChange(update)` runs `update` whenever the viewport may have
 * changed — and re-runs it shortly after, because iOS Safari fires rotation
 * events while visualViewport still reports the *old* dimensions. A
 * ResizeObserver on <html> covers cases where iOS withholds the events
 * entirely (its layout box must change on rotation). `kickViewport()` lets
 * app code force a re-measure (e.g. on a background tap) as a manual
 * recovery path.
 */

const updaters = new Set<() => void>();

/** Force every registered viewport updater to re-measure right now. */
export function kickViewport(): void {
  for (const run of updaters) run();
}

/**
 * The vertical safe-area insets (notch/Dynamic Island, home indicator), read
 * from `env(safe-area-inset-*)` via a hidden probe. 0 on devices/contexts with
 * no insets — so the pad budget is unchanged there.
 */
export function safeAreaInsets(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

export function onViewportChange(update: () => void): () => void {
  let t1: number | undefined;
  let t2: number | undefined;
  const run = () => {
    update();
    window.clearTimeout(t1);
    window.clearTimeout(t2);
    t1 = window.setTimeout(update, 120);
    t2 = window.setTimeout(update, 400);
  };
  run();
  updaters.add(run);
  window.addEventListener('resize', run);
  window.addEventListener('orientationchange', run);
  window.addEventListener('pageshow', run); // bfcache restores
  window.visualViewport?.addEventListener('resize', run);
  screen.orientation?.addEventListener('change', run);
  const observer = new ResizeObserver(run);
  observer.observe(document.documentElement);
  return () => {
    updaters.delete(run);
    window.removeEventListener('resize', run);
    window.removeEventListener('orientationchange', run);
    window.removeEventListener('pageshow', run);
    window.visualViewport?.removeEventListener('resize', run);
    screen.orientation?.removeEventListener('change', run);
    observer.disconnect();
    window.clearTimeout(t1);
    window.clearTimeout(t2);
  };
}
