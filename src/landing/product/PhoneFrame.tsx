import React from 'react';
import { ProductScreen } from './ProductScreen';

interface PhoneFrameProps {
  className?: string;
  style?: React.CSSProperties;
}

export function PhoneFrame({ className = '', style }: PhoneFrameProps) {
  return (
    <div
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
        ...style
      }}
      className={className}
      aria-hidden="true"
    >
      {/* Smartphone Notch */}
      <div style={{ width: '40%', height: '14px', background: '#0a0a0a', borderRadius: '0 0 10px 10px', margin: '0 auto 6px auto', zIndex: 10 }} />

      {/* Screen */}
      <div style={{ flex: 1, borderRadius: '14px', overflow: 'hidden' }}>
        <ProductScreen view="cardapio" />
      </div>
    </div>
  );
}
