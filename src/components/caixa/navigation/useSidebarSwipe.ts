import { useEffect, useRef, type PointerEvent } from 'react';

/** Preview width directly on the existing sidebar; commit state only on release. */
export function useSidebarSwipe(setOpen: (open: boolean) => void) {
  const start = useRef<{ id: number; x: number; y: number; width: number; owner: HTMLElement | null; mobile: HTMLElement | null; frame: number; dx: number; releasing: boolean } | null>(null);
  const clear = () => {
    const origin = start.current;
    if (!origin) return;
    cancelAnimationFrame(origin.frame);
    origin.owner?.removeAttribute('data-kc-dragging');
    origin.owner?.style.removeProperty('--kc-sidebar-drag-width');
    origin.owner?.style.removeProperty('--kc-sidebar-content-width');
    if (origin.mobile) origin.mobile.style.removeProperty('transform');
    start.current = null;
  };
  useEffect(() => clear, []);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!event.isPrimary || event.button !== 0 ||
        (event.target instanceof Element && event.target.closest('button,a,input,select,textarea,summary'))) return;
      clear();
      const sidebar = event.currentTarget.closest<HTMLElement>('.cashier-sidebar');
      const mobile = sidebar?.classList.contains('cashier-sidebar--mobile') ? sidebar : null;
      const owner = mobile ? null : sidebar?.parentElement ?? null;
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: sidebar?.getBoundingClientRect().width ?? 0, owner, mobile, frame: 0, dx: 0, releasing: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const origin = start.current;
      if (!origin || origin.id !== event.pointerId) return;
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      origin.dx = dx;
      if (origin.frame) return;
      origin.frame = requestAnimationFrame(() => {
        origin.frame = 0;
        if (start.current !== origin) return;
        if (origin.owner) {
          const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
          const styles = getComputedStyle(origin.owner);
          const expanded = parseFloat(styles.getPropertyValue('--sidebar-width')) * rem || 16 * rem;
          const width = Math.max(3.5 * rem, Math.min(expanded, origin.width + origin.dx));
          origin.owner.style.setProperty('--kc-sidebar-content-width', `${origin.width - 1}px`);
          origin.owner.style.setProperty('--kc-sidebar-drag-width', `${width}px`);
          origin.owner.setAttribute('data-kc-dragging', '');
        } else if (origin.mobile) origin.mobile.style.transform = `translateX(${Math.min(0, origin.dx)}px)`;
      });
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const origin = start.current;
      if (!origin || origin.id !== event.pointerId) return;
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      if (Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy) * 1.5) setOpen(dx > 0);
      origin.releasing = true;
      // Let React apply the final state while preview width still holds its position.
      cancelAnimationFrame(origin.frame);
      origin.frame = requestAnimationFrame(clear);
    },
    onPointerCancel: clear,
    onLostPointerCapture() { if (start.current && !start.current.releasing) clear(); },
  };
}
