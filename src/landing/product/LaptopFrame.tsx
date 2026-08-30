import React from 'react';
import laptopShell from '../../assets/koma-notebook-graphite-shell-v2.png';
import { EditableLaptopFrame } from './EditableLaptopFrame';
import { ProductScreen } from './ProductScreen';
import type { DeviceScreenshot } from './DeviceScreenshot';
import geometry from './laptopFrameGeometry.json';
import './editable-laptop.css';

interface LaptopFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  screenshot?: DeviceScreenshot;
  className?: string;
  style?: React.CSSProperties;
}

export function LaptopFrame({ view = 'pdv', screenshot, className, style }: LaptopFrameProps) {
  return (
    <EditableLaptopFrame shellSrc={laptopShell} screenshot={screenshot} className={className} style={style}>
      <ProductScreen view={view} scaleLogicalWidth={geometry.logicalWidth} />
    </EditableLaptopFrame>
  );
}
