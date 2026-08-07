import React, { useRef, useEffect, useState } from 'react';
import { ProductScreen } from './ProductScreen';

interface TabletFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function TabletFrame({ view = 'mesas', className = '', style }: TabletFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        // 1280px is logical width of real app
        setScale(width / 1280);
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
      className={`koma-real-tablet ${className}`}
      style={{
        ...style,
        ['--koma-preview-scale' as any]: scale,
      }}
      aria-hidden="true"
    >
      <div className="koma-real-screen">
        <ProductScreen view={view} />
      </div>
    </div>
  );
}
