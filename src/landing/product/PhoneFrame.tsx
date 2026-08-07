import React, { useRef, useEffect, useState } from 'react';
import { ProductScreen } from './ProductScreen';

interface PhoneFrameProps {
  className?: string;
  style?: React.CSSProperties;
}

export function PhoneFrame({ className = '', style }: PhoneFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        // Mobile viewport width ~ 430px
        setScale(width / 430);
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
      style={{
        width: '100%',
        aspectRatio: '9 / 19',
        borderRadius: '24px',
        background: '#181924',
        border: '3px solid #282a3c',
        padding: '10px',
        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        ['--koma-preview-scale' as any]: scale,
        ...style
      }}
      className={className}
      aria-hidden="true"
    >
      {/* Smartphone Notch */}
      <div style={{ width: '40%', height: '14px', background: '#0a0a0a', borderRadius: '0 0 10px 10px', margin: '0 auto 6px auto', zIndex: 10 }} />

      {/* Screen */}
      <div style={{ flex: 1, borderRadius: '14px', overflow: 'hidden' }}>
        <ProductScreen view="cardapio" scaleLogicalWidth={430} />
      </div>
    </div>
  );
}
