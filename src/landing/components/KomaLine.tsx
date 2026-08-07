import React from 'react';
import { motion, type MotionValue } from 'motion/react';

interface KomaLineProps {
  progress?: MotionValue<number>;
  className?: string;
}

export function KomaLine({ progress, className = '' }: KomaLineProps) {
  return (
    <div className={`koma-bar ${className}`} aria-hidden="true">
      {progress && (
        <motion.div
          style={{ width: progress, height: '100%', background: 'var(--koma-green)' }}
        />
      )}
    </div>
  );
}
