import React, { useRef, useState, useEffect } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { DeviceFrame } from '../components/DeviceFrame';

const HERO_STRIP_ITEMS = [
  { num: '01', name: 'PDV BALCÃO' },
  { num: '02', name: 'GESTÃO DE MESAS' },
  { num: '03', name: 'KDS COZINHA' },
  { num: '04', name: 'CARDÁPIO QR' },
  { num: '05', name: 'IMPRESSÃO AUTOMÁTICA' },
];

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  // Desktop micro-parallax mouse state
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    // Only on desktop & non-reduced motion
    const handleMouseMove = (e: MouseEvent) => {
      if (window.innerWidth > 1024) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        setMousePos({
          x: ((e.clientX - cx) / cx) * 5, // max 5px
          y: ((e.clientY - cy) / cy) * 5,
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const deviceRotateY = useTransform(scrollYProgress, [0, 1], [-6, 0]);
  const deviceY = useTransform(scrollYProgress, [0, 1], [0, -40]);

  return (
    <section ref={sectionRef} className="koma-hero" aria-label="Hero">
      {/* Background Graphic Layer: 1-2% Opacity Arc Layer */}
      <div className="koma-hero-bg-layer" aria-hidden="true">
        <div className="koma-hero-bg-arc" />
        <div className="koma-hero-bg-diagonal" />
      </div>

      <div className="koma-hero-grid">
        {/* Main headline & Copy */}
        <motion.div
          className="koma-hero-content"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="koma-hero-headline" aria-label="O restaurante não para">
            <span className="koma-hero-line koma-hero-line--sm">O</span>
            <span className="koma-hero-line koma-hero-line--xl">RESTAURANTE</span>

            {/* The KÔMA Signature Green Bar with scaleX entrance animation */}
            <div className="koma-hero-bar-wrap">
              <motion.span
                className="koma-hero-bar"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
                aria-hidden="true"
              />
            </div>

            <span className="koma-hero-line koma-hero-line--lg">NÃO PARA.</span>
          </h1>

          {/* Option B Copy Direction */}
          <motion.p
            className="koma-hero-sub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
          >
            <span className="koma-hero-sub-bold">Seu sistema também não.</span>
            O pedido entra. A operação acompanha.
          </motion.p>

          <motion.div
            className="koma-hero-cta"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
          >
            <a href="#demonstracao" className="koma-btn koma-btn--primary">
              Solicitar demonstração
            </a>
          </motion.div>
        </motion.div>

        {/* Real Product Protagonist - 10-20% Scale Increase & Invasion Overlap */}
        <div className="koma-hero-device-container">
          <motion.div
            className="koma-hero-device-frame"
            style={{
              rotateY: deviceRotateY,
              y: deviceY,
              x: mousePos.x,
              rotateX: mousePos.y * 0.3,
            }}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <DeviceFrame />
          </motion.div>
        </div>
      </div>

      {/* Numerated Bottom Module Strip */}
      <motion.div
        className="koma-hero-strip"
        role="list"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.65 }}
      >
        {HERO_STRIP_ITEMS.map((item) => (
          <div key={item.num} className="koma-hero-strip-item" role="listitem">
            <span className="koma-hero-strip-num">{item.num}</span>
            <span className="koma-hero-strip-name">{item.name}</span>
          </div>
        ))}
      </motion.div>
    </section>
  );
}
