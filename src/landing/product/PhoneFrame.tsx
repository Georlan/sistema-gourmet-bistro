import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProductScreen } from './ProductScreen';
import phoneShell from '../../assets/koma-phone-shell-3d.png';

interface PhoneFrameProps {
  className?: string;
  style?: React.CSSProperties;
}

export function PhoneFrame({ className = '', style }: PhoneFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const updateScale = () => {
      if (screenRef.current) {
        setScale(screenRef.current.clientWidth / 430);
      }
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
        <div
          ref={screenRef}
          className="koma-phone-3d-screen"
          style={{ ['--koma-preview-scale' as string]: scale } as React.CSSProperties}
        >
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
