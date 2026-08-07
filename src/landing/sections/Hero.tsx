import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { DeviceFrame } from '../components/DeviceFrame';

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  const deviceRotateY = useTransform(scrollYProgress, [0, 1], [-8, 0]);
  const deviceRotateX = useTransform(scrollYProgress, [0, 1], [5, 0]);
  const deviceY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const deviceOpacity = useTransform(scrollYProgress, [0.6, 1], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, 50]);

  return (
    <section ref={sectionRef} className="koma-hero" aria-label="Hero">
      {/* Background geometry */}
      <div className="koma-hero-geometry" aria-hidden="true">
        <div className="koma-hero-circle" />
        <div className="koma-hero-diagonal" />
      </div>

      {/* Main content */}
      <motion.div style={{ y: textY }} className="koma-hero-content">
        <h1 className="koma-hero-headline" aria-label="O restaurante não para">
          <span className="koma-hero-line koma-hero-line--sm">O</span>
          <span className="koma-hero-line koma-hero-line--xl">RESTAURANTE</span>
          <span className="koma-hero-bar" aria-hidden="true" />
          <span className="koma-hero-line koma-hero-line--lg">NÃO PARA.</span>
        </h1>

        <p className="koma-hero-sub">
          Pedido, cozinha, caixa, entrega.<br />
          Tudo no mesmo ritmo.
        </p>

        <div className="koma-hero-cta">
          <a href="#demonstracao" className="koma-btn koma-btn--primary">
            Solicitar demonstração
          </a>
        </div>
      </motion.div>

      {/* Tablet protagonist */}
      <motion.div
        className="koma-hero-device"
        style={{
          rotateY: deviceRotateY,
          rotateX: deviceRotateX,
          y: deviceY,
          opacity: deviceOpacity,
        }}
      >
        <DeviceFrame />
      </motion.div>
    </section>
  );
}
