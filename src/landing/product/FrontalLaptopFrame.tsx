import React, { useRef, useEffect, useState } from 'react';
import { ProductScreen } from './ProductScreen';

interface FrontalLaptopFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function FrontalLaptopFrame({ view = 'mesas', className = '', style }: FrontalLaptopFrameProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);

  useEffect(() => {
    const updateScale = () => {
      if (screenRef.current) {
        const width = screenRef.current.clientWidth;
        setScale(width / 1280);
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (screenRef.current) observer.observe(screenRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`koma-frontal-laptop ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        filter: 'drop-shadow(0 35px 70px rgba(0, 0, 0, 0.22))',
        ...style,
      }}
      aria-hidden="true"
    >
      {/* Laptop Screen Lid / Shell */}
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 10',
          background: '#0d0e15',
          borderRadius: '16px 16px 0 0',
          padding: '10px 10px 0 10px',
          border: '2px solid #282a38',
          borderBottom: 'none',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* WebCam Dot */}
        <div
          style={{
            position: 'absolute',
            top: '4px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: '#1a1c26',
            border: '1px solid #333648',
            zIndex: 10,
          }}
        />

        {/* Screen Glass Frame */}
        <div
          ref={screenRef}
          style={{
            flex: 1,
            width: '100%',
            background: '#090a0f',
            borderRadius: '8px 8px 0 0',
            overflow: 'hidden',
            position: 'relative',
            border: '1px solid #1a1c26',
          }}
        >
          {/* Real KÔMA UI Screen scaled to 1280px */}
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

          {/* Discreet Glass Reflection */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 40%)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
        </div>
      </div>

      {/* Laptop Hinge & Lower Base Aluminum Lip */}
      <div
        style={{
          width: '108%',
          height: '16px',
          background: 'linear-gradient(180deg, #e2e4e9 0%, #cbd0d8 40%, #b0b6c2 100%)',
          borderRadius: '0 0 14px 14px',
          position: 'relative',
          boxShadow: '0 8px 20px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}
      >
        {/* Hinge Line Accent */}
        <div
          style={{
            width: '20%',
            height: '3px',
            background: '#9ca3af',
            borderRadius: '0 0 3px 3px',
          }}
        />

        {/* Trackpad Notch */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '14%',
            height: '4px',
            background: '#949ba6',
            borderRadius: '0 0 4px 4px',
          }}
        />
      </div>
    </div>
  );
}
