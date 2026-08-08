import React, { useCallback, useEffect, useRef } from 'react';
import { ProductScreen } from './ProductScreen';
import phoneShell from '../../assets/koma-phone-shell-3d.png';
import { usePerspectiveTransform, type NormalizedPoint } from './usePerspectiveTransform';

const PHONE_SCREEN_POINTS: readonly NormalizedPoint[] = [
  [0.294, 0.071],
  [0.696, 0.071],
  [0.816, 0.877],
  [0.3645, 0.893],
];

interface PhoneFrameProps {
  className?: string;
  style?: React.CSSProperties;
}

export function PhoneFrame({ className = '', style }: PhoneFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const screenTransform = usePerspectiveTransform(containerRef, 430, 900, PHONE_SCREEN_POINTS);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const updatePointerLight = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = containerRef.current;
    if (!element || event.pointerType === 'touch') return;

    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      element.style.setProperty('--phone-light-x', `${x * 100}%`);
      element.style.setProperty('--phone-light-y', `${y * 100}%`);
      element.style.setProperty('--phone-tilt-x', `${(0.5 - y) * 3.5}deg`);
      element.style.setProperty('--phone-tilt-y', `${(x - 0.5) * 3.5}deg`);
    });
  }, []);

  const resetPointerLight = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    element.style.setProperty('--phone-light-x', '38%');
    element.style.setProperty('--phone-light-y', '22%');
    element.style.setProperty('--phone-tilt-x', '0deg');
    element.style.setProperty('--phone-tilt-y', '0deg');
  }, []);

  return (
    <div
      ref={containerRef}
      className={`koma-phone-3d ${className}`}
      style={style}
      onPointerMove={updatePointerLight}
      onPointerLeave={resetPointerLight}
      aria-hidden="true"
    >
      <div className="koma-phone-3d-stage">
        <div className="koma-phone-3d-screen" style={{ transform: screenTransform ?? undefined }}>
          <div className="koma-phone-3d-screen-content">
            <ProductScreen view="cardapio" scaleLogicalWidth={430} />
          </div>
        </div>

        <img
          src={phoneShell}
          alt=""
          className="koma-phone-3d-shell"
          draggable={false}
          decoding="async"
        />

        <div className="koma-phone-3d-glare" />
      </div>
    </div>
  );
}
