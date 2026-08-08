import React, { useRef, useEffect, useState, useMemo } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { ProductScreen } from './ProductScreen';

interface HeroTabletSceneProps {
  overlaySrc?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function HeroTabletScene({
  overlaySrc = '/landing/devices/tablet-hero-overlay.png',
  className = '',
  style,
}: HeroTabletSceneProps) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.36);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Responsive scale calculation for 1280px logical screen
  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        // Calculate viewport width relative to container
        const screenDiv = containerRef.current.querySelector('.hero-tablet-screen');
        if (screenDiv) {
          const width = screenDiv.clientWidth;
          setScale(width / 1280);
        }
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Subtle Mouse Parallax (4px to 8px max displacement, 1 to 2 deg max tilt)
  useEffect(() => {
    if (reduceMotion) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (window.innerWidth > 1024) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        setMousePos({
          x: ((e.clientX - cx) / cx) * 6, // max 6px
          y: ((e.clientY - cy) / cy) * 6,
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [reduceMotion]);

  // Motion Configuration
  const motionProps = useMemo(() => {
    if (reduceMotion) {
      return {
        initial: { opacity: 0, y: 24 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
      };
    }

    return {
      initial: { opacity: 0, y: 35, rotateZ: -2, rotateY: -6 },
      animate: { opacity: 1, y: 0, rotateZ: -3, rotateY: -3 },
      transition: { duration: 0.85, ease: [0.22, 1, 0.36, 1], delay: 0.25 },
    };
  }, [reduceMotion]);

  return (
    <motion.div
      ref={containerRef}
      {...motionProps}
      className={`hero-tablet-scene relative select-none ${className}`}
      style={{
        width: 'clamp(360px, 46vw, 720px)',
        aspectRatio: '1.33 / 1',
        transformOrigin: 'center center',
        transform: `translate3d(${mousePos.x}px, ${mousePos.y}px, 0)`,
        pointerEvents: 'none',
        ...style,
      }}
    >
      {/* 1. Ambient Shadow Layer */}
      <div
        className="hero-tablet-shadow absolute inset-0 rounded-[40px]"
        style={{
          filter: 'blur(35px)',
          transform: 'translate(28px, 40px) scale(0.9)',
          background: 'rgba(0, 0, 0, 0.65)',
          zIndex: 0,
        }}
        aria-hidden="true"
      />

      {/* 2. Real KÔMA Screen Viewport (Positioned within transparent window of tablet) */}
      <div
        className="hero-tablet-screen absolute overflow-hidden"
        style={{
          top: '12%',
          left: '10.5%',
          width: '79%',
          height: '74%',
          zIndex: 1,
          borderRadius: '8px',
          background: '#090a0f',
          boxShadow: 'inset 0 0 20px rgba(0, 0, 0, 0.8)',
        }}
      >
        <div
          style={{
            width: 1280,
            height: 800,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {/* Real KÔMA Component (MesasView with real model data) */}
          <ProductScreen view="mesas" scaleLogicalWidth={1280} />
        </div>
      </div>

      {/* 3. Physical Tablet PNG Overlay Frame (Above the screen) */}
      <img
        src={overlaySrc}
        alt="KÔMA Tablet Frame"
        aria-hidden="true"
        className="hero-tablet-overlay absolute inset-0 h-full w-full object-contain pointer-events-none select-none"
        style={{ zIndex: 2 }}
      />
    </motion.div>
  );
}
