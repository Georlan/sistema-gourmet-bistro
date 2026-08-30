import React, { useId, useRef } from 'react';
import { usePerspectiveTransform, type NormalizedPoint } from './usePerspectiveTransform';

export interface PhoneScreenshot {
  src: string;
  alt: string;
  /** Contain preserves the whole screenshot; cover is an explicit editorial crop. */
  fit?: 'contain' | 'cover';
  position?: string;
}

interface EditablePhoneFrameProps {
  shellSrc: string;
  screenshot?: PhoneScreenshot;
  children?: React.ReactNode;
}

// Coordinates belong to the approved 1024×1536 shell. The SVG viewBox trims
// unused canvas, while both layers share this single responsive coordinate space.
const SCREEN_POINTS: readonly NormalizedPoint[] = [
  [36 / 660, 74 / 1460],
  [592 / 660, 32 / 1460],
  [609 / 660, 1432 / 1460],
  [22 / 660, 1410 / 1460],
];
const OUTLINE = 'M 300 79 L 695 41 Q 813 32 821 155 L 837 1364 Q 839 1476 754 1483 L 275 1465 Q 188 1460 188 1365 L 198 204 Q 194 93 300 79 Z';
const DISPLAY = 'M 290 103 L 695 70 Q 766 65 769 153 L 786 1354 Q 790 1456 716 1455 L 281 1439 Q 205 1434 206 1356 L 215 210 Q 213 111 290 103 Z';

export function EditablePhoneFrame({ shellSrc, screenshot, children }: EditablePhoneFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const maskId = `phone-shell-${useId().replace(/:/g, '')}`;
  const transform = usePerspectiveTransform(stageRef, 430, 990, SCREEN_POINTS);

  return (
    <div ref={stageRef} className="koma-editable-phone" data-screen-mode={screenshot ? 'image' : 'content'}>
      <div className="koma-editable-phone-screen" style={{ transform: transform ?? undefined, visibility: transform ? 'visible' : 'hidden' }}>
        {screenshot ? (
          <img className="koma-editable-phone-capture" src={screenshot.src} alt={screenshot.alt}
            style={{ objectFit: screenshot.fit ?? 'contain', objectPosition: screenshot.position ?? 'center' }}
            loading="lazy" decoding="async" draggable={false} />
        ) : (
          <div className="koma-editable-phone-content" aria-hidden="true" inert>{children}</div>
        )}
      </div>
      {/* The render has a baked checkerboard: the vector mask removes it AND
          the blank display at render time. Real UI/images remain separate. */}
      <svg className="koma-editable-phone-shell" viewBox="180 30 660 1460" aria-hidden="true" focusable="false">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="180" y="30" width="660" height="1460" style={{ maskType: 'luminance' }}>
            <path d={OUTLINE} fill="white" />
            <path d={DISPLAY} fill="black" />
            <circle cx="487" cy="119" r="16" fill="white" />
          </mask>
        </defs>
        <image href={shellSrc} width="1024" height="1536" mask={`url(#${maskId})`} />
      </svg>
    </div>
  );
}
