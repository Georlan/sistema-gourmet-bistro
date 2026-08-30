import React from 'react';
import tabletShell from '../../assets/koma-tablet-graphite-shell-v2.png';
import { ProductScreen } from './ProductScreen';
import { EditableTabletFrame } from './EditableTabletFrame';
import type { DeviceScreenshot } from './DeviceScreenshot';
import './editable-tablet.css';

interface TabletFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  screenshot?: DeviceScreenshot;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
}

export function TabletFrame({ view = 'mesas', screenshot, className, style, priority }: TabletFrameProps) {
  return (
    <EditableTabletFrame shellSrc={tabletShell} screenshot={screenshot} className={className} style={style} priority={priority}>
      <ProductScreen view={view} scaleLogicalWidth={1280} />
    </EditableTabletFrame>
  );
}
