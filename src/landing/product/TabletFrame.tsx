import React, { useCallback, useEffect, useRef } from 'react';
import tabletShell from '../../assets/koma-tablet-shell-3d.png';
import { ProductScreen } from './ProductScreen';
import { usePerspectiveTransform, type NormalizedPoint } from './usePerspectiveTransform';

const TABLET_SCREEN_POINTS: readonly NormalizedPoint[] = [
  [0.228, 0.141],
  [0.8164, 0.1533],
  [0.7585, 0.8594],
  [0.166, 0.7705],
];

interface TabletFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function TabletFrame({ view = 'mesas', className = '', style }: TabletFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const screenTransform = usePerspectiveTransform(containerRef, 1280, 800, TABLET_SCREEN_POINTS);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const updatePointerLight = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = containerRef.current;
    if (!element || event.pointerType === 'touch') return;

    const rect = element.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      element.style.setProperty('--tablet-shell-light-x', `${x * 100}%`);
      element.style.setProperty('--tablet-shell-light-y', `${y * 100}%`);
      element.style.setProperty('--tablet-shell-tilt-x', `${(0.5 - y) * 2.2}deg`);
      element.style.setProperty('--tablet-shell-tilt-y', `${(x - 0.5) * 2.2}deg`);
    });
  }, []);

  const resetPointerLight = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    element.style.setProperty('--tablet-shell-light-x', '68%');
    element.style.setProperty('--tablet-shell-light-y', '20%');
    element.style.setProperty('--tablet-shell-tilt-x', '0deg');
    element.style.setProperty('--tablet-shell-tilt-y', '0deg');
  }, []);

  return (
    <div
      ref={containerRef}
      className={`koma-tablet-3d ${className}`}
      style={style}
      onPointerMove={updatePointerLight}
      onPointerLeave={resetPointerLight}
      aria-hidden="true"
    >
      <div className="koma-tablet-3d-stage">
        <div className="koma-tablet-3d-screen" style={{ transform: screenTransform ?? undefined }}>
          <ProductScreen view={view} scaleLogicalWidth={1280} />
        </div>

        <img
          src={tabletShell}
          alt=""
          className="koma-tablet-3d-shell"
          draggable={false}
          decoding="async"
        />

        <div className="koma-tablet-3d-glare" />
      </div>
    </div>
  );
}
