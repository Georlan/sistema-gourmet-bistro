import type { KeyboardEvent } from 'react';

/** Keep keyboard navigation within visible, enabled controls of an open overlay. */
export function trapOverlayTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]',
  )).filter(control => control.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
