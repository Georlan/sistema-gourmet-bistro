import React, { useRef } from 'react';
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

  const deviceRotateY = useTransform(scrollYProgress, [0, 1], [-10, 0]);
  const deviceRotateX = useTransform(scrollYProgress, [0, 1], [6, 0]);
  const deviceY = useTransform(scrollYProgress, [0, 1], [0, -50]);

  return (
    <section ref={sectionRef} className="koma-hero" aria-label="Hero">
      <div className="koma-hero-main">
        {/* Main headline */}
        <div className="koma-hero-content">
          <h1 className="koma-hero-headline" aria-label="O restaurante não para">
            <span className="koma-hero-line koma-hero-line--sm">O</span>
            <span className="koma-hero-line koma-hero-line--xl">RESTAURANTE</span>
            <span className="koma-hero-bar" aria-hidden="true" />
            <span className="koma-hero-line koma-hero-line--lg">NÃO PARA.</span>
          </h1>

          <p className="koma-hero-sub">
            Seu sistema também não.<br />
            Pedido, cozinha, caixa, entrega. Tudo no mesmo ritmo.
          </p>

          <div className="koma-hero-cta">
            <a href="#demonstracao" className="koma-btn koma-btn--primary">
              Solicitar demonstração
            </a>
          </div>
        </div>

        {/* Real Product Protagonist - 45-50% Viewport width */}
        <div className="koma-hero-device-wrap">
          <motion.div
            className="koma-hero-device"
            style={{
              rotateY: deviceRotateY,
              rotateX: deviceRotateX,
              y: deviceY,
            }}
          >
            <DeviceFrame />
          </motion.div>
        </div>
      </div>

      {/* Discrete Editorial Strip (NO stars, NO badges, NO pills) */}
      <div className="koma-hero-strip" role="list">
        {HERO_STRIP_ITEMS.map((item) => (
          <div key={item.num} className="koma-hero-strip-item" role="listitem">
            <span className="koma-hero-strip-num">{item.num}</span>
            <span className="koma-hero-strip-name">{item.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
