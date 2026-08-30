import React, { useRef } from 'react';
import { usePerspectiveTransform, type NormalizedPoint } from './usePerspectiveTransform';
import type { DeviceScreenshot } from './DeviceScreenshot';
import geometry from './laptopFrameGeometry.json';

interface EditableLaptopFrameProps {
  shellSrc: string;
  screenshot?: DeviceScreenshot;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const { screen } = geometry;
// Preserve the physical visor's aspect ratio, including for future screenshots.
const logicalHeight = geometry.logicalWidth * screen.height / screen.width;
const SCREEN_POINTS: readonly NormalizedPoint[] = [
  [screen.left / geometry.width, screen.top / geometry.height],
  [(screen.left + screen.width) / geometry.width, screen.top / geometry.height],
  [(screen.left + screen.width) / geometry.width, (screen.top + screen.height) / geometry.height],
  [screen.left / geometry.width, (screen.top + screen.height) / geometry.height],
];

export function EditableLaptopFrame({ shellSrc, screenshot, children, className = '', style }: EditableLaptopFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const transform = usePerspectiveTransform(stageRef, geometry.logicalWidth, logicalHeight, SCREEN_POINTS);

  return (
    <div ref={stageRef} className={`koma-editable-laptop ${className}`} style={style}
      data-screen-mode={screenshot ? 'image' : 'content'}>
      <div className="koma-editable-laptop-screen" style={{
        width: geometry.logicalWidth, height: logicalHeight,
        transform: transform ?? undefined, visibility: transform ? 'visible' : 'hidden',
      }}>
        {screenshot ? (
          <img className="koma-editable-laptop-capture" src={screenshot.src} alt={screenshot.alt}
            style={{ objectFit: screenshot.fit ?? 'contain', objectPosition: screenshot.position ?? 'center' }}
            loading="lazy" decoding="async" draggable={false} />
        ) : (
          <div className="koma-editable-laptop-content" aria-hidden="true" inert>{children}</div>
        )}
      </div>
      {/* The approved PNG contains only hardware: both background and visor have real alpha. */}
      <img className="koma-editable-laptop-shell" src={shellSrc} alt="" aria-hidden="true"
        width={geometry.width} height={geometry.height}
        loading="lazy" decoding="async" draggable={false} />
    </div>
  );
}
