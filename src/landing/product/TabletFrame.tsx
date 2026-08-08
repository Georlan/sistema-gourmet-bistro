import React, { useCallback, useEffect, useRef, useState } from 'react';
import tabletShell from '../../assets/koma-tablet-shell-3d.png';
import { ProductScreen } from './ProductScreen';

interface TabletFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function TabletFrame({ view = 'mesas', className = '', style }: TabletFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [scale, setScale] = useState(0.36);

  useEffect(() => {
    const updateScale = () => {
      if (screenRef.current) setScale(screenRef.current.clientWidth / 1280);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (screenRef.current) observer.observe(screenRef.current);
    return () => observer.disconnect();
  }, []);

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
        <div
          ref={screenRef}
          className="koma-tablet-3d-screen"
          style={{ ['--koma-preview-scale' as string]: scale } as React.CSSProperties}
        >
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
