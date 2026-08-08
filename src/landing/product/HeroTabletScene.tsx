import React, { useRef, useEffect, useState } from 'react';
import { ProductScreen } from './ProductScreen';

interface HeroTabletSceneProps {
  className?: string;
  style?: React.CSSProperties;
}

export function HeroTabletScene({ className = '', style }: HeroTabletSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);

  // Calculate dynamic scale for 1280px logical real screen
  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const screenDiv = containerRef.current.querySelector('.koma-physical-screen');
        if (screenDiv) {
          const width = screenDiv.clientWidth;
          setScale(width / 1280);
        }
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`koma-hero-tablet-wrap ${className}`}
      style={{
        perspective: '1400px',
        width: 'clamp(540px, 44vw, 760px)',
        marginRight: '-8vw',
        ...style,
      }}
    >
      {/* Whole Physical Tablet Container transformed in 3D as a single object */}
      <div
        className="koma-physical-tablet"
        style={{
          transform: 'rotateY(-8deg) rotateX(2deg) rotateZ(2deg)',
          transformStyle: 'preserve-3d',
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          background: '#12141d',
          borderRadius: '22px',
          padding: '12px',
          border: '3px solid #282a3c',
          boxShadow: `
            0 45px 110px rgba(0, 0, 0, 0.75),
            0 15px 35px rgba(0, 0, 0, 0.5),
            inset 0 0 0 1px rgba(255, 255, 255, 0.08)
          `,
        }}
      >
        {/* Ambient Glow / Edge Highlight */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: -1,
            borderRadius: '23px',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 40%, rgba(0,184,148,0.1) 100%)',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        />

        {/* Physical Tablet Screen Viewport */}
        <div
          className="koma-physical-screen"
          style={{
            width: '100%',
            height: '100%',
            background: '#090a0f',
            borderRadius: '12px',
            overflow: 'hidden',
            position: 'relative',
            border: '1px solid #1e202d',
            zIndex: 1,
          }}
        >
          {/* Real KÔMA UI Viewport scaled uniformly */}
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
            <ProductScreen view="mesas" scaleLogicalWidth={1280} />
          </div>
        </div>
      </div>
    </div>
  );
}
