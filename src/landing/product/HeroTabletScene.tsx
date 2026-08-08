import React, { useRef, useEffect, useState } from 'react';
import { ProductScreen } from './ProductScreen';

interface HeroTabletSceneProps {
  className?: string;
  style?: React.CSSProperties;
}

export function HeroTabletScene({ className = '', style }: HeroTabletSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.48);
  const [isHovered, setIsHovered] = useState(false);
  const [hoverState, setHoverState] = useState({
    rotateY: -10,
    rotateX: 3,
    glareX: 50,
    glareY: 50,
  });

  // Calculate dynamic scale for 1280px logical real screen
  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const screenDiv = containerRef.current.querySelector('.koma-physical-screen');
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

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;  // 0 to 1
    const py = (e.clientY - rect.top) / rect.height; // 0 to 1

    // Map rotateY between -13deg and -3deg (aligned with diagonal)
    const rotateY = -13 + px * 10;
    // Map rotateX between +5deg and -2deg
    const rotateX = 5 - py * 7;

    setHoverState({
      rotateY,
      rotateX,
      glareX: Math.round(px * 100),
      glareY: Math.round(py * 100),
    });
  };

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => {
    setIsHovered(false);
    setHoverState({
      rotateY: -10,
      rotateX: 3,
      glareX: 50,
      glareY: 50,
    });
  };

  // Dynamic CSS variables and styles based on state
  const currentRotateY = isHovered ? hoverState.rotateY : -10;
  const currentRotateX = isHovered ? hoverState.rotateX : 3;
  const currentRotateZ = 2.5;
  const currentScale = isHovered ? 1.025 : 1;
  const currentTranslateY = isHovered ? -5 : 0;
  const currentBrightness = isHovered ? 1.04 : 1;

  return (
    <div
      ref={containerRef}
      className={`koma-hero-tablet-wrap ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        perspective: '1400px',
        width: 'clamp(620px, 48vw, 840px)', // ~10-15% larger scale
        marginRight: '-2.5vw', // Brought 10-15% more into viewport
        cursor: 'pointer',
        ...style,
      }}
    >
      {/* Whole Physical Tablet Container transformed in 3D as a single object */}
      <div
        className="koma-physical-tablet"
        style={{
          transform: `translateY(${currentTranslateY}px) scale(${currentScale}) rotateY(${currentRotateY}deg) rotateX(${currentRotateX}deg) rotateZ(${currentRotateZ}deg)`,
          transformStyle: 'preserve-3d',
          transition: isHovered
            ? 'transform 0.15s ease-out, filter 0.25s ease, box-shadow 0.25s ease'
            : 'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), filter 0.55s ease, box-shadow 0.55s ease',
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          background: '#12141d',
          borderRadius: '22px',
          padding: '12px',
          border: '3px solid #282a3c',
          boxShadow: isHovered
            ? `
              0 70px 150px rgba(0, 0, 0, 0.9),
              0 30px 50px rgba(0, 0, 0, 0.7),
              0 0 35px rgba(0, 184, 148, 0.15),
              inset 0 0 0 1px rgba(255, 255, 255, 0.15)
            `
            : `
              0 55px 125px rgba(0, 0, 0, 0.82),
              0 20px 40px rgba(0, 0, 0, 0.6),
              inset 0 0 0 1px rgba(255, 255, 255, 0.08)
            `,
          filter: `brightness(${currentBrightness})`,
        }}
      >
        {/* Dynamic Light Glare / Reflection following cursor */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: -1,
            borderRadius: '23px',
            background: isHovered
              ? `radial-gradient(circle at ${hoverState.glareX}% ${hoverState.glareY}%, rgba(255,255,255,0.18) 0%, rgba(0,184,148,0.1) 40%, rgba(255,255,255,0) 80%)`
              : 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 40%, rgba(0,184,148,0.1) 100%)',
            transition: 'background 0.2s ease',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        />

        {/* Physical Tablet Screen Viewport */}
        <div
          className="koma-physical-screen"
          style={{
            width: '100%',
            height: '100%',
            background: '#090a0f',
            borderRadius: '12px',
            overflow: 'hidden',
            position: 'relative',
            border: '1px solid #1e202d',
            zIndex: 1,
          }}
        >
          {/* Real KÔMA UI Viewport scaled uniformly */}
          <div
            style={{
              width: '1280px',
              height: '800px',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            <ProductScreen view="mesas" scaleLogicalWidth={1280} />
          </div>
        </div>
      </div>
    </div>
  );
}
