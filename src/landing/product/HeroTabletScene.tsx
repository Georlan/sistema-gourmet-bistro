import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ProductScreen } from './ProductScreen';

interface HeroTabletSceneProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  interaction?: 'standard' | 'hero';
  className?: string;
  style?: React.CSSProperties;
}

export function HeroTabletScene({ view = 'mesas', interaction = 'standard', className = '', style }: HeroTabletSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.48);
  const animationFrameRef = useRef<number | null>(null);

  // Calculate dynamic scale for 1280px logical real screen
  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const screenDiv = containerRef.current.querySelector('.koma-physical-screen');
        if (screenDiv) {
          const widthScale = screenDiv.clientWidth / 1280;
          const heightScale = screenDiv.clientHeight / 800;
          setScale(Math.min(widthScale, heightScale));
        }
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = containerRef.current;
    if (!element || event.pointerType === 'touch') return;
    const { clientX, clientY } = event;

    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      const rotateY = interaction === 'hero' ? -9 + x * 14 : -5 + x * 7;
      const rotateX = interaction === 'hero' ? 5 - y * 8 : 3 - y * 5;
      element.style.setProperty('--tablet-rotate-y', `${rotateY}deg`);
      element.style.setProperty('--tablet-rotate-x', `${rotateX}deg`);
      element.style.setProperty('--tablet-glare-x', `${Math.round(x * 100)}%`);
      element.style.setProperty('--tablet-glare-y', `${Math.round(y * 100)}%`);
    });
  }, [interaction]);

  const handlePointerLeave = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    element.style.removeProperty('--tablet-rotate-y');
    element.style.removeProperty('--tablet-rotate-x');
    element.style.removeProperty('--tablet-glare-x');
    element.style.removeProperty('--tablet-glare-y');
  }, []);

  return (
    <div
      ref={containerRef}
      className={`koma-hero-tablet-wrap ${className}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={style}
    >
      <div className="koma-physical-tablet">
        <div className="koma-tablet-camera" aria-hidden="true" />
        <div className="koma-tablet-button" aria-hidden="true" />
        <div className="koma-tablet-glare" aria-hidden="true" />

        <div className="koma-physical-screen">
          <div
            style={{
              width: '1280px',
              height: '800px',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            <ProductScreen view={view} scaleLogicalWidth={1280} />
          </div>
        </div>
      </div>
    </div>
  );
}
