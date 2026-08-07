import React from 'react';
import { ProductScreen } from './ProductScreen';

interface TabletFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function TabletFrame({ view = 'mesas', className = '', style }: TabletFrameProps) {
  return (
    <div
      className={`koma-real-tablet ${className}`}
      style={style}
      aria-hidden="true"
    >
      <div className="koma-real-screen">
        <ProductScreen view={view} />
      </div>
    </div>
  );
}
