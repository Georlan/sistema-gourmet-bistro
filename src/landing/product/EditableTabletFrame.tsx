import React, { useRef } from 'react';
import { usePerspectiveTransform, type NormalizedPoint } from './usePerspectiveTransform';
import type { DeviceScreenshot } from './DeviceScreenshot';
import geometry from './tabletFrameGeometry.json';

interface EditableTabletFrameProps {
  shellSrc: string;
  screenshot?: DeviceScreenshot;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
}

const SCREEN_POINTS: readonly NormalizedPoint[] = geometry.screenCorners.map(([x, y]) => [
  (x - geometry.crop.left) / geometry.crop.width,
  (y - geometry.crop.top) / geometry.crop.height,
]);

export function EditableTabletFrame({ shellSrc, screenshot, children, className = '', style, priority = false }: EditableTabletFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const transform = usePerspectiveTransform(stageRef, geometry.logicalWidth, geometry.logicalHeight, SCREEN_POINTS);

  return (
    <div ref={stageRef} className={`koma-editable-tablet ${className}`} style={style}
      data-screen-mode={screenshot ? 'image' : 'content'}>
      <div className="koma-editable-tablet-screen" style={{
        width: geometry.logicalWidth, height: geometry.logicalHeight,
        transform: transform ?? undefined, visibility: transform ? 'visible' : 'hidden',
      }}>
        {screenshot ? (
          <img className="koma-editable-tablet-capture" src={screenshot.src} alt={screenshot.alt}
            style={{ objectFit: screenshot.fit ?? 'contain', objectPosition: screenshot.position ?? 'center' }}
            loading={priority ? 'eager' : 'lazy'} decoding="async" draggable={false} />
        ) : (
          <div className="koma-editable-tablet-content" aria-hidden="true" inert>{children}</div>
        )}
      </div>
      {/* Real alpha outside the bezel AND throughout the display. The product
          UI is never flattened into the physical shell. */}
      <img className="koma-editable-tablet-shell" src={shellSrc} alt="" aria-hidden="true"
        width={geometry.crop.width} height={geometry.crop.height}
        loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'}
        decoding="async" draggable={false} />
    </div>
  );
}
