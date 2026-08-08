import React, { useRef, useEffect, useState } from 'react';
import { ProductScreen } from './ProductScreen';

interface FrontalLaptopFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function FrontalLaptopFrame({ view = 'pdv', className = '', style }: FrontalLaptopFrameProps) {
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
        filter: 'drop-shadow(0 35px 75px rgba(0, 0, 0, 0.28))',
        ...style,
      }}
      aria-hidden="true"
    >
      {/* Laptop Screen Lid / Shell */}
      <div
        style={{
          width: '100%',
          background: '#0e1017',
          borderRadius: '16px 16px 0 0',
          padding: '12px 12px 10px 12px',
          border: '2px solid #252838',
          borderBottom: 'none',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
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
            background: '#1c1e2b',
            border: '1px solid #36394e',
            zIndex: 10,
          }}
        />

        {/* Screen Glass Frame with exact 16:10 aspect ratio */}
        <div
          ref={screenRef}
          style={{
            width: '100%',
            aspectRatio: '16 / 10',
            background: '#090a0f',
            borderRadius: '6px',
            overflow: 'hidden',
            position: 'relative',
            border: '1px solid #1c1e2b',
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
              background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 45%)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
        </div>
      </div>

      {/* Laptop Hinge & Lower Base Aluminum Lip */}
      <div
        style={{
          width: '106%',
          height: '14px',
          background: 'linear-gradient(180deg, #e5e7eb 0%, #d1d5db 45%, #9ca3af 100%)',
          borderRadius: '0 0 14px 14px',
          position: 'relative',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.22), inset 0 1px 1px rgba(255, 255, 255, 0.9)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}
      >
        {/* Hinge Line Accent */}
        <div
          style={{
            width: '18%',
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
            width: '12%',
            height: '4px',
            background: '#949ba6',
            borderRadius: '0 0 4px 4px',
          }}
        />
      </div>
    </div>
  );
}
