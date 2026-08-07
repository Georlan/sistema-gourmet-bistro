import React from 'react';
import { ProductScreen } from './ProductScreen';

interface DesktopFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function DesktopFrame({ view = 'mesas', className = '', style }: DesktopFrameProps) {
  return (
    <div
      style={{
        width: '100%',
        background: '#1a1a24',
        borderRadius: '14px',
        padding: '12px 12px 0 12px',
        border: '2px solid #2a2c3a',
        boxShadow: '0 35px 90px rgba(0, 0, 0, 0.45)',
        aspectRatio: '16 / 10',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...style
      }}
      className={className}
      aria-hidden="true"
    >
      {/* Laptop Topbar */}
      <div style={{ height: '24px', display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '4px', marginBottom: '8px' }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }} />
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
        <span style={{ fontSize: '0.65rem', color: '#666', fontFamily: 'Space Grotesk', marginLeft: 'auto', marginRight: 'auto' }}>sistema-gourmet-bistro.pages.dev/?view=caixa</span>
      </div>

      {/* Screen */}
      <div style={{ flex: 1, borderRadius: '8px 8px 0 0', overflow: 'hidden', border: '1px solid #222538' }}>
        <ProductScreen view={view} />
      </div>
    </div>
  );
}
