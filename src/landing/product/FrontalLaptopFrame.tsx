import React, { useEffect, useRef, useState } from 'react';
import { ProductScreen } from './ProductScreen';

interface FrontalLaptopFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
  device?: 'laptop' | 'tablet' | 'phone';
}

export function FrontalLaptopFrame({ view = 'pdv', className = '', style, device = 'laptop' }: FrontalLaptopFrameProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const width = device === 'phone' ? 430 : 1280;
  const height = device === 'phone' ? 740 : 800;

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const update = () => setScale(screen.clientWidth / width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(screen);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div className={`koma-frontal-device koma-frontal-device--${device} ${className}`} style={style} aria-hidden="true" inert>
      <div className="koma-frontal-lid">
        <div className="koma-frontal-camera" />
        <div ref={screenRef} className="koma-frontal-screen" style={{ aspectRatio: `${width} / ${height}` }}>
          {/* Absolute placement prevents the logical canvas from imposing a 1280px minimum width. */}
          <div className="koma-frontal-canvas" style={{ width, height, transform: `scale(${scale})` }}>
            <ProductScreen view={view} scaleLogicalWidth={width} />
          </div>
        </div>
      </div>
      {device === 'laptop' && <div className="koma-frontal-base"><i /></div>}
    </div>
  );
}
