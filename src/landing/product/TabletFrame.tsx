import React from 'react';
import { HeroTabletScene } from './HeroTabletScene';

interface TabletFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function TabletFrame({ className = '', style }: TabletFrameProps) {
  return <HeroTabletScene className={className} style={style} />;
}
