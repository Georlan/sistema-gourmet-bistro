import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

type DeviceHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

function clearReveal(owner: string) {
  const root = document.documentElement;
  if (root.getAttribute('data-courier-theme-wipe') !== owner) return;
  root.removeAttribute('data-courier-theme-wipe');
  for (const key of ['--courier-wipe-x', '--courier-wipe-y', '--courier-wipe-radius']) root.style.removeProperty(key);
}

/** One short native reveal on explicit theme changes. No animation loop or dependencies. */
export function useCourierThemeTransition(disabled: boolean) {
  const owner = useId();
  const current = useRef<ViewTransition | null>(null);
  const mounted = useRef(true);
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.current?.skipTransition();
      clearReveal(owner);
    };
  }, [owner]);

  const change = (button: HTMLButtonElement, update: () => void) => {
    if (current.current) return;
    const device = navigator as DeviceHints;
    if (disabled || !document.startViewTransition || document.visibilityState !== 'visible' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches || device.connection?.saveData ||
      (device.deviceMemory != null && device.deviceMemory <= 2) ||
      (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 2)) {
      update();
      return;
    }
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const radius = Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)));
    const root = document.documentElement;
    root.style.setProperty('--courier-wipe-x', `${x}px`);
    root.style.setProperty('--courier-wipe-y', `${y}px`);
    root.style.setProperty('--courier-wipe-radius', `${radius}px`);
    root.setAttribute('data-courier-theme-wipe', owner);
    let committed = false;
    const commit = () => { if (!committed && mounted.current) { committed = true; flushSync(update); } };
    const clean = () => {
      clearReveal(owner);
      current.current = null;
      if (mounted.current) setAnimating(false);
    };
    try {
      const transition = document.startViewTransition(commit);
      current.current = transition;
      setAnimating(true);
      void transition.ready.catch(() => {});
      void transition.finished.catch(() => {}).finally(clean);
    } catch {
      try { commit(); } finally { clean(); }
    }
  };
  return { change, animating };
}
